# 兼容与契约：参与运行时的系统调用（Linux 篇）

[TOC]

得益于 Linux 开放和普及，运行时对 Linux 系统调用的支持是原生级的。
与 darwin 不同的是，Linux 直接将一个系统调用通过 `SYSCALL` 指令参与调用，
不存在类似于 darwin 上使用 cgo 完成调用的开销。

## 案例研究：`runtime.clone`

以 `clone` 这个系统调用为例，
在调度器创建 M 的时候，会调用 `runtime.newosproc`，进而在 Linux 上会调用 `runtime.clone` 来创建一个
新的线程：

```go
//go:nowritebarrier
func newosproc(mp *m) {
	(...)
	ret := clone(cloneFlags, stk, unsafe.Pointer(mp), unsafe.Pointer(mp.g0), unsafe.Pointer(funcPC(mstart)))
	(...)
}

//go:noescape
func clone(flags int32, stk, mp, gp, fn unsafe.Pointer) int32
```

而 `runtime.clone` 这个方法直接通过汇编实现，并直接通过将 56 号系统调用编号送入 AX，
通过 `SYSCALL` 完成 `clone` 这个系统调用。

> 位于 runtime/sys_linux_amd64.s

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

同理，所有的 Linux 系统调用都是通过直接编写汇编代码，通过 SYSCALL 指令和系统调用编号来完成调用，
原理完全一致，读者可以举一反三，这里不再枚举。

## 运行时实现的系统调用清单

> GOOS: linux
>
> GOARCH: amd64

|%rax|系统调用|
|:--|:---------|
| 0 |  sys_read |
| 1 |  sys_write |
| 3 |  sys_close |
| 9 |  sys_mmap |
| 12 |  sys_brk |
| 13 |  sys_rt_sigaction |
| 14 |  sys_rt_sigprocmask |
| 24 |  sys_sched_yield |
| 35 |  sys_nanosleep |
| 38 |  sys_setitimer |
| 39 |  sys_getpid |
| 41 |  sys_socket |
| 42 |  sys_connect |
| 56 |  sys_clone |
| 60 |  sys_exit |
| 72 |  sys_fcntl |
| 186 |  sys_gettid |
| 202 |  sys_futex |
| 204 |  sys_sched_getaffinity |
| 231 |  sys_exit_group |
| 233 |  sys_epoll_ctl |
| 234 |  sys_tgkill |
| 257 |  sys_openat |
| 269 |  sys_faccessat |
| 281 |  sys_epoll_pwait |
| 291 |  sys_epoll_create1 |

## 进一步阅读的参考文献

- [LINUX SYSTEM CALL TABLE FOR X86 64](http://blog.rchapman.org/posts/Linux_System_Call_Table_for_x86_64/)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
