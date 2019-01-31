# 调度器: 基本知识

在详细进入代码之前，我们了解一下调度器的设计原则及一些基本概念来建立较为宏观的认识。
运行时调度器的任务是给不同的工作线程 (worker thread) 分发 ready-to-run goroutine。

理解调度器涉及的主要概念包括以下三个：

- G: goroutine。
- M: worker thread, 或 machine。
- P: processor，是一种执行 Go 代码被要求资源。M 必须关联一个 P 才能执行 Go 代码，但它可以被阻塞或在一个系统调用中没有关联的 P。

## 工作线程的 park/unpark

调度器的设计需要在保持足够的运行 worker thread 来利用有效硬件并发资源、和 park 运行
过多的 worker thread 来节约 CPU 能耗之间进行权衡。但是这个权衡并不简单，有以下两点原因：

1. 调度器状态是有意分布的（具体而言，是一个 per-P 的 work 队列），因此在快速路径
（fast path）计算出全局断言 (global predicates) 是不可能的。
2. 为了获得最佳的线程管理，我们必须知晓未来的情况（当一个新的 goroutine 会
在不久的将来 ready，则不再 park 一个 worker thread）

以下的三种方法不被采纳：

1. 集中式管理所有调度器状态（会将限制可扩展性）
2. 直接切换 goroutine。也就是说，当我们 ready 一个新的 goroutine 时，让出一个 P，
   unpark 一个线程并切换到这个线程运行 goroutine。因为 ready 的 goroutine 线程可能
   在下一个瞬间 out of work，从而导致线程 thrashing（当计算机虚拟内存饱和时会发生
   thrashing，最终导致分页调度状态不再变化。这个状态会一直持续，知道用户关闭一些运行的
   应用或者活跃进程释放一些虚拟内存资源），因此我们需要 park 这个线程。同样，我们
   希望在相同的线程内保存维护 goroutine，这种方式还会摧毁计算的局部性原理。
3. 任何时候 ready 一个 goroutine 时也存在一个空闲的 P 时，都 unpark 一个额外的线程，
   但不进行切换。因为额外线程会在没有检查任何 work 的情况下立即 park ，最终导致大量线程的
   parking/unparking。

目前的调度器实现方式为：

如果存在一个空闲的 P 并且没有 spinning 状态的工作线程，当 ready 一个 goroutine 时，
就 unpark 一个额外的线程。如果一个工作线程的本地队列里没有 work ，且在全局运行队列或 netpoller
中也没有 work，则称一个工作线程被称之为 **spinning** ；spinning 状态由 `sched.nmspinning` 和
`m.spinning` 表示。

这种方式下被 unpark 的线程同样也成为 spinning，我们也不对这种线程进行 goroutine 切换，
因此这类线程最初就是没有 work 的状态。spinning 线程会在 park 前，从 per-P 中运行队列中寻找 work。
如果一个 spinning 进程发现 work，就会将自身切换出 spinning 状态，并且开始执行。

如果它没有发现 work 则会将自己带 spinning 转状态然后进行 park。

如果至少有一个 spinning 进程（`sched.nmspinning>1`），则 ready 一个 goroutine 时，
不会去 unpark 一个新的线程。作为补偿，如果最后一个 spinning 线程发现 work 并且停止 spinning，
则必须 unpark 一个新的 spinning 线程。这个方法消除了不合理的线程 unpark 峰值，
且同时保证最终的最大 CPU 并行度利用率。

主要的实现复杂性表现为当进行 spinning->non-spinning 线程转换时必须非常小心。这种转换在提交一个
新的 goroutine ，并且任何一个部分都需要取消另一个工作线程会发生竞争。如果双方均失败，则会以半静态
CPU 利用不足而结束。

ready 一个 goroutine 的通用范式为：

- 提交一个 goroutine 到 per-P 的局部 work 队列
- `#StoreLoad-style` write barrier
- 检查 `sched.nmspinning`

从 spinning->non-spinning 转换的一般模式为：

- 减少 `nmspinning`
- `#StoreLoad-style` write barrier
- 在所有 per-P 任务队列检查新的 work

注意，此种复杂性并不适用于全局任务队列，因为我们不会蠢到当给一个全局队列提交 work 时进行线程 unpark。

## 主要结构

这里仅仅只是对 M/P/G 以及调度器结构的一个简单陈列，初次阅读此结构会感觉虚无缥缈，不知道在看什么。
事实上，我们更应该直接深入调度器相关的代码来逐个理解每个字段的实际用途。
这里仅在每个结构后简单讨论其宏观作用，用作后文参考。

### M 的结构

M 是 OS 线程的实体。

> 位于 `runtime/runtime2.go`

```go
type m struct {
	g0      *g     // 用于执行调度指令的 goroutine
	morebuf gobuf  // morestack 的 gobuf 参数
	divmod  uint32 // div/mod denominator for arm - known to liblink

	// debugger 不知道的字段
	procid        uint64       // 用于 debugger，偏移量不是写死的
	gsignal       *g           // 处理 signal 的 g
	goSigStack    gsignalStack // Go 分配的 signal handling 栈
	sigmask       sigset       // 用于保存 saved signal mask
	tls           [6]uintptr   // thread-local storage (对 x86 而言为额外的寄存器)
	mstartfn      func()
	curg          *g       // 当前运行的用户 goroutine
	caughtsig     guintptr // goroutine 在 fatal signal 中运行
	p             puintptr // attached p for executing go code (nil if not executing go code)
	nextp         puintptr
	oldp          puintptr // 执行系统调用之前绑定的 p
	id            int64
	mallocing     int32
	throwing      int32
	preemptoff    string // 如果不为空串 ""，继续让当前 g 运行在该 M 上
	locks         int32
	dying         int32
	profilehz     int32
	spinning      bool // m 当前没有运行 work 且正处于寻找 work 的活跃状态
	blocked       bool // m 阻塞在一个 note 上
	inwb          bool // m 正在执行 write barrier
	newSigstack   bool // C 线程上的 minit 调用了 signalstack（C 调用 Go?）
	printlock     int8
	incgo         bool   // m 正在执行 cgo 调用
	freeWait      uint32 // if == 0, safe to free g0 and delete m (atomic)
	fastrand      [2]uint32
	needextram    bool
	(...)
	ncgocall      uint64      // 总共的 cgo 调用数
	ncgo          int32       // 正在进行的 cgo 调用数
	cgoCallersUse uint32      // 如果非零，则表示 cgoCaller 正在临时使用
	cgoCallers    *cgoCallers // cgo 调用崩溃的 cgo 回溯
	park          note
	alllink       *m // 在 allm 上
	schedlink     muintptr
	mcache        *mcache
	lockedg       guintptr
	createstack   [32]uintptr    // 当前线程创建的栈
	lockedExt     uint32         // 外部 LockOSThread 追踪
	lockedInt     uint32         // 内部 lockOSThread 追踪
	nextwaitm     muintptr       // 正在等待锁的下一个 m
	waitunlockf   unsafe.Pointer // todo go func(*g, unsafe.pointer) bool
	waitlock      unsafe.Pointer
	waittraceev   byte
	waittraceskip int
	startingtrace bool
	syscalltick   uint32
	thread        uintptr // 线程处理
	freelink      *m      // 在 sched.freem 上
	(...)
}
```

在这个结构里，它自身会：

- 持有一个（假装）运行它的 P
- 持有一个用于信号处理的 G
- 持有当前正在运行的 G
- 管理在它身上执行的 cgo 调用
- 将自己与其他的 M 进行串联

以及一些用于分析的调试字段等。

### P 的结构

P 只是处理器的抽象，而非处理器本身，它存在的意义在于实现 work-stealing 算法。
简单来说，每个 P 持有一个 G 的本地队列。

在没有 P 的情况下，所有的 G 只能放在一个全局的队列中。
当 M 执行完 G 而没有 G 可执行时，必须将队列锁住从而取值。

当引入了 P 之后，P 持有 G 的本地队列，而持有 P 的 M 执行完 G 后在 P 本地队列中没有发现其他 G 可以执行时，
会从其他的 P 的本地队列偷取（steal）一个 G 来执行，只有在所有的 P 都偷不到的情况下才去全局队列里面取。

一个不恰当的比喻：银行服务台排队中身手敏捷的顾客，当一个服务台队列空（没有人）时，
马上会有在其他队列排队的顾客迅速跑到这个没人的服务台来，这就是所谓的偷取。

```go
type p struct {
	lock mutex

	id          int32
	status      uint32 // p 的状态 pidle/prunning/...
	link        puintptr
	schedtick   uint32     // 每次调度器调用都会增加
	syscalltick uint32     // 每次进行系统调用都会增加
	sysmontick  sysmontick // 系统监控观察到的最后一次记录
	m           muintptr   // 反向链接到关联的 m （nil 则表示 idle）
	mcache      *mcache
	racectx     uintptr

	deferpool    [5][]*_defer // 不同大小的可用的 defer 结构池 (见 panic.go)
	deferpoolbuf [5][32]*_defer

	// goroutine id 的缓存，用于均摊 runtime·sched.goidgen 的访问
	// 见 runtime.newproc
	goidcache    uint64
	goidcacheend uint64

	// 可运行的 goroutine 队列，可无锁访问
	runqhead uint32
	runqtail uint32
	runq     [256]guintptr
	// runnext 如果非 nil，则表示一个可运行的 G 已经由当前的 G ready
	// 并且当正在运行的 G 仍然有空余时间片时，应该直接运行它，
	// 而非 runq 运行队列中的 G。ready 的 G 会继承当前剩余的时间片。
	// 如果一组 goroutine 在 communicate-and-wait 模式中锁住，
	// 则会将其设置为一个 unit，并消除由于将 ready 的 goroutine 添加
	// 到运行队列末尾而导致的（可能很大的）调度延迟。
	runnext guintptr

	// 有效的 G (状态 == Gdead)
	gfree struct {
		gList
		n int32
	}

	sudogcache []*sudog
	sudogbuf   [128]*sudog

	tracebuf traceBufPtr

	// traceSweep 表示应该被 trace 的 sweep 事件
	// 这用于 defer sweep 开始事件，直到 span 实际被 sweep。
	traceSweep bool
	// traceSwept 和 traceReclaimed 会 trace 当前 sweep 循环中
	// sweeping 扫描和回收的字节数。
	traceSwept, traceReclaimed uintptr

	palloc persistentAlloc // per-P，用于避免 mutex

	// Per-P GC 状态
	gcAssistTime         int64 // assistAlloc 时间 (纳秒)
	gcFractionalMarkTime int64 // fractional mark worker 的时间 (纳秒)
	gcBgMarkWorker       guintptr
	gcMarkWorkerMode     gcMarkWorkerMode

	// gcMarkWorkerStartTime 为该 mark worker 开始的 nanotime()
	gcMarkWorkerStartTime int64

	// gcw 为当前 P 的 GC work buffer 缓存。该 work buffer 会被写入
	// write barrier，由 mutator 辅助消耗，并处理某些 GC 状态转换。
	gcw gcWork

	// wbBuf 是当前 P 的 GC 的 write barrier 缓存
	//
	// TODO: Consider caching this in the running G.
	wbBuf wbBuf

	runSafePointFn uint32 // 如果为 1, 则在下一个 safe-point 运行 sched.safePointFn

	pad cpu.CacheLinePad
}
```

所以整个结构除去 P 的本地 G 队列外，就是一些统计、调试、GC 辅助的字段了。

此外，P 既然是处理器的抽象，因此在 P 的数组中是绝对不允许发生 false sharing 的，
这也就是 P 最后有一个 cache line pad 的原因。

### G 的结构

G 既然是 goroutine，必然需要定义自身的（近乎无穷的）执行栈：

```go
type g struct {
	// Stack 参数
	// stack 描述了实际的栈内存：[stack.lo, stack.hi)
	stack stack // 偏移量与 runtime/cgo 一致
	// stackguard0 是对比 Go 栈增长的 prologue 的栈指针
	// 如果 sp 寄存器比 stackguard0 小（由于栈往低地址方向增长），会触发栈拷贝和调度
	// 通常情况下：stackguard0 = stack.lo + StackGuard，但被抢占时会变为 StackPreempt
	stackguard0 uintptr // 偏移量与 liblink 一致
	// stackguard1 是对比 C 栈增长的 prologue 的栈指针
	// 当位于 g0 和 gsignal 栈上时，值为 stack.lo + StackGuard
	// 在其他栈上值为 ~0 用于触发 morestackc (并 crash) 调用
	stackguard1 uintptr // 偏移量与 liblink 一致

	_panic         *_panic // innermost panic - 偏移量用于 liblink
	_defer         *_defer // innermost defer
	m              *m      // 当前的 m; 偏移量对 arm liblink 透明
	sched          gobuf
	syscallsp      uintptr        // 如果 status==Gsyscall, 则 syscallsp = sched.sp 并在 GC 期间使用
	syscallpc      uintptr        // 如果 status==Gsyscall, 则 syscallpc = sched.pc 并在 GC 期间使用
	stktopsp       uintptr        // 期望 sp 位于栈顶，用于回溯检查
	param          unsafe.Pointer // wakeup 唤醒时候传递的参数
	atomicstatus   uint32
	stackLock      uint32 // sigprof/scang 锁; TODO: fold in to atomicstatus
	goid           int64
	schedlink      guintptr
	waitsince      int64      // g 阻塞的时间
	waitreason     waitReason // 如果 status==Gwaiting，则记录等待的原因
	preempt        bool       // 抢占信号，stackguard0 = stackpreempt 的副本
	paniconfault   bool       // 发生 fault panic （不崩溃）的地址
	preemptscan    bool       // 为 gc 进行 scan 的被强占的 g
	gcscandone     bool       // g 执行栈已经 scan 了；此此段受 _Gscan 位保护
	gcscanvalid    bool       // 在 gc 周期开始时为 false；当 G 从上次 scan 后就没有运行时为 true TODO: remove?
	throwsplit     bool       // 必须不能进行栈拆分
	raceignore     int8       // 忽略 race 检查事件
	sysblocktraced bool       // StartTrace 已经出发了此 goroutine 的 EvGoInSyscall
	sysexitticks   int64      // 当 syscall 返回时的 cputicks（用于跟踪）
	traceseq       uint64     // trace event sequencer 跟踪事件排序器
	tracelastp     puintptr   // 最后一个为此 goroutine 触发事件的 P
	lockedm        muintptr
	sig            uint32
	writebuf       []byte
	sigcode0       uintptr
	sigcode1       uintptr
	sigpc          uintptr
	gopc           uintptr         // 当前创建 goroutine go 语句的 pc 寄存器
	ancestors      *[]ancestorInfo // 创建此 goroutine 的 ancestor goroutine 的信息(debug.tracebackancestors 调试用)
	startpc        uintptr         // goroutine 函数的 pc 寄存器
	racectx        uintptr
	waiting        *sudog         // 如果 g 发生阻塞（且有有效的元素指针）sudog 会将当前 g 按锁住的顺序组织起来
	cgoCtxt        []uintptr      // cgo 回溯上下文
	labels         unsafe.Pointer // profiler 的标签
	timer          *timer         // 为 time.Sleep 缓存的计时器
	selectDone     uint32         // 我们是否正在参与 select 且某个 goroutine 胜出？

	// Per-G GC 状态

	// gcAssistBytes 是该 G 在分配的字节数这一方面的的 GC 辅助 credit
	// 如果该值为正，则 G 已经存入了在没有 assisting 的情况下分配了 gcAssistBytes 字节
	// 如果该值为负，则 G 必须在 scan work 中修正这个值
	// 我们以字节为单位进行追踪，一遍快速更新并检查 malloc 热路径中分配的债务（分配的字节）。
	// assist ratio 决定了它与 scan work 债务的对应关系
	gcAssistBytes int64
}
```

除了执行栈之外，还有很多与调试和 profiling 相关的字段。
一个 G 没有什么黑魔法，无非是将需要执行的函数参数进行了拷贝，保存了要执行的函数体的入口地址，用于执行。

上面的字段中，stack 类型的字段用于描述 g 的执行栈，结构仅仅只是简单的栈的高低位：

```go
// Stack 描述了 Go 的执行栈，栈的区间为 [lo, hi)，在栈两边没有任何隐式数据结构
// 因此 Go 的执行栈由运行时管理，本质上分配在堆中，比 ulimit -s 大
type stack struct {
	lo uintptr
	hi uintptr
}
```

`sudog` 用于组织产生阻塞的 g（例如在 channel 上阻塞）：

```go
// sudog 表示了一个等待队列中的 g，例如在一个 channel 中进行发送和接受
//
// sudog 是必要的，因为 g <-> 同步对象之间的关系是多对多。一个 g 可以在多个等待列表上，
// 因此可以有很多的 sudog 为一个 g 服务；并且很多 g 可能在等待同一个同步对象，
// 因此也会有很多 sudog 为一个同步对象服务。
//
// 所有的 sudog 分配在一个特殊的池中。使用 acquireSudog 和 releaseSudog 来分配并释放它们。
type sudog struct {
	// 下面的字段由这个 sudog 阻塞的通道的 hchan.lock 进行保护。
	// shrinkstack 依赖于它服务于 sudog 相关的 channel 操作。

	g *g

	// isSelect 表示 g 正在参与一个 select，因此 g.selectDone 必须以 CAS 的方式来避免唤醒时候的 data race。
	isSelect bool
	next     *sudog
	prev     *sudog
	elem     unsafe.Pointer // 数据元素（可能指向栈）

	// 下面的字段永远不会并发的被访问。对于 channel waitlink 只会被 g 访问
	// 对于 semaphores，所有的字段（包括上面的）只会在持有 semaRoot 锁时被访问

	acquiretime int64
	releasetime int64
	ticket      uint32
	parent      *sudog // semaRoot 二叉树
	waitlink    *sudog // g.waiting 列表或 semaRoot
	waittail    *sudog // semaRoot
	c           *hchan // channel
}
```

## 调度器 `sched` 结构

调度器，所有 goroutine 被调度的核心。

```go
type schedt struct {
	// 应该被原子访问。保持在第一个字段来确保 32 位系统上的对齐
	goidgen  uint64
	lastpoll uint64

	lock mutex

	// 当增加 nmidle、nmidlelocked、nmsys、nmfreed 时，检查 checkdead()

	midle        muintptr // 等待 work 的空闲 m
	nmidle       int32    // 等待 work 的空闲 m 的数量
	nmidlelocked int32    // 等待 work 的锁住的 m 的数量
	mnext        int64    // 已经创建的 m 的个数，同时还表示下一个 m 的 id
	maxmcount    int32    // 允许（或死亡）的 m 的最大值
	nmsys        int32    // 不计入死锁的系统 m 的数量
	nmfreed      int64    // 释放的 m 的计数（递增）

	ngsys uint32 // 系统 goroutine 的数量，动态更新

	pidle      puintptr // 空闲 p 链表
	npidle     uint32   // 空闲 p 数量
	nmspinning uint32   // 见 proc.go 中关于 "工作线程 parking/unparking" 的注释.

	// 全局 runnable G 队列
	runq     gQueue
	runqsize int32

	// disable 控制了选择性的禁止调度器
	//
	// 使用 schedEnableUser 来控制此这个
	//
	// disable 受到 sched.lock 保护
	disable struct {
		// 用户禁用用户 goroutine 的调度
		user     bool
		runnable gQueue // 即将发生的 runable Gs
		n        int32  // runable 的数量
	}

	// 有效 dead G 的全局缓存.
	gFree struct {
		lock    mutex
		stack   gList // 包含栈的 Gs
		noStack gList // 没有栈的 Gs
		n       int32
	}

	// sudog 结构的集中缓存
	sudoglock  mutex
	sudogcache *sudog

	// 不同大小的有效的 defer 结构的池
	deferlock mutex
	deferpool [5]*_defer

	// freem 是当 m.exited 设置后等待被释放的 m 的列表，通过 m.freelink 链接
	freem *m

	gcwaiting  uint32 // 等待 gc 运行
	stopwait   int32
	stopnote   note
	sysmonwait uint32
	sysmonnote note

	// 如果 p.runSafePointFn 设置后，safepointFn 应该在每个 P 的下一个 GC 的 safepoint 时调用
	safePointFn   func(*p)
	safePointWait int32
	safePointNote note

	profilehz int32 // cpu profiling rate

	procresizetime int64 // 上一次修改 gomaxprocs 的时间 nanotime()
	totaltime      int64 // ∫gomaxprocs dt 在 procresizetime 的积分（总和）
}
```

在这个结构里，调度器：

- 管理了能够将 G 和 M 进行绑定的 M 链表（队列）
- 管理了空闲的 P 链表（队列）
- 管理了 runnable G 的全局队列
- 管理了即将进入 runnable 状态的（dead 状态的） G 的队列
- 管理了发生阻塞的 G 的队列
- 管理了 defer 调用池
- 管理了 GC 和系统监控的信号
- 管理了需要在 safe point 时执行的函数
- 统计了(极少发生的)动态调整 P 所花的时间

其中 `muintptr` 本质上就是 `uintptr`，在 [9 unsafe 范式](../9-unsafe) 中我们知道，
因为栈会发生移动，uintptr 在 safe point 之外是不能被局部持有的，所以 `muintptr` 的使用必须非常小心：

```go
// muintptr 是一个 *m 指针，不受 GC 的追踪
//
// 因为我们要释放 M，所以有一些在 muintptr 上的额外限制
//
// 1. 永不在 safe point 之外局部持有一个 muintptr
//
// 2. 任何堆上的 muintptr 必须被 M 自身持有，进而保证它不会在最后一个 *m 指针被释放时使用
type muintptr uintptr
```

而用于管理信号的 `note` 结构，我们留到 GC 和系统监控时再来细看。

## 总结

调度器的设计还是相当巧妙的。
它通过引入一个 P，巧妙的减缓了全局锁的调用频率，进一步压榨了机器的性能。
goroutine 本身也不是什么黑魔法，运行时只是将其作为一个需要运行的入口地址保存在了 G 中，
同时对调用的参数进行了一份拷贝。
我们说 P 是处理器自身的抽象，但 P 只是一个纯粹的概念。相反，M 才是运行代码的真身。

值得一提的是，目前的调度器设计总是假设 M 到 P 的访问速度是一样的，即不同的 CPU 核心访问多级缓存、内存的速度一致。
但真实情况是，假设我们有一个田字形排布的四个物理核心：

```
           L2 ------------+
           |              |
        +--+--+           |
       L1     L1          |
       |       |          |
    +------+------+       |
    | CPU1 | CPU2 |       |
    +------+------+       L3
    | CPU3 | CPU4 |       |
    +------+------+       |
       |       |          |
      L1      L1          |
        +--+--+           |
           |              |
           L2-------------+
```


那么左上角 CPU1 访问 CPU 2 的 L1 缓存，要远比访问 CPU3 或 CPU 4 的 L1 缓存，**在物理上**，快得多。
这也就是我们所说的 NUMA（non-uniform memory access，非均匀访存）架构。

针对这一点，Go 官方已经提出了具体的调度器设计，但由于工作量巨大，甚至没有提上日程。

## 进一步阅读的参考文献

1. [Scalable Go Scheduler Design Doc](https://golang.org/s/go11sched)
2. [Go Preemptive Scheduler Design Doc](https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit#heading=h.3pilqarbrc9h)
3. [NUMA-aware scheduler for Go](https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub)
4. [Scheduling Multithreaded Computations by Work Stealing](papers/steal.pdf)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
