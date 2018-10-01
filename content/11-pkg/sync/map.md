# 11 标准库：sync.Map

sync.Map 宣称内部做了特殊的优化，在两种情况下由于普通的 map+mutex。在研究源码之前我们先来看看测试结果。
在测试中，我们测试了：n 个 key 中，每个 key 产生 1 次写行为，每个 key 产生 n 次读行为。

下面是随 n (#key) 变化的性能结果

![](../../../images/map-syncmap.png)

**图1：`map`+`sync.Mutex` 与 `sync.Map` 之间单次写多次读场景下的性能对比**

下面我们来研究一下 sync.Map 的具体优化细节。

## 结构

既然是并发安全，因此 sync.Map 一定会包含 Mutex。那么宣称的多次读场景下的优化一定是使用了某种特殊的
机制来保证安全的情况下可以不再使用 Mutex。

```go
// Map 是一种并发安全的 map[interface{}]interface{}，在多个 goroutine 中没有额外的锁条件
// 读取、存储和删除操作的时间复杂度平均为常量
//
// Map 类型非常特殊，大部分代码应该使用原始的 Go map。它具有单独的锁或协调以获得类型安全且更易维护。
//
// Map 类型针对两种常见的用例进行优化：
// 1. 给定 key 只会产生写一次但是却会多次读，类似乎只增的缓存
// 2. 多个 goroutine 读、写以及覆盖不同的 key
// 这两种情况下，与单独使用 Mutex 或 RWMutex 的 map 相比，会显著降低竞争情况
//
// 零值 Map 为空且可以直接使用，Map 使用后不能复制
type Map struct {
	mu Mutex

	// read 包含 map 内容的一部分，这些内容对于并发访问是安全的（有或不使用 mu）。
	//
	// read 字段 load 总是安全的，但是必须使用 mu 进行 store。
	//
	// 存储在 read 中的 entry 可以在没有 mu 的情况下并发更新，
	// 但是更新已经删除的 entry 需要将 entry 复制到 dirty map 中，并使用 mu 进行删除。
	read atomic.Value // 只读

	// dirty 含了需要 mu 的 map 内容的一部分。为了确保将 dirty map 快速地转为 read map，
	// 它还包括了 read map 中所有未删除的 entry。
	//
	// 删除的 entry 不会存储在 dirty map 中。在 clean map 中，被删除的 entry 必须被删除并添加到 dirty 中，
	// 然后才能将新的值存储为它
	//
	// 如果 dirty map 为 nil，则下一次的写行为会通过 clean map 的浅拷贝进行初始化
	dirty map[interface{}]*entry

	// misses 计算了从 read map 上一次更新开始的 load 数，需要 lock 以确定 key 是否存在。
	//
	// 一旦发生足够的 misses 足以囊括复制 dirty map 的成本，dirty map 将被提升为 read map（处于未修改状态）
	// 并且 map 的下一次 store 将生成新的 dirty 副本。
	misses int
}
```

在这个结构中，可以看到 `read` 和 `dirty` 分别对应两个 `map`，但 `read` 的结构比较特殊，是一个 `atomic.Value` 类型。
先不去管它，我们直接理解为一个 map，之后再来详细看它。

从 `misses` 的描述中可以大致看出 sync.Map 的思路是发生足够多的读时，就将 dirty map 复制一份到 read map 上。
从而实现在 read map 上的读操作不再需要昂贵的 Mutex 操作。

## `Store()`

我们先来看看 `Store()`。

```go
// Store 存储 key 对应的 value
func (m *Map) Store(key, value interface{}) {
	// 获得 read map
	read, _ := m.read.Load().(readOnly)

	// 修改一个已经存在的值
	// 读取 read map 中的值
	// 如果读到了，则尝试更新 read map 的值，如果更新成功，则直接返回，否则还要继续处理（当且仅当要更新的值被标记为删除）
	// 如果没读到，则还要继续处理（read map 中不存在）
	if e, ok := read.m[key]; ok && e.tryStore(&value) {
		return
	}
    (...)
}
```

可以看到，首先发生的是更新已经存在值的情况：
更新操作直接更新 read map 中的值，如果成功则不需要进行任何操作，如果没有成功才继续处理。

我们来看一下 `tryStore`。

```go
// tryStore 在 entry 还没有被删除的情况下存储其值
//
// 如果 entry 被删除了，则 tryStore 返回 false 且不修改 entry
func (e *entry) tryStore(i *interface{}) bool {

	// 读取 entry
	p := atomic.LoadPointer(&e.p)

	// 如果 entry 已经删除，则无法存储，返回
	if p == expunged {
		return false
	}

	for {
		// 交换 p 和 i 的值，原子操作，如果成功则立即返回
		if atomic.CompareAndSwapPointer(&e.p, p, unsafe.Pointer(i)) {
			return true
		}

		// 如果没有成功，则再读一次 entry
		p = atomic.LoadPointer(&e.p)
		// 如果 entry 已经删除，则无法存储，返回
		if p == expunged {
			return false
		}

		// 再次尝试，说明只要 key 不删除，那么更新操作一定会直接更新 read map，不涉及 dirty map
	}
}
```

从 `tryStore` 可以看出，在更新操作中只要没有发生 key 的删除情况，即值已经在 dirty map 中标记为删除，
更新操作一定只更新到 read map 中，不涉及与 dirty map 之间的数据同步。

我们继续看 `Store()` 剩下的部分。下面的情况就相对复杂一些了，在锁住结构后，
要做的第一件事情就是更新刚才读过的 read map。刚才我们仅仅只是修改一个已经存在的值，
现在我们面临三种情况：

**情况1**

```go
// Store 存储 key 对应的 value
func (m *Map) Store(key, value interface{}) {
	(...)

	m.mu.Lock()
	// 经过刚才的一系列操作，read map 可能已经更新了
	// 因此需要再读一次
	read, _ = m.read.Load().(readOnly)

	if e, ok := read.m[key]; ok {
		// 修改一个已经存在的值
		if e.unexpungeLocked() {
			// 说明 entry 先前是被标记为删除了的，现在我们又要存储它，只能向 dirty map 进行更新了
			m.dirty[key] = e
		}
		// 无论先前删除与否，都要更新 read map
		e.storeLocked(&value)
	} else if e, ok := m.dirty[key]; ok {
		(...)
	} else {
		(...)
	}
	m.mu.Unlock()
}
```

这种情况下，本质上还分两种情况：

1. 可能因为是一个已经删除的值（之前的 `tryStore` 失败）
2. 可能先前仅保存在 dirty map 然后同步到了 read map（TODO: 可能吗？）

对于第一种而言，我们需要重新将这个已经删除的值标记为没有删除，然后将这个值同步回 dirty map（删除操作只删除 dirty map，之后再说）
对于第二种状态，我们直接更新 read map，不需要打扰 dirty map。

**情况2**

```go
// Store 存储 key 对应的 value
func (m *Map) Store(key, value interface{}) {
	(...)
	if e, ok := read.m[key]; ok {
		(...)
	} else if e, ok := m.dirty[key]; ok {
		e.storeLocked(&value) // 更新 dirty map 的值即可
	} else {
		(...)
	}
	m.mu.Unlock()
}
```

我们发现 read map 中没有想要更新的值，那么看一下 dirty map 有没有，结果发现是有的，
那么我们直接修改 dirty map，不去打扰 read map。

**情况3**

```go
// Store 存储 key 对应的 value
func (m *Map) Store(key, value interface{}) {
	(...)
	if e, ok := read.m[key]; ok {
		(...)
	} else if e, ok := m.dirty[key]; ok {
		(...)
	} else {
		// 如果 dirty map 里没有 read map 没有的值（两者相同）
		if !read.amended {
			// 首次添加一个新的值到 dirty map 中
			// 确保已被分配并标记为 read map 是不完备的(dirty map 有 read map 没有的)
			m.dirtyLocked()
			// 更新 amended，标记 read map 中缺少了值（标记为两者不同）
			m.read.Store(readOnly{m: read.m, amended: true})
		}
		// 不管 read map 和 dirty map 相同与否，正式保存新的值
		m.dirty[key] = newEntry(value)
	}
	m.mu.Unlock()
}
// 只是简单的创建一个 entry
// entry 是一个对应于 map 中特殊 key 的 slot
type entry struct {
	// TODO: 解释这里
	// p points to the interface{} value stored for the entry.
	//
	// If p == nil, the entry has been deleted and m.dirty == nil.
	//
	// If p == expunged, the entry has been deleted, m.dirty != nil, and the entry
	// is missing from m.dirty.
	//
	// Otherwise, the entry is valid and recorded in m.read.m[key] and, if m.dirty
	// != nil, in m.dirty[key].
	//
	// An entry can be deleted by atomic replacement with nil: when m.dirty is
	// next created, it will atomically replace nil with expunged and leave
	// m.dirty[key] unset.
	//
	// An entry's associated value can be updated by atomic replacement, provided
	// p != expunged. If p == expunged, an entry's associated value can be updated
	// only after first setting m.dirty[key] = e so that lookups using the dirty
	// map find the entry.
	p unsafe.Pointer // *interface{}
}
func newEntry(i interface{}) *entry {
	return &entry{p: unsafe.Pointer(&i)}
}
```

read map 和 dirty map 都没有，只能是存储一个新值了。当然，在更新之前
我们还要再检查一下 read map 和 dirty map 的状态。
如果 read map 和 dirty map 中存储的内容是相同的，那么我们这次存储新的数据
只会存储在 dirty map 中，因此会造成 read map 和 dirty map 的不一致。

read map 和 dirty map 相同的情况，首先调用 `dirtyLocked()`。

```go
func (m *Map) dirtyLocked() {
	// 如果 dirty map 为空，则一切都很好，返回
	if m.dirty != nil {
		return
	}

	// 获得 read map
	read, _ := m.read.Load().(readOnly)

	// 创建一个与 read map 大小一样的 dirty map
	m.dirty = make(map[interface{}]*entry, len(read.m))

	// 依次将 read map 的值复制到 dirty map 中。
	for k, e := range read.m {
		if !e.tryExpungeLocked() {
			m.dirty[k] = e
		}
	}
}

func (e *entry) tryExpungeLocked() (isExpunged bool) {

	// 获取 entry 的值
	p := atomic.LoadPointer(&e.p)

	// 如果 entry 值是 nil
	for p == nil {
		// 检查是否被标记为已经删除
		if atomic.CompareAndSwapPointer(&e.p, nil, expunged) {
			// 成功交换，说明被标记为删除
			return true
		}
		// 删除操作失败，说明 expunged 是 nil，则重新读取一下
		p = atomic.LoadPointer(&e.p)
	}

	// 直到读到的 p不为 nil 时，则判断是否是标记为删除的对象
	return p == expunged
}
```

这个步骤中将 read map 中没有被标记为删除的值全部同步到了 dirty map 中。
然后将 dirty map 标记为与 read map 不同，因为接下来我们马上要把向 dirty map 存值了。

好了，至此我们完成了整个存储过程。小结一下：

1. 存储过程遵循互不影响的原则，如果在 read map 中读到，则只更新 read map，如果在 dirty map 中读到，则只更新 dirty map。
2. 优先从 read map 中读，更新失败才读 dirty map。
3. 存储新值的时候，如果 dirty map 中没有 read map 中的值，那么直接将整个 read map 同步到 dirty map。这时原来的 dirty map 被彻底覆盖（一些值依赖 GC 进行清理）。

## `Load()`

在平时使用 `Load()` 时，可能就存在疑惑，如果 `map` 中元素找不到，直接返回 `nil` 就可以了，为什么还需要一个 `ok` 的布尔值？
我们来看 `Load` 操作发生了什么。

## `Delete()`

再来看删除操作。

```go
// Delete 删除 key 对应的 value
func (m *Map) Delete(key interface{}) {
	// 获得 read map
	read, _ := m.read.Load().(readOnly)

	// 从 read map 中读取需要删除的 key
	e, ok := read.m[key]

	// 如果 read map 中没找到，且 read map 与 dirty map 不一致
	// 说明要删除的值在 dirty map 中
	if !ok && read.amended {
		// 在 dirty map 中需要加锁
		m.mu.Lock()
		// 再次读 read map
		read, _ = m.read.Load().(readOnly)
		// 从 read map 中取值
		e, ok = read.m[key]
		// 没取到，read map 和 dirty map 不一致
		if !ok && read.amended {
			// 删除 dierty map 的值
			delete(m.dirty, key)
		}
		m.mu.Unlock()
	}
	// 如果 read map 中找到了
	if ok {
		// 则执行删除
		e.delete()
	}
}

func (e *entry) delete() (hadValue bool) {
	for {
		// 读取 entry 的值
		p := atomic.LoadPointer(&e.p)

		// 如果 p 等于 nil，或者 p 已经标记删除
		if p == nil || p == expunged {
			// 则不需要删除
			return false
		}
		// 否则，将 p 的值与 nil 进行原子换
		if atomic.CompareAndSwapPointer(&e.p, p, nil) {
			// 删除成功（本质只是接触引用，实际上是留给 GC 清理）
			return true
		}
	}
}
```

从实现上来看，删除操作相对简单，当需要删除一个值时，移除 read map 中的值，本质上仅仅只是解除对变量的引用。
实际的回收是由 GC 进行处理。
如果 read map 中并未找到要删除的值，才会去尝试删除 dirty map 中的值。

## `Range()`

## `atomic.Value`

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-ND 4.0 & MIT &copy; [changkun](https://changkun.de)