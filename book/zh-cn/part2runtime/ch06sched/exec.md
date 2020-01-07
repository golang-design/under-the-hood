---
weight: 2103
title: "6.3 调度循环"
---

# 6.3 调度循环

[TOC]

所有的初始化工作都已经完成了，是时候启动运行时调度器了。
我们已经知道，当所有准备工作都完成后，
最后一个开始执行的引导调用就是 `runtime.mstart` 了。现在我们来研究一下它在干什么。

```asm
TEXT runtime·rt0_go(SB),NOSPLIT,$0
	(...)
	CALL	runtime·newproc(SB) // G 初始化
	POPQ	AX
	POPQ	AX

	// 启动 M
	CALL	runtime·mstart(SB) // 开始执行
	RET

DATA	runtime·mainPC+0(SB)/8,$runtime·main(SB)
GLOBL	runtime·mainPC(SB),RODATA,$8
```

## 执行前的准备

### `mstart` 与 `mstart1`

在启动前，在 [调度器: 初始化](./init.md) 中我们已经了解到 G 的栈边界是还没有初始化的。
因此我们必须在开始前计算栈边界，因此在 `mstart1` 之前，就是一些确定执行栈边界的工作。
当 `mstart1` 结束后，会执行 `mexit` 退出 M。`mstart` 也是所有新创建的 M 的起点。

<!-- 该函数不能进行栈分段，因为我们甚至还没有设置栈的边界
它可能会在 STW 阶段运行（因为它还没有 P），所以 write barrier 也是不允许的 -->

```go
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
	if GOOS == "windows" || GOOS == "solaris" || GOOS == "plan9" || GOOS == "darwin" || GOOS == "aix" {
		// 由于 windows, solaris, darwin, aix 和 plan9 总是系统分配的栈，在在 mstart 之前放进 _g_.stack 的
		// 因此上面的逻辑还没有设置 osStack。
		osStack = true
	}

	// 退出线程
	mexit(osStack)
}
```

再来看 `mstart1`。

```go
func mstart1() {
	_g_ := getg()
	(...)

	// 为了在 mcall 的栈顶使用调用方来结束当前线程，做记录
	// 当进入 schedule 之后，我们再也不会回到 mstart1，所以其他调用可以复用当前帧。
	save(getcallerpc(), getcallersp())
	(...)
	minit()

	// 设置信号 handler；在 minit 之后，因为 minit 可以准备处理信号的的线程
	if _g_.m == &m0 {
		mstartm0()
	}

	// 执行启动函数
	if fn := _g_.m.mstartfn; fn != nil {
		fn()
	}

	// 如果当前 m 并非 m0，则要求绑定 p
	if _g_.m != &m0 {
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
3. 调度循环 `schedule` 无法返回，因此最后一个 `mexit` 目前还不会被执行，因此当下所有的 Go 程序会创建的线程都无法被释放
（只有一个特例，当使用 `runtime.LockOSThread` 锁住的 G 退出时会使用 `gogo` 退出 M，在本节稍后讨论）。

<!-- TODO:
我们可能会问一个问题：为什么不在创建 G 的时候就完成执行栈边界的计算？
原因在于 `mstart1` 会在每一个线程被创建时被执行，只有当线程被创建后，才能计算 g 执行栈的边界。 -->


<!-- 
按以下逻辑重新组织本章？
M 的创建
M 的休眠
M 的唤醒
M 的死亡
G 的创建
G 的休眠
G 的唤醒
G 的死亡
P 的创建
P 的死亡
M 与 G 的绑定
M 与 G 的解绑
M 与 P 的绑定
M 与 P 的解绑
G 与 P 的绑定
G 与 P 的解绑
 -->

关于运行时信号处理，以及 note 同步机制，我们分别在 [信号处理机制](./signal.md) 和 [运行时同步原语](./sync.md) 详细分析。

### M 与 P 的绑定

M 与 P 的绑定过程只是简单的将 P 链表中的 P ，保存到 M 中的 P 指针上。
绑定前，P 的状态一定是 `_Pidle`，绑定后 P 的状态一定为 `_Prunning`。

```go
//go:yeswritebarrierrec
func acquirep(_p_ *p) {
	// 此处不允许 write barrier
	wirep(_p_)
	(...)
}
//go:nowritebarrierrec
//go:nosplit
func wirep(_p_ *p) {
	_g_ := getg()
	(...)

	// 检查 m 是否正常，并检查要获取的 p 的状态
	if _p_.m != 0 || _p_.status != _Pidle {
		(...)
		throw("wirep: invalid p state")
	}

	// 将 p 绑定到 m，p 和 m 互相引用
	_g_.m.p.set(_p_) // *_g_.m.p = _p_
	_p_.m.set(_g_.m) // *_p_.m = _g_.m

	// 修改 p 的状态
	_p_.status = _Prunning
}
```

### M 的暂止和复始

无论出于什么原因，当 M 需要被暂止时，可能（因为还有其他暂止 M 的方法）会执行该调用。
此调用会将 M 进行暂止，并阻塞到它被复始时。这一过程就是工作线程的暂止和复始。

```go
// 停止当前 m 的执行，直到新的 work 有效
// 在包含要求的 P 下返回
func stopm() {
	_g_ := getg()
	(...)

	// 将 m 放回到 空闲列表中，因为我们马上就要暂止了
	lock(&sched.lock)
	mput(_g_.m)
	unlock(&sched.lock)

	// 暂止当前的 M，在此阻塞，直到被唤醒
	notesleep(&_g_.m.park)

	// 清除暂止的 note
	noteclear(&_g_.m.park)

	// 此时已经被复始，说明有任务要执行
	// 立即 acquire P
	acquirep(_g_.m.nextp.ptr())
	_g_.m.nextp = 0
}
```

它的流程也非常简单，将 m 放回至空闲列表中，而后使用 note 注册一个暂止通知，
阻塞到它重新被复始。

## 核心调度

千辛万苦，我们终于来到了核心的调度逻辑。

```go
// 调度器的一轮：找到 runnable goroutine 并进行执行且永不返回
func schedule() {
	_g_ := getg()
	(...)

	// m.lockedg 会在 LockOSThread 下变为非零
	if _g_.m.lockedg != 0 {
		stoplockedm()
		execute(_g_.m.lockedg.ptr(), false) // 永不返回
	}
	(...)

top:
	if sched.gcwaiting != 0 {
		// 如果需要 GC，不再进行调度
		gcstopm()
		goto top
	}
	if _g_.m.p.ptr().runSafePointFn != 0 {
		runSafePointFn()
	}

	var gp *g
	var inheritTime bool
	(...)

	// 正在 GC，去找 GC 的 g
	if gp == nil && gcBlackenEnabled != 0 {
		gp = gcController.findRunnableGCWorker(_g_.m.p.ptr())
	}

	if gp == nil {
		// 说明不在 GC
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
		(...)
	}
	if gp == nil {
		// 如果偷都偷不到，则休眠，在此阻塞
		gp, inheritTime = findrunnable()
	}

	// 这个时候一定取到 g 了

	if _g_.m.spinning {
		// 如果 m 是自旋状态，则
		//   1. 从自旋到非自旋
		//   2. 在没有自旋状态的 m 的情况下，再多创建一个新的自旋状态的 m
		resetspinning()
	}

	if sched.disable.user && !schedEnabled(gp) {
		// Scheduling of this goroutine is disabled. Put it on
		// the list of pending runnable goroutines for when we
		// re-enable user scheduling and look again.
		lock(&sched.lock)
		if schedEnabled(gp) {
			// Something re-enabled scheduling while we
			// were acquiring the lock.
			unlock(&sched.lock)
		} else {
			sched.disable.runnable.pushBack(gp)
			sched.disable.n++
			unlock(&sched.lock)
			goto top
		}
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

	(...)

	// 终于开始执行了
	gogo(&gp.sched)
}
```

当开始执行 `execute` 后，g 会被切换到 `_Grunning` 状态。
设置自身的抢占信号，将 m 和 g 进行绑定。
最终调用 `gogo` 开始执行。

在 amd64 平台下的实现：

```asm
// void gogo(Gobuf*)
// 从 Gobuf 恢复状态; longjmp
TEXT runtime·gogo(SB), NOSPLIT, $16-8
	MOVQ	buf+0(FP), BX		// 运行现场
	MOVQ	gobuf_g(BX), DX
	MOVQ	0(DX), CX		// 确认 g != nil
	get_tls(CX)
	MOVQ	DX, g(CX)
	MOVQ	gobuf_sp(BX), SP	// 恢复 SP
	MOVQ	gobuf_ret(BX), AX
	MOVQ	gobuf_ctxt(BX), DX
	MOVQ	gobuf_bp(BX), BP
	MOVQ	$0, gobuf_sp(BX)	// 清理，辅助 GC
	MOVQ	$0, gobuf_ret(BX)
	MOVQ	$0, gobuf_ctxt(BX)
	MOVQ	$0, gobuf_bp(BX)
	MOVQ	gobuf_pc(BX), BX	// 获取 g 要执行的函数的入口地址
	JMP	BX						// 开始执行
```

这个 `gogo` 的实现真实非常巧妙。初次阅读时，看到 `JMP BX` 开始执行 goroutine 函数体
后就没了，简直一脸疑惑，就这么没了？后续调用怎么回到调度器呢？
事实上我们已经在 [调度器：初始化](./init.md) 一节中看到过相关操作了：

```go
func newproc1(fn *funcval, argp *uint8, narg int32, callergp *g, callerpc uintptr) {
	siz := narg
	siz = (siz + 7) &^ 7
	(...)
	totalSize := 4*sys.RegSize + uintptr(siz) + sys.MinFrameSize
	totalSize += -totalSize & (sys.SpAlign - 1)
	sp := newg.stack.hi - totalSize
	spArg := sp
	(...)
	memclrNoHeapPointers(unsafe.Pointer(&newg.sched), unsafe.Sizeof(newg.sched))
	newg.sched.sp = sp
	newg.stktopsp = sp
	newg.sched.pc = funcPC(goexit) + sys.PCQuantum
	newg.sched.g = guintptr(unsafe.Pointer(newg))
	gostartcallfn(&newg.sched, fn)
	(...)
}
```

在执行 `gostartcallfn` 之前，栈帧状态为：

```
    +--------+
    |        | ---  ---      newg.stack.hi
    +--------+  |    |
    |        |  |    |
    +--------+  |    |
    |        |  |    | siz
    +--------+  |    |
    |        |  |    |
    +--------+  |    |
    |        |  |   ---
    +--------+  |  
    |        |  |  
    +--------+  | totalSize = 4*sys.PtrSize + siz
    |        |  | 
    +--------+  |
    |        |  |  
    +--------+  |
    |        | ---
    +--------+   高地址
 SP |        |                                      假想的调用方栈帧
    +--------+ ---------------------------------------------
    |        |                                             fn 栈帧
    +--------+
    |        |   低地址
       ....


                        +--------+
                     PC | goexit | 
                        +--------+
```

当执行 `gostartcallfn` 后：

```go
func gostartcallfn(gobuf *gobuf, fv *funcval) {
	var fn unsafe.Pointer
	if fv != nil {
		fn = unsafe.Pointer(fv.fn)
	} else {
		fn = unsafe.Pointer(funcPC(nilfunc))
	}
	gostartcall(gobuf, fn, unsafe.Pointer(fv))
}
func gostartcall(buf *gobuf, fn, ctxt unsafe.Pointer) {
	sp := buf.sp
	if sys.RegSize > sys.PtrSize {
		sp -= sys.PtrSize
		*(*uintptr)(unsafe.Pointer(sp)) = 0
	}
	sp -= sys.PtrSize
	*(*uintptr)(unsafe.Pointer(sp)) = buf.pc
	buf.sp = sp
	buf.pc = uintptr(fn)
	buf.ctxt = ctxt
}
```

此时保存的堆栈的情况如下：

```
    +--------+
    |        | ---  ---      newg.stack.hi
    +--------+  |    |
    |        |  |    |
    +--------+  |    |
    |        |  |    | siz
    +--------+  |    |
    |        |  |    |
    +--------+  |    |
    |        |  |   ---
    +--------+  |  
    |        |  |  
    +--------+  | totalSize = 4*sys.PtrSize + siz
    |        |  | 
    +--------+  |
    |        |  |  
    +--------+  |
    |        | ---
    +--------+   高地址
    | goexit |                                      假想的调用方栈帧
    +--------+ ---------------------------------------------
 SP |        |                                             fn 栈帧
    +--------+
    |        |   低地址
       ....


                        +--------+
                     PC |   fn   | 
                        +--------+
```

可以看到，在执行现场 `sched.sp` 保存的其实是 `goexit` 的地址。
那么也就是 `JMP` 跳转到 PC 寄存器处，开始执行 `fn`。当 `fn` 执行完毕后，会将（假象的）
调用方 `goexit` 的地址恢复到 PC，从而达到执行 `goexit` 的目的：

```go
// 在 goroutine 返回 goexit + PCQuantum 时运行的最顶层函数。
TEXT runtime·goexit(SB),NOSPLIT,$0-0
	BYTE	$0x90	// NOP
	CALL	runtime·goexit1(SB)	// 不会返回
	// traceback from goexit1 must hit code range of goexit
	BYTE	$0x90	// NOP
```

那么接下来就是去执行 `goexit1` 了：

```go
// 完成当前 goroutine 的执行
func goexit1() {
	(...)

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

于是最终开始 `goexit0`：

```go
// goexit 继续在 g0 上执行
func goexit0(gp *g) {
	_g_ := getg()

	// 切换当前的 g 为 _Gdead
	casgstatus(gp, _Grunning, _Gdead)
	if isSystemGoroutine(gp, false) {
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
	(...)

	// 将 g 扔进 gfree 链表中等待复用
	gfput(_g_.m.p.ptr(), gp)

	if locked {
		// 该 goroutine 可能在当前线程上锁住，因为它可能导致了不正常的内核状态
		// 这时候 kill 该线程，而非将 m 放回到线程池。

		// 此举会返回到 mstart，从而释放当前的 P 并退出该线程
		if GOOS != "plan9" { // See golang.org/issue/22227.
			gogo(&_g_.m.g0.sched)
		} else {
			// 因为我们可能已重用此线程结束，在 plan9 上清除 lockedExt
			_g_.m.lockedExt = 0
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

### 偷取工作

全局 g 链式队列中取 max 个 g ，其中第一个用于执行，max-1 个放入本地队列。
如果放不下，则只在本地队列中放下能放的。过程比较简单：

```go
// 从全局队列中偷取，调用时必须锁住调度器
func globrunqget(_p_ *p, max int32) *g {
	// 如果全局队列中没有 g 直接返回
	if sched.runqsize == 0 {
		return nil
	}

	// per-P 的部分，如果只有一个 P 的全部取
	n := sched.runqsize/gomaxprocs + 1
	if n > sched.runqsize {
		n = sched.runqsize
	}

	// 不能超过取的最大个数
	if max > 0 && n > max {
		n = max
	}

	// 计算能不能在本地队列中放下 n 个
	if n > int32(len(_p_.runq))/2 {
		n = int32(len(_p_.runq)) / 2
	}

	// 修改本地队列的剩余空间
	sched.runqsize -= n
	// 拿到全局队列队头 g
	gp := sched.runq.pop()
	// 计数
	n--

	// 继续取剩下的 n-1 个全局队列放入本地队列
	for ; n > 0; n-- {
		gp1 := sched.runq.pop()
		runqput(_p_, gp1, false)
	}
	return gp
}
```

从本地队列中取，首先看 next 是否有已经安排要运行的 g ，如果有，则返回下一个要运行的 g
否则，以 cas 的方式从本地队列中取一个 g。

如果是已经安排要运行的 g，则继承剩余的可运行时间片进行运行；
否则以一个新的时间片来运行。

```go
// 从本地可运行队列中获取 g
// 如果 inheritTime 为 true，则 g 继承剩余的时间片
// 否则开始一个新的时间片。在所有者 P 上执行
func runqget(_p_ *p) (gp *g, inheritTime bool) {
	// 如果有 runnext，则为下一个要运行的 g
	for {
		// 下一个 g
		next := _p_.runnext
		// 没有，break
		if next == 0 {
			break
		}
		// 如果 cas 成功，则 g 继承剩余时间片执行
		if _p_.runnext.cas(next, 0) {
			return next.ptr(), true
		}
	}

	// 没有 next
	for {
		// 本地队列是空，返回 nil
		h := atomic.LoadAcq(&_p_.runqhead) // load-acquire, 与其他消费者同步
		t := _p_.runqtail
		if t == h {
			return nil, false
		}

		// 从本地队列中以 cas 方式拿一个
		gp := _p_.runq[h%uint32(len(_p_.runq))].ptr()
		if atomic.CasRel(&_p_.runqhead, h, h+1) { // cas-release, 提交消费
			return gp, false
		}
	}
}
```

偷取（steal）的实现是一个非常复杂的过程。这个过程来源于我们
需要仔细的思考什么时候对调度器进行加锁、什么时候对 m 进行暂止、
什么时候将 m 从自旋向非自旋切换等等。

```go
// 寻找一个可运行的 goroutine 来执行。
// 尝试从其他的 P 偷取、从全局队列中获取、poll 网络
func findrunnable() (gp *g, inheritTime bool) {
	_g_ := getg()

	// 这里的条件与 handoffp 中的条件必须一致：
	// 如果 findrunnable 将返回 G 运行，handoffp 必须启动 M.

top:
	_p_ := _g_.m.p.ptr()

	// 如果在 gc，则暂止当前 m，直到复始后回到 top
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

	// cgo 调用被终止，继续进入
	if *cgo_yield != nil {
		asmcgocall(*cgo_yield, nil)
	}

	// 取本地队列 local runq，如果已经拿到，立刻返回
	if gp, inheritTime := runqget(_p_); gp != nil {
		return gp, inheritTime
	}

	// 全局队列 global runq，如果已经拿到，立刻返回
	if sched.runqsize != 0 {
		lock(&sched.lock)
		gp := globrunqget(_p_, 0)
		unlock(&sched.lock)
		if gp != nil {
			return gp, false
		}
	}

	// Poll 网络，优先级比从其他 P 中偷要高。
	// 在我们尝试去其他 P 偷之前，这个 netpoll 只是一个优化。
	// 如果没有 waiter 或 netpoll 中的线程已被阻塞，则可以安全地跳过它。
	// 如果有任何类型的逻辑竞争与被阻塞的线程（例如它已经从 netpoll 返回，但尚未设置 lastpoll）
	// 该线程无论如何都将阻塞 netpoll。
	if netpollinited() && atomic.Load(&netpollWaiters) > 0 && atomic.Load64(&sched.lastpoll) != 0 {
		if list := netpoll(false); !list.empty() { // 无阻塞
			gp := list.pop()
			injectglist(gp.schedlink.ptr())
			casgstatus(gp, _Gwaiting, _Grunnable)
			(...)
			return gp, false
		}
	}

	// 从其他 P 中偷 work
	procs := uint32(gomaxprocs) // 获得 p 的数量
	if atomic.Load(&sched.npidle) == procs-1 {
		// GOMAXPROCS = 1 或除了我们之外的所有人都已经 idle 了。
		// 新的 work 可能出现在 syscall/cgocall/网络/timer返回时
		// 它们均没有提交到本地运行队列，因此偷取没有任何意义。
		goto stop
	}
	// 如果自旋状态下 m 的数量 >= busy 状态下 p 的数量，直接进入阻塞
	// 该步骤是有必要的，它用于当 GOMAXPROCS>>1 时但程序的并行机制很慢时
	// 昂贵的 CPU 消耗。
	if !_g_.m.spinning && 2*atomic.Load(&sched.nmspinning) >= procs-atomic.Load(&sched.npidle) {
		goto stop
	}

	// 如果 m 是非自旋状态，切换为自旋
	if !_g_.m.spinning {
		_g_.m.spinning = true
		atomic.Xadd(&sched.nmspinning, 1)
	}

	for i := 0; i < 4; i++ {
		// 随机偷
		for enum := stealOrder.start(fastrand()); !enum.done(); enum.next() {
			// 已经进入了 GC? 回到顶部，暂止当前的 m
			if sched.gcwaiting != 0 {
				goto top
			}
			stealRunNextG := i > 2 // 如果偷了两轮都偷不到，便优先查找 ready 队列
			if gp := runqsteal(_p_, allp[enum.position()], stealRunNextG); gp != nil {
				// 总算偷到了，立即返回
				return gp, false
			}
		}
	}

stop:

	// 没有任何 work 可做。
	// 如果我们在 GC mark 阶段，则可以安全的扫描并 blacken 对象
	// 然后便有 work 可做，运行 idle-time 标记而非直接放弃当前的 P。
	if gcBlackenEnabled != 0 && _p_.gcBgMarkWorker != 0 && gcMarkWorkAvailable(_p_) {
		_p_.gcMarkWorkerMode = gcMarkWorkerIdleMode
		gp := _p_.gcBgMarkWorker.ptr()
		casgstatus(gp, _Gwaiting, _Grunnable)
		(...)
		return gp, false
	}

	// 仅限于 wasm
	// 如果一个回调返回后没有其他 goroutine 是苏醒的
	// 则暂停执行直到回调被触发。
	if beforeIdle() {
		// 至少一个 goroutine 被唤醒
		goto top
	}

	// 放弃当前的 P 之前，对 allp 做一个快照
	// 一旦我们不再阻塞在 safe-point 时候，可以立刻在下面进行修改
	allpSnapshot := allp

	// 准备归还 p，对调度器加锁
	lock(&sched.lock)
	// 进入了 gc，回到顶部暂止 m
	if sched.gcwaiting != 0 || _p_.runSafePointFn != 0 {
		unlock(&sched.lock)
		goto top
	}

	// 全局队列中又发现了任务
	if sched.runqsize != 0 {
		gp := globrunqget(_p_, 0)
		unlock(&sched.lock)
		// 赶紧偷掉返回
		return gp, false
	}

	// 归还当前的 p
	if releasep() != _p_ {
		throw("findrunnable: wrong p")
	}

	// 将 p 放入 idle 链表
	pidleput(_p_)

	// 完成归还，解锁
	unlock(&sched.lock)

	// 这里要非常小心:
	// 线程从自旋到非自旋状态的转换，可能与新 goroutine 的提交同时发生。
	// 我们必须首先丢弃 nmspinning，然后再次检查所有的 per-P 队列（并在期间伴随 #StoreLoad 内存屏障）
	// 如果反过来，其他线程可以在我们检查了所有的队列、然后提交一个 goroutine、再丢弃了 nmspinning
	// 进而导致无法复始一个线程来运行那个 goroutine 了。
	// 如果我们发现下面的新 work，我们需要恢复 m.spinning 作为重置的信号，
	// 以取消暂止新的工作线程（因为可能有多个 starving 的 goroutine）。
	// 但是，如果在发现新 work 后我们也观察到没有空闲 P，可以暂停当前线程
	// 因为系统已满载，因此不需要自旋线程。
	wasSpinning := _g_.m.spinning
	if _g_.m.spinning {
		_g_.m.spinning = false
		if int32(atomic.Xadd(&sched.nmspinning, -1)) < 0 {
			throw("findrunnable: negative nmspinning")
		}
	}

	// 再次检查所有的 runqueue
	for _, _p_ := range allpSnapshot {
		// 如果这时本地队列不空
		if !runqempty(_p_) {
			// 重新获取 p
			lock(&sched.lock)
			_p_ = pidleget()
			unlock(&sched.lock)

			// 如果能获取到 p
			if _p_ != nil {

				// 绑定 p
				acquirep(_p_)

				// 如果此前已经被切换为自旋
				if wasSpinning {
					// 重新切换回非自旋
					_g_.m.spinning = true
					atomic.Xadd(&sched.nmspinning, 1)
				}

				// 这时候是有 work 的，回到顶部重新 find g
				goto top
			}

			// 看来没有 idle 的 p，不需要重新 find g 了
			break
		}
	}

	// 再次检查 idle-priority GC work
	// 和上面重新找 runqueue 的逻辑类似
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

	// poll 网络
	// 和上面重新找 runqueue 的逻辑类似
	if netpollinited() && atomic.Load(&netpollWaiters) > 0 && atomic.Xchg64(&sched.lastpoll, 0) != 0 {
		(...)
		gp := netpoll(true) // 阻塞到新的 work 有效为止
		atomic.Store64(&sched.lastpoll, uint64(nanotime()))
		if gp != nil {
			lock(&sched.lock)
			_p_ = pidleget()
			unlock(&sched.lock)
			if _p_ != nil {
				acquirep(_p_)
				injectglist(gp.schedlink.ptr())
				casgstatus(gp, _Gwaiting, _Grunnable)
				(...)
				return gp, false
			}
			injectglist(gp)
		}
	}

	// 真的什么都没找到
	// 暂止当前的 m
	stopm()
	goto top
}
```

在 `findrunnable` 这个过程中，我们：

- 首先检查是是否正在进行 GC，如果是则暂止当前的 m 并阻塞休眠；
- 尝试从本地队列中取 g，如果取到，则直接返回，否则继续从全局队列中找 g，如果找到则直接返回；
- 检查是否存在 poll 网络的 g，如果有，则直接返回；
- 如果此时仍然无法找到 g，则从其他 P 的本地队列中偷取；
- 从其他 P 本地队列偷取的工作会执行四轮，在前两轮中只会查找 runnable 队列，后两轮则会优先查找 ready 队列，如果找到，则直接返回；
- 所有的可能性都尝试过了，在准备暂止 m 之前，还要进行额外的检查；
- 首先检查此时是否是 GC mark 阶段，如果是，则直接返回 mark 阶段的 g；
- 如果仍然没有，则对当前的 p 进行快照，准备对调度器进行加锁；
- 当调度器被锁住后，我们仍然还需再次检查这段时间里是否有进入 GC，如果已经进入了 GC，则回到第一步，阻塞 m 并休眠；
- 当调度器被锁住后，如果我们又在全局队列中发现了 g，则直接返回；
- 当调度器被锁住后，我们彻底找不到任务了，则归还释放当前的 P，将其放入 idle 链表中，并解锁调度器；
- 当 M/P 已经解绑后，我们需要将 m 的状态切换出自旋状态，并减少 nmspinning；
- 此时我们仍然需要重新检查所有的队列；
- 如果此时我们发现有一个 P 队列不空，则立刻尝试获取一个 P，如果获取到，则回到第一步，重新执行偷取工作，如果取不到，则说明系统已经满载，无需继续进行调度；
- 同样，我们还需要再检查是否有 GC mark 的 g 出现，如果有，获取 P 并回到第一步，重新执行偷取工作；
- 同样，我们还需要再检查是否存在 poll 网络的 g，如果有，则直接返回；
- 终于，我们什么也没找到，暂止当前的 m 并阻塞休眠。

### M 的唤醒

我们已经看到了 M 的暂止和复始的过程，那么 M 的自旋到非自旋的过程如何发生？

```go
func resetspinning() {
	_g_ := getg()
	(...)

	_g_.m.spinning = false
	nmspinning := atomic.Xadd(&sched.nmspinning, -1)
	(...)

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
	// 对自旋线程保守一些，必要时只增加一个
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
	(...)

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

### M 的创生

M 是通过 `newm` 来创生的，一般情况下，能够非常简单的创建，
某些特殊情况（线程状态被污染），M 的创建需要一个叫做模板线程的功能加以配合，
我们在 [运行时线程管理](./lockosthread.md)
中详细讨论：

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
		lock(&newmHandoff.lock)
		if newmHandoff.haveTemplateThread == 0 {
			throw("on a locked thread with no template thread")
		}
		mp.schedlink = newmHandoff.newm
		newmHandoff.newm.set(mp)
		if newmHandoff.waiting {
			newmHandoff.waiting = false
			// 唤醒 m, 自旋到非自旋
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

- 如果当前程序为 cgo 程序，则会通过 `asmcgocall` 来创建线程并调用 `mstart`（在 [cgo](../../part2runtime/ch10abi/cgo.md) 中讨论）
- 否则会调用 `newosproc` 来创建线程，从而调用 `mstart`。

既然是 `newosproc` ，我们此刻仍在 Go 的空间中，那么实现就是操作系统特定的了，

##### 系统线程的创建 (darwin)

```go
// 可能在 m.p==nil 情况下运行，因此不允许 write barrier
//go:nowritebarrierrec
func newosproc(mp *m) {
	stk := unsafe.Pointer(mp.g0.stack.hi)
	(...)

	// 初始化 attribute 对象
	var attr pthreadattr
	var err int32
	err = pthread_attr_init(&attr)
	if err != 0 {
		write(2, unsafe.Pointer(&failthreadcreate[0]), int32(len(failthreadcreate)))
		exit(1)
	}

	// 设置想要使用的栈大小。目前为 64KB
	const stackSize = 1 << 16
	if pthread_attr_setstacksize(&attr, stackSize) != 0 {
		write(2, unsafe.Pointer(&failthreadcreate[0]), int32(len(failthreadcreate)))
		exit(1)
	}

	// 通知 pthread 库不会 join 这个线程。
	if pthread_attr_setdetachstate(&attr, _PTHREAD_CREATE_DETACHED) != 0 {
		write(2, unsafe.Pointer(&failthreadcreate[0]), int32(len(failthreadcreate)))
		exit(1)
	}

	// 最后创建线程，在 mstart_stub 开始，进行底层设置并调用 mstart
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

`pthread_create` 在 [参与运行时的系统调用（Darwin 篇）](../../part2runtime/ch10abi/syscall-darwin.md) 中讨论。

##### 系统线程的创建 (linux)

而 linux 上的情况就乐观的多了：

```go
// May run with m.p==nil, so write barriers are not allowed.
//go:nowritebarrier
func newosproc(mp *m) {
	stk := unsafe.Pointer(mp.g0.stack.hi)
	(...)

	// 在 clone 期间禁用信号，以便新线程启动时信号被禁止。
	// 他们会在 minit 中重新启用。
	var oset sigset
	sigprocmask(_SIG_SETMASK, &sigset_all, &oset)
	ret := clone(cloneFlags, stk, unsafe.Pointer(mp), unsafe.Pointer(mp.g0), unsafe.Pointer(funcPC(mstart)))
	sigprocmask(_SIG_SETMASK, &oset, nil)
	(...)
}

```

`clone` 是系统调用，我们在 [参与运行时的系统调用（Linux 篇）](../../part2runtime/ch10abi/syscall-linux.md) 中讨论
这些系统调用在 Go 中的实现方式。

### M/G 解绑

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

### M 的死亡

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
		notesleep(&m.park) // 暂止主线程，在此阻塞
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

在 Linux amd64 上：

```asm
// func exitThread(wait *uint32)
TEXT runtime·exitThread(SB),NOSPLIT,$0-8
	MOVQ	wait+0(FP), AX
	// 栈使用完毕
	MOVL	$0, (AX)
	MOVL	$0, DI	// exit code
	MOVL	$SYS_exit, AX
	SYSCALL
	// 甚至连栈都没有了
	INT	$3
	JMP	0(PC)
```

从实现上可以看出，只有 linux 中才可能正常的退出一个栈，而 darwin 只能保持暂止了。
而如果是主线程，则会始终保持 park。

## 小结

我们已经看过了整个调度器的设计，下图纵观了整个过程：

![](../../../assets/schedule.png)

那么，很自然的能够想到这个流程中存在两个问题：

1. `findRunnableGCWorker` 在干什么？
2. 调度循环看似合理，但如果 G 执行时间过长，难道要等到 G 执行完后再调度其他的 G？显然不符合实际情况，那么到底会发生什么事情？

本节篇幅已经相当长了，让我们在后面的章节中进行讨论。

## 进一步阅读的参考文献

- [RGOOCH et al., 2017] [runtime: terminate locked OS thread if its goroutine exits](https://github.com/golang/go/issues/20395)
- [BRINAMARIO et al., 2016] [runtime: let idle OS threads exit](https://github.com/golang/go/issues/14592)
- [PHILHOFER et al., 2016] [runtime: scheduler is slow when goroutines are frequently woken](https://github.com/golang/go/issues/18237)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)