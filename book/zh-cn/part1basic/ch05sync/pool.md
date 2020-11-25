---
weight: 1506
title: "5.6 缓存池"
---

# 5.6 缓存池

`sync.Pool` 是一个临时对象池。一句话来概括，`sync.Pool` 管理了一组临时对象，
当需要时从池中获取，使用完毕后从再放回池中，以供他人使用。其公共方法与成员包括：

```go
type Pool struct {
	New func() interface{}
	...
}
// Get 从 Pool 中选择一个任意的对象，将其移出 Pool, 并返回给调用方。
// Get 可能会返回一个非零值对象（被其他人使用过），因此调用方不应假设
// 返回的对象具有任何形式的状态。
func (p *Pool) Get() interface{} { ... }
func (p *Pool) Put(x interface{}) { ... }
```

使用 `sync.Pool` 只需要指定 `sync.Pool` 对象的创建方法 `New`，
则在使用 `sync.Pool.Get` 失败的情况下，会池的内部会选择性的创建一个新的值。
因此获取到的对象可能是刚被使用完毕放回池中的对象、亦或者是由 `New` 创建的新对象。

## 底层结构

`sync.Pool` 未公开的字段包括：

```go
type Pool struct {
	local     unsafe.Pointer // local 固定大小 per-P 数组, 实际类型为 [P]poolLocal
	localSize uintptr        // local array 的大小

	victim     unsafe.Pointer // 来自前一个周期的 local
	victimSize uintptr        // victim 数组的大小
	...
}
```

其内部本质上保存了一个 `poolLocal` 元素的数组，即 `local`，每个 `poolLocal` 都只被一个 P 拥有，
而 `victim` 则缓存了上一个垃圾回收周期的 `local`。

而 `poolLocal` 则由 `private` 和 `shared` 两个字段组成：

```go
type poolLocalInternal struct {
	private interface{}
	shared  poolChain
}

type poolLocal struct {
	poolLocalInternal
	pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

从前面结构体的字段不难猜测，`private` 是一个仅用于当前 P 进行读写的字段（即没有并发读写的问题），
而 shared 则遵循字面意思，可以在多个 P 之间进行共享读写，是一个 `poolChain` 链式队列结构，
我们先记住这个结构在局部 P 上可以进行 `pushHead` 和 `popHead` 操作（队头读写），
在所有 P 上都可以进行 `popTail` （队尾出队）操作，之后再来详细看它的实现细节。

## Get

当从池中获取对象时，会先从 per-P 的 `poolLocal` slice 中选取一个 `poolLocal`，选择策略遵循：

1. 优先从 private 中选择对象
2. 若取不到，则尝试从 `shared` 队列的队头进行读取
3. 若取不到，则尝试从其他的 P 中进行偷取 `getSlow`
4. 若还是取不到，则使用 New 方法新建

```go
func (p *Pool) Get() interface{} {
	...
	// 获取一个 poolLocal
	l, pid := p.pin()

	// 先从 private 获取对象
	x := l.private
	l.private = nil
	if x == nil {
		// 尝试从 localPool 的 shared 队列队头读取，
		// 因为队头的内存局部性比队尾更好。
		x, _ = l.shared.popHead()

		// 如果取不到，则获取新的缓存对象
		if x == nil {
			x = p.getSlow(pid)
		}
	}
	runtime_procUnpin()
	...

	// 如果 getSlow 还是获取不到，则 New 一个
	if x == nil && p.New != nil {
		x = p.New()
	}
	return x
}
```

其实我们不难看出：

1. `private` 只保存了一个对象;
2. 第一次从 `shared` 中取对象时，还未涉及跨 P 读写，因此 `popHead` 是可用的；
3. 当 `shared` 读取不到对象时，说明当前局部 P 所持有的 `localPool` 不包含任何对象，这时尝试从其他的 `localPool` 进行偷取。
4. 实在是偷不到，才考虑新创建一个对象。

## Put

`Put` 的过程则相对简单，只需要将对象放回到池中。
与 `Get` 取出一样，放回遵循策略：

1. 优先放入 `private`
2. 如果 private 已经有值，即不能放入，则尝试放入 `shared`

```go
// Put 将 x 放回到池中
func (p *Pool) Put(x interface{}) {
	if x == nil {
		return
	}
	...

	// 获得一个 localPool
	l, _ := p.pin()

	// 优先放入 private
	if l.private == nil {
		l.private = x
		x = nil
	}

	// 如果不能放入 private 则放入 shared
	if x != nil {
		l.shared.pushHead(x)
	}
	runtime_procUnpin()
	...
}
```

## 偷取细节

上面已经介绍了 `Get/Put` 的具体策略。我们还有一些细节需要处理。

### `pin()` 与 `pinSlow()`

`pin()` 用于取当前 P 中的 `poolLocal`。我们来仔细看一下它的实现细节。

```go
// pin 会将当前的 goroutine 固定到 P 上，禁用抢占，并返回 localPool 池以及当前 P 的 pid。
func (p *Pool) pin() (*poolLocal, int) {
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

`pin()` 首先会调用运行时实现获得当前 P 的 id，将 P 设置为禁止抢占，达到固定当前 goroutine 的目的。
然后检查 `pid` 与 `p.localSize` 的值来确保从 `p.local` 中取值不会发生越界。
如果不会发生，则调用 `indexLocal()` 完成取值。否则还需要继续调用 `pinSlow()`。

```go
func indexLocal(l unsafe.Pointer, i int) *poolLocal {
	// 简单的通过 p.local 的头指针与索引来第 i 个 pooLocal
	lp := unsafe.Pointer(uintptr(l) + uintptr(i)*unsafe.Sizeof(poolLocal{}))
	return (*poolLocal)(lp)
}
```

在这个过程中我们可以看到在运行时调整 P 的大小的代价。如果此时 P 被调大，而没有对应的 `poolLocal` 时，
必须在取之前创建好，从而必须依赖全局加锁，这对于以性能著称的池化概念是比较致命的。

既然需要对全局进行加锁，`pinSlow()` 会首先取消 P 的禁止抢占，这是因为使用 mutex 时 P 必须为可抢占的状态。
然后使用 `allPoolsMu` 进行加锁。
当完成加锁后，再重新固定 P ，取其 pid。注意，因为中途可能已经被其他的线程调用，因此这时候需要再次对 pid 进行检查。
如果 pid 在 p.local 大小范围内，则不再此时创建，直接返回。

如果 `p.local` 为空，则将 p 扔给 `allPools` 并在垃圾回收阶段回收所有 Pool 实例。
最后再完成对 `p.local` 的创建（彻底丢弃旧数组）：

```go
var (
	allPoolsMu Mutex
	// allPools 是一组 pool 的集合，具有非空主缓存。
	// 有两种形式来保护它的读写：1. allPoolsMu 锁; 2. STW.
	allPools   []*Pool
)

func (p *Pool) pinSlow() (*poolLocal, int) {
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
		return indexLocal(l, pid), pid
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
	return &local[pid], pid
}
```

### `getSlow()`

终于，我们获取到了 `poolLocal`，现在回到我们 `Get` 的取值过程。在取对象的过程中，我们仍然会面临
既不能从 `private` 取、也不能从 `shared` 中取得尴尬境地。这时候就来到了 `getSlow()`。

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
func (p *Pool) getSlow(pid int) (x interface{}) {
	size := atomic.LoadUintptr(&p.localSize) // load-acquire
	local := p.local                         // load-consume
	for i := 0; i < int(size); i++ {
		// 获取目标 poolLocal, 引入 pid 保证不是自身
		l := indexLocal(local, (pid+i+1)%int(size))

		// 从其他的 P 中固定的 localPool 的 share 队列的队尾偷一个缓存对象
		if x, _ := l.shared.popTail(); x != nil {
			return x
		}
	}

	// 当 local 失败后，尝试再尝试从上一个垃圾回收周期遗留下来的 victim。
	// 如果 pid 比 victim 遗留的 localPool 还大，则说明从根据此 pid 从
	// victim 获取 localPool 会发生越界（同时也表明此时 P 的数量已经发生变化）
	// 这时无法继续读取，直接返回 nil
	size = atomic.LoadUintptr(&p.victimSize)
	if uintptr(pid) >= size {
		return nil
	}

	// 获取 localPool，并优先读取 private
	locals = p.victim
	l := indexLocal(locals, pid)
	if x := l.private; x != nil {
		l.private = nil
		return x
	}
	for i := 0; i < int(size); i++ {
		l := indexLocal(locals, (pid+i)%int(size))
		// 从其他的 P 中固定的 localPool 的 share 队列的队尾偷一个缓存对象
		if x, _ := l.shared.popTail(); x != nil {
			return x
		}
	}

	// 将 victim 缓存置空，从而确保之后的 get 操作不再读取此处的值
	atomic.StoreUintptr(&p.victimSize, 0)
	return nil
}
```

## 缓存的回收

`sync.Pool` 的垃圾回收发生在运行时 GC 开始之前。

在 `src/sync/pool.go` 中:

```go
// 将缓存清理函数注册到运行时 GC 时间段
func init() {
	runtime_registerPoolCleanup(poolCleanup)
}

// 由运行时实现
func runtime_registerPoolCleanup(cleanup func())
```

在 `src/runtime/mgc.go` 中:

```go
// 开始 GC
func gcStart(trigger gcTrigger) {
	...
	clearpools()
	...
}

// 实现缓存清理
func clearpools() {
	// clear sync.Pools
	if poolcleanup != nil {
		poolcleanup()
	}
	...
}

var poolcleanup func()

// 利用编译器标志将 sync 包中的清理注册到运行时
//go:linkname sync_runtime_registerPoolCleanup sync.runtime_registerPoolCleanup
func sync_runtime_registerPoolCleanup(f func()) {
	poolcleanup = f
}
```

再来看实际的清理函数：

```go
// oldPools 是一组 pool 的集合，具有非空 victim 缓存。由 STW 保护
var oldPools []*Pool

func poolCleanup() {
	// 该函数会注册到运行时 GC 阶段(前)，此时为 STW 状态，不需要加锁
	// 它必须不处理分配且不调用任何运行时函数。

	// 由于此时是 STW，不存在用户态代码能尝试读取 localPool，进而所有的 P 都已固定（与 goroutine 绑定）

	// 从所有的 oldPols 中删除 victim
	for _, p := range oldPools {
		p.victim = nil
		p.victimSize = 0
	}

	// 将主缓存移动到 victim 缓存
	for _, p := range allPools {
		p.victim = p.local
		p.victimSize = p.localSize

		p.local = nil
		p.localSize = 0
	}

	// 具有非空主缓存的池现在具有非空的 victim 缓存，并且没有任何 pool 具有主缓存。
	oldPools, allPools = allPools, nil
}
```

注意，即便是最后 `p.local` 已经被置换到 `oldPools` 的 `p.victim`，其中的缓存对象仍然有可能被偷取放回到 `allPools`
中，从而延缓了 `victim` 中缓存对象被回收的速度。

## `poolChain`

前面已经看到 poolChain 的功能了：一个队首非并发安全、队尾并发安全的链式队列（变长）。
它的结构包含队头和队尾的两个 `poolChainElt` 指针：

```go
type poolChain struct {
	head *poolChainElt
	tail *poolChainElt
}
```

而从 `poolChainElt` 的结构我们可以看出，这是一个双向队列，包含 `next` 和 `prev` 指针：

```go
type poolChainElt struct {
	poolDequeue
	next, prev *poolChainElt
}
```

其中的 `poolDequeue` 是一个单生产者、多消费者的固定长度的环状队列，其中 headTail 字段的前 32 位
表示了下一个需要被填充的对象槽的索引，而后 32 位则表示了队列中最先被插入的数据的索引，
`eface` 数组存储了实际的对象，其 eface 依赖运行时对 `interface{}` 的实现，即一个 `interface{}` 由
`typ` 和 `val` 两段数据组成：

```go
type poolDequeue struct {
	headTail uint64
	vals []eface
}
type eface struct {
	typ, val unsafe.Pointer
}
```

因此 `poolChain` 本质上串联了若干个 `poolDequeue`。

### `poolChain` 的 `popHead`、`pushHead` 和 `popTail`

`poolChain` 实际上是多个生产者消费者模型的链表。
对于一个局部 P 而言，充当了多个队头的单一生产者，它可以安全的
在整个链表中所串联的队列的队头进行操作。
而其他的多个 P 而言，则充当了多个队尾的消费者，
可以在所串联的队列的队尾进行消费（偷取）。

`popHead` 操作发生在从本地 shared 队列中消费并获取对象（消费者）。
`pushHead` 操作发生在向本地 shared 队列中放置对象（生产者）。
`popTail` 操作则发生在从其他 P 的 shared 队列中偷取的过程。

```go
const (
	dequeueBits = 32
	dequeueLimit = (1 << dequeueBits) / 4
)
func (c *poolChain) popHead() (interface{}, bool) {
	d := c.head
	// d 是一个 poolDequeue，如果 d.popHead 是并发安全的，
	// 那么这里取 val 也是并发安全的。若 d.popHead 失败，则
	// 说明需要重新尝试。这个过程会持续到整个链表为空。
	for d != nil {
		if val, ok := d.popHead(); ok {
			return val, ok
		}
		d = loadPoolChainElt(&d.prev)
	}
	return nil, false
}
func (c *poolChain) pushHead(val interface{}) {
	d := c.head

	// 如果链表空，则创建一个新的链表
	if d == nil {
		const initSize = 8 // 固定长度为 8，必须为 2 的指数
		d = new(poolChainElt)
		d.vals = make([]eface, initSize)
		c.head = d
		storePoolChainElt(&c.tail, d)
	}

	// 如果向队列中存值失败，则检查是否当前队列已满
	if d.pushHead(val) {
		return
	}
	newSize := len(d.vals) * 2
	if newSize >= dequeueLimit {
		newSize = dequeueLimit
	}

	// 如果已满，则创建一个新的 poolDequeue
	// 由于是新创建的，则 push 一定会成功
	d2 := &poolChainElt{prev: d}
	d2.vals = make([]eface, newSize)
	c.head = d2
	storePoolChainElt(&d.next, d2)
	d2.pushHead(val)
}
func (c *poolChain) popTail() (interface{}, bool) {
	d := loadPoolChainElt(&c.tail)
	if d == nil {
		return nil, false
	}

	// 普通的 CAS 操作
	for {
		d2 := loadPoolChainElt(&d.next)
		if val, ok := d.popTail(); ok {
			return val, ok
		}
		if d2 == nil {
			return nil, false
		}
		if atomic.CompareAndSwapPointer((*unsafe.Pointer)(unsafe.Pointer(&c.tail)), unsafe.Pointer(d), unsafe.Pointer(d2)) {
			storePoolChainElt(&d2.prev, nil)
		}
		d = d2
	}
}
```

### `poolDequeue` 的 `popHead`、`pushHead` 和 `popTail`

正如前面所说 `poolDequeue` 是一个单生产者、多消费者的固定长度的环状队列，
`popHead`、`pushHead` 由局部的 P 操作队首，而 `popTail` 由其他并行的 P 操作队尾。
其中 `headTail` 字段的前 32 位表示了下一个需要被填充的对象槽的索引，
而后 32 位则表示了队列中最先被插入的数据的索引。

通过 `pack`/`unpack` 方法来实现对 `head` 和 `tail` 的读写：

```go
// 将 head 和 tail 指针从 d.headTail 中分离开来
func (d *poolDequeue) unpack(ptrs uint64) (head, tail uint32) {
	const mask = 1<<dequeueBits - 1
	head = uint32((ptrs >> dequeueBits) & mask)
	tail = uint32(ptrs & mask)
	return
}
// 将 head 和 tail 指针打包到 d.headTail 一个 64bit 的变量中
func (d *poolDequeue) pack(head, tail uint32) uint64 {
	const mask = 1<<dequeueBits - 1
	return (uint64(head) << dequeueBits) |
		uint64(tail&mask)
}
```

从 `poolChain` 的实现中我们可以看到，每个 `poolDequeue` 的 `vals` 长度为 8。
但由于是循环队列，实现中并不关心队列的长度，只要收尾元素的索引相等，则说明队列已满。
因此通过 CAS 原语实现单一生产者的对队头的读 `popHead` 和写 `pushHead`：

```go
func (d *poolDequeue) popHead() (interface{}, bool) {
	var slot *eface
	for {
		ptrs := atomic.LoadUint64(&d.headTail)
		head, tail := d.unpack(ptrs)
		if tail == head {
			return nil, false // 队列满
		}

		head--
		ptrs2 := d.pack(head, tail)
		if atomic.CompareAndSwapUint64(&d.headTail, ptrs, ptrs2) {
			slot = &d.vals[head&uint32(len(d.vals)-1)]
			break
		}
	}
	val := *(*interface{})(unsafe.Pointer(slot))
	if val == dequeueNil(nil) {
		val = nil
	}
	*slot = eface{}
	return val, true
}
func (d *poolDequeue) pushHead(val interface{}) bool {
	ptrs := atomic.LoadUint64(&d.headTail)
	head, tail := d.unpack(ptrs)
	if (tail+uint32(len(d.vals)))&(1<<dequeueBits-1) == head {
		return false // 队列满
	}
	slot := &d.vals[head&uint32(len(d.vals)-1)]

	// 此处可能与 popTail 发生竞争，参见 popTail
	typ := atomic.LoadPointer(&slot.typ)
	if typ != nil {
		return false
	}
	if val == nil {
		val = dequeueNil(nil)
	}
	*(*interface{})(unsafe.Pointer(slot)) = val
	atomic.AddUint64(&d.headTail, 1<<dequeueBits)
	return true
}
```

以及多个消费者读的处理手段非常巧妙，通过 `interface{}` 的 typ 和 val 两段式
结构的读写先后顺序，在 `popTail` 和 `pushHead` 之间消除了竞争：

```go
func (d *poolDequeue) popTail() (interface{}, bool) {
	var slot *eface
	for {
		ptrs := atomic.LoadUint64(&d.headTail)
		head, tail := d.unpack(ptrs)
		if tail == head {
			return nil, false // 队列满
		}
		ptrs2 := d.pack(head, tail+1)
		if atomic.CompareAndSwapUint64(&d.headTail, ptrs, ptrs2) {
			slot = &d.vals[tail&uint32(len(d.vals)-1)]
			break
		}
	}

	val := *(*interface{})(unsafe.Pointer(slot))
	if val == dequeueNil(nil) {
		val = nil
	}

	// 注意：此处可能与 pushHead 发生竞争，解决方案是：
	// 1. 让 pushHead 先读取 typ 的值，如果 typ 值不为 nil，则说明 popTail 尚未清理完 slot
	// 2. 让 popTail 先清理掉 val 中的内容，在清理掉 typ，从而确保不会与 pushHead 对 slot 的写行为发生竞争
	slot.val = nil
	atomic.StorePointer(&slot.typ, nil)
	return val, true
}
```

## 小结

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
         shared          shared          shared
```

一个 goroutine 固定在 P 上，从当前 P 对应的 `private` 取值，
shared 字段作为一个优化过的链式无锁变长队列，当在 `private` 取不到值的情况下，
从对应的 `shared` 队列的队首取，若还是取不到，则尝试从其他 P 的 `shared` 队列队尾中偷取。
若偷不到，则尝试从上一个 GC 周期遗留到 `victim` 缓存中取，否则调用 `New` 创建一个新的对象。

对于回收而言，池中所有临时对象在一次 GC 后会被放入 `victim` 缓存中，
而前一个周期被放入 `victim` 的缓存则会被清理掉。

对于调用方而言，当 Get 到临时对象后，便脱离了池本身不受控制。
用方有责任将使用完的对象放回池中。

本文中介绍的 `sync.Pool` 实现为 Go 1.13 优化过后的版本，相较于之前的版本，主要有以下几点优化：

1. 引入了 `victim` （二级）缓存，每次 GC 周期不再清理所有的缓存对象，而是将 `locals` 中的对象暂时放入 `victim` ，从而延迟到下一个 GC 周期进行回收；
2. 在下一个周期到来前，`victim` 中的缓存对象可能会被偷取，在 `Put` 操作后又重新回到 `locals` 中，这个过程发生在从其他 P 的 `shared` 队列中偷取不到、以及 `New` 一个新对象之前，进而是在牺牲了 `New` 新对象的速度的情况下换取的；
3. `poolLocal` 不再使用 `Mutex` 这类昂贵的锁来保证并发安全，取而代之的是使用了 CAS 算法优化实现的 `poolChain` 变长无锁双向链式队列。

这种两级缓存的优化的优势在于：

1. 显著降低了 GC 发生前清理当前周期中产生的大量缓存对象的影响：因为回收被推迟到了下个 GC 周期；
2. 显著降低了 GC 发生后 New 对象的成本：因为密集的缓存对象读写可能从上个周期中未清理的对象中偷取。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).