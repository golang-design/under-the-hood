// Copyright 2016 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package sync

import (
	"sync/atomic"
	"unsafe"
)

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

// readOnly 是一个原子写在 Map.read 字段中不可变的结构
type readOnly struct {
	m       map[interface{}]*entry
	amended bool // 如果 dirty map 包含了某个 m 中不存在的 key，则为 true
}

// expunged 是一个任意指针，标记了已经从 dirty map 中删除的 entry
var expunged = unsafe.Pointer(new(interface{}))

// entry 是一个对应于 map 中特殊 key 的 slot
type entry struct {
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

// Load 返回了存储在 map 中对应于 key 的值 value，如果不存在则返回 nil
// ok 表示了值能否在 map 中找到
func (m *Map) Load(key interface{}) (value interface{}, ok bool) {
	// 拿到只读 read map
	read, _ := m.read.Load().(readOnly)

	// 从只读 map 中读 key 对应的 value
	e, ok := read.m[key]

	// 如果在 read map 中找不到，且 dirty map 包含 read map 中不存在的 key，则进一步查找
	if !ok && read.amended {
		m.mu.Lock()
		// Avoid reporting a spurious miss if m.dirty got promoted while we were
		// blocked on m.mu. (If further loads of the same key will not miss, it's
		// not worth copying the dirty map for this key.)
		// 锁住后，再读一次 read map
		read, _ = m.read.Load().(readOnly)
		e, ok = read.m[key]
		// 如果这时 read map 还读不到，且 dirty map 与 read map 不一致
		if !ok && read.amended {
			// 则从 dirty map 中读
			e, ok = m.dirty[key]
			// Regardless of whether the entry was present, record a miss: this key
			// will take the slow path until the dirty map is promoted to the read
			// map.
			m.missLocked()
		}
		m.mu.Unlock()
	}
	// 如果 dirty map 中没有 read map 中不存在哎的 key，则确实没找到，返回 nil 和 false
	if !ok {
		return nil, false
	}
	// 如果找到了，则返回读到的值
	return e.load()
}

func (e *entry) load() (value interface{}, ok bool) {
	// 读 entry 的值
	p := atomic.LoadPointer(&e.p)

	// 如果值为 nil 或者已经删除
	if p == nil || p == expunged {
		// 则读不到
		return nil, false
	}
	// 否则读值
	return *(*interface{})(p), true
}

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
		e.storeLocked(&value) // 更新 dirty map 的值即可
	} else { // 存储一个全新的值

		// 如果 dirty map 里没有 read map 没有的值（两者相同）
		if !read.amended {
			// 首次添加一个新的值到 dirty map 中
			// 确保已被分配并标记为 read map 是不完备的(dirty map 有 read map 没有的)
			m.dirtyLocked()
			// 更新 amended，标记 read map 中缺少了值（两者不同）
			m.read.Store(readOnly{m: read.m, amended: true})
		}
		// 不管 read map 和 dirty map 相同与否，正式保存新的值
		m.dirty[key] = newEntry(value)
	}
	m.mu.Unlock()
}

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

// unexpungeLocked 确认 entry 是否没有被标记为删除
//
// 如果 entry 已经被标记删除，它必须在 m.mu unlock 之前被添加到 dirty map
func (e *entry) unexpungeLocked() (wasExpunged bool) {
	// 这个函数会交换 expunged 与 nil 的值
	// 如果 expunged 不是 nil，则会发生交换，则说明被标记为删除过，否则说明没有被标记过
	return atomic.CompareAndSwapPointer(&e.p, expunged, nil)
}

// 无条件将值存储到 entry 中，必须已知不被删除
func (e *entry) storeLocked(i *interface{}) {
	atomic.StorePointer(&e.p, unsafe.Pointer(i))
}

// LoadOrStore returns the existing value for the key if present.
// Otherwise, it stores and returns the given value.
// The loaded result is true if the value was loaded, false if stored.
func (m *Map) LoadOrStore(key, value interface{}) (actual interface{}, loaded bool) {
	// Avoid locking if it's a clean hit.
	read, _ := m.read.Load().(readOnly)
	if e, ok := read.m[key]; ok {
		actual, loaded, ok := e.tryLoadOrStore(value)
		if ok {
			return actual, loaded
		}
	}

	m.mu.Lock()
	read, _ = m.read.Load().(readOnly)
	if e, ok := read.m[key]; ok {
		if e.unexpungeLocked() {
			m.dirty[key] = e
		}
		actual, loaded, _ = e.tryLoadOrStore(value)
	} else if e, ok := m.dirty[key]; ok {
		actual, loaded, _ = e.tryLoadOrStore(value)
		m.missLocked()
	} else {
		if !read.amended {
			// We're adding the first new key to the dirty map.
			// Make sure it is allocated and mark the read-only map as incomplete.
			m.dirtyLocked()
			m.read.Store(readOnly{m: read.m, amended: true})
		}
		m.dirty[key] = newEntry(value)
		actual, loaded = value, false
	}
	m.mu.Unlock()

	return actual, loaded
}

// tryLoadOrStore atomically loads or stores a value if the entry is not
// expunged.
//
// If the entry is expunged, tryLoadOrStore leaves the entry unchanged and
// returns with ok==false.
func (e *entry) tryLoadOrStore(i interface{}) (actual interface{}, loaded, ok bool) {
	p := atomic.LoadPointer(&e.p)
	if p == expunged {
		return nil, false, false
	}
	if p != nil {
		return *(*interface{})(p), true, true
	}

	// Copy the interface after the first load to make this method more amenable
	// to escape analysis: if we hit the "load" path or the entry is expunged, we
	// shouldn't bother heap-allocating.
	ic := i
	for {
		if atomic.CompareAndSwapPointer(&e.p, nil, unsafe.Pointer(&ic)) {
			return i, false, true
		}
		p = atomic.LoadPointer(&e.p)
		if p == expunged {
			return nil, false, false
		}
		if p != nil {
			return *(*interface{})(p), true, true
		}
	}
}

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

// Range calls f sequentially for each key and value present in the map.
// If f returns false, range stops the iteration.
//
// Range does not necessarily correspond to any consistent snapshot of the Map's
// contents: no key will be visited more than once, but if the value for any key
// is stored or deleted concurrently, Range may reflect any mapping for that key
// from any point during the Range call.
//
// Range may be O(N) with the number of elements in the map even if f returns
// false after a constant number of calls.
func (m *Map) Range(f func(key, value interface{}) bool) {
	// We need to be able to iterate over all of the keys that were already
	// present at the start of the call to Range.
	// If read.amended is false, then read.m satisfies that property without
	// requiring us to hold m.mu for a long time.
	read, _ := m.read.Load().(readOnly)
	if read.amended {
		// m.dirty contains keys not in read.m. Fortunately, Range is already O(N)
		// (assuming the caller does not break out early), so a call to Range
		// amortizes an entire copy of the map: we can promote the dirty copy
		// immediately!
		m.mu.Lock()
		read, _ = m.read.Load().(readOnly)
		if read.amended {
			read = readOnly{m: m.dirty}
			m.read.Store(read)
			m.dirty = nil
			m.misses = 0
		}
		m.mu.Unlock()
	}

	for k, e := range read.m {
		v, ok := e.load()
		if !ok {
			continue
		}
		if !f(k, v) {
			break
		}
	}
}

func (m *Map) missLocked() {
	m.misses++
	if m.misses < len(m.dirty) {
		return
	}
	m.read.Store(readOnly{m: m.dirty})
	m.dirty = nil
	m.misses = 0
}

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
