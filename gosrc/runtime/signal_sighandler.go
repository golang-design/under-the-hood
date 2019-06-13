// Copyright 2013 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// +build aix darwin dragonfly freebsd linux nacl netbsd openbsd solaris

package runtime

import (
	"unsafe"
)

// crashing is the number of m's we have waited for when implementing
// GOTRACEBACK=crash when a signal is received.
var crashing int32

// testSigtrap is used by the runtime tests. If non-nil, it is called
// on SIGTRAP. If it returns true, the normal behavior on SIGTRAP is
// suppressed.
var testSigtrap func(info *siginfo, ctxt *sigctxt, gp *g) bool

// sighandler is invoked when a signal occurs. The global g will be
// set to a gsignal goroutine and we will be running on the alternate
// signal stack. The parameter g will be the value of the global g
// when the signal occurred. The sig, info, and ctxt parameters are
// from the system signal handler: they are the parameters passed when
// the SA is passed to the sigaction system call.
//
// The garbage collector may have stopped the world, so write barriers
// are not allowed.
// 信号发生时调用 sighandler。 全局 g 将是设置为 gsignal goroutine，
// 并运行在备用信号栈上。参数 g 将是全局 g 在产生信号时的值。
// sig, info 和 ctxt 参数是来自系统信号处理程序：它们是传递的参数
// SA 被传递给 sigaction 系统调用。
// 垃圾回收器可能已经 STW，因此不允许写屏障。
//
//go:nowritebarrierrec
func sighandler(sig uint32, info *siginfo, ctxt unsafe.Pointer, gp *g) {
	_g_ := getg()
	c := &sigctxt{info, ctxt}

	// profile 时钟超时
	if sig == _SIGPROF {
		sigprof(c.sigpc(), c.sigsp(), c.siglr(), gp, _g_.m)
		return
	}

	if sig == _SIGTRAP && testSigtrap != nil && testSigtrap(info, (*sigctxt)(noescape(unsafe.Pointer(c))), gp) {
		return
	}

	flags := int32(_SigThrow)
	if sig < uint32(len(sigtable)) {
		flags = sigtable[sig].flags
	}
	if flags&_SigPanic != 0 && gp.throwsplit {
		// 我们无法安全的 sigpanic 因为它可能造成栈的增长，因此忽略它
		flags = (flags &^ _SigPanic) | _SigThrow
	}
	if isAbortPC(c.sigpc()) {
		// 很多架构中，abort 函数会导致内存段错误，不将其作为 panic
		flags = _SigThrow
	}
	if c.sigcode() != _SI_USER && flags&_SigPanic != 0 {
		// 产生 panic 的信号
		// Arrange the stack so that it looks like the point
		// where the signal occurred made a call to the
		// function sigpanic. Then set the PC to sigpanic.

		// Have to pass arguments out of band since
		// augmenting the stack frame would break
		// the unwinding code.
		gp.sig = sig
		gp.sigcode0 = uintptr(c.sigcode())
		gp.sigcode1 = uintptr(c.fault())
		gp.sigpc = c.sigpc()

		c.preparePanic(sig, gp)
		return
	}

	// 转发用户信号
	if c.sigcode() == _SI_USER || flags&_SigNotify != 0 {
		if sigsend(sig) {
			return
		}
	}

	// 设置为可忽略的用户信号
	if c.sigcode() == _SI_USER && signal_ignored(sig) {
		return
	}

	// 处理 KILL 信号
	if flags&_SigKill != 0 {
		dieFromSignal(sig)
	}

	// 非 THROW， 返回
	if flags&_SigThrow == 0 {
		return
	}

	_g_.m.throwing = 1
	_g_.m.caughtsig.set(gp)

	if crashing == 0 {
		startpanic_m()
	}

	if sig < uint32(len(sigtable)) {
		print(sigtable[sig].name, "\n")
	} else {
		print("Signal ", sig, "\n")
	}

	print("PC=", hex(c.sigpc()), " m=", _g_.m.id, " sigcode=", c.sigcode(), "\n")
	if _g_.m.lockedg != 0 && _g_.m.ncgo > 0 && gp == _g_.m.g0 {
		print("signal arrived during cgo execution\n")
		gp = _g_.m.lockedg.ptr()
	}
	print("\n")

	level, _, docrash := gotraceback()
	if level > 0 {
		goroutineheader(gp)
		tracebacktrap(c.sigpc(), c.sigsp(), c.siglr(), gp)
		if crashing > 0 && gp != _g_.m.curg && _g_.m.curg != nil && readgstatus(_g_.m.curg)&^_Gscan == _Grunning {
			// tracebackothers on original m skipped this one; trace it now.
			goroutineheader(_g_.m.curg)
			traceback(^uintptr(0), ^uintptr(0), 0, _g_.m.curg)
		} else if crashing == 0 {
			tracebackothers(gp)
			print("\n")
		}
		dumpregs(c)
	}

	if docrash {
		crashing++
		if crashing < mcount()-int32(extraMCount) {
			// There are other m's that need to dump their stacks.
			// Relay SIGQUIT to the next m by sending it to the current process.
			// All m's that have already received SIGQUIT have signal masks blocking
			// receipt of any signals, so the SIGQUIT will go to an m that hasn't seen it yet.
			// When the last m receives the SIGQUIT, it will fall through to the call to
			// crash below. Just in case the relaying gets botched, each m involved in
			// the relay sleeps for 5 seconds and then does the crash/exit itself.
			// In expected operation, the last m has received the SIGQUIT and run
			// crash/exit and the process is gone, all long before any of the
			// 5-second sleeps have finished.
			print("\n-----\n\n")
			raiseproc(_SIGQUIT)
			usleep(5 * 1000 * 1000)
		}
		crash()
	}

	printDebugLog()

	exit(2)
}
