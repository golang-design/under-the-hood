// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

import (
	"internal/cpu"
	"runtime/internal/atomic"
	"runtime/internal/sys"
	"unsafe"
)

// 定义的常量
const (
	// G 的状态
	//
	// 除了指示 G 的一般状态之外，G 的状态就类似于 goroutine 的堆栈的一个锁（即它执行用户代码的能力）。
	// 如果你在给此列表增加内容，还需要添加到 mgcmark.go 中的 “垃圾收集期间的正常” 状态列表中。
	//
	//
	// TODO(austin): The _Gscan bit could be much lighter-weight.
	// For example, we could choose not to run _Gscanrunnable
	// goroutines found in the run queue, rather than CAS-looping
	// until they become _Grunnable. And transitions like
	// _Gscanwaiting -> _Gscanrunnable are actually okay because
	// they don't affect stack ownership.

	// _Gidle 表示 goroutine 刚刚完成分配且还未被初始化
	_Gidle = iota // 0

	// _Grunnable 表示 goroutine 已经在运行队列中。当前还未运行用户代码。还未拥有运行栈。
	_Grunnable // 1

	// _Grunning 表示 goroutine 可能正在运行用户代码。运行栈被该 goroutine 拥有。
	// 该 goroutine 不在运行队列中，且被分配了一个 M 和 一个 P。(g.m 和 g.m.p 均有效)
	_Grunning // 2

	// _Gsyscall 表示当前 goroutine 正在执行一个系统调用，没有执行用户代码。
	// 该 goroutine 拥有一个栈且不在运行队列中，并分配有一个 M
	_Gsyscall // 3

	// _Gwaiting 表示当前 goroutine 在运行时中被阻塞。它没有执行用户代码。它不在运行队列中，
	// 但应该记录在某处（比如一个 channel 等待队列）因此可以在需要时 ready()。
	// 除了 channel 操作可以在适当的 channel 锁定下读取或写入堆栈的部分之外，它不拥有堆栈。
	// 否则，在 goroutine 进入 _Gwaiting 后访问堆栈是不安全的（例如，它可能会被移动）。
	_Gwaiting // 4

	// _Gmoribund_unused is currently unused, but hardcoded in gdb
	// scripts.
	_Gmoribund_unused // 5

	// _Gdead 表示当前 goroutine 当前未被使用。它可能刚被执行、
	// 在释放列表中、或刚刚被初始化。它没有执行用户代码。它可能也可能没有分配的栈。
	// G 及其栈（如果有）由正在退出 G 或从释放列表获得 G 的 M 拥有
	_Gdead // 6

	// _Genqueue_unused 表示 G 当前未被使用
	_Genqueue_unused // 7

	// _Gcopystack means this goroutine's stack is being moved. It
	// is not executing user code and is not on a run queue. The
	// stack is owned by the goroutine that put it in _Gcopystack.
	_Gcopystack // 8

	// _Gpreempted means this goroutine stopped itself for a
	// suspendG preemption. It is like _Gwaiting, but nothing is
	// yet responsible for ready()ing it. Some suspendG must CAS
	// the status to _Gwaiting to take responsibility for
	// ready()ing this G.
	_Gpreempted // 9

	// _Gscan combined with one of the above states other than
	// _Grunning indicates that GC is scanning the stack. The
	// goroutine is not executing user code and the stack is owned
	// by the goroutine that set the _Gscan bit.
	//
	// _Gscanrunning is different: it is used to briefly block
	// state transitions while GC signals the G to scan its own
	// stack. This is otherwise like _Grunning.
	//
	// atomicstatus&~Gscan gives the state the goroutine will
	// return to when the scan completes.
	_Gscan          = 0x1000
	_Gscanrunnable  = _Gscan + _Grunnable  // 0x1001
	_Gscanrunning   = _Gscan + _Grunning   // 0x1002
	_Gscansyscall   = _Gscan + _Gsyscall   // 0x1003
	_Gscanwaiting   = _Gscan + _Gwaiting   // 0x1004
	_Gscanpreempted = _Gscan + _Gpreempted // 0x1009
)

const (
	// P 的状态
	// _Pidle means a P is not being used to run user code or the
	// scheduler. Typically, it's on the idle P list and available
	// to the scheduler, but it may just be transitioning between
	// other states.
	//
	// The P is owned by the idle list or by whatever is
	// transitioning its state. Its run queue is empty.
	_Pidle = iota
	// _Prunning means a P is owned by an M and is being used to
	// run user code or the scheduler. Only the M that owns this P
	// is allowed to change the P's status from _Prunning. The M
	// may transition the P to _Pidle (if it has no more work to
	// do), _Psyscall (when entering a syscall), or _Pgcstop (to
	// halt for the GC). The M may also hand ownership of the P
	// off directly to another M (e.g., to schedule a locked G).
	_Prunning

	// _Psyscall means a P is not running user code. It has
	// affinity to an M in a syscall but is not owned by it and
	// may be stolen by another M. This is similar to _Pidle but
	// uses lightweight transitions and maintains M affinity.
	//
	// Leaving _Psyscall must be done with a CAS, either to steal
	// or retake the P. Note that there's an ABA hazard: even if
	// an M successfully CASes its original P back to _Prunning
	// after a syscall, it must understand the P may have been
	// used by another M in the interim.
	_Psyscall

	// _Pgcstop means a P is halted for STW and owned by the M
	// that stopped the world. The M that stopped the world
	// continues to use its P, even in _Pgcstop. Transitioning
	// from _Prunning to _Pgcstop causes an M to release its P and
	// park.
	//
	// The P retains its run queue and startTheWorld will restart
	// the scheduler on Ps with non-empty run queues.
	_Pgcstop

	// _Pdead means a P is no longer used (GOMAXPROCS shrank). We
	// reuse Ps if GOMAXPROCS increases. A dead P is mostly
	// stripped of its resources, though a few things remain
	// (e.g., trace buffers).
	_Pdead
)

// 互斥锁。在无竞争的情况下，与自旋锁 spin lock（只是一些用户级指令）一样快，
// 但在争用路径 contention path 中，它们在内核中休眠。零值互斥锁为未加锁状态（无需初始化每个锁）。
type mutex struct {
	// 基于 futex 的实现将其视为 uint32 key (linux)
	// 而基于 sema 实现则将其视为 M* waitm。 (darwin)
	// 以前作为 union 使用，但 union 会打破精确 GC
	key uintptr
}

// 休眠与唤醒一次性事件.
// 在任何调用 notesleep 或 notewakeup 之前，必须调用 noteclear 来初始化这个 note
// 且只能有一个线程调用 notewakeup 一次。一旦 notewakeup 被调用后，notesleep 会返回。
// 随后的 notesleep 调用则会立即返回。
// 随后的 noteclear 必须在前一个 notesleep 返回前调用，例如 notewakeup 调用后
// 直接调用 noteclear 是不允许的。
//
// notetsleep 类似于 notesleep 但会在给定数量的纳秒时间后唤醒，即使事件尚未发生。
// 如果一个 goroutine 使用 notetsleep 来提前唤醒，则必须等待调用 noteclear，直到可以确定
// 没有其他 goroutine 正在调用 notewakeup。
//
// notesleep/notetsleep 通常在 g0 上调用，notetsleepg 类似于 notetsleep 但会在用户 g 上调用。
type note struct {
	// 基于 futex 的实现将其视为 uint32 key (linux)
	// 而基于 sema 实现则将其视为 M* waitm。 (darwin)
	// 以前作为 union 使用，但 union 会打破精确 GC
	key uintptr
}

type funcval struct {
	fn uintptr
	// 变长大小，fn 的数据在应在 fn 之后
}

type iface struct {
	tab  *itab
	data unsafe.Pointer
}

type eface struct {
	_type *_type
	data  unsafe.Pointer
}

func efaceOf(ep *interface{}) *eface {
	return (*eface)(unsafe.Pointer(ep))
}

// The guintptr, muintptr, and puintptr are all used to bypass write barriers.
// It is particularly important to avoid write barriers when the current P has
// been released, because the GC thinks the world is stopped, and an
// unexpected write barrier would not be synchronized with the GC,
// which can lead to a half-executed write barrier that has marked the object
// but not queued it. If the GC skips the object and completes before the
// queuing can occur, it will incorrectly free the object.
//
// We tried using special assignment functions invoked only when not
// holding a running P, but then some updates to a particular memory
// word went through write barriers and some did not. This breaks the
// write barrier shadow checking mode, and it is also scary: better to have
// a word that is completely ignored by the GC than to have one for which
// only a few updates are ignored.
//
// Gs and Ps are always reachable via true pointers in the
// allgs and allp lists or (during allocation before they reach those lists)
// from stack variables.
//
// Ms are always reachable via true pointers either from allm or
// freem. Unlike Gs and Ps we do free Ms, so it's important that
// nothing ever hold an muintptr across a safe point.

// A guintptr holds a goroutine pointer, but typed as a uintptr
// to bypass write barriers. It is used in the Gobuf goroutine state
// and in scheduling lists that are manipulated without a P.
//
// The Gobuf.g goroutine pointer is almost always updated by assembly code.
// In one of the few places it is updated by Go code - func save - it must be
// treated as a uintptr to avoid a write barrier being emitted at a bad time.
// Instead of figuring out how to emit the write barriers missing in the
// assembly manipulation, we change the type of the field to uintptr,
// so that it does not require write barriers at all.
//
// Goroutine structs are published in the allg list and never freed.
// That will keep the goroutine structs from being collected.
// There is never a time that Gobuf.g's contain the only references
// to a goroutine: the publishing of the goroutine in allg comes first.
// Goroutine pointers are also kept in non-GC-visible places like TLS,
// so I can't see them ever moving. If we did want to start moving data
// in the GC, we'd need to allocate the goroutine structs from an
// alternate arena. Using guintptr doesn't make that problem any worse.
type guintptr uintptr

//go:nosplit
func (gp guintptr) ptr() *g { return (*g)(unsafe.Pointer(gp)) }

//go:nosplit
func (gp *guintptr) set(g *g) { *gp = guintptr(unsafe.Pointer(g)) }

//go:nosplit
func (gp *guintptr) cas(old, new guintptr) bool {
	return atomic.Casuintptr((*uintptr)(unsafe.Pointer(gp)), uintptr(old), uintptr(new))
}

// setGNoWB 当使用 guintptr 不可行时，在没有 write barrier 下执行 *gp = new
//go:nosplit
//go:nowritebarrier
func setGNoWB(gp **g, new *g) {
	(*guintptr)(unsafe.Pointer(gp)).set(new)
}

type puintptr uintptr

//go:nosplit
func (pp puintptr) ptr() *p { return (*p)(unsafe.Pointer(pp)) }

//go:nosplit
func (pp *puintptr) set(p *p) { *pp = puintptr(unsafe.Pointer(p)) }

// muintptr 是一个 *m 指针，不受 GC 的追踪
//
// 因为我们要释放 M，所以有一些在 muintptr 上的额外限制
//
// 1. 永不在 safe point 之外局部持有一个 muintptr
//
// 2. 任何堆上的 muintptr 必须被 M 自身持有，进而保证它不会在最后一个 *m 指针被释放时使用
type muintptr uintptr

//go:nosplit
func (mp muintptr) ptr() *m { return (*m)(unsafe.Pointer(mp)) }

//go:nosplit
func (mp *muintptr) set(m *m) { *mp = muintptr(unsafe.Pointer(m)) }

// setMNoWB 当使用 muintptr 不可行时，在没有 write barrier 下执行 *mp = new
//go:nosplit
//go:nowritebarrier
func setMNoWB(mp **m, new *m) {
	(*muintptr)(unsafe.Pointer(mp)).set(new)
}

type gobuf struct {
	// sp, pc 和 g 偏移量均在 libmach 中写死
	//
	// ctxt 对于 GC 非常特殊，它可能是一个在堆上分配的 funcval，因此 GC 需要追踪它
	// 但是它需要从汇编中设置和清除，因此很难使用写屏障。然而 ctxt 是一个实时保存的、
	// 存活的寄存器，且我们只在真实的寄存器和 gobuf 之间进行交换。
	// 因此我们将其视为栈扫描时的一个 root，从而汇编中保存或恢复它不需要写屏障。
	// 它仍然作为指针键入，以便来自Go的任何其他写入获得写入障碍。
	sp   uintptr
	pc   uintptr
	g    guintptr
	ctxt unsafe.Pointer
	ret  sys.Uintreg
	lr   uintptr
	bp   uintptr // for GOEXPERIMENT=framepointer
}

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

type libcall struct {
	fn   uintptr
	n    uintptr // 参数的个数
	args uintptr // 参数
	r1   uintptr // 返回值
	r2   uintptr
	err  uintptr // 错误号
}

// 描述了如何处理回调
type wincallbackcontext struct {
	gobody       unsafe.Pointer // 要调度的 go 函数
	argsize      uintptr        // 回调参数大小（字节）
	restorestack uintptr        // adjust stack on return by (in bytes) (386 only)
	cleanstack   bool
}

// Stack 描述了 Go 的执行栈，栈的区间为 [lo, hi)，在栈两边没有任何隐式数据结构
// 因此 Go 的执行栈由运行时管理，本质上分配在堆中，比 ulimit -s 大
type stack struct {
	lo uintptr
	hi uintptr
}

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

	_panic        *_panic // innermost panic - 偏移量用于 liblink
	_defer        *_defer // innermost defer
	m             *m      // 当前的 m; 偏移量对 arm liblink 透明
	sched         gobuf
	syscallsp     uintptr        // 如果 status==Gsyscall, 则 syscallsp = sched.sp 并在 GC 期间使用
	syscallpc     uintptr        // 如果 status==Gsyscall, 则 syscallpc = sched.pc 并在 GC 期间使用
	stktopsp      uintptr        // 期望 sp 位于栈顶，用于回溯检查
	param         unsafe.Pointer // wakeup 唤醒时候传递的参数
	atomicstatus  uint32
	stackLock     uint32 // sigprof/scang 锁; TODO: fold in to atomicstatus
	goid          int64
	schedlink     guintptr
	waitsince     int64      // g 阻塞的时间
	waitreason    waitReason // 如果 status==Gwaiting，则记录等待的原因
	preempt       bool       // 抢占信号，stackguard0 = stackpreempt 的副本
	preemptStop   bool       // transition to _Gpreempted on preemption; otherwise, just deschedule
	preemptShrink bool       // shrink stack at synchronous safe point

	// asyncSafePoint is set if g is stopped at an asynchronous
	// safe point. This means there are frames on the stack
	// without precise pointer information.
	asyncSafePoint bool

	paniconfault bool // 发生 fault panic （不崩溃）的地址
	gcscandone   bool // g 执行栈已经 scan 了；此此段受 _Gscan 位保护
	throwsplit   bool // 必须不能进行栈分段
	// activeStackChans indicates that there are unlocked channels
	// pointing into this goroutine's stack. If true, stack
	// copying needs to acquire channel locks to protect these
	// areas of the stack.
	activeStackChans bool

	raceignore     int8     // 忽略 race 检查事件
	sysblocktraced bool     // StartTrace 已经出发了此 goroutine 的 EvGoInSyscall
	sysexitticks   int64    // 当 syscall 返回时的 cputicks（用于跟踪）
	traceseq       uint64   // trace event sequencer 跟踪事件排序器
	tracelastp     puintptr // 最后一个为此 goroutine 触发事件的 P
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
	selectDone     uint32         // 我们是否正在参与 select 且某个 goroutine 胜出

	// Per-G GC 状态

	// gcAssistBytes 是该 G 在分配的字节数这一方面的的 GC 辅助 credit
	// 如果该值为正，则 G 已经存入了在没有 assisting 的情况下分配了 gcAssistBytes 字节
	// 如果该值为负，则 G 必须在 scan work 中修正这个值
	// 我们以字节为单位进行追踪，一遍快速更新并检查 malloc 热路径中分配的债务（分配的字节）。
	// assist ratio 决定了它与 scan work 债务的对应关系
	gcAssistBytes int64
}

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
	traceback     uint8
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
	waittraceev   byte
	waittraceskip int
	startingtrace bool
	syscalltick   uint32
	freelink      *m // 在 sched.freem 上

	// 下面这些字段因为它们太大而不能放在低级的 NOSPLIT 函数的堆栈上。
	libcall   libcall
	libcallpc uintptr // 用于 cpu profiler
	libcallsp uintptr
	libcallg  guintptr
	syscall   libcall // 存储 windows 上系统调用的参数

	vdsoSP uintptr // SP 用于 VDSO 调用的回溯 (如果没有产生调用则为 0)
	vdsoPC uintptr // PC 用于 VDSO 调用的回溯

	// preemptGen 记录了完成的抢占信号，用于检测一个抢占失败次数，原子递增
	preemptGen uint32

	dlogPerM

	mOS
}

type p struct {
	id          int32
	status      uint32 // p 的状态 pidle/prunning/...
	link        puintptr
	schedtick   uint32     // 每次调度器调用都会增加
	syscalltick uint32     // 每次进行系统调用都会增加
	sysmontick  sysmontick // 系统监控观察到的最后一次记录
	m           muintptr   // 反向链接到关联的 m （nil 则表示 idle）
	mcache      *mcache
	pcache      pageCache
	raceprocctx uintptr

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

	// Cache of mspan objects from the heap.
	mspancache struct {
		// We need an explicit length here because this field is used
		// in allocation codepaths where write barriers are not allowed,
		// and eliminating the write barrier/keeping it eliminated from
		// slice updates is tricky, moreso than just managing the length
		// ourselves.
		len int
		buf [128]*mspan
	}

	tracebuf traceBufPtr

	// traceSweep 表示应该被 trace 的 sweep 事件
	// 这用于 defer sweep 开始事件，直到 span 实际被 sweep。
	traceSweep bool
	// traceSwept 和 traceReclaimed 会 trace 当前 sweep 循环中
	// sweeping 扫描和回收的字节数。
	traceSwept, traceReclaimed uintptr

	palloc persistentAlloc // per-P，用于避免 mutex

	_ uint32 // Alignment for atomic fields below

	// The when field of the first entry on the timer heap.
	// This is updated using atomic functions.
	// This is 0 if the timer heap is empty.
	timer0When uint64

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
	//
	// TODO: Consider caching this in the running G.
	wbBuf wbBuf

	runSafePointFn uint32 // 如果为 1, 则在下一个 safe-point 运行 sched.safePointFn

	// Lock for timers. We normally access the timers while running
	// on this P, but the scheduler can also do it from a different P.
	timersLock mutex

	// Actions to take at some time. This is used to implement the
	// standard library's time package.
	// Must hold timersLock to access.
	timers []*timer

	// Number of timers in P's heap.
	// Modified using atomic instructions.
	numTimers uint32

	// Number of timerModifiedEarlier timers on P's heap.
	// This should only be modified while holding timersLock,
	// or while the timer status is in a transient state
	// such as timerModifying.
	adjustTimers uint32

	// Number of timerDeleted timers in P's heap.
	// Modified using atomic instructions.
	deletedTimers uint32

	// Race context used while executing timer functions.
	timerRaceCtx uintptr

	// preempt is set to indicate that this P should be enter the
	// scheduler ASAP (regardless of what G is running on it).
	preempt bool

	pad cpu.CacheLinePad
}

type schedt struct {
	// 应该被原子访问。保持在第一个字段来确保 32 位系统上的对齐
	goidgen   uint64
	lastpoll  uint64
	pollUntil uint64 // time to which current poll is sleeping

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

// Values for the flags field of a sigTabT.
const (
	_SigNotify   = 1 << iota // let signal.Notify have signal, even if from kernel
	_SigKill                 // if signal.Notify doesn't take it, exit quietly
	_SigThrow                // if signal.Notify doesn't take it, exit loudly
	_SigPanic                // if the signal is from the kernel, panic
	_SigDefault              // if the signal isn't explicitly requested, don't monitor it
	_SigGoExit               // cause all runtime procs to exit (only used on Plan 9).
	_SigSetStack             // add SA_ONSTACK to libc handler
	_SigUnblock              // always unblock; see blockableSig
	_SigIgn                  // _SIG_DFL action is to ignore the signal
)

// Layout of in-memory per-function information prepared by linker
// See https://golang.org/s/go12symtab.
// Keep in sync with linker (../cmd/link/internal/ld/pcln.go:/pclntab)
// and with package debug/gosym and with symtab.go in package runtime.
type _func struct {
	entry   uintptr // start pc
	nameoff int32   // function name

	args        int32  // in/out args size
	deferreturn uint32 // offset of start of a deferreturn call instruction from entry, if any.

	pcsp      int32
	pcfile    int32
	pcln      int32
	npcdata   int32
	funcID    funcID  // set for certain special runtime functions
	_         [2]int8 // unused
	nfuncdata uint8   // must be last
}

// Pseudo-Func that is returned for PCs that occur in inlined code.
// A *Func can be either a *_func or a *funcinl, and they are distinguished
// by the first uintptr.
type funcinl struct {
	zero  uintptr // set to 0 to distinguish from _func
	entry uintptr // entry of the real (the "outermost") frame.
	name  string
	file  string
	line  int
}

// layout of Itab known to compilers
// allocated in non-garbage-collected memory
// Needs to be in sync with
// ../cmd/compile/internal/gc/reflect.go:/^func.dumptabs.
type itab struct {
	inter *interfacetype
	_type *_type
	hash  uint32 // copy of _type.hash. Used for type switches.
	_     [4]byte
	fun   [1]uintptr // variable sized. fun[0]==0 means _type does not implement inter.
}

// lock-free 栈节点
// 还用于 export_test.go.
type lfnode struct {
	next    uint64
	pushcnt uintptr
}

type forcegcstate struct {
	lock mutex
	g    *g
	idle uint32
}

// startup_random_data holds random bytes initialized at startup. These come from
// the ELF AT_RANDOM auxiliary vector (vdso_linux_amd64.go or os_linux_386.go).
var startupRandomData []byte

// extendRandom 将 r[:n] 中的随机数扩展到整个切片 r。 将 n<0 视为 n==0。
func extendRandom(r []byte, n int) {
	if n < 0 {
		n = 0
	}
	for n < len(r) {
		// 使用散列函数和时间种子扩展随机位
		w := n
		if w > 16 {
			w = 16
		}
		h := memhash(unsafe.Pointer(&r[n-w]), uintptr(nanotime()), uintptr(w))
		for i := 0; i < sys.PtrSize && n < len(r); i++ {
			r[n] = byte(h)
			n++
			h >>= 8
		}
	}
}

// _defer 在被推迟调用的列表上保存了一个入口，
// 如果你在这里增加了一个字段，则需要在 freedefer 和 deferProStack 中增加清除它的代码
// This struct must match the code in cmd/compile/internal/gc/reflect.go:deferstruct
// and cmd/compile/internal/gc/ssa.go:(*state).call.
// Some defers will be allocated on the stack and some on the heap.
// All defers are logically part of the stack, so write barriers to
// initialize them are not required. All defers must be manually scanned,
// and for heap defers, marked.
type _defer struct {
	siz     int32 // includes both arguments and results
	started bool
	heap    bool
	// openDefer indicates that this _defer is for a frame with open-coded
	// defers. We have only one defer record for the entire frame (which may
	// currently have 0, 1, or more defers active).
	openDefer bool
	sp        uintptr  // defer 时的 sp
	pc        uintptr  // pc at time of defer
	fn        *funcval // can be nil for open-coded defers
	_panic    *_panic  // panic 被 defer
	link      *_defer

	// If openDefer is true, the fields below record values about the stack
	// frame and associated function that has the open-coded defer(s). sp
	// above will be the sp for the frame, and pc will be address of the
	// deferreturn call in the function.
	fd   unsafe.Pointer // funcdata for the function associated with the frame
	varp uintptr        // value of varp for the stack frame
	// framepc is the current pc associated with the stack frame. Together,
	// with sp above (which is the sp associated with the stack frame),
	// framepc/sp can be used as pc/sp pair to continue a stack trace via
	// gentraceback().
	framepc uintptr
}

// _panic 保存了一个活跃的 panic
//
// 这个标记了 go:notinheap 因为 _panic 的值必须位于栈上
//
// argp 和 link 字段为栈指针，但在栈增长时不需要特殊处理：因为他们是指针类型且
// _panic 值只位于栈上，正常的栈指针调整会处理他们。
//
//go:notinheap
type _panic struct {
	argp      unsafe.Pointer // panic 期间 defer 调用参数的指针; 无法移动 - liblink 已知
	arg       interface{}    // panic 的参数
	link      *_panic        // link 链接到更早的 panic
	pc        uintptr        // where to return to in runtime if this panic is bypassed
	sp        unsafe.Pointer // where to return to in runtime if this panic is bypassed
	recovered bool           // 表明 panic 是否结束
	aborted   bool           // 表明 panic 是否忽略
	goexit    bool
}

// stack traces
type stkframe struct {
	fn       funcInfo   // function being run
	pc       uintptr    // program counter within fn
	continpc uintptr    // program counter where execution can continue, or 0 if not
	lr       uintptr    // program counter at caller aka link register
	sp       uintptr    // stack pointer at pc
	fp       uintptr    // stack pointer at caller aka frame pointer
	varp     uintptr    // top of local variables
	argp     uintptr    // pointer to function arguments
	arglen   uintptr    // number of bytes at argp
	argmap   *bitvector // force use of this argmap
}

// ancestorInfo records details of where a goroutine was started.
type ancestorInfo struct {
	pcs  []uintptr // pcs from the stack of this goroutine
	goid int64     // goroutine id of this goroutine; original goroutine possibly dead
	gopc uintptr   // pc of go statement that created this goroutine
}

const (
	_TraceRuntimeFrames = 1 << iota // include frames for internal runtime functions.
	_TraceTrap                      // the initial PC, SP are from a trap, not a return PC from a call
	_TraceJumpStack                 // if traceback is on a systemstack, resume trace at g that called into it
)

// The maximum number of frames we print for a traceback
const _TracebackMaxFrames = 100

// A waitReason explains why a goroutine has been stopped.
// See gopark. Do not re-use waitReasons, add new ones.
type waitReason uint8

const (
	waitReasonZero                  waitReason = iota // ""
	waitReasonGCAssistMarking                         // "GC assist marking"
	waitReasonIOWait                                  // "IO wait"
	waitReasonChanReceiveNilChan                      // "chan receive (nil chan)"
	waitReasonChanSendNilChan                         // "chan send (nil chan)"
	waitReasonDumpingHeap                             // "dumping heap"
	waitReasonGarbageCollection                       // "garbage collection"
	waitReasonGarbageCollectionScan                   // "garbage collection scan"
	waitReasonPanicWait                               // "panicwait"
	waitReasonSelect                                  // "select"
	waitReasonSelectNoCases                           // "select (no cases)"
	waitReasonGCAssistWait                            // "GC assist wait"
	waitReasonGCSweepWait                             // "GC sweep wait"
	waitReasonGCScavengeWait                          // "GC scavenge wait"
	waitReasonChanReceive                             // "chan receive"
	waitReasonChanSend                                // "chan send"
	waitReasonFinalizerWait                           // "finalizer wait"
	waitReasonForceGGIdle                             // "force gc (idle)"
	waitReasonSemacquire                              // "semacquire"
	waitReasonSleep                                   // "sleep"
	waitReasonSyncCondWait                            // "sync.Cond.Wait"
	waitReasonTimerGoroutineIdle                      // "timer goroutine (idle)"
	waitReasonTraceReaderBlocked                      // "trace reader (blocked)"
	waitReasonWaitForGCCycle                          // "wait for GC cycle"
	waitReasonGCWorkerIdle                            // "GC worker (idle)"
	waitReasonPreempted                               // "preempted"
)

var waitReasonStrings = [...]string{
	waitReasonZero:                  "",
	waitReasonGCAssistMarking:       "GC assist marking",
	waitReasonIOWait:                "IO wait",
	waitReasonChanReceiveNilChan:    "chan receive (nil chan)",
	waitReasonChanSendNilChan:       "chan send (nil chan)",
	waitReasonDumpingHeap:           "dumping heap",
	waitReasonGarbageCollection:     "garbage collection",
	waitReasonGarbageCollectionScan: "garbage collection scan",
	waitReasonPanicWait:             "panicwait",
	waitReasonSelect:                "select",
	waitReasonSelectNoCases:         "select (no cases)",
	waitReasonGCAssistWait:          "GC assist wait",
	waitReasonGCSweepWait:           "GC sweep wait",
	waitReasonGCScavengeWait:        "GC scavenge wait",
	waitReasonChanReceive:           "chan receive",
	waitReasonChanSend:              "chan send",
	waitReasonFinalizerWait:         "finalizer wait",
	waitReasonForceGGIdle:           "force gc (idle)",
	waitReasonSemacquire:            "semacquire",
	waitReasonSleep:                 "sleep",
	waitReasonSyncCondWait:          "sync.Cond.Wait",
	waitReasonTimerGoroutineIdle:    "timer goroutine (idle)",
	waitReasonTraceReaderBlocked:    "trace reader (blocked)",
	waitReasonWaitForGCCycle:        "wait for GC cycle",
	waitReasonGCWorkerIdle:          "GC worker (idle)",
	waitReasonPreempted:             "preempted",
}

func (w waitReason) String() string {
	if w < 0 || w >= waitReason(len(waitReasonStrings)) {
		return "unknown wait reason"
	}
	return waitReasonStrings[w]
}

var (
	allglen    uintptr
	allm       *m
	allp       []*p  // 所有 P 的存储位置，P 的个数是可以动态调整的
	allpLock   mutex // Protects P-less reads of allp and all writes
	gomaxprocs int32
	ncpu       int32
	forcegc    forcegcstate
	sched      schedt
	newprocs   int32

	// 有关可用的 cpu 功能的信息。
	// 在 runtime.cpuinit 中启动时设置。
	// 运行时之外的包不应使用这些包因为它们不是外部 api。
	// 启动时在 asm_{386,amd64}.s 中设置
	processorVersionInfo uint32
	isIntel              bool
	lfenceBeforeRdtsc    bool

	goarm                uint8 // set by cmd/link on arm systems
	framepointer_enabled bool  // set by cmd/link
)

// Set by the linker so the runtime can determine the buildmode.
var (
	islibrary bool // -buildmode=c-shared
	isarchive bool // -buildmode=c-archive
)
