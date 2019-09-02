# 调度器: 基本知识

[TOC]

在详细进入代码之前，我们需要提前了解一下调度器的设计原则及一些基本概念来建立对调度器较为宏观的认识。

理解调度器涉及的主要概念包括以下三个：

- G: **G**oroutine，即我们在 Go 程序中使用 `go` 关键字创建的执行体；
- M: Worker thread, 或 **M**achine，即传统意义上进程的线程；
- P: **P**rocessor，即一种人为抽象的、用于执行 Go 代码被要求资源。只有当 M 关联一个 P 后才能执行 Go 代码，
但它可以被阻塞或在一个系统调用中没有关联的 P。

运行时调度器的任务是给不同的工作线程 (worker thread) 分发可供运行的（ready-to-run）goroutine。
我们不妨设每个工作线程总是贪心的执行所有存在的 goroutine，那么当运行进程中存在 n 个线程（M），且
每个 M 在某个时刻有且只能调度一个 G，则可以证明这两条性质：

1. 当用户态代码创建了 m (m > n) 个 G 时，则必定存在 m-n 个 G 尚未被 M 调度执行；
2. 当用户态代码创建的 m (m < n) 时，则必定存在 n-m 个 M 不存在正在调度的 G。

这两条性质分别决定了工作线程的暂止（park）和 复始（unpark）。

## 工作线程的暂止和复始

不难发现，调度器的设计需要在不同的方面进行权衡，即既要保持足够的运行工作线程来利用有效硬件并发资源，
又要暂止过多的工作线程来节约 CPU 能耗。
如果我们把调度器想象成一个系统，则寻找这个权衡的最优解意味着我们必须求解调度器系统中
每个 M 的状态，即系统的全局状态。这是非常困难的，考虑以下两个难点：

**难点 1**: 调度器状态是一个 per-P 的局部工作队列，在快速路径（fast path）计算出
全局谓词 (global predicates) 是不可能的。

我们都知道计算的局部性原理，为了利用这一原理，调度器所需调度的 G 都会被放在每个 M 自身对应的本地队列中。
换句话说，每个 M 都无法直接观察到其他的 M 所具有的 G 的状态。这本质上是一个分布式系统。
显然，每个 M 都能够连续的获取自身的状态，但当它需要获取整个系统的全局状态时却不容易。
原因在于我们没有一个能够让所有线程都同步的时钟，换句话说，我们需要依赖屏障来保证多个 M 之间的全局状态同步。
更进一步，在不使用屏障的情况下，
利用每个 M 在不同时间中记录的本地状态中计算出调度器的全局状态呢（即快速路径下计算进程集的全局谓词），
是不可能的。


**难点 2**: 为了获得最佳的线程管理，我们必须获得未来的信息，即当一个新的 G 即将就绪（ready）时，
则不再暂止一个工作线程。

举例来说，目前我们的调度器存在 4 个 M，并其中有 3 个 M 正在调度 G，则其中有 1 个 M 处于空闲状态。
这时为了节约 CPU 能耗，我们希望对这个空闲的 M 进行暂止操作。但是，正当我们完成了对此 M 的暂止操作后，
用户态代码正好执行到了需要调度一个新的 G 时，我们有不得不将刚刚暂止的 M 重新启动，这无疑增加了开销。
我们当然有理由希望，如果我们能知晓一个程序生命周期中所有的调度信息，提前知晓什么时候适合对 M 进行暂止自然再好不过了。
尽管我们能够对程序代码进行静态分析，但这显然是不可能的：考虑一个简单的 Web 服务端程序，每个用户请求
到达后会创建一个新的 G 交于调度器进行调度。但请求到达是一个随机过程，我们只能预测在给定置信区间下
可能到达的请求数，而不能完整知晓所有的调度需求。

那么我们又应该如何设计一个通用型调度器呢？我们很容易想到三种平凡的做法：

**设计 1**: 集中式管理所有状态

这种做法自然是不可取的，这将限制调度器的可扩展性。

**设计 2**: 每当需要就绪一个 G1 时，都让出一个 P，直接切换出 G2，再复始一个 M 来执行 G2。

因为复始的 M 可能在下一个瞬间又没有调度任务，则会发生线程颠簸（thrashing），进而我们又需要暂止这个线程。
另一方面，我们希望在相同的线程内保存维护 G，这种方式还会破坏计算的局部性原理。

**设计 3**: 任何时候当就绪一个 G、也存在一个空闲的 P 时，都复始一个额外的线程，不进行切换。

因为这个额外线程会在没有检查任何工作的情况下立即进行暂止，最终导致大量 M 的暂止和复始行为，产生大量开销。

基于以上考虑，目前的 Go 的调度器实现方式可以被简单的概括为：
**如果存在一个空闲的 P 并且没有自旋状态的工作线程 M 时候，当就绪一个 G 时，就复始一个额外的线程 M。**

这句话的信息量较多，我们先来解释一些概念：

一个 **自旋（spinning）** 工作线程在实现上，自旋状态由 `sched.nmspinning` 和 `m.spinning` 表示。

1. 如果一个工作线程的本地队列、全局运行队列或 netpoller 中均没有工作，则该线程成为自旋线程；
2. 满足该条件的、被复始的线程也被称为自旋线程。我们也不对这种线程进行 G 切换，因此这类线程最初就是没有工作的状态。

我们可以通过下图来直观理解工作线程的状态转换：

```
  如果存在空闲的 P，且存在暂止的 M，并就绪 G
          +------+
          v      |
执行 --> 自旋 --> 暂止
 ^        |
 +--------+
  如果发现工作
```

概括来说，自旋线程会在暂止前，从 per-P 中运行队列中寻找工作。
如果一个自旋进程发现工作，就会将自身切换出自旋状态，并且开始执行。
如果它没有发现工作则会将自己进行暂止，带出自旋状态。
如果至少有一个自旋进程（`sched.nmspinning>1`），则就绪一个 G 时，
不会去暂止一个新的线程。作为补偿，如果最后一个自旋线程发现工作并且停止自旋时，
则必须复始一个新的自旋线程。这个方法消除了不合理的线程复始峰值，且同时保证最终的最大 CPU 并行度利用率。

这种设计的实现复杂性表现在进行自旋与费自选线程状态转换时必须非常小心。
这种转换在提交一个新的 G 时发生竞争，最终导致任何一个工作线程都需要暂止对方。
如果双方均发生失败，则会以半静态 CPU 利用不足而结束调度。

因此，就绪一个 G 的通用流程为：

- 提交一个 G 到 per-P 的本地工作队列
- 执行 StoreLoad 风格的写屏障
- 检查 `sched.nmspinning` 数量

而从自旋到非自旋转换的一般流程为：

- 减少 `nmspinning` 的数量
- 执行 StoreLoad 风格的写屏障
- 在所有 per-P 本地任务队列检查新的工作

当然，此种复杂性在全局任务队列是不存在的，因为我们不会笨到当给一个全局队列提交工作时进行线程的复始操作。

## 主要结构

我们这个部分简单来浏览一遍 M/P/G 的结构，初次阅读此结构会感觉虚无缥缈，不知道在看什么。
事实上，我们更应该直接深入调度器相关的代码来逐个理解每个字段的实际用途。
因此这里仅在每个结构后简单讨论其宏观作用，用作后文参考。
读者可以简单浏览各个字段，为其留下一个初步的印象即可。

### M 的结构

M 是 OS 线程的实体。

```go
// src/runtime/runtime2.go
type m struct {
	g0      *g     // 用于执行调度指令的 goroutine
	morebuf gobuf  // morestack 的 gobuf 参数
	(...)

	procid        uint64       // 用于 debugger，偏移量不是写死的
	gsignal       *g           // 处理 signal 的 g
	goSigStack    gsignalStack // Go 分配的 signal handling 栈
	sigmask       sigset       // 用于保存 saved signal mask
	tls           [6]uintptr   // thread-local storage (对 x86 而言为额外的寄存器)
	mstartfn      func()
	curg          *g       // 当前运行的用户 goroutine
	caughtsig     guintptr // goroutine 在 fatal signal 中运行
	p             puintptr // 执行 go 代码时持有的 p (如果没有执行则为 nil)
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
	createstack   [32]uintptr // 当前线程创建的栈
	lockedExt     uint32      // 外部 LockOSThread 追踪
	lockedInt     uint32      // 内部 lockOSThread 追踪
	nextwaitm     muintptr    // 正在等待锁的下一个 m
	waitunlockf   func(*g, unsafe.Pointer) bool
	waitlock      unsafe.Pointer
	(...)
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

P 只是处理器的抽象，而非处理器本身，它存在的意义在于实现工作窃取（work stealing）算法。
简单来说，每个 P 持有一个 G 的本地队列。

在没有 P 的情况下，所有的 G 只能放在一个全局的队列中。
当 M 执行完 G 而没有 G 可执行时，必须将队列锁住从而取值。

当引入了 P 之后，P 持有 G 的本地队列，而持有 P 的 M 执行完 G 后在 P 本地队列中没有发现其他 G 可以执行时，
会从其他的 P 的本地队列偷取（steal）一个 G 来执行，只有在所有的 P 都偷不到的情况下才去全局队列里面取。

一个不恰当的比喻：银行服务台排队中身手敏捷的顾客，当一个服务台队列空（没有人）时，
马上会有在其他队列排队的顾客迅速跑到这个没人的服务台来，这就是所谓的偷取。

```go
type p struct {
	id          int32
	status      uint32 // p 的状态 pidle/prunning/...
	link        puintptr
	schedtick   uint32     // 每次调度器调用都会增加
	syscalltick uint32     // 每次进行系统调用都会增加
	sysmontick  sysmontick // 系统监控观察到的最后一次记录
	m           muintptr   // 反向链接到关联的 m （nil 则表示 idle）
	mcache      *mcache
	(...)

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

	(...)

	palloc persistentAlloc // per-P，用于避免 mutex

	_ uint32 // 对齐，用于下面字段的原子操作

	// Per-P GC 状态
	gcAssistTime         int64    // assistAlloc 时间 (纳秒) 原子操作
	gcFractionalMarkTime int64    // fractional mark worker 的时间 (纳秒) 原子操作
	gcBgMarkWorker       guintptr // 原子操作
	gcMarkWorkerMode     gcMarkWorkerMode

	// gcMarkWorkerStartTime 为该 mark worker 开始的 nanotime()
	gcMarkWorkerStartTime int64

	// gcw 为当前 P 的 GC work buffer 缓存。该 work buffer 会被写入
	// write barrier，由 mutator 辅助消耗，并处理某些 GC 状态转换。
	gcw gcWork

	// wbBuf 是当前 P 的 GC 的 write barrier 缓存
	wbBuf wbBuf

	runSafePointFn uint32 // 如果为 1, 则在下一个 safe-point 运行 sched.safePointFn
	(...)
}
```

所以整个结构除去 P 的本地 G 队列外，就是一些统计、调试、GC 辅助的字段了。

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
	stackLock      uint32 // sigprof/scang 锁;
	goid           int64
	schedlink      guintptr
	waitsince      int64      // g 阻塞的时间
	waitreason     waitReason // 如果 status==Gwaiting，则记录等待的原因
	preempt        bool       // 抢占信号，stackguard0 = stackpreempt 的副本
	paniconfault   bool       // 发生 fault panic （不崩溃）的地址
	preemptscan    bool       // 为 gc 进行 scan 的被强占的 g
	gcscandone     bool       // g 执行栈已经 scan 了；此此段受 _Gscan 位保护
	gcscanvalid    bool       // 在 gc 周期开始时为 false；当 G 从上次 scan 后就没有运行时为 true
	throwsplit     bool       // 必须不能进行栈分段
	(...)
	sysblocktraced bool       // StartTrace 已经出发了此 goroutine 的 EvGoInSyscall
	sysexitticks   int64      // 当 syscall 返回时的 cputicks（用于跟踪）
	(...)
	lockedm        muintptr
	sig            uint32
	writebuf       []byte
	sigcode0       uintptr
	sigcode1       uintptr
	sigpc          uintptr
	gopc           uintptr         // 当前创建 goroutine go 语句的 pc 寄存器
	ancestors      *[]ancestorInfo // 创建此 goroutine 的 ancestor goroutine 的信息(debug.tracebackancestors 调试用)
	startpc        uintptr         // goroutine 函数的 pc 寄存器
	(...)
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

### 调度器 `sched` 结构

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

	gcwaiting  uint32 // 需要进行 GC，应该停止调度
	stopwait   int32
	stopnote   note
	sysmonwait uint32
	sysmonnote note

	// 如果 p.runSafePointFn 设置后，safepointFn 应该在每个 P 的下一个 GC 的 safepoint 时调用
	safePointFn   func(*p)
	safePointWait int32
	safePointNote note
	(...)

	procresizetime int64 // 上一次修改 gomaxprocs 的时间 nanotime()
	totaltime      int64 // ∫gomaxprocs dt 在 procresizetime 的积分（总和）
}
```

在这个结构里，调度器：

- 管理了能够将 G 和 M 进行绑定的 M 队列
- 管理了空闲的 P 链表（队列）
- 管理了 runnable G 的全局队列
- 管理了即将进入 runnable 状态的（dead 状态的） G 的队列
- 管理了发生阻塞的 G 的队列
- 管理了 defer 调用池
- 管理了 GC 和系统监控的信号
- 管理了需要在 safe point 时执行的函数
- 统计了(极少发生的)动态调整 P 所花的时间

其中 `muintptr` 本质上就是 `uintptr`，因为 goroutine 栈会发生移动，
uintptr 在 safe point 之外是不能被局部持有的，所以 `muintptr` 的使用必须非常小心：

```go
// muintptr 是一个不受 GC 的追踪的 *m 指针
// 因为我们要释放 M，所以有一些在 muintptr 上的额外限制
// 1. 永不在 safe point 之外局部持有一个 muintptr
// 2. 任何堆上的 muintptr 必须被 M 自身持有，进而保证它不会在最后一个 *m 指针被释放时使用
type muintptr uintptr
```

而用于管理信号的 `note` 结构，我们留到 GC 和系统监控时再来细看。

## 总结

调度器的设计还是相当巧妙的。它通过引入一个 P，巧妙的减缓了全局锁的调用频率，进一步压榨了机器的性能。
goroutine 本身也不是什么黑魔法，运行时只是将其作为一个需要运行的入口地址保存在了 G 中，
同时对调用的参数进行了一份拷贝。我们说 P 是处理器自身的抽象，但 P 只是一个纯粹的概念。相反，M 才是运行代码的真身。

[返回目录](./readme.md) | 上一节 | [下一节 调度器初始化](./init.md)

## 进一步阅读的参考文献

- [ROBERT et al., 1999] [Robert D. Blumofe and Charles E. Leiserson. 1999. Scheduling multithreaded computations by work stealing. J. ACM 46, 5 (September 1999), 720-748.](https://dl.acm.org/citation.cfm?id=324234)
- [VYUKOV, 2012] [Vyukov, Dmitry. Scalable Go Scheduler Design Doc, 2012](https://golang.org/s/go11sched)
- [VYUKOV, 2013] [Vyukov, Dmitry. Go Preemptive Scheduler Design Doc, 2013](https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit#heading=h.3pilqarbrc9h)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
