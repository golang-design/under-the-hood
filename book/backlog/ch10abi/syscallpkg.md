---
weight: 2502
title: "10.2 用户态系统调用"
---

# 10.2 用户态系统调用

TODO: 内容编排中


系统调用 `syscall` 包是一个非常特殊的包，Go 作为一门编程语言势必要开放面向操作系统的底层接口。
由于 Go 的运行时机制存在，并不是所有的系统调用都能开放给用户的代码，也并非所有的系统调用都能直接
将其封装。另一方面，系统调用随操作系统的进化而进化，Go 团队其实也意识到了这个问题，因此目前的 `syscall`
包其实早在 go1.4 就已提出弃用提案，反之应该使用 `golang.org/x/sys` [1]。

本节我们分两个部分来讨论系统调用这个包：运行时实现提供支持的系统调用，和泛用型系统调用的封装。
并借此专门分析分析当一个 goroutine 进入和退出系统调用时，Go 运行时都具体需要进行什么处理。

## 由运行时提供支持的系统调用

某些系统调用需要运行时提供支持，这包括：

- `syscall.Getpagesize`
- `syscall.runtime_envs`
- `syscall.runtime_BeforeFork`
- `syscall.runtime_AfterFork`
- `syscall.runtime_BeforeExec`
- `syscall.runtime_AfterExec`
- `syscall.runtime_AfterForkInChild`
- `syscall.setenv_c`
- `syscall.unsetenv_c`
- `syscall.Exit`

之所以需要运行时的支持，这有几种原因：

1. 运行时就已经完成调用，用户态代码做此调用时不需要再反复调用，直接返回其值即可：

   ```go
   //go:linkname syscall_Getpagesize syscall.Getpagesize
   func syscall_Getpagesize() int { return int(physPageSize) }
   ```

   这是因为[运行时初始化的时候就已经完成物理页大小的查询](../../1-boot.md)，并保存为一个全局变量，无需再进行系统调用。

   另一个例子，在运行时初始化时，就已经获得进程的 `envs` 参数：

   ```go
   //go:linkname syscall_runtime_envs syscall.runtime_envs
   func syscall_runtime_envs() []string { return append([]string{}, envs...) }
   ```

2. 需要在系统栈上执行，例如：

   ```go
   // Called from syscall package before fork.
   //go:linkname syscall_runtime_BeforeFork syscall.runtime_BeforeFork
   //go:nosplit
   func syscall_runtime_BeforeFork() {
   	systemstack(beforefork)
   }
   ```

   同样的还有 `syscall.runtime_AfterFork`、

3. 防止 `syscall.Exec` 意外产生的 `clone`:

   ```go
   // execLock 序列化 exec 和 clone 以避免在创建/销毁线程时执行错误或未指定的行为。见 issue #19546。
   var execLock rwmutex
   
   // 从 syscall.Exec 开始前调用
   //go:linkname syscall_runtime_BeforeExec syscall.runtime_BeforeExec
   func syscall_runtime_BeforeExec() {
   	// 在exec期间阻止创建线程。
   	execLock.lock()
   }
   
   // 从 syscall.Exec 结束后调用
   //go:linkname syscall_runtime_AfterExec syscall.runtime_AfterExec
   func syscall_runtime_AfterExec() {
   	execLock.unlock()
   }
   ```

4. 需要运行时信号处理的支持，例如：

   ```go
   // inForkedChild 在处理子进程中的信号时是正确的。
   // 这用于避免在我们使用 vfork 时调用 libc 函数。
   var inForkedChild bool
   
   // 在 syscall 包 fork 之后从子进程中调用。
   // 它将非 sigignored 信号重置为默认处理程序，并恢复信号掩码以准备 exec。
   // 因为这可能在 vfork 期间调用，因此可能暂时与父进程共享地址空间，
   // 所以这不能更改任何全局变量或调用可能执行此操作的 C 代码。
   //go:linkname syscall_runtime_AfterForkInChild syscall.runtime_AfterForkInChild
   //go:nosplit
   //go:nowritebarrierrec
   func syscall_runtime_AfterForkInChild() {
   	// 可以在这里更改 inForkedChild 中的全局变量，因为我们要将其更改回来。
   	// 这里没有竞争，因为如果我们与父进程共享地址空间，则父进程不能同时运行。
   	inForkedChild = true
   
   	clearSignalHandlers()
   
   	// 因为我们是子进程且是唯一运行的线程，所以我们知道没有其他任何方式修改 gp.m.sigmask。
   	msigrestore(getg().m.sigmask)
   
   	inForkedChild = false
   }
   ```

5. 需要 cgo 的支持，例如 `syscall.Setenv`：

   ```go
   var _cgo_setenv unsafe.Pointer   // 指向 C 函数的指针
   var _cgo_unsetenv unsafe.Pointer // 指向 C 函数的指针
   
   // 当 cgo 被加载后，更新 C 环境
   // 从 syscall.Setenv 中调用
   //go:linkname syscall_setenv_c syscall.setenv_c
   func syscall_setenv_c(k string, v string) {
   	if _cgo_setenv == nil {
   		return
   	}
   	arg := [2]unsafe.Pointer{cstring(k), cstring(v)}
   	asmcgocall(_cgo_setenv, unsafe.Pointer(&arg))
   }
   
   // 当 cgo 被加载后，更新 C 环境
   // 从 syscall.unsetenv 中调用
   //go:linkname syscall_unsetenv_c syscall.unsetenv_c
   func syscall_unsetenv_c(k string) {
   	if _cgo_unsetenv == nil {
   		return
   	}
   	arg := [1]unsafe.Pointer{cstring(k)}
   	asmcgocall(_cgo_unsetenv, unsafe.Pointer(&arg))
   }
   ```

   在使用 cgo 时候， `_cgo_setenv` 会被链接设置为 `x_cgo_setenv` 这个 stub：

   > 位于 `runtime/cgo/setenv.go`

   ```go
   //go:cgo_import_static x_cgo_setenv
   //go:linkname x_cgo_setenv x_cgo_setenv
   //go:linkname _cgo_setenv runtime._cgo_setenv
   var x_cgo_setenv byte
   var _cgo_setenv = &x_cgo_setenv
   
   //go:cgo_import_static x_cgo_unsetenv
   //go:linkname x_cgo_unsetenv x_cgo_unsetenv
   //go:linkname _cgo_unsetenv runtime._cgo_unsetenv
   var x_cgo_unsetenv byte
   var _cgo_unsetenv = &x_cgo_unsetenv
   ```

   > 位于 `runtime/cgo/gcc_setenv.c`

   ```c
   /* 调用 setenv 的 stub */
   void
   x_cgo_setenv(char **arg)
   {
   	_cgo_tsan_acquire();
   	setenv(arg[0], arg[1], 1);
   	_cgo_tsan_release();
   }
   ```

6. 行为不同，`exit` 系统调用并非并发安全 [2]，运行时 `exit` 的实现通过 `exit_group` [3] 完成，直接退出所有线程：

   ```go
   //go:linkname syscall_Exit syscall.Exit
   //go:nosplit
   func syscall_Exit(code int) {
   	exit(int32(code))
   }
   ```

   ```asm
   TEXT runtime·exit(SB),NOSPLIT,$0-4
   	MOVL	code+0(FP), DI
   	MOVL	$SYS_exit_group, AX
   	SYSCALL
   	RET
   ```

## 通用型系统调用

系统调用可以根据传递参数的个数来分为多种不同的类型，显然对如此多的系统调用进行封装费时费力，
`syscall` 包是通过 perl 脚本来生成的各种不同类型的系统调用，例如这些类型：

```go
func Syscall(trap, a1, a2, a3 uintptr) (r1, r2 uintptr, err Errno)
func Syscall6(trap, a1, a2, a3, a4, a5, a6 uintptr) (r1, r2 uintptr, err Errno)
func RawSyscall(trap, a1, a2, a3 uintptr) (r1, r2 uintptr, err Errno)
func RawSyscall6(trap, a1, a2, a3, a4, a5, a6 uintptr) (r1, r2 uintptr, err Errno)
```

不过这已经超出了我们的关注点，我们直接以 `write` 这个系统调用为例，讨论 `linux/amd64` 下的实现。

> 位于 `syscall/zsyscall_linux_amd64.go`，生成自 `syscall/mksyscall.pl`

```go
func write(fd int, p []byte) (n int, err error) {
	var _p0 unsafe.Pointer
	if len(p) > 0 {
		_p0 = unsafe.Pointer(&p[0])
	} else {
		_p0 = unsafe.Pointer(&_zero)
	}
	r0, _, e1 := Syscall(SYS_WRITE, uintptr(fd), uintptr(_p0), uintptr(len(p)))
	n = int(r0)
	if e1 != 0 {
		err = errnoErr(e1)
	}
	return
}
```

`write` 调用通过 `Syscall` 完成系统调用，这个调用由汇编实现：

```asm
// func Syscall(trap int64, a1, a2, a3 uintptr) (r1, r2, err uintptr);
// Trap # in AX, args in DI SI DX R10 R8 R9, return in AX DX
// Note that this differs from "standard" ABI convention, which
// would pass 4th arg in CX, not R10.

TEXT ·Syscall(SB),NOSPLIT,$0-56
	CALL	runtime·entersyscall(SB)
	MOVQ	a1+8(FP), DI
	MOVQ	a2+16(FP), SI
	MOVQ	a3+24(FP), DX
	MOVQ	$0, R10
	MOVQ	$0, R8
	MOVQ	$0, R9
	MOVQ	trap+0(FP), AX	// syscall entry
	SYSCALL
	CMPQ	AX, $0xfffffffffffff001
	JLS	ok
	MOVQ	$-1, r1+32(FP)
	MOVQ	$0, r2+40(FP)
	NEGQ	AX
	MOVQ	AX, err+48(FP)
	CALL	runtime·exitsyscall(SB)
	RET
ok:
	MOVQ	AX, r1+32(FP)
	MOVQ	DX, r2+40(FP)
	MOVQ	$0, err+48(FP)
	CALL	runtime·exitsyscall(SB)
	RET
```
在系统调用开始时，会调用运行时 `runtime.entersyscall`，并在调用结束时，调用 `runtime.exitsyscall`

### `runtime.entersyscall` 和 `runtime.exitsyscall`

我们在讨论[调度器初始化](../../4-sched/init.md)和[`cgo` 实现](../../10-cgo.md)的时候就已经提到过
这两个调用的作用：它们会将一个处于 `_Grunning` 状态的 G 切换到 `_Gsyscall` 状态，并在系统调用时间过长
后，主动放弃 P，供他人使用。

```go
// 标准系统调用入口，用于 go syscall 库以及普通的 cgo 调用
//go:nosplit
func entersyscall() {
	reentersyscall(getcallerpc(), getcallersp())
}

// The goroutine g is about to enter a system call.
// Record that it's not using the cpu anymore.
// This is called only from the go syscall library and cgocall,
// not from the low-level system calls used by the runtime.
//
// Entersyscall cannot split the stack: the gosave must
// make g->sched refer to the caller's stack segment, because
// entersyscall is going to return immediately after.
//
// Nothing entersyscall calls can split the stack either.
// We cannot safely move the stack during an active call to syscall,
// because we do not know which of the uintptr arguments are
// really pointers (back into the stack).
// In practice, this means that we make the fast path run through
// entersyscall doing no-split things, and the slow path has to use systemstack
// to run bigger things on the system stack.
//
// reentersyscall is the entry point used by cgo callbacks, where explicitly
// saved SP and PC are restored. This is needed when exitsyscall will be called
// from a function further up in the call stack than the parent, as g->syscallsp
// must always point to a valid stack frame. entersyscall below is the normal
// entry point for syscalls, which obtains the SP and PC from the caller.
//
// Syscall tracing:
// At the start of a syscall we emit traceGoSysCall to capture the stack trace.
// If the syscall does not block, that is it, we do not emit any other events.
// If the syscall blocks (that is, P is retaken), retaker emits traceGoSysBlock;
// when syscall returns we emit traceGoSysExit and when the goroutine starts running
// (potentially instantly, if exitsyscallfast returns true) we emit traceGoStart.
// To ensure that traceGoSysExit is emitted strictly after traceGoSysBlock,
// we remember current value of syscalltick in m (_g_.m.syscalltick = _g_.m.p.ptr().syscalltick),
// whoever emits traceGoSysBlock increments p.syscalltick afterwards;
// and we wait for the increment before emitting traceGoSysExit.
// Note that the increment is done even if tracing is not enabled,
// because tracing can be enabled in the middle of syscall. We don't want the wait to hang.
//
//go:nosplit
func reentersyscall(pc, sp uintptr) {
	_g_ := getg()

	// Disable preemption because during this function g is in Gsyscall status,
	// but can have inconsistent g->sched, do not let GC observe it.
	_g_.m.locks++

	// Entersyscall must not call any function that might split/grow the stack.
	// (See details in comment above.)
	// Catch calls that might, by replacing the stack guard with something that
	// will trip any stack check and leaving a flag to tell newstack to die.
	_g_.stackguard0 = stackPreempt
	_g_.throwsplit = true

	// Leave SP around for GC and traceback.
	save(pc, sp)
	_g_.syscallsp = sp
	_g_.syscallpc = pc
	casgstatus(_g_, _Grunning, _Gsyscall)
	if _g_.syscallsp < _g_.stack.lo || _g_.stack.hi < _g_.syscallsp {
		systemstack(func() {
			print("entersyscall inconsistent ", hex(_g_.syscallsp), " [", hex(_g_.stack.lo), ",", hex(_g_.stack.hi), "]\n")
			throw("entersyscall")
		})
	}

	if trace.enabled {
		systemstack(traceGoSysCall)
		// systemstack itself clobbers g.sched.{pc,sp} and we might
		// need them later when the G is genuinely blocked in a
		// syscall
		save(pc, sp)
	}

	if atomic.Load(&sched.sysmonwait) != 0 {
		systemstack(entersyscall_sysmon)
		save(pc, sp)
	}

	if _g_.m.p.ptr().runSafePointFn != 0 {
		// runSafePointFn may stack split if run on this stack
		systemstack(runSafePointFn)
		save(pc, sp)
	}

	_g_.m.syscalltick = _g_.m.p.ptr().syscalltick
	_g_.sysblocktraced = true
	_g_.m.mcache = nil
	pp := _g_.m.p.ptr()
	pp.m = 0
	_g_.m.oldp.set(pp)
	_g_.m.p = 0
	atomic.Store(&pp.status, _Psyscall)
	if sched.gcwaiting != 0 {
		systemstack(entersyscall_gcwait)
		save(pc, sp)
	}

	_g_.m.locks--
}
```

TODO:


```go
//go:nosplit
func exitsyscallfast(oldp *p) bool {
	_g_ := getg()

	// Freezetheworld sets stopwait but does not retake P's.
	if sched.stopwait == freezeStopWait {
		_g_.m.mcache = nil
		_g_.m.p = 0
		return false
	}

	// Try to re-acquire the last P.
	if _g_.m.p != 0 && _g_.m.p.ptr().status == _Psyscall && atomic.Cas(&_g_.m.p.ptr().status, _Psyscall, _Prunning) {
		// There's a cpu for us, so we can run.
		wirep(oldp)
		exitsyscallfast_reacquired()
		return true
	}

	// Try to get any other idle P.
	oldp := _g_.m.p.ptr()
	_g_.m.mcache = nil
	_g_.m.p = 0
	if sched.pidle != 0 {
		var ok bool
		systemstack(func() {
			ok = exitsyscallfast_pidle()
			if ok && trace.enabled {
				if oldp != nil {
					// Wait till traceGoSysBlock event is emitted.
					// This ensures consistency of the trace (the goroutine is started after it is blocked).
					for oldp.syscalltick == _g_.m.syscalltick {
						osyield()
					}
				}
				traceGoSysExit(0)
			}
		})
		if ok {
			return true
		}
	}
	return false
}
```

TODO:

```go
// The goroutine g exited its system call.
// Arrange for it to run on a cpu again.
// This is called only from the go syscall library, not
// from the low-level system calls used by the runtime.
//
// Write barriers are not allowed because our P may have been stolen.
//
//go:nosplit
//go:nowritebarrierrec
func exitsyscall() {
	_g_ := getg()

	_g_.m.locks++ // see comment in entersyscall
	if getcallersp() > _g_.syscallsp {
		throw("exitsyscall: syscall frame is no longer valid")
	}

	_g_.waitsince = 0
	oldp := _g_.m.oldp.ptr()
	_g_.m.oldp = 0
	if exitsyscallfast(oldp) {
		if _g_.m.mcache == nil {
			throw("lost mcache")
		}
		if trace.enabled {
			if oldp != _g_.m.p.ptr() || _g_.m.syscalltick != _g_.m.p.ptr().syscalltick {
				systemstack(traceGoStart)
			}
		}
		// There's a cpu for us, so we can run.
		_g_.m.p.ptr().syscalltick++
		// We need to cas the status and scan before resuming...
		casgstatus(_g_, _Gsyscall, _Grunning)

		// Garbage collector isn't running (since we are),
		// so okay to clear syscallsp.
		_g_.syscallsp = 0
		_g_.m.locks--
		if _g_.preempt {
			// restore the preemption request in case we've cleared it in newstack
			_g_.stackguard0 = stackPreempt
		} else {
			// otherwise restore the real _StackGuard, we've spoiled it in entersyscall/entersyscallblock
			_g_.stackguard0 = _g_.stack.lo + _StackGuard
		}
		_g_.throwsplit = false

		if sched.disable.user && !schedEnabled(_g_) {
			// Scheduling of this goroutine is disabled.
			Gosched()
		}

		return
	}

	_g_.sysexitticks = 0
	if trace.enabled {
		// Wait till traceGoSysBlock event is emitted.
		// This ensures consistency of the trace (the goroutine is started after it is blocked).
		for oldp != nil && oldp.syscalltick == _g_.m.syscalltick {
			osyield()
		}
		// We can't trace syscall exit right now because we don't have a P.
		// Tracing code can invoke write barriers that cannot run without a P.
		// So instead we remember the syscall exit time and emit the event
		// in execute when we have a P.
		_g_.sysexitticks = cputicks()
	}

	_g_.m.locks--

	// Call the scheduler.
	mcall(exitsyscall0)

	if _g_.m.mcache == nil {
		throw("lost mcache")
	}

	// Scheduler returned, so we're allowed to run now.
	// Delete the syscallsp information that we left for
	// the garbage collector during the system call.
	// Must wait until now because until gosched returns
	// we don't know for sure that the garbage collector
	// is not running.
	_g_.syscallsp = 0
	_g_.m.p.ptr().syscalltick++
	_g_.throwsplit = false
}
```

### 返回的错误处理

完成系统调用后，通过 `errnoErr` 将 `e1` 这个返回值转换为 `error` 类型，这是怎么回事呢？
事实上，`errnoErr` 是一个接收 `Errno` 的函数：

```go
const (
	EAGAIN          = Errno(0xb)
	EINVAL          = Errno(0x16)
	ENOENT          = Errno(0x2)
)

// 对于常见的 Errno 值，仅进行一次接口分配。
var (
	errEAGAIN error = EAGAIN
	errEINVAL error = EINVAL
	errENOENT error = ENOENT
)

// errnoErr 返回常见的封装的 Errno 值，以防止在运行时进行分配。
func errnoErr(e Errno) error {
	switch e {
	case 0:
		return nil
	case EAGAIN:
		return errEAGAIN
	case EINVAL:
		return errEINVAL
	case ENOENT:
		return errENOENT
	}
	return e
}
```

而 `Errno` 类型实现了 `error` 接口：

```go
// Errno 是描述错误条件的无符号数。
// 它实现了 error 接口。零 Errno 按惯例是非错误的，
// 因此从 Errno 转换为错误的代码应该使用：
//	err = nil
//	if errno != 0 {
//		err = errno
//	}
type Errno uintptr

func (e Errno) Error() string {
	if 0 <= int(e) && int(e) < len(errors) {
		s := errors[e]
		if s != "" {
			return s
		}
	}
	return "errno " + itoa(int(e))
}
```

`errors` 只是一个字符串表：

```go
// 错误表
var errors = [...]string{
	1:   "operation not permitted",
	2:   "no such file or directory",
	(...)
}
```

## 进一步阅读的参考文献

1. [Deprecate the syscall package](https://golang.org/s/go1.4-syscall)
2. [exit(3) - Linux's Programmer Manual](http://man7.org/linux/man-pages/man3/exit.3.html)
3. [exit_group(2) - Linux's Programmer Manual](http://man7.org/linux/man-pages/man2/exit_group.2.html)

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
