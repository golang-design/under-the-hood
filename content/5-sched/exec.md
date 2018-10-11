# 5 调度器: 执行调度

所有的初始化工作都已经完成了，是时候启动运行时调度器了。

## 执行前的准备

在 [1 引导](../1-boot.md) 中我们已经看到了当所有准备工作都完成后，最后一个开始执行的引导调用就是 `runtime.mstart` 了。
现在我们来看看它在干什么。

```go
// 启动 M
//
// 该函数不能拆分栈，因为我们甚至还没有设置栈的边界
//
// 它可能会在 STW 阶段运行（因为它还没有 P），所以 write barrier 也是不允许的
//
//go:nosplit
//go:nowritebarrierrec
func mstart() {
	_g_ := getg()

	// 终于开始确定执行栈的边界了
	// 通过检查 g 执行占的边界来确定是否为系统栈
	osStack := _g_.stack.lo == 0
	if osStack {
		// 根据系统栈初始化执行栈的边界
		// cgo 可能会离开 stack.hi
		// minit 可能会更新栈的边界
		size := _g_.stack.hi
		if size == 0 {
			size = 8192 * sys.StackGuardMultiplier
		}
		_g_.stack.hi = uintptr(noescape(unsafe.Pointer(&size)))
		_g_.stack.lo = _g_.stack.hi - size + 1024
	}
	// 初始化栈 guard，进而可以同时调用 Go 或 C 函数。
	_g_.stackguard0 = _g_.stack.lo + _StackGuard
	_g_.stackguard1 = _g_.stackguard0

	// 启动！
	mstart1()

	// 退出线程
	if GOOS == "windows" || GOOS == "solaris" || GOOS == "plan9" || GOOS == "darwin" {
		// 由于 windows, solaris, darwin 和 plan9 总是系统分配的栈，在在 mstart 之前放进 _g_.stack 的
		// 因此上面的逻辑还没有设置 osStack。
		osStack = true
	}

	// 退出线程
	mexit(osStack)
}
```

TODO:

```go
func mstart1() {
	_g_ := getg()

	// 检查当前执行的 g 不是 g0
	if _g_ != _g_.m.g0 {
		throw("bad runtime·mstart")
	}

	// 为了在 mcall 的栈顶使用调用方来结束当前线程，做记录
	// 当进入 schedule 之后，我们再也不会回到 mstart1，所以其他调用可以复用当前帧。
	save(getcallerpc(), getcallersp())
	asminit()
	minit()

	// 设置信号 handler；在 minit 之后，因为 minit 可以准备处理信号的的线程
	if _g_.m == &m0 {
		mstartm0()
	}

	// 执行启动函数
	if fn := _g_.m.mstartfn; fn != nil {
		fn()
	}

	// GC startTheWorld 会检查 spinning M 是否少于并发标记需求
	// 新建 m，设置 m.helpgc = -1，加入闲置队列等待唤醒
	if _g_.m.helpgc != 0 {
		_g_.m.helpgc = 0
		stopm()
	} else if _g_.m != &m0 {
		// 绑定 p
		acquirep(_g_.m.nextp.ptr())
		_g_.m.nextp = 0
	}

	// 彻底准备好，开始调度，永不返回
	schedule()
}
```

### 细节

TODO: 解释 pc/sp

```go
// getcallerpc 返回它调用方的调用方程序计数器 PC program conter
// getcallersp 返回它调用方的调用方的栈指针 SP stack pointer
// 实现由编译器内建，在任何平台上都没有实现它的代码
//
// 例如:
//
//	func f(arg1, arg2, arg3 int) {
//		pc := getcallerpc()
//		sp := getcallersp()
//	}
//
// 这两行会寻找调用 f 的 PC 和 SP
//
// 调用 getcallerpc 和 getcallersp 必须被询问的帧中完成
//
// getcallersp 的结果在返回时是正确的，但是它可能会被任何随后调用的函数无效，
// 因为它可能会重新定位堆栈，以使其增长或缩小。一般规则是，getcallersp 的结果
// 应该立即使用，并且只能传递给 nosplit 函数。

//go:noescape
func getcallerpc() uintptr

//go:noescape
func getcallersp() uintptr // implemented as an intrinsic on all platforms


// save updates getg().sched to refer to pc and sp so that a following
// gogo will restore pc and sp.
//
// save must not have write barriers because invoking a write barrier
// can clobber getg().sched.
//
//go:nosplit
//go:nowritebarrierrec
func save(pc, sp uintptr) {
	_g_ := getg()

	_g_.sched.pc = pc
	_g_.sched.sp = sp
	_g_.sched.lr = 0
	_g_.sched.ret = 0
	_g_.sched.g = guintptr(unsafe.Pointer(_g_))
	// We need to ensure ctxt is zero, but can't have a write
	// barrier here. However, it should always already be zero.
	// Assert that.
	if _g_.sched.ctxt != nil {
		badctxt()
	}
}
```

TODO: 解释 control word

```asm
TEXT runtime·asminit(SB),NOSPLIT,$0-0
	// Linux and MinGW start the FPU in extended double precision.
	// Other operating systems use double precision.
	// Change to double precision to match them,
	// and to match other hardware that only has double.
	FLDCW	runtime·controlWord64(SB)
	RET
```

TODO: 解释 signal mask

```go
// 初始化一个新的 m （包括引导阶段的 m）
// 在一个新的线程上调用，不分配内存
func minit() {
	// The alternate signal stack is buggy on arm and arm64.
	// The signal handler handles it directly.
	if GOARCH != "arm" && GOARCH != "arm64" {
		minitSignalStack()
	}
	minitSignalMask()
}
```

TODO: 解释 extra m

```go
// mstartm0 实现了一部分 mstart1，只运行在 m0 上
//
// 允许 write barrier，因为我们知道 GC 此时还不能运行，因此他们没有 op。
//
//go:yeswritebarrierrec
func mstartm0() {
	// 创建一个额外的 M 服务 non-Go 线程（cgo 调用中产生的线程）的回调
	// windows 上也需要额外 M 来服务 syscall.NewCallback 产生的回调，见 issue #6751
	if (iscgo || GOOS == "windows") && !cgoHasExtraM {
		cgoHasExtraM = true
		newextram()
	}
	initsig(false)
}
```

TODO: 解释 P 的绑定过程

```go
// Associate p and the current m.
//
// This function is allowed to have write barriers even if the caller
// isn't because it immediately acquires _p_.
//
//go:yeswritebarrierrec
func acquirep(_p_ *p) {
	// Do the part that isn't allowed to have write barriers.
	acquirep1(_p_)

	// have p; write barriers now allowed
	_g_ := getg()
	_g_.m.mcache = _p_.mcache

	if trace.enabled {
		traceProcStart()
	}
}
```

```go
// acquirep1 is the first step of acquirep, which actually acquires
// _p_. This is broken out so we can disallow write barriers for this
// part, since we don't yet have a P.
//
//go:nowritebarrierrec
func acquirep1(_p_ *p) {
	_g_ := getg()

	if _g_.m.p != 0 || _g_.m.mcache != nil {
		throw("acquirep: already in go")
	}
	if _p_.m != 0 || _p_.status != _Pidle {
		id := int64(0)
		if _p_.m != 0 {
			id = _p_.m.ptr().id
		}
		print("acquirep: p->m=", _p_.m, "(", id, ") p->status=", _p_.status, "\n")
		throw("acquirep: invalid p state")
	}
	_g_.m.p.set(_p_)
	_p_.m.set(_g_.m)
	_p_.status = _Prunning
}
```

TODO: 解释 M 停用，讨论最近即将在下一个版本中移除的 helpgc

```go
// Stops execution of the current m until new work is available.
// Returns with acquired P.
// 停止当前 m 的执行，直到新的 work 有效
// 返回要求绑定的 p
func stopm() {
	_g_ := getg()

	if _g_.m.locks != 0 {
		throw("stopm holding locks")
	}
	if _g_.m.p != 0 {
		throw("stopm holding p")
	}
	if _g_.m.spinning {
		throw("stopm spinning")
	}

retry:
	lock(&sched.lock)
	mput(_g_.m)
	unlock(&sched.lock)
	notesleep(&_g_.m.park)
	noteclear(&_g_.m.park)
	if _g_.m.helpgc != 0 {
		// helpgc() set _g_.m.p and _g_.m.mcache, so we have a P.
		gchelper()
		// Undo the effects of helpgc().
		_g_.m.helpgc = 0
		_g_.m.mcache = nil
		_g_.m.p = 0
		goto retry
	}
	acquirep(_g_.m.nextp.ptr())
	_g_.m.nextp = 0
}
```

## 核心调度

千辛万苦，我们终于来到了核心的调度逻辑。

```go
// 调度器的一轮：找到 runnable goroutine 并进行执行且永不返回
func schedule() {
	_g_ := getg()

	if _g_.m.locks != 0 {
		throw("schedule: holding locks")
	}

	// m.lockedg 会在 lockosthread 下变为非零
	if _g_.m.lockedg != 0 {
		stoplockedm()
		execute(_g_.m.lockedg.ptr(), false) // 永不返回
	}

	// 我们不应该调度一个正在执行 cgo 调用的 g
	// 因为 cgo 在使用当前 m 的 g0 栈
	if _g_.m.incgo {
		throw("schedule: in cgo")
	}

top:
	if sched.gcwaiting != 0 {
		// 如果还在等待 gc，则
		gcstopm()
		goto top
	}
	if _g_.m.p.ptr().runSafePointFn != 0 {
		runSafePointFn()
	}

	var gp *g
	var inheritTime bool

	// trace 相关
	if trace.enabled || trace.shutdown {
		gp = traceReader()
		if gp != nil {
			casgstatus(gp, _Gwaiting, _Grunnable)
			traceGoUnpark(gp, 0)
		}
	}

	// 正在 gc，去找 gc 的 g
	if gp == nil && gcBlackenEnabled != 0 {
		gp = gcController.findRunnableGCWorker(_g_.m.p.ptr())
	}

	if gp == nil {
		// 说明不在 gc
		//
		// 每调度 61 次，就检查一次全局队列，保证公平性
		// 否则两个 goroutine 可以通过互相 respawn 一直占领本地的 runqueue
		if _g_.m.p.ptr().schedtick%61 == 0 && sched.runqsize > 0 {
			lock(&sched.lock)
			// 从全局队列中偷 g
			gp = globrunqget(_g_.m.p.ptr(), 1)
			unlock(&sched.lock)
		}
	}
	if gp == nil {
		// 说明不在 gc
		// 两种情况：
		//  1. 普通取
		//  2. 全局队列中偷不到的取
		// 从本地队列中取
		gp, inheritTime = runqget(_g_.m.p.ptr())
		if gp != nil && _g_.m.spinning {
			throw("schedule: spinning with local work")
		}
	}
	if gp == nil {
		// 如果偷都偷不到，则休眠，在此阻塞
		gp, inheritTime = findrunnable()
	}

	// 这个时候一定取到 g 了

	if _g_.m.spinning {
		// 如果 m 是 spinning 状态，则
		//   1. 从 spinning -> non-spinning
		//   2. 在没有 spinning 的 m 的情况下，再多创建一个新的 spinning m
		resetspinning()
	}

	if gp.lockedm != 0 {
		// 如果 g 需要 lock 到 m 上，则会将当前的 p
		// 给这个要 lock 的 g
		// 然后阻塞等待一个新的 p
		startlockedm(gp)
		goto top
	}

	// 开始执行
	execute(gp, inheritTime)
}
```

```go
// Schedules gp to run on the current M.
// If inheritTime is true, gp inherits the remaining time in the
// current time slice. Otherwise, it starts a new time slice.
// Never returns.
//
// Write barriers are allowed because this is called immediately after
// acquiring a P in several places.
//
//go:yeswritebarrierrec
func execute(gp *g, inheritTime bool) {
	_g_ := getg()

	// 将 g 正式切换为 _Grunning 状态
	casgstatus(gp, _Grunnable, _Grunning)
	gp.waitsince = 0
	gp.preempt = false
	gp.stackguard0 = gp.stack.lo + _StackGuard
	if !inheritTime {
		_g_.m.p.ptr().schedtick++
	}
	_g_.m.curg = gp
	gp.m = _g_.m

	// profiling 相关
	hz := sched.profilehz
	if _g_.m.profilehz != hz {
		setThreadCPUProfiler(hz)
	}

	// trace 相关
	if trace.enabled {
		// GoSysExit has to happen when we have a P, but before GoStart.
		// So we emit it here.
		if gp.syscallsp != 0 && gp.sysblocktraced {
			traceGoSysExit(gp.sysexitticks)
		}
		traceGoStart()
	}

	gogo(&gp.sched)
}
```

我们看一下 386 平台下的实现：

```asm
// void gogo(Gobuf*)
// 从 Gobuf 恢复状态; longjmp
TEXT runtime·gogo(SB), NOSPLIT, $8-4
	MOVL	buf+0(FP), BX		// 运行现场
	MOVL	gobuf_g(BX), DX
	MOVL	0(DX), CX		// 确认 g != nil
	get_tls(CX)
	MOVL	DX, g(CX)
	MOVL	gobuf_sp(BX), SP	// 恢复 SP
	MOVL	gobuf_ret(BX), AX
	MOVL	gobuf_ctxt(BX), DX
	MOVL	$0, gobuf_sp(BX)	// 清理，辅助 GC
	MOVL	$0, gobuf_ret(BX)
	MOVL	$0, gobuf_ctxt(BX)
	MOVL	gobuf_pc(BX), BX	// 获取 g 要执行的函数的入口地址
	JMP	BX						// 开始执行
```

这个 `gogo` 的实现真实非常巧妙。初次阅读时，看到 `JMP BX` 开始执行 goroutine 函数体
后就没了，简直一脸疑惑，就这么没了？后续调用怎么回到调度器呢？事实上我们已经在 [5 调度器：初始化](init.md) 一节中
看到过相关操作了：

```go
func newproc1(fn *funcval, argp *uint8, narg int32, callergp *g, callerpc uintptr) {
	(...)
	memclrNoHeapPointers(unsafe.Pointer(&newg.sched), unsafe.Sizeof(newg.sched))
	newg.sched.sp = sp
	newg.stktopsp = sp
	newg.sched.pc = funcPC(goexit) + sys.PCQuantum // +PCQuantum 从而前一个指令还在相同的函数内
	newg.sched.g = guintptr(unsafe.Pointer(newg))
	gostartcallfn(&newg.sched, fn)
	(...)
}
```

可以看到，在执行现场栈顶 `sched.pc` 保存的其实是 `goexit` 的地址。
那么也就是 `JMP` 跳转到 `goexit`：

```go
// 在 goroutine 返回 goexit + PCQuantum 时运行的最顶层函数。
TEXT runtime·goexit(SB),NOSPLIT,$0-0
	BYTE	$0x90	// NOP
	CALL	runtime·goexit1(SB)	// 不会返回
	// traceback from goexit1 must hit code range of goexit
	BYTE	$0x90	// NOP
```

TODO: 考虑配图解释运行现场

那么接下来就是去执行 `goexit1` 了：

```go
// 完成当前 goroutine 的执行
func goexit1() {

	// race 和 trace 相关
	if raceenabled {
		racegoend()
	}
	if trace.enabled {
		traceGoEnd()
	}

	// 开始收尾工作
	mcall(goexit0)
}
```

通过 `mcall` 完成 `goexit0` 的调用：

```asm
// func mcall(fn func(*g))
// 切换到 m->g0 栈, 并调用 fn(g).
// Fn 必须永不返回. 它应该使用 gogo(&g->sched) 来持续运行 g
TEXT runtime·mcall(SB), NOSPLIT, $0-4
	MOVL	fn+0(FP), DI

	get_tls(DX)
	MOVL	g(DX), AX	// 在 g->sched 中保存状态
	MOVL	0(SP), BX	// 调用方 PC
	MOVL	BX, (g_sched+gobuf_pc)(AX)
	LEAL	fn+0(FP), BX	// 调用方 SP
	MOVL	BX, (g_sched+gobuf_sp)(AX)
	MOVL	AX, (g_sched+gobuf_g)(AX)

	// 切换到 m->g0 及其栈，调用 fn
	MOVL	g(DX), BX
	MOVL	g_m(BX), BX
	MOVL	m_g0(BX), SI
	CMPL	SI, AX	// 如果 g == m->g0 要调用 badmcall
	JNE	3(PC)
	MOVL	$runtime·badmcall(SB), AX
	JMP	AX
	MOVL	SI, g(DX)	// g = m->g0
	MOVL	(g_sched+gobuf_sp)(SI), SP	// sp = m->g0->sched.sp
	PUSHL	AX
	MOVL	DI, DX
	MOVL	0(DI), DI
	CALL	DI	// 好了，开始调用 fn
	POPL	AX
	MOVL	$runtime·badmcall2(SB), AX
	JMP	AX
	RET
```

TODO: 考虑配图解释

于是最终开始 `goexit0`：

```go
// goexit 继续在 g0 上执行
func goexit0(gp *g) {
	_g_ := getg()

	// 切换当前的 g 为 _Gdead
	casgstatus(gp, _Grunning, _Gdead)
	if isSystemGoroutine(gp) {
		atomic.Xadd(&sched.ngsys, -1)
	}

	// 清理
	gp.m = nil
	locked := gp.lockedm != 0
	gp.lockedm = 0
	_g_.m.lockedg = 0
	gp.paniconfault = false
	gp._defer = nil // 应该已经为 true，但以防万一
	gp._panic = nil // Goexit 中 panic 则不为 nil， 指向栈分配的数据
	gp.writebuf = nil
	gp.waitreason = 0
	gp.param = nil
	gp.labels = nil
	gp.timer = nil

	if gcBlackenEnabled != 0 && gp.gcAssistBytes > 0 {
		// 刷新 assist credit 到全局池。
		// 如果应用在快速创建 goroutine，这可以为 pacing 提供更好的信息。
		scanCredit := int64(gcController.assistWorkPerByte * float64(gp.gcAssistBytes))
		atomic.Xaddint64(&gcController.bgScanCredit, scanCredit)
		gp.gcAssistBytes = 0
	}

	// 注意 gp 的栈 scan 目前开始变为 valid，因为它没有栈了
	gp.gcscanvalid = true

	// 解绑 m 和 g
	dropg()

	if GOARCH == "wasm" { // wasm 目前还没有线程支持
		// 将 g 扔进 gfree 链表中等待复用
		gfput(_g_.m.p.ptr(), gp)
		// 再次进行调度
		schedule() // 永不返回
	}

	if _g_.m.lockedInt != 0 {
		print("invalid m->lockedInt = ", _g_.m.lockedInt, "\n")
		throw("internal lockOSThread error")
	}
	_g_.m.lockedExt = 0

	// 将 g 扔进 gfree 链表中等待复用
	gfput(_g_.m.p.ptr(), gp)

	if locked {
		// The goroutine may have locked this thread because
		// it put it in an unusual kernel state. Kill it
		// rather than returning it to the thread pool.

		// Return to mstart, which will release the P and exit
		// the thread.
		if GOOS != "plan9" { // See golang.org/issue/22227.
			gogo(&_g_.m.g0.sched)
		}
	}

	// 再次进行调度
	schedule()
}
```

TODO: 小结一下调度逻辑

### 细节

#### 偷取工作

TODO: 解释全局偷取

```go
// 从全局队列中偷取，调用时必须锁住调度器
func globrunqget(_p_ *p, max int32) *g {
	if sched.runqsize == 0 {
		return nil
	}

	n := sched.runqsize/gomaxprocs + 1
	if n > sched.runqsize {
		n = sched.runqsize
	}
	if max > 0 && n > max {
		n = max
	}
	if n > int32(len(_p_.runq))/2 {
		n = int32(len(_p_.runq)) / 2
	}

	sched.runqsize -= n
	if sched.runqsize == 0 {
		sched.runqtail = 0
	}

	gp := sched.runqhead.ptr()
	sched.runqhead = gp.schedlink
	n--
	for ; n > 0; n-- {
		gp1 := sched.runqhead.ptr()
		sched.runqhead = gp1.schedlink
		runqput(_p_, gp1, false)
	}
	return gp
}
```

TODO: 解释本地队列取

```go
// Get g from local runnable queue.
// If inheritTime is true, gp should inherit the remaining time in the
// current time slice. Otherwise, it should start a new time slice.
// Executed only by the owner P.
func runqget(_p_ *p) (gp *g, inheritTime bool) {
	// If there's a runnext, it's the next G to run.
	for {
		next := _p_.runnext
		if next == 0 {
			break
		}
		if _p_.runnext.cas(next, 0) {
			return next.ptr(), true
		}
	}

	for {
		h := atomic.Load(&_p_.runqhead) // load-acquire, synchronize with other consumers
		t := _p_.runqtail
		if t == h {
			return nil, false
		}
		gp := _p_.runq[h%uint32(len(_p_.runq))].ptr()
		if atomic.Cas(&_p_.runqhead, h, h+1) { // cas-release, commits consume
			return gp, false
		}
	}
}
```

TODO: 解释偷

```go
// Finds a runnable goroutine to execute.
// Tries to steal from other P's, get g from global queue, poll network.
func findrunnable() (gp *g, inheritTime bool) {
	_g_ := getg()

	// The conditions here and in handoffp must agree: if
	// findrunnable would return a G to run, handoffp must start
	// an M.

top:
	_p_ := _g_.m.p.ptr()
	if sched.gcwaiting != 0 {
		gcstopm()
		goto top
	}
	if _p_.runSafePointFn != 0 {
		runSafePointFn()
	}
	if fingwait && fingwake {
		if gp := wakefing(); gp != nil {
			ready(gp, 0, true)
		}
	}
	if *cgo_yield != nil {
		asmcgocall(*cgo_yield, nil)
	}

	// local runq
	if gp, inheritTime := runqget(_p_); gp != nil {
		return gp, inheritTime
	}

	// global runq
	if sched.runqsize != 0 {
		lock(&sched.lock)
		gp := globrunqget(_p_, 0)
		unlock(&sched.lock)
		if gp != nil {
			return gp, false
		}
	}

	// Poll network.
	// This netpoll is only an optimization before we resort to stealing.
	// We can safely skip it if there are no waiters or a thread is blocked
	// in netpoll already. If there is any kind of logical race with that
	// blocked thread (e.g. it has already returned from netpoll, but does
	// not set lastpoll yet), this thread will do blocking netpoll below
	// anyway.
	if netpollinited() && atomic.Load(&netpollWaiters) > 0 && atomic.Load64(&sched.lastpoll) != 0 {
		if gp := netpoll(false); gp != nil { // non-blocking
			// netpoll returns list of goroutines linked by schedlink.
			injectglist(gp.schedlink.ptr())
			casgstatus(gp, _Gwaiting, _Grunnable)
			if trace.enabled {
				traceGoUnpark(gp, 0)
			}
			return gp, false
		}
	}

	// Steal work from other P's.
	procs := uint32(gomaxprocs)
	if atomic.Load(&sched.npidle) == procs-1 {
		// Either GOMAXPROCS=1 or everybody, except for us, is idle already.
		// New work can appear from returning syscall/cgocall, network or timers.
		// Neither of that submits to local run queues, so no point in stealing.
		goto stop
	}
	// If number of spinning M's >= number of busy P's, block.
	// This is necessary to prevent excessive CPU consumption
	// when GOMAXPROCS>>1 but the program parallelism is low.
	if !_g_.m.spinning && 2*atomic.Load(&sched.nmspinning) >= procs-atomic.Load(&sched.npidle) {
		goto stop
	}
	if !_g_.m.spinning {
		_g_.m.spinning = true
		atomic.Xadd(&sched.nmspinning, 1)
	}
	for i := 0; i < 4; i++ {
		for enum := stealOrder.start(fastrand()); !enum.done(); enum.next() {
			if sched.gcwaiting != 0 {
				goto top
			}
			stealRunNextG := i > 2 // first look for ready queues with more than 1 g
			if gp := runqsteal(_p_, allp[enum.position()], stealRunNextG); gp != nil {
				return gp, false
			}
		}
	}

stop:

	// We have nothing to do. If we're in the GC mark phase, can
	// safely scan and blacken objects, and have work to do, run
	// idle-time marking rather than give up the P.
	if gcBlackenEnabled != 0 && _p_.gcBgMarkWorker != 0 && gcMarkWorkAvailable(_p_) {
		_p_.gcMarkWorkerMode = gcMarkWorkerIdleMode
		gp := _p_.gcBgMarkWorker.ptr()
		casgstatus(gp, _Gwaiting, _Grunnable)
		if trace.enabled {
			traceGoUnpark(gp, 0)
		}
		return gp, false
	}

	// wasm only:
	// Check if a goroutine is waiting for a callback from the WebAssembly host.
	// If yes, pause the execution until a callback was triggered.
	if pauseSchedulerUntilCallback() {
		// A callback was triggered and caused at least one goroutine to wake up.
		goto top
	}

	// Before we drop our P, make a snapshot of the allp slice,
	// which can change underfoot once we no longer block
	// safe-points. We don't need to snapshot the contents because
	// everything up to cap(allp) is immutable.
	allpSnapshot := allp

	// return P and block
	lock(&sched.lock)
	if sched.gcwaiting != 0 || _p_.runSafePointFn != 0 {
		unlock(&sched.lock)
		goto top
	}
	if sched.runqsize != 0 {
		gp := globrunqget(_p_, 0)
		unlock(&sched.lock)
		return gp, false
	}
	if releasep() != _p_ {
		throw("findrunnable: wrong p")
	}
	pidleput(_p_)
	unlock(&sched.lock)

	// Delicate dance: thread transitions from spinning to non-spinning state,
	// potentially concurrently with submission of new goroutines. We must
	// drop nmspinning first and then check all per-P queues again (with
	// #StoreLoad memory barrier in between). If we do it the other way around,
	// another thread can submit a goroutine after we've checked all run queues
	// but before we drop nmspinning; as the result nobody will unpark a thread
	// to run the goroutine.
	// If we discover new work below, we need to restore m.spinning as a signal
	// for resetspinning to unpark a new worker thread (because there can be more
	// than one starving goroutine). However, if after discovering new work
	// we also observe no idle Ps, it is OK to just park the current thread:
	// the system is fully loaded so no spinning threads are required.
	// Also see "Worker thread parking/unparking" comment at the top of the file.
	wasSpinning := _g_.m.spinning
	if _g_.m.spinning {
		_g_.m.spinning = false
		if int32(atomic.Xadd(&sched.nmspinning, -1)) < 0 {
			throw("findrunnable: negative nmspinning")
		}
	}

	// check all runqueues once again
	for _, _p_ := range allpSnapshot {
		if !runqempty(_p_) {
			lock(&sched.lock)
			_p_ = pidleget()
			unlock(&sched.lock)
			if _p_ != nil {
				acquirep(_p_)
				if wasSpinning {
					_g_.m.spinning = true
					atomic.Xadd(&sched.nmspinning, 1)
				}
				goto top
			}
			break
		}
	}

	// Check for idle-priority GC work again.
	if gcBlackenEnabled != 0 && gcMarkWorkAvailable(nil) {
		lock(&sched.lock)
		_p_ = pidleget()
		if _p_ != nil && _p_.gcBgMarkWorker == 0 {
			pidleput(_p_)
			_p_ = nil
		}
		unlock(&sched.lock)
		if _p_ != nil {
			acquirep(_p_)
			if wasSpinning {
				_g_.m.spinning = true
				atomic.Xadd(&sched.nmspinning, 1)
			}
			// Go back to idle GC check.
			goto stop
		}
	}

	// poll network
	if netpollinited() && atomic.Load(&netpollWaiters) > 0 && atomic.Xchg64(&sched.lastpoll, 0) != 0 {
		if _g_.m.p != 0 {
			throw("findrunnable: netpoll with p")
		}
		if _g_.m.spinning {
			throw("findrunnable: netpoll with spinning")
		}
		gp := netpoll(true) // block until new work is available
		atomic.Store64(&sched.lastpoll, uint64(nanotime()))
		if gp != nil {
			lock(&sched.lock)
			_p_ = pidleget()
			unlock(&sched.lock)
			if _p_ != nil {
				acquirep(_p_)
				injectglist(gp.schedlink.ptr())
				casgstatus(gp, _Gwaiting, _Grunnable)
				if trace.enabled {
					traceGoUnpark(gp, 0)
				}
				return gp, false
			}
			injectglist(gp)
		}
	}
	stopm()
	goto top
}
```

#### `startlockedm`

```go
// Schedules the locked m to run the locked gp.
// May run during STW, so write barriers are not allowed.
//go:nowritebarrierrec
func startlockedm(gp *g) {
	_g_ := getg()

	mp := gp.lockedm.ptr()
	if mp == _g_.m {
		throw("startlockedm: locked to me")
	}
	if mp.nextp != 0 {
		throw("startlockedm: m has p")
	}
	// directly handoff current P to the locked m
	incidlelocked(-1)
	_p_ := releasep()
	mp.nextp.set(_p_)
	notewakeup(&mp.park)
	stopm()
}
```

#### M 唤醒

```go
func resetspinning() {
	_g_ := getg()
	if !_g_.m.spinning {
		throw("resetspinning: not a spinning m")
	}
	_g_.m.spinning = false
	nmspinning := atomic.Xadd(&sched.nmspinning, -1)
	if int32(nmspinning) < 0 {
		throw("findrunnable: negative nmspinning")
	}
	// M wakeup policy is deliberately somewhat conservative, so check if we
	// need to wakeup another P here. See "Worker thread parking/unparking"
	// comment at the top of the file for details.
	if nmspinning == 0 && atomic.Load(&sched.npidle) > 0 {
		wakep()
	}
}
// 尝试将一个或多个 P 唤醒来执行 G
// 当 G 可能运行时（newproc, ready）时调用该函数
func wakep() {
	// 对 spinning 线程保守一些，必要时只增加一个
	// 如果失败，则立即返回
	if !atomic.Cas(&sched.nmspinning, 0, 1) {
		return
	}
	startm(nil, true)
}
// Schedules some M to run the p (creates an M if necessary).
// If p==nil, tries to get an idle P, if no idle P's does nothing.
// May run with m.p==nil, so write barriers are not allowed.
// If spinning is set, the caller has incremented nmspinning and startm will
// either decrement nmspinning or set m.spinning in the newly started M.
//go:nowritebarrierrec
func startm(_p_ *p, spinning bool) {
	lock(&sched.lock)
	if _p_ == nil {
		_p_ = pidleget()
		if _p_ == nil {
			unlock(&sched.lock)
			if spinning {
				// The caller incremented nmspinning, but there are no idle Ps,
				// so it's okay to just undo the increment and give up.
				if int32(atomic.Xadd(&sched.nmspinning, -1)) < 0 {
					throw("startm: negative nmspinning")
				}
			}
			return
		}
	}
	mp := mget()
	unlock(&sched.lock)
	if mp == nil {
		var fn func()
		if spinning {
			// The caller incremented nmspinning, so set m.spinning in the new M.
			fn = mspinning
		}
		newm(fn, _p_)
		return
	}
	if mp.spinning {
		throw("startm: m is spinning")
	}
	if mp.nextp != 0 {
		throw("startm: m has p")
	}
	if spinning && !runqempty(_p_) {
		throw("startm: p has runnable gs")
	}
	// The caller incremented nmspinning, so set m.spinning in the new M.
	mp.spinning = spinning
	mp.nextp.set(_p_)
	notewakeup(&mp.park)
}
// 尝试从 midel 列表中获取一个 M
// 调度器必须锁住
// 可能在 STW 期间运行，故不允许 write barrier
//go:nowritebarrierrec
func mget() *m {
	mp := sched.midle.ptr()
	if mp != nil {
		sched.midle = mp.schedlink
		sched.nmidle--
	}
	return mp
}
```

TODO: 我们在 [5 调度器: 系统监控](sysmon.md) 中讨论 `newm`。

#### M/G 解绑

`dropg` 听起来很玄乎，但实际上就是指将当前 g 的 m 置空、将当前 m 的 g 置空，从而完成解绑：

```go
// dropg 移除 m 与当前 goroutine m->curg（简称 gp ）之间的关联。
// 通常，调用方将 gp 的状态设置为非 _Grunning 后立即调用 dropg 完成工作。
// 调用方也有责任在 gp 将使用 ready 时重新启动时进行相关安排。
// 在调用 dropg 并安排 gp ready 好后，调用者可以做其他工作，但最终应该
// 调用 schedule 来重新启动此 m 上的 goroutine 的调度。
func dropg() {
	_g_ := getg()

	setMNoWB(&_g_.m.curg.m, nil)
	setGNoWB(&_g_.m.curg, nil)
}
// setMNoWB 当使用 muintptr 不可行时，在没有 write barrier 下执行 *mp = new
//go:nosplit
//go:nowritebarrier
func setMNoWB(mp **m, new *m) {
	(*muintptr)(unsafe.Pointer(mp)).set(new)
}
// setGNoWB 当使用 guintptr 不可行时，在没有 write barrier 下执行 *gp = new
//go:nosplit
//go:nowritebarrier
func setGNoWB(gp **g, new *g) {
	(*guintptr)(unsafe.Pointer(gp)).set(new)
}
```

## 总结

TODO: 总结整个调度逻辑，遗留的问题（GC worker, ）

## 进一步阅读的参考文献

- [let idle OS threads exit](https://github.com/golang/go/issues/14592)
- [scheduler is slow when goroutines are frequently woken](https://github.com/golang/go/issues/18237)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)