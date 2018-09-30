# 11 标准库：sync.Pool

sync.Pool 是一个临时对象池。一句话来概括，sync.Pool 管理了一组临时对象，当需要时从池中获取，使用完毕后从再放回池中，以供他人使用。

使用 sync.Pool 只需要编写对象的创建方法：

```go
type Pool struct {
	noCopy noCopy // 最后来讨论这个

	local     unsafe.Pointer // local 固定大小 per-P 池, 实际类型为 [P]poolLocal
	localSize uintptr        // local array 的大小

    // New 方法在 Get 失败的情况下，选择性的创建一个值
	New func() interface{}
}
```

因此获取到的对象可能是刚被使用完毕放回池中的对象、亦或者是由 New 创建的新对象。

## 底层结构

上面已经看到 sync.Pool 内部本质上保存了一个 `poolLocal` 数组，每个 `poolLocal` 都只被一个 P 拥有。

```go
// Local per-P Pool appendix.
type poolLocalInternal struct {
	private interface{}   // 只能被不同的 P 使用.
	shared  []interface{} // 可以被任意 P 使用.
	Mutex                 // 并发锁
}

type poolLocal struct {
	poolLocalInternal

	// 将 poolLocal 补齐至两个缓存行的倍数，防止 false sharing,
	// 每个缓存行具有 64 bytes，即 512 bit
	// 目前我们的处理器一般拥有 32 * 1024 / 64 = 512 条缓存行
	pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

每个 `poolLocal` 的大小均为缓存行的偶数倍，包含一个 `private` 私有对象、`shared` 共享对象 slice 
以及一个 `Mutex` 并发锁。

## Get

当从池中获取对象时，会先从 per-P 的 `poolLocal` slice 中选取一个 `poolLocal`，选择策略遵循：

1. 优先从 private 中选择对象
2. 若取不到，则对 shared slice 加锁，取最后一个
3. 若取不到，则尝试从其他线程中 steal
4. 若还是取不到，则使用 New 方法新建

```go
// Get 从 Pool 中选择一个任意的对象，将其移出 Pool, 并返回给调用方.
// Get 可能会返回一个非零值对象（被其他人使用过），因此调用方不应假设
// 返回的对象具有任何形式的状态.
func (p *Pool) Get() interface{} {

	// 如果启用了 race 检查，则先停用
	if race.Enabled {
		race.Disable()
	}

	// 返回 poolLocal
	l := p.pin()

	// 先从 private 选择
	x := l.private
	l.private = nil
	runtime_procUnpin()
	if x == nil {

		// 加锁，从 shared 获取
		l.Lock()

		// 从 shared 尾部取缓存对象
		last := len(l.shared) - 1
		if last >= 0 {
			x = l.shared[last]
			l.shared = l.shared[:last]
		}
		l.Unlock()

		// 如果取不到，则获取新的缓存对象
		if x == nil {
			x = p.getSlow()
		}
	}

	// 恢复 race 检查
	if race.Enabled {
		race.Enable()
		if x != nil {
			race.Acquire(poolRaceAddr(x))
		}
	}

	// 如果 getSlow 还是获取不到，则 New 一个
	if x == nil && p.New != nil {
		x = p.New()
	}
	return x
}
```

## Put

`Put` 的过程则相对简单，只需要将对象放回到池中。与取出一样，放回同样拥有策略：

1. 优先放入 `private`
2. 如果 private 已经有值，即不能放入，则尝试放入 `shared`

```go
// Put 将 x 放回到池中
func (p *Pool) Put(x interface{}) {
	if x == nil {
		return
	}

	// 停用 race
	if race.Enabled {
		if fastrand()%4 == 0 {
			// Randomly drop x on floor.
			return
		}
		race.ReleaseMerge(poolRaceAddr(x))
		race.Disable()
	}

	// 获取 localPool
	l := p.pin()

	// 优先放入 private
	if l.private == nil {
		l.private = x
		x = nil
	}
	runtime_procUnpin()

	// 如果不能放入 private 则放入 shared
	if x != nil {
		l.Lock()
		l.shared = append(l.shared, x)
		l.Unlock()
	}

	// 恢复 race
	if race.Enabled {
		race.Enable()
	}
}
```

## 细节

上面已经介绍了 `Get/Put` 的具体策略。我们还有一些细节需要处理：

### `pin()`

`pin()` 用于取当前 P 中的 `poolLocal`。我们来仔细看一下它的实现细节。

```go
// pin 会将当前 goroutine 订到 P 上, 禁止抢占(preemption) 并从 poolLocal 池中返回 P 对应的 poolLocal
// 调用方必须在完成取值后调用 runtime_procUnpin() 来取消抢占。
func (p *Pool) pin() *poolLocal {
	// 返回当前 P.id
	pid := runtime_procPin()
	// 在 pinSlow 中会存储 localSize 后再存储 local，因此这里反过来读取
	// 因为我们已经禁用了抢占，这时不会发生 GC
	// 因此，我们必须观察 local 和 localSize 是否对应
	// 观察到一个全新或很大的的 local 是正常行为
	s := atomic.LoadUintptr(&p.localSize) // load-acquire
	l := p.local                          // load-consume
	// 因为可能存在动态的 P（运行时调整 P 的个数）procresize/GOMAXPROCS
	// 如果 P.id 没有越界，则直接返回
	if uintptr(pid) < s {
		return indexLocal(l, pid)
	}
	// 没有结果时，涉及全局加锁
	// 例如重新分配数组内存，添加到全局列表
	return p.pinSlow()
}
```

`pin()` 首先会调用运行时实现获得当前 P 的 id，将 P 设置为禁止抢占。然后检查 pid 与 p.localSize 的值
来确保从 p.local 中取值不会发生越界。如果不会发生，则调用 `indexLocal()` 完成取值。否则还需要继续调用 
`pinSlow()`。

```go
func indexLocal(l unsafe.Pointer, i int) *poolLocal {
	// 简单的通过 p.local 的头指针与索引来第 i 个 pooLocal
	lp := unsafe.Pointer(uintptr(l) + uintptr(i)*unsafe.Sizeof(poolLocal{}))
	return (*poolLocal)(lp)
}
```

在这个过程中我们可以看到在运行时调整 P 的大小的代价。如果此时 P 被调大，而没有对应的 `poolLocal` 时，
必须在取之前创建好，从而必须依赖全局加锁，这对于以性能著称的池化概念是比较致命的，因此这也是 `pinSlow` 的由来。

### `pinSlow()`

因为需要对全局进行加锁，`pinSlow()` 会首先取消 P 的不可抢占，然后使用 `allPoolsMu` 进行加锁：

```go
var (
	allPoolsMu Mutex
	allPools   []*Pool
)
```

当完成加锁后，再重新固定 P ，取其 pid。注意，因为中途可能已经被其他的线程调用，因此这时候需要再次对 pid 进行检查。
如果 pid 在 p.local 大小范围内，则不再此时创建，直接返回。

如果 `p.local` 为空，则将 p 扔给 `allPools` 并在垃圾回收阶段回收所有 Pool 实例。
最后再完成对 `p.local` 的创建（彻底丢弃旧数组）

```go
func (p *Pool) pinSlow() *poolLocal {
	// 这时取消 P 的禁止抢占，因为使用 mutex 时候 P 必须可抢占
	runtime_procUnpin()

	// 加锁
	allPoolsMu.Lock()
	defer allPoolsMu.Unlock()

	// 当锁住后，再次固定 P 取其 id
	pid := runtime_procPin()

	// 并再次检查是否符合条件，因为可能中途已被其他线程调用
	// 当再次固定 P 时 poolCleanup 不会被调用
	s := p.localSize
	l := p.local
	if uintptr(pid) < s {
		return indexLocal(l, pid)
	}

	// 如果数组为空，新建
	// 将其添加到 allPools，垃圾回收器从这里获取所有 Pool 实例
	if p.local == nil {
		allPools = append(allPools, p)
	}

	// 根据 P 数量创建 slice，如果 GOMAXPROCS 在 GC 间发生变化
	// 我们重新分配此数组并丢弃旧的
	size := runtime.GOMAXPROCS(0)
	local := make([]poolLocal, size)

	// 将底层数组起始指针保存到 p.local，并设置 p.localSize
	atomic.StorePointer(&p.local, unsafe.Pointer(&local[0])) // store-release
	atomic.StoreUintptr(&p.localSize, uintptr(size))         // store-release

	// 返回所需的 pollLocal
	return &local[pid]
}
```

### `getSlow()`

终于，我们获取到了 `poolLocal`。就回到了我们从中取值的过程。在取对象的过程中，我们仍然会面临
既不能从 private 取、也不能从 shared 中取得尴尬境地。这时候就来到了 `getSlow()`。

试想，如果我们在本地的 P 中取不到值，是不是可以考虑从别人那里偷一点过来？总会比创建一个新的要快。
因此，我们再次固定 P，并取得当前的 P.id 来从其他 P 中偷值，那么我们需要先获取到其他 P 对应的
`poolLocal`。假设 `size` 为数组的大小，`local` 为 `p.local`，那么尝试遍历其他所有 P：

```go
for i := 0; i < int(size); i++ {
	// 获取目标 poolLocal, 引入 pid 保证不是自身
	l := indexLocal(local, (pid+i+1)%int(size))
```

我们来证明一下此处确实不会发生取到自身的情况，不妨设：`pid = (pid+i+1)%size` 则 `pid+i+1 = a*size+pid`。
即：`a*size = i+1`，其中 a 为整数。由于 `i<size`，于是 `a*size = i+1 < size+1`，则：
`(a-1)*size < 1` ==> `size < 1 / (a-1)`，由于 `size` 为非负整数，这是不可能的。

因此当取到其他 `poolLocal` 时，便能从 shared 中取对象了。

```go
func (p *Pool) getSlow() (x interface{}) {
	size := atomic.LoadUintptr(&p.localSize) // load-acquire
	local := p.local                         // load-consume

	// 获取 P.id
	// 从其他 proc (poolLocal) steal 一个对象
	pid := runtime_procPin()
	runtime_procUnpin()
	for i := 0; i < int(size); i++ {
		// 获取目标 poolLocal, 引入 pid 保证不是自身
		l := indexLocal(local, (pid+i+1)%int(size))

		// 对目标 poolLocal 加锁，用于访问 share 区域
		l.Lock()

		// steal 一个缓存对象
		last := len(l.shared) - 1
		if last >= 0 {
			x = l.shared[last]
			l.shared = l.shared[:last]
			l.Unlock()
			break
		}
		l.Unlock()
	}
	return x
}
```

## 运行时垃圾回收

sync.Pool 的垃圾回收发生在运行时 GC 开始之前。

`src/sync/pool.go`:

```go
// 将缓存清理函数注册到运行时 GC 时间段
func init() {
	runtime_registerPoolCleanup(poolCleanup)
}

// 由运行时实现
func runtime_registerPoolCleanup(cleanup func())
```

`src/runtime/mgc.go`:

```go
var poolcleanup func()
// 利用编译器标志将 sync 包中的清理注册到运行时
//go:linkname sync_runtime_registerPoolCleanup sync.runtime_registerPoolCleanup
func sync_runtime_registerPoolCleanup(f func()) {
	poolcleanup = f
}

// 实现缓存清理
func clearpools() {
	// clear sync.Pools
	if poolcleanup != nil {
		poolcleanup()
	}
    (...)
}
```

再来看实际的清理函数：

```go
func poolCleanup() {
	// 该函数会注册到运行时 GC 阶段(前)，此时为 STW 状态，不需要加锁
	// 它必须不处理分配且不调用任何运行时函数，防御性的将一切归零，有以下两点原因:
	// 1. 防止整个 Pool 的 false retention
	// 2. 如果 GC 发生在当有 goroutine 与 l.shared 进行 Put/Get 时，它会保留整个 Pool.
	//    那么下个 GC 周期的内存消耗将会翻倍。
	// 遍历所有 Pool 实例，接触相关引用，交由 GC 进行回收
	for i, p := range allPools {

		// 解除引用
		allPools[i] = nil

		// 遍历 p.localSize 数组
		for i := 0; i < int(p.localSize); i++ {

			// 获取 poolLocal
			l := indexLocal(p.local, i)

			// 清理 private 和 shared 区域
			l.private = nil
			for j := range l.shared {
				l.shared[j] = nil
			}
			l.shared = nil
		}

		// 设置 p.local = nil 除解引用之外的数组空间
		// 同时 p.pinSlow 方法会将其重新添加到 allPool
		p.local = nil
		p.localSize = 0
	}

	// 重置 allPools，需要所有 p.pinSlow 重新添加
	allPools = []*Pool{}
}
```

## `noCopy`

noCopy 是 go1.7 开始引入的一个静态检查机制。它不仅仅工作在运行时或标准库，同时也对用户代码有效。
用户只需实现这样的不消耗内存、仅用于静态分析的结构来保证一个对象在第一次使用后不会发生复制。

```go
// noCopy 用于嵌入一个结构体中来保证其第一次使用后不会被复制
//
// 见 https://golang.org/issues/8005#issuecomment-190753527
type noCopy struct{}

// Lock 是一个空操作用来给 `go vet` 的 -copylocks 静态分析
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

## 总结

至此，我们完整分析了 sync.Pool 的所有代码。总结：

```
        goroutine      goroutine       goroutine
           |               |               |
           P               P               P
           |               |               |
         private        private          private
           |               |               |
    [   poolLocal      poolLocal        poolLocal  ]    sync.Pool
           |               |               |
    [share1 share2] [share1 share2] [share1 share2]
```

一个 goroutine 固定在 P 上，从当前 P 对应的 `poolLocal` 取值，
若取不到，则从对应的 shared 上取，若还是取不到，则尝试从其他 P 的 shared 中偷。
若偷不到，则调用 New 创建一个新的对象。池中所有临时对象在一次 GC 后会被全部清空。

对于调用方而言，当 Get 到临时对象后，便脱离了池本身不受控制。
用方有责任将使用完的对象放回池中。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-ND 4.0 & MIT &copy; [changkun](https://changkun.de)