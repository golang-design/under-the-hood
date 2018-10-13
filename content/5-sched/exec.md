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

在启动前，我们在 [5 调度器: 初始化](init.md) 中已经了解到 g 的栈边界是还没有初始化的。
因此我们得在开始前计算栈边界，因此在 `mstart1` 之前，就是一些确定执行栈边界的工作。

当 `mstart1` 结束后，会执行 `mexit` 退出 m。

再来看 `mstart1`。

```go
func mstart1() {
	_g_ := getg()

	// 检查当前执行的 g 是不是 g0
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

几个需要注意的细节：

1. `mstart` 除了在程序引导阶段会被运行之外，也可能在每个 m 被创建时运行（本节稍后讨论）；
2. `mstart` 进入 `mstart1` 之后，会初始化自身用于信号处理的 g，在 `mstartfn` 指定时将其执行；
3. `mstart` 可能在 GC STW 阶段被运行，如果此时需要 `helpgc` （`helpgc` 将在 Go 1.12 中被移除），则会在进入调度前被 park，进入 spinning 状态；
4. 调度循环 `schedule` 无法返回，因此最后一个 `mexit` 目前还不会被执行，因此当下所有的 Go 程序会创建的线程都无法被释放（只有一个特例，当使用 LockOSThread 锁住的 G 退出时会使用 `gogo` 退出 M，在本节稍后讨论）。

除此之外，我们可能会问一个问题：为什么不在创建 G 的时候就完成执行栈边界的计算？
原因在于 `mstart1` 会在每一个进程被创建时被执行，只有当线程被创建后，才能计算 g 执行栈的边界。

### `asminit`

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

### Signal G

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

### Extra M

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

### M/P 绑定

TODO: 解释 P 的绑定过程和 mcache

```go
// 将 p 关联到当前的 m
//
// 因为该函数会立即 acquire P，因此即使调用方不允许 write barrier，
// 此函数仍然允许 write barrier。
//
//go:yeswritebarrierrec
func acquirep(_p_ *p) {
	// 此处不允许 write barrier
	acquirep1(_p_)

	// 已经获取了 p，因此之后允许 write barrier
	_g_ := getg()
	_g_.m.mcache = _p_.mcache

	if trace.enabled {
		traceProcStart()
	}
}
// acquirep1 为 acquirep 的实际获取 p 的第一步。
// 之所以进行拆分是因为我们可以为这个部分驳回 write barrier
//go:nowritebarrierrec
func acquirep1(_p_ *p) {
	_g_ := getg()

	// 检查 确实没有 p
	if _g_.m.p != 0 || _g_.m.mcache != nil {
		throw("acquirep: already in go")
	}

	// 检查 m 是否正常，并检查要获取的 p 的状态
	if _p_.m != 0 || _p_.status != _Pidle {
		id := int64(0)
		if _p_.m != 0 {
			id = _p_.m.ptr().id
		}
		print("acquirep: p->m=", _p_.m, "(", id, ") p->status=", _p_.status, "\n")
		throw("acquirep: invalid p state")
	}

	// 正式获取 p
	_g_.m.p.set(_p_)

	// 将 p 绑定到 m
	_p_.m.set(_g_.m)

	// 修改 p 的状态
	_p_.status = _Prunning
}
```

### M 的 park/unpark

无论出于什么原因，当 m 需要被 park 时，可能（因为还有其他 park M 的方法）会执行该调用。
此调用会将 m 进行 park，并阻塞到它被 unpark 时。
这一过程就是工作线程的 park/unpark。

```go
// 停止当前 m 的执行，直到新的 work 有效
// 在包含要求的 P 下返回
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
	// 将 m 放回到 空闲列表中，因为我们马上就要 park 了
	lock(&sched.lock)
	mput(_g_.m)
	unlock(&sched.lock)

	// park 当前的 M，在此阻塞，直到被唤醒 unpark
	notesleep(&_g_.m.park)

	// 清除 unpark 的 note
	noteclear(&_g_.m.park)

	// 如果需要 helpgc
	if _g_.m.helpgc != 0 {
		// helpgc() 会设置 _g_.m.p 与 _g_.m.mcache，因此我们会 acquire 一个 P 进行
		gchelper()
		// 撤销 helpgc() 的影响
		_g_.m.helpgc = 0
		_g_.m.mcache = nil
		_g_.m.p = 0
		goto retry
	}

	// 此时已经被 unpark，说明有任务要执行
	// 立即 acquire P
	acquirep(_g_.m.nextp.ptr())
	_g_.m.nextp = 0
}
```

它的流程也非常简单，将 m 放回至空闲列表中，而后使用 note 注册一个 park 通知，
阻塞到它重新被 unpark；如果在阻塞结束后，恰好需要 helpgc，则会重新被阻塞。

至此，可以看出 helpgc 已经对 m 的 park/unpark 以及 mstart 产生影响，好在下一个版本中
helpgc 的机制会被移除，我们留到后面的垃圾回收器中再详细讨论。

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

先不管上面究竟做了什么，我们直接看最后一句的 `execute`。

```go
// 在当前 M 上调度 gp。
// 如果 inheritTime 为 true，则 gp 继承剩余的时间片。否则从一个新的时间片开始
// 永不返回。
//
// 该函数允许 write barrier 因为它是在 acquire P 之后的调用的。
//
//go:yeswritebarrierrec
func execute(gp *g, inheritTime bool) {
	_g_ := getg()

	// 将 g 正式切换为 _Grunning 状态
	casgstatus(gp, _Grunnable, _Grunning)
	gp.waitsince = 0
	// 抢占信号
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

	// 终于开始执行了
	gogo(&gp.sched)
}
```

当开始执行 `execute` 后，g 会被切换到 `_Grunning` 状态。
设置自身的抢占信号，将 m 和 g 进行绑定。
最终调用 `gogo` 开始执行。

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
		// 该 goroutine 可能在当前线程上锁住，因为它可能导致了不正常的内核状态
		// 这时候应该 kill 该线程，而非将 m 放回到线程池。

		// 此举会返回到 mstart，从而释放当前的 P 并退出该线程
		if GOOS != "plan9" { // See golang.org/issue/22227.
			gogo(&_g_.m.g0.sched)
		}
	}

	// 再次进行调度
	schedule()
}
```

退出的善后工作也相对简单，无非就是复位 g 的状态、解绑 m 和 g，将其
放入 gfree 链表中等待其他的 go 语句创建新的 g。

如果 goroutine 将自身所在同一个 OS 线程中且没有自行解绑则 m 会退出，而不会被放回到线程池中。
相反，会再次调用 gogo 切换到 g0 执行现场中，这也是目前唯一的退出 m 的机会，在本节最后解释。

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

TODO:

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

#### M 的唤醒

我们已经看到了 M 的 park/unpark 过程，那么 M 的 spinning 转换 non-spinning 的过程如何发生？

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

#### M 的创生

```go
// 创建一个新的 m. 它会启动并调用 fn 或调度器
// fn 必须是静态、非堆上分配的闭包
// 它可能在 m.p==nil 时运行，因此不允许 write barrier
//go:nowritebarrierrec
func newm(fn func(), _p_ *p) {

	// 分配一个 m
	mp := allocm(_p_, fn)

	// 设置 p 用于后续绑定
	mp.nextp.set(_p_)

	// 设置 signal mask
	mp.sigmask = initSigmask

	if gp := getg(); gp != nil && gp.m != nil && (gp.m.lockedExt != 0 || gp.m.incgo) && GOOS != "plan9" {
		// 我们处于一个锁定的 M 或可能由 C 启动的线程。这个线程的内核状态可能
		// 很奇怪（用户可能已将其锁定）。我们不想将其克隆到另一个线程。
		// 相反，请求一个已知状态良好的线程来创建给我们的线程。
		//
		// 在 plan9 上禁用，见 golang.org/issue/22227
		//
		// TODO: This may be unnecessary on Windows, which
		// doesn't model thread creation off fork.
		lock(&newmHandoff.lock)
		if newmHandoff.haveTemplateThread == 0 {
			throw("on a locked thread with no template thread")
		}
		mp.schedlink = newmHandoff.newm
		newmHandoff.newm.set(mp)
		if newmHandoff.waiting {
			newmHandoff.waiting = false
			// 唤醒 m, spinning -> non-spinning
			notewakeup(&newmHandoff.wake)
		}
		unlock(&newmHandoff.lock)
		return
	}
	newm1(mp)
}
```

```go
// Allocate a new m unassociated with any thread.
// Can use p for allocation context if needed.
// fn is recorded as the new m's m.mstartfn.
//
// This function is allowed to have write barriers even if the caller
// isn't because it borrows _p_.
//
//go:yeswritebarrierrec
func allocm(_p_ *p, fn func()) *m {
	_g_ := getg()
	_g_.m.locks++ // disable GC because it can be called from sysmon
	if _g_.m.p == 0 {
		acquirep(_p_) // temporarily borrow p for mallocs in this function
	}

	// Release the free M list. We need to do this somewhere and
	// this may free up a stack we can use.
	if sched.freem != nil {
		lock(&sched.lock)
		var newList *m
		for freem := sched.freem; freem != nil; {
			if freem.freeWait != 0 {
				next := freem.freelink
				freem.freelink = newList
				newList = freem
				freem = next
				continue
			}
			stackfree(freem.g0.stack)
			freem = freem.freelink
		}
		sched.freem = newList
		unlock(&sched.lock)
	}

	mp := new(m)
	mp.mstartfn = fn
	mcommoninit(mp)

	// In case of cgo or Solaris or Darwin, pthread_create will make us a stack.
	// Windows and Plan 9 will layout sched stack on OS stack.
	if iscgo || GOOS == "solaris" || GOOS == "windows" || GOOS == "plan9" || GOOS == "darwin" {
		mp.g0 = malg(-1)
	} else {
		mp.g0 = malg(8192 * sys.StackGuardMultiplier)
	}
	mp.g0.m = mp

	if _p_ == _g_.m.p.ptr() {
		releasep()
	}
	_g_.m.locks--
	if _g_.m.locks == 0 && _g_.preempt { // restore the preemption request in case we've cleared it in newstack
		_g_.stackguard0 = stackPreempt
	}

	return mp
}
```

```go
func newm1(mp *m) {
	if iscgo {
		var ts cgothreadstart
		if _cgo_thread_start == nil {
			throw("_cgo_thread_start missing")
		}
		ts.g.set(mp.g0)
		ts.tls = (*uint64)(unsafe.Pointer(&mp.tls[0]))
		ts.fn = unsafe.Pointer(funcPC(mstart))
		if msanenabled {
			msanwrite(unsafe.Pointer(&ts), unsafe.Sizeof(ts))
		}
		execLock.rlock() // Prevent process clone.
		asmcgocall(_cgo_thread_start, unsafe.Pointer(&ts))
		execLock.runlock()
		return
	}
	execLock.rlock() // Prevent process clone.
	newosproc(mp)
	execLock.runlock()
}
```

当 m 被创建时，会转去运行 `mstart`：

- 如果当前程序为 cgo 程序，则会通过 `asmcgocall` 来创建线程并调用 `mstart`（我们在 [10 cgo](../10-cgo.md)）
- 否则会调用 `newosproc` 来创建线程，从而调用 `mstart`。

既然是 `newosproc` ，我们此刻仍在 Go 的空间中，那么实现就是操作系统特定的了，
因为 WebAssembly 平台目前尚无线程支持，我们就只讨论 darwin 和 linux 了。

##### `runtime/os_darwin.go`

```go
// 可能在 m.p==nil 情况下运行，因此不允许 write barrier
//go:nowritebarrierrec
func newosproc(mp *m) {
	stk := unsafe.Pointer(mp.g0.stack.hi)
	if false {
		print("newosproc stk=", stk, " m=", mp, " g=", mp.g0, " id=", mp.id, " ostk=", &mp, "\n")
	}

	// 初始化 attribute 对象
	var attr pthreadattr
	var err int32
	err = pthread_attr_init(&attr)
	if err != 0 {
		write(2, unsafe.Pointer(&failthreadcreate[0]), int32(len(failthreadcreate)))
		exit(1)
	}

	// 设置想要使用的栈大小。目前为 64KB
	// TODO: just use OS default size?
	const stackSize = 1 << 16
	if pthread_attr_setstacksize(&attr, stackSize) != 0 {
		write(2, unsafe.Pointer(&failthreadcreate[0]), int32(len(failthreadcreate)))
		exit(1)
	}
	//mSysStatInc(&memstats.stacks_sys, stackSize) //TODO: do this?

	// 通知 pthread 库不会 join 这个线程。
	if pthread_attr_setdetachstate(&attr, _PTHREAD_CREATE_DETACHED) != 0 {
		write(2, unsafe.Pointer(&failthreadcreate[0]), int32(len(failthreadcreate)))
		exit(1)
	}

	// Finally, create the thread. It starts at mstart_stub, which does some low-level
	// setup and then calls mstart.
	var oset sigset
	sigprocmask(_SIG_SETMASK, &sigset_all, &oset)
	err = pthread_create(&attr, funcPC(mstart_stub), unsafe.Pointer(mp))
	sigprocmask(_SIG_SETMASK, &oset, nil)
	if err != 0 {
		write(2, unsafe.Pointer(&failthreadcreate[0]), int32(len(failthreadcreate)))
		exit(1)
	}
}
```

我们终于看到进程的创建了，原来还是走的 C 调用：

```go
//go:nosplit
//go:cgo_unsafe_args
func pthread_create(attr *pthreadattr, start uintptr, arg unsafe.Pointer) int32 {
	return libcCall(unsafe.Pointer(funcPC(pthread_create_trampoline)), unsafe.Pointer(&attr))
}
func pthread_create_trampoline()
```

```asm
TEXT runtime·pthread_create_trampoline(SB),NOSPLIT,$0
	PUSHL	BP
	MOVL	SP, BP
	SUBL	$24, SP
	MOVL	32(SP), CX
	LEAL	16(SP), AX	// arg "0" &threadid (which we throw away)
	MOVL	AX, 0(SP)
	MOVL	0(CX), AX	// arg 1 attr
	MOVL	AX, 4(SP)
	MOVL	4(CX), AX	// arg 2 start
	MOVL	AX, 8(SP)
	MOVL	8(CX), AX	// arg 3 arg
	MOVL	AX, 12(SP)
	CALL	libc_pthread_create(SB)
	MOVL	BP, SP
	POPL	BP
	RET
```

##### `runtime/os_linux.go`

而 linux 上的情况就乐观的多了：

```go
// May run with m.p==nil, so write barriers are not allowed.
//go:nowritebarrier
func newosproc(mp *m) {
	stk := unsafe.Pointer(mp.g0.stack.hi)
	/*
	 * note: strace gets confused if we use CLONE_PTRACE here.
	 */
	if false {
		print("newosproc stk=", stk, " m=", mp, " g=", mp.g0, " clone=", funcPC(clone), " id=", mp.id, " ostk=", &mp, "\n")
	}

	// Disable signals during clone, so that the new thread starts
	// with signals disabled. It will enable them in minit.
	var oset sigset
	sigprocmask(_SIG_SETMASK, &sigset_all, &oset)
	ret := clone(cloneFlags, stk, unsafe.Pointer(mp), unsafe.Pointer(mp.g0), unsafe.Pointer(funcPC(mstart)))
	sigprocmask(_SIG_SETMASK, &oset, nil)

	if ret < 0 {
		print("runtime: failed to create new OS thread (have ", mcount(), " already; errno=", -ret, ")\n")
		if ret == -_EAGAIN {
			println("runtime: may need to increase max user processes (ulimit -u)")
		}
		throw("newosproc")
	}
}

//go:noescape
func clone(flags int32, stk, mp, gp, fn unsafe.Pointer) int32
```

```asm
// int32 clone(int32 flags, void *stk, M *mp, G *gp, void (*fn)(void));
TEXT runtime·clone(SB),NOSPLIT,$0
	MOVL	flags+0(FP), DI
	MOVQ	stk+8(FP), SI
	MOVQ	$0, DX
	MOVQ	$0, R10

	// Copy mp, gp, fn off parent stack for use by child.
	// Careful: Linux system call clobbers CX and R11.
	MOVQ	mp+16(FP), R8
	MOVQ	gp+24(FP), R9
	MOVQ	fn+32(FP), R12

	MOVL	$SYS_clone, AX
	SYSCALL

	// In parent, return.
	CMPQ	AX, $0
	JEQ	3(PC)
	MOVL	AX, ret+40(FP)
	RET

	// In child, on new stack.
	MOVQ	SI, SP

	// If g or m are nil, skip Go-related setup.
	CMPQ	R8, $0    // m
	JEQ	nog
	CMPQ	R9, $0    // g
	JEQ	nog

	// Initialize m->procid to Linux tid
	MOVL	$SYS_gettid, AX
	SYSCALL
	MOVQ	AX, m_procid(R8)

	// Set FS to point at m->tls.
	LEAQ	m_tls(R8), DI
	CALL	runtime·settls(SB)

	// In child, set up new stack
	get_tls(CX)
	MOVQ	R8, g_m(R9)
	MOVQ	R9, g(CX)
	CALL	runtime·stackcheck(SB)

nog:
	// Call fn
	CALL	R12

	// It shouldn't return. If it does, exit that thread.
	MOVL	$111, DI
	MOVL	$SYS_exit, AX
	SYSCALL
	JMP	-3(PC)	// keep exiting
```

linux 下为原生系统调用，似乎感受到了不平等待遇 :)

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

#### M 的死亡

我们已经多次提到过 m 当且仅当它所运行的 goroutine 本锁定在该 m 且 goroutine 退出后，
m 才会退出。我们来看一看它的原因。

首先，我们已经知道调度循环会一直进行下去永远不会返回了：

```go
func mstart() {
	(...)
	mstart1() // 永不返回
	(...)
	mexit(osStack)
}
```
那 `mexit` 究竟什么时候会被执行？
事实上，在 `mstart1` 中：

```go
func mstart1() {
	(...)
	// 为了在 mcall 的栈顶使用调用方来结束当前线程，做记录
	// 当进入 schedule 之后，我们再也不会回到 mstart1，所以其他调用可以复用当前帧。
	save(getcallerpc(), getcallersp())
	(...)
}
```

`save` 记录了调用方的 pc 和 sp，而对于 `save`：

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


// save 更新了 getg().sched 的 pc 和 sp 的指向，并允许 gogo 能够恢复到 pc 和 sp
//
// save 不允许 write barrier 因为 write barrier 会破坏 getg().sched
//
//go:nosplit
//go:nowritebarrierrec
func save(pc, sp uintptr) {
	_g_ := getg()

	// 保存当前运行现场
	_g_.sched.pc = pc
	_g_.sched.sp = sp
	_g_.sched.lr = 0
	_g_.sched.ret = 0

	// 保存 g
	_g_.sched.g = guintptr(unsafe.Pointer(_g_))

	// 我们必须确保 ctxt 为零，但这里不允许 write barrier。
	// 所以这里只是做一个断言
	if _g_.sched.ctxt != nil {
		badctxt()
	}
}
```

由于 `mstart/mstart1` 是运行在 g0 上的，因此 `save` 将保存 `mstart` 的运行现场保存到 `g0.sched` 中。
当调度循环执行到 `goexit0` 时，会检查 m 与 g 之间是否被锁住：

```go
func goexit0(gp *g) {
	(...)
	gfput(_g_.m.p.ptr(), gp)

	if locked {
		if GOOS != "plan9" {
			gogo(&_g_.m.g0.sched)
		}
	}
	schedule()
}
```

如果 g 锁在当前 m 上，则调用 `gogo` 恢复到 `g0.sched` 的执行现场，从而恢复到 `mexit` 调用。

最后来看 `mexit`：

```go
// mexit 销毁并退出当前线程
//
// 请不要直接调用来退出线程，因为它必须在线程栈顶上运行。
// 相反，请使用 gogo(&_g_.m.g0.sched) 来解除栈并退出线程。
//
// 当调用时，m.p != nil。因此可以使用 write barrier。
// 在退出前它会释放当前绑定的 P。
//
//go:yeswritebarrierrec
func mexit(osStack bool) {
	g := getg()
	m := g.m

	if m == &m0 {
		// 主线程
		//
		// 在 linux 中，退出主线程会导致进程变为僵尸进程。
		// 在 plan 9 中，退出主线程将取消阻塞等待，及时其他线程仍在运行。
		// 在 Solaris 中我们既不能 exitThread 也不能返回到 mstart 中。
		// 其他系统上可能发生别的糟糕的事情。
		//
		// 我们可以尝试退出之前清理当前 M ，但信号处理非常复杂
		handoffp(releasep()) // 让出 P
		lock(&sched.lock)    // 锁住调度器
		sched.nmfreed++
		checkdead()
		unlock(&sched.lock)
		notesleep(&m.park) // park 主线程，在此阻塞
		throw("locked m0 woke up")
	}

	sigblock()
	unminit()

	// 释放 gsignal 栈
	if m.gsignal != nil {
		stackfree(m.gsignal.stack)
	}

	// 将 m 从 allm 中移除
	lock(&sched.lock)
	for pprev := &allm; *pprev != nil; pprev = &(*pprev).alllink {
		if *pprev == m {
			*pprev = m.alllink
			goto found
		}
	}
	// 如果没找到则是异常状态，说明 allm 管理出错
	throw("m not found in allm")
found:

	// 
	if !osStack {
		// Delay reaping m until it's done with the stack.
		//
		// If this is using an OS stack, the OS will free it
		// so there's no need for reaping.
		atomic.Store(&m.freeWait, 1)
		// Put m on the free list, though it will not be reaped until
		// freeWait is 0. Note that the free list must not be linked
		// through alllink because some functions walk allm without
		// locking, so may be using alllink.
		m.freelink = sched.freem
		sched.freem = m
	}
	unlock(&sched.lock)

	// Release the P.
	handoffp(releasep())
	// After this point we must not have write barriers.

	// Invoke the deadlock detector. This must happen after
	// handoffp because it may have started a new M to take our
	// P's work.
	lock(&sched.lock)
	sched.nmfreed++
	checkdead()
	unlock(&sched.lock)

	if osStack {
		// Return from mstart and let the system thread
		// library free the g0 stack and terminate the thread.
		return
	}

	// mstart is the thread's entry point, so there's nothing to
	// return to. Exit the thread directly. exitThread will clear
	// m.freeWait when it's done with the stack and the m can be
	// reaped.
	exitThread(&m.freeWait)
}
```

可惜 `exitThread` 在 darwin 上还是没有定义：

```go
// 未在 darwin 上使用，但必须定义
func exitThread(wait *uint32) {
}
```

在 linux 386 上：

```asm
// func exitThread(wait *uint32)
TEXT runtime·exitThread(SB),NOSPLIT,$0-4
	MOVL	wait+0(FP), AX
	// 栈使用完毕
	MOVL	$0, (AX)
	MOVL	$1, AX	// 退出当前线程
	MOVL	$0, BX	// exit code
	INT	$0x80	// 没有栈; 不能使用 CALL 调用
	// 甚至可能连一个栈都没有
	INT	$3
	JMP	0(PC)
```

从实现上可以看出，只有 linux 中才可能正常的退出一个栈，而 darwin 只能保持 park 了。
而如果是主线程，则会始终保持 park。

## 总结

我们已经看过了整个调度器的设计，下图纵观了整个过程：

```
          mstart --> mstart1  - - - - - - - - - - - - - - - - - - - - --> mexit
                        |                                                  ^
                        v  yes                                             |
                       m0? ---> mstartm0 --> newextram --> initsig         |
                     no |                                     |            |
                        v                                     |            |
在这里保存 mstart 运行现场  save <-------------------------------+            | 从而在这里可以跳转到 mexit
                        |           服务 cgo 或 windows                     |
                        v                                                  |
                     asminit                                               |
                        |                                                  |
                      minit ----> minitSignalStack --> minitSignalMask     |
                        |                                                  |
                        v      yes                                         |
                     mstartfn? ---> mstartfn                               |
                     no |              |                                   |
                        | <------------+                                   |
                        |                                                  |
                        |       yes                                        |
                      helpgc? --------------> stopm                        |
                     no |                       |                          |
                        |                       | park m                   |
                        |                       | until new g              |
                        v                       |                          |
                     acquirep                   |                          |
                        | <---------------------+                          |
                        v                                     no           |
                     schedule <----------------------------------- lock on os thread?
                        |                                                  |
                        +-----> stoplockedm -----------------+             |
      +----+----------> |                                    |             |
      |    |            |                                    |             |
      |    |      yes   |                                    |             |
      | gcstopm <---- in gc?                                 |             |
      |              no |                                    |             |
      |                 v                                    |             |
      |           runSafePointerFn                           |             |
      |                 |                                    |             |
      |                 v        yes                         |             |
      |             gc blacken? ----> findRunnableGCWorker   |             |
      |                 |                     |              |             |
      |                 v                     |              |             |
      |         runqget / globrunqget         |              |             |
      |                 |                     |              |             |
      |                 v                     |              |             |
      |            findrunnable               |              |             |
      |                 |                     |              |             |
      |                 v                     |              |             |
      |            resetspinning <------------+              |             |
      |                 |                                    |             |
      |           yes   v                                    |             |
   startlockedm <---- locked m?                              |             |
                     no |                                    |             |
                        v                                    |             |
                      execute <------------------------------+             |
                        |                                                  |
                        v                                                  |
                       gogo                                              gfput                               
                        |                                                  ^                               
                        v                                                  |                               
                        G --> goexit --> mcall --> goexit1 ------------> dropg
```

那么，很自然的能够想到这个流程中存在两个问题：

1. `findRunnableGCWorker` 在干什么？
2. 调度循环看似合理，但如果 G 执行时间过长，难道要等到 G 执行完后再调度其他的 G？显然不符合实际情况，那么到底会发生什么事情？

本节篇幅已经相当长了，让我们留到[5 调度器: 系统监控](sysmon.md)和[6 垃圾回收器: 三色标记法](../6-gc/mark.md)中进行讨论。

## 进一步阅读的参考文献

- [Terminate locked OS thread if its goroutine exits](https://github.com/golang/go/issues/20395)
- [Let idle OS threads exit](https://github.com/golang/go/issues/14592)
- [Scheduler is slow when goroutines are frequently woken](https://github.com/golang/go/issues/18237)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)