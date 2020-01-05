// Copyright 2019 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Goroutine 抢占
//
// A goroutine can be preempted at any safe-point. Currently, there
// are a few categories of safe-points:
//
// 1. A blocked safe-point occurs for the duration that a goroutine is
//    descheduled, blocked on synchronization, or in a system call.
//
// 2. Synchronous safe-points occur when a running goroutine checks
//    for a preemption request.
//
// 3. Asynchronous safe-points occur at any instruction in user code
//    where the goroutine can be safely paused and a conservative
//    stack and register scan can find stack roots. The runtime can
//    stop a goroutine at an async safe-point using a signal.
//
// At both blocked and synchronous safe-points, a goroutine's CPU
// state is minimal and the garbage collector has complete information
// about its entire stack. This makes it possible to deschedule a
// goroutine with minimal space, and to precisely scan a goroutine's
// stack.
//
// Synchronous safe-points are implemented by overloading the stack
// bound check in function prologues. To preempt a goroutine at the
// next synchronous safe-point, the runtime poisons the goroutine's
// stack bound to a value that will cause the next stack bound check
// to fail and enter the stack growth implementation, which will
// detect that it was actually a preemption and redirect to preemption
// handling.
//
// Preemption at asynchronous safe-points is implemented by suspending
// the thread using an OS mechanism (e.g., signals) and inspecting its
// state to determine if the goroutine was at an asynchronous
// safe-point. Since the thread suspension itself is generally
// asynchronous, it also checks if the running goroutine wants to be
// preempted, since this could have changed. If all conditions are
// satisfied, it adjusts the signal context to make it look like the
// signaled thread just called asyncPreempt and resumes the thread.
// asyncPreempt spills all registers and enters the scheduler.
//
// (An alternative would be to preempt in the signal handler itself.
// This would let the OS save and restore the register state and the
// runtime would only need to know how to extract potentially
// pointer-containing registers from the signal context. However, this
// would consume an M for every preempted G, and the scheduler itself
// is not designed to run from a signal handler, as it tends to
// allocate memory and start threads in the preemption path.)

// Goroutine 可以在任何安全点被抢占。当前，安全点具有不同的类别：
//
// 1. 在对 goroutine 进行调度，在同步时或在系统调用中进行阻塞的过程中，
//    将发生阻塞安全点（blocked safe-points）。
//
// 2. 当运行的 goroutine 检查抢占请求时，会发生同步安全点（synchronous safe-points）。
//
// 3. 异步安全点（asynchronous safe-points）出现在用户代码中的任何指令中，
//    可以安全地暂停 goroutine，保守的堆栈和寄存器扫描可以找到栈的根集合。运行时
//    可以使用信号在异步安全点停止 goroutine。
//
// 在阻塞和同步安全点上，goroutine 的 CPU 状态都为最小，并且垃圾回收器具有
// 有关其整个堆栈的完整信息。这使得可以以最小的空间调度 goroutine，并精确扫描
// goroutine 的堆栈。
//
// 同步安全点通过重载函数序言中的堆栈绑定检查来实现。要在下一个同步安全点抢占
// goroutine，运行时会毒害 goroutine 的堆栈，绑定到一个值，该值将导致下一个堆栈
// 绑定检查失败并进入堆栈增长实现，这将检测到它实际上是抢占并重定向抢占处理。
//
// 通过使用 OS 机制（例如信号）挂起线程并检查其状态以确定 goroutine 是否处于异步
// 安全点来实现异步安全点的抢占。由于线程挂起本身通常是异步的，因此它还会检查是否
// 要抢占正在运行的 goroutine，因为这可能已更改。如果满足所有条件，它将调整信号
// 上下文，使其看起来像刚好被称为 asyncPreempt 的信号线程，然后恢复该线程。
// asyncPreempt 溢出所有寄存器并进入调度程序。
//
// （一种替代方法是在信号处理程序本身中抢占。这将使OS保存并恢复寄存器状态，
// 并且运行时仅需要知道如何从信号上下文中提取可能包含指针的寄存器。但是，
// 这会消耗很多时间。每个被抢占的G都有一个M，并且调度程序本身不旨在从信号处理程序运行，
// 因为它倾向于在抢占路径中分配内存并启动线程。）

package runtime

import (
	"runtime/internal/atomic"
	"runtime/internal/sys"
	"unsafe"
)

type suspendGState struct {
	g *g

	// dead indicates the goroutine was not suspended because it
	// is dead. This goroutine could be reused after the dead
	// state was observed, so the caller must not assume that it
	// remains dead.
	dead bool

	// stopped indicates that this suspendG transitioned the G to
	// _Gwaiting via g.preemptStop and thus is responsible for
	// readying it when done.
	stopped bool
}

// suspendG suspends goroutine gp at a safe-point and returns the
// state of the suspended goroutine. The caller gets read access to
// the goroutine until it calls resumeG.
// suspendG 在安全点挂起 goroutine gp 并返回
// 暂停的goroutine的状态。呼叫者获得对的读取权限
// goroutine，直到它调用resumeG。
//
// It is safe for multiple callers to attempt to suspend the same
// goroutine at the same time. The goroutine may execute between
// subsequent successful suspend operations. The current
// implementation grants exclusive access to the goroutine, and hence
// multiple callers will serialize. However, the intent is to grant
// shared read access, so please don't depend on exclusive access.
// 多个呼叫者尝试中止相同呼叫是安全的
// 同时进行goroutine。该goroutine可以在
// 随后成功的挂起操作。目前
// 实现授予对goroutine的独占访问权限，因此
// 多个调用者将序列化。但是，目的是要授予
// 共享读取访问权限，因此请不要依赖于独占访问权限。
//
// This must be called from the system stack and the user goroutine on
// the current M (if any) must be in a preemptible state. This
// prevents deadlocks where two goroutines attempt to suspend each
// other and both are in non-preemptible states. There are other ways
// to resolve this deadlock, but this seems simplest.
// 必须从系统堆栈和用户goroutine上调用
// 当前的M（如果有）必须处于可抢占状态。这个
// 防止两个goroutine尝试分别挂起的死锁
// 其他都处于不可抢占状态。还有其他方法
// 解决此僵局，但这似乎最简单。
//
// TODO(austin): What if we instead required this to be called from a
// user goroutine? Then we could deschedule the goroutine while
// waiting instead of blocking the thread. If two goroutines tried to
// suspend each other, one of them would win and the other wouldn't
// complete the suspend until it was resumed. We would have to be
// careful that they couldn't actually queue up suspend for each other
// and then both be suspended. This would also avoid the need for a
// kernel context switch in the synchronous case because we could just
// directly schedule the waiter. The context switch is unavoidable in
// the signal case.
// TODO（奥斯汀）：如果我们相反要求从
// 用户goroutine？然后我们可以安排goroutine的时间
// 等待而不是阻塞线程。如果两个goroutines试图
// 互相暂停，其中一个将获胜而另一个则不会
// 完成暂停，直到恢复为止。我们将不得不
// 小心，他们实际上无法将对方暂停
// 然后都被暂停。这也将避免需要
// 在同步情况下进行内核上下文切换，因为我们可以
// 直接安排服务员。上下文切换是不可避免的
// 信号情况。
//
//go:systemstack
func suspendG(gp *g) suspendGState {
	if mp := getg().m; mp.curg != nil && readgstatus(mp.curg) == _Grunning {
		// Since we're on the system stack of this M, the user
		// G is stuck at an unsafe point. If another goroutine
		// were to try to preempt m.curg, it could deadlock.
		throw("suspendG from non-preemptible goroutine")
	}

	// See https://golang.org/cl/21503 for justification of the yield delay.
	const yieldDelay = 10 * 1000
	var nextYield int64

	// Drive the goroutine to a preemption point.
	stopped := false
	var asyncM *m
	var asyncGen uint32
	var nextPreemptM int64
	for i := 0; ; i++ {
		switch s := readgstatus(gp); s {
		default:
			if s&_Gscan != 0 {
				// Someone else is suspending it. Wait
				// for them to finish.
				//
				// TODO: It would be nicer if we could
				// coalesce suspends.
				break
			}

			dumpgstatus(gp)
			throw("invalid g status")

		case _Gdead:
			// Nothing to suspend.
			//
			// preemptStop may need to be cleared, but
			// doing that here could race with goroutine
			// reuse. Instead, goexit0 clears it.
			return suspendGState{dead: true}

		case _Gcopystack:
			// The stack is being copied. We need to wait
			// until this is done.

		case _Gpreempted:
			// We (or someone else) suspended the G. Claim
			// ownership of it by transitioning it to
			// _Gwaiting.
			if !casGFromPreempted(gp, _Gpreempted, _Gwaiting) {
				break
			}

			// We stopped the G, so we have to ready it later.
			stopped = true

			s = _Gwaiting
			fallthrough

		case _Grunnable, _Gsyscall, _Gwaiting:
			// Claim goroutine by setting scan bit.
			// This may race with execution or readying of gp.
			// The scan bit keeps it from transition state.
			if !castogscanstatus(gp, s, s|_Gscan) {
				break
			}

			// Clear the preemption request. It's safe to
			// reset the stack guard because we hold the
			// _Gscan bit and thus own the stack.
			gp.preemptStop = false
			gp.preempt = false
			gp.stackguard0 = gp.stack.lo + _StackGuard

			// The goroutine was already at a safe-point
			// and we've now locked that in.
			//
			// TODO: It would be much better if we didn't
			// leave it in _Gscan, but instead gently
			// prevented its scheduling until resumption.
			// Maybe we only use this to bump a suspended
			// count and the scheduler skips suspended
			// goroutines? That wouldn't be enough for
			// {_Gsyscall,_Gwaiting} -> _Grunning. Maybe
			// for all those transitions we need to check
			// suspended and deschedule?
			return suspendGState{g: gp, stopped: stopped}

		case _Grunning:
			// Optimization: if there is already a pending preemption request
			// (from the previous loop iteration), don't bother with the atomics.
			if gp.preemptStop && gp.preempt && gp.stackguard0 == stackPreempt && asyncM == gp.m && atomic.Load(&asyncM.preemptGen) == asyncGen {
				break
			}

			// Temporarily block state transitions.
			if !castogscanstatus(gp, _Grunning, _Gscanrunning) {
				break
			}

			// Request synchronous preemption.
			gp.preemptStop = true
			gp.preempt = true
			gp.stackguard0 = stackPreempt

			// Prepare for asynchronous preemption.
			asyncM2 := gp.m
			asyncGen2 := atomic.Load(&asyncM2.preemptGen)
			needAsync := asyncM != asyncM2 || asyncGen != asyncGen2
			asyncM = asyncM2
			asyncGen = asyncGen2

			casfrom_Gscanstatus(gp, _Gscanrunning, _Grunning)

			// 发送异步抢占。我们在将 G 的状态改为 _Grunning 后进行，因为 preemptM
			// 可能会同步执行，且我们不希望在 G 在其状态自旋时进行捕获。
			if preemptMSupported && debug.asyncpreemptoff == 0 && needAsync {
				// 当 preemptM 同步执行，且这里的自旋循环将导致活锁时，对
				// preemptM 调用的速率限制。这一点在 Windows 上非常重要。
				now := nanotime()
				if now >= nextPreemptM {
					nextPreemptM = now + yieldDelay/2
					preemptM(asyncM)
				}
			}
		}

		// TODO: Don't busy wait. This loop should really only
		// be a simple read/decide/CAS loop that only fails if
		// there's an active race. Once the CAS succeeds, we
		// should queue up the preemption (which will require
		// it to be reliable in the _Grunning case, not
		// best-effort) and then sleep until we're notified
		// that the goroutine is suspended.
		if i == 0 {
			nextYield = nanotime() + yieldDelay
		}
		if nanotime() < nextYield {
			procyield(10)
		} else {
			osyield()
			nextYield = nanotime() + yieldDelay/2
		}
	}
}

// resumeG undoes the effects of suspendG, allowing the suspended
// goroutine to continue from its current safe-point.
func resumeG(state suspendGState) {
	if state.dead {
		// We didn't actually stop anything.
		return
	}

	gp := state.g
	switch s := readgstatus(gp); s {
	default:
		dumpgstatus(gp)
		throw("unexpected g status")

	case _Grunnable | _Gscan,
		_Gwaiting | _Gscan,
		_Gsyscall | _Gscan:
		casfrom_Gscanstatus(gp, s, s&^_Gscan)
	}

	if state.stopped {
		// We stopped it, so we need to re-schedule it.
		ready(gp, 0, true)
	}
}

// canPreemptM 报告 mp 是否处于可抢占的安全状态。
//
// It is nosplit because it has nosplit callers.
//
//go:nosplit
func canPreemptM(mp *m) bool {
	return mp.locks == 0 && mp.mallocing == 0 && mp.preemptoff == "" && mp.p.ptr().status == _Prunning
}

//go:generate go run mkpreempt.go

// asyncPreempt 保存了所有用户寄存器，并调用 asyncPreempt2
//
// 当栈扫描遭遇 asyncPreempt 栈帧时，将会保守的扫描调用方栈帧
//
// asyncPreempt 由汇编实现
func asyncPreempt()

//go:nosplit
func asyncPreempt2() {
	gp := getg()
	gp.asyncSafePoint = true
	if gp.preemptStop {
		mcall(preemptPark)
	} else {
		mcall(gopreempt_m)
	}
	gp.asyncSafePoint = false
}

// asyncPreemptStack is the bytes of stack space required to inject an
// asyncPreempt call.
var asyncPreemptStack = ^uintptr(0)

func init() {
	f := findfunc(funcPC(asyncPreempt))
	total := funcMaxSPDelta(f)
	f = findfunc(funcPC(asyncPreempt2))
	total += funcMaxSPDelta(f)
	// Add some overhead for return PCs, etc.
	asyncPreemptStack = uintptr(total) + 8*sys.PtrSize
	if asyncPreemptStack > _StackLimit {
		// We need more than the nosplit limit. This isn't
		// unsafe, but it may limit asynchronous preemption.
		//
		// This may be a problem if we start using more
		// registers. In that case, we should store registers
		// in a context object. If we pre-allocate one per P,
		// asyncPreempt can spill just a few registers to the
		// stack, then grab its context object and spill into
		// it. When it enters the runtime, it would allocate a
		// new context for the P.
		print("runtime: asyncPreemptStack=", asyncPreemptStack, "\n")
		throw("async stack too large")
	}
}

// wantAsyncPreempt 返回异步抢占是否被 gp 请求
func wantAsyncPreempt(gp *g) bool {
	// 同时检查 G 和 P
	return (gp.preempt || gp.m.p != 0 && gp.m.p.ptr().preempt) && readgstatus(gp)&^_Gscan == _Grunning
}

// isAsyncSafePoint reports whether gp at instruction PC is an
// asynchronous safe point. This indicates that:
//
// 1. It's safe to suspend gp and conservatively scan its stack and
// registers. There are no potentially hidden pointer values and it's
// not in the middle of an atomic sequence like a write barrier.
//
// 2. gp has enough stack space to inject the asyncPreempt call.
//
// 3. It's generally safe to interact with the runtime, even if we're
// in a signal handler stopped here. For example, there are no runtime
// locks held, so acquiring a runtime lock won't self-deadlock.
func isAsyncSafePoint(gp *g, pc, sp, lr uintptr) bool {
	mp := gp.m

	// Only user Gs can have safe-points. We check this first
	// because it's extremely common that we'll catch mp in the
	// scheduler processing this G preemption.
	if mp.curg != gp {
		return false
	}

	// Check M state.
	if mp.p == 0 || !canPreemptM(mp) {
		return false
	}

	// Check stack space.
	if sp < gp.stack.lo || sp-gp.stack.lo < asyncPreemptStack {
		return false
	}

	// Check if PC is an unsafe-point.
	f := findfunc(pc)
	if !f.valid() {
		// Not Go code.
		return false
	}
	if (GOARCH == "mips" || GOARCH == "mipsle" || GOARCH == "mips64" || GOARCH == "mips64le") && lr == pc+8 && funcspdelta(f, pc, nil) == 0 {
		// We probably stopped at a half-executed CALL instruction,
		// where the LR is updated but the PC has not. If we preempt
		// here we'll see a seemingly self-recursive call, which is in
		// fact not.
		// This is normally ok, as we use the return address saved on
		// stack for unwinding, not the LR value. But if this is a
		// call to morestack, we haven't created the frame, and we'll
		// use the LR for unwinding, which will be bad.
		return false
	}
	smi := pcdatavalue(f, _PCDATA_RegMapIndex, pc, nil)
	if smi == -2 {
		// Unsafe-point marked by compiler. This includes
		// atomic sequences (e.g., write barrier) and nosplit
		// functions (except at calls).
		return false
	}
	if fd := funcdata(f, _FUNCDATA_LocalsPointerMaps); fd == nil || fd == unsafe.Pointer(&no_pointers_stackmap) {
		// This is assembly code. Don't assume it's
		// well-formed. We identify assembly code by
		// checking that it has either no stack map, or
		// no_pointers_stackmap, which is the stack map
		// for ones marked as NO_LOCAL_POINTERS.
		//
		// TODO: Are there cases that are safe but don't have a
		// locals pointer map, like empty frame functions?
		return false
	}
	name := funcname(f)
	if inldata := funcdata(f, _FUNCDATA_InlTree); inldata != nil {
		inltree := (*[1 << 20]inlinedCall)(inldata)
		ix := pcdatavalue(f, _PCDATA_InlTreeIndex, pc, nil)
		if ix >= 0 {
			name = funcnameFromNameoff(f, inltree[ix].func_)
		}
	}
	if hasPrefix(name, "runtime.") ||
		hasPrefix(name, "runtime/internal/") ||
		hasPrefix(name, "reflect.") {
		// For now we never async preempt the runtime or
		// anything closely tied to the runtime. Known issues
		// include: various points in the scheduler ("don't
		// preempt between here and here"), much of the defer
		// implementation (untyped info on stack), bulk write
		// barriers (write barrier check),
		// reflect.{makeFuncStub,methodValueCall}.
		//
		// TODO(austin): We should improve this, or opt things
		// in incrementally.
		return false
	}

	return true
}

var no_pointers_stackmap uint64 // defined in assembly, for NO_LOCAL_POINTERS macro
