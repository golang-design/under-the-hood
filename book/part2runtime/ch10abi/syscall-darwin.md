# 兼容与契约：参与运行时的系统调用（Darwin 篇）

[TOC]

我们已经在前面的章节中多次提到过 darwin 平台上的系统调用时通过封装
`libc` 的系统调用完成的。本节我们就以 `pthread_create` 这个 POSIX 调用为例，
来看看 darwin 平台上是如何实现系统调用的。

## `libcCall` 调用

所有的调用都通过 `runtime.libcCall` 来完成。

> 位于 `runtime/sys_darwin.go`

```go
// 用 arg 作为参数调用 fn。返回 fn 返回的内容。fn 是所需函数入口点的原始 pc 值。
// 切换到系统堆栈（如果尚未存在）。将调用点保留为 profiler 回溯开始的地方。
//go:nosplit
func libcCall(fn, arg unsafe.Pointer) int32 {
	// 为回溯而离开调用方 PC/SP/G
	gp := getg()
	var mp *m
	if gp != nil {
		mp = gp.m
	}
	if mp != nil && mp.libcallsp == 0 {
		mp.libcallg.set(gp)
		mp.libcallpc = getcallerpc()
		// sp 必须是最后一个被设置，因为一旦 async cpu profiler 发现所有三个值都非零，就会使用它们
		mp.libcallsp = getcallersp()
	} else {
		// 确保我们不重置 libcallsp。这使得 libcCall 可以重入;
		// 我们记住第一次调用 M 的 g/pc/sp，直到 libcCall 实例返回。
		// 重入只对信号有用，因为 libc 从不回调 Go。
		// 棘手的情况是我们从 M 调用 libcX 并记录 g/pc/sp。
		// 在该调用返回之前，信号到达同一个 M，信号处理代码调用另一个 libc 函数。
		// 我们不希望记录处理程序中的第二个 libcCall，并且我们不希望
		// 该调用的完成为零 libcallsp。
		// 在 sighandler 中时，因为我们在处理信号时会阻塞所有信号，所以
		// 我们不需要设置 libcall*（即使我们当前不在 libc 中）。
		// 这包括配置文件信号，它使用的是 libcall* info 的信号。
		mp = nil
	}
	res := asmcgocall(fn, arg) // 发起 cgo 调用。
	if mp != nil {
		mp.libcallsp = 0
	}
	return res
}
```

可以看到，其实在 darwin 系统上的调用本质上是通过 cgo 完成的。
在发起 cgo 调用之前，会对 m 的一些属性做处理来支持回溯：

```go
type m struct {
	(...)

	libcallpc uintptr // 用于 cpu profiler
	libcallsp uintptr
	libcallg  guintptr

	(...)
}

// 在 g 和 m 不空的情况下，在 `libcallg`/`libcallpc`/`libcallsp` 上记录调用回溯信息
gp := getg()
mp.libcallg.set(gp)
mp.libcallpc = getcallerpc()
mp.libcallsp = getcallersp()
```

## 案例研究：`runtime.pthread_create`

既然 Go 从运行时一层抹掉了线程相关的所有 API，那么 `pthread_create` 会是一个很好的例子。

在调度器创建 M 的时候，会调用 `runtime.newosproc`，进而会调用 `runtime.pthread_create`：

> 位于 `runtime/os_darwin.go`

```go
func newosproc(mp *m) {
	(...)
	err = pthread_create(&attr, funcPC(mstart_stub), unsafe.Pointer(mp))
	(...)
}
```

这个 `runtime.pthread_create` 其实就是

```go
// * _trampoline 函数从 Go 调用约定转换为 C 调用约定，然后调用底层的 libc 函数。它们在 sys_darwin_$ARCH.s 中定义。

//go:nosplit
//go:cgo_unsafe_args
func pthread_create(attr *pthreadattr, start uintptr, arg unsafe.Pointer) int32 {
	return libcCall(unsafe.Pointer(funcPC(pthread_create_trampoline)), unsafe.Pointer(&attr))
}
func pthread_create_trampoline()

// 告诉链接器可以在系统库中找到 libc_* 函数，但缺少 libc_ 前缀。
//go:cgo_import_dynamic libc_pthread_create pthread_create "/usr/lib/libSystem.B.dylib"
```

编译器则负责链接 `runtime.pthread_create_trampoline` 到汇编，完成 `/usr/lib/libSystem.B.dylib` 
提供的 `libc` 调用：

```c
TEXT runtime·pthread_create_trampoline(SB),NOSPLIT,$0
	PUSHQ	BP
	MOVQ	SP, BP
	SUBQ	$16, SP
	MOVQ	0(DI), SI	// arg 2 attr
	MOVQ	8(DI), DX	// arg 3 start
	MOVQ	16(DI), CX	// arg 4 arg
	MOVQ	SP, DI		// arg 1 &threadid (which we throw away)
	CALL	libc_pthread_create(SB)
	MOVQ	BP, SP
	POPQ	BP
	RET
```

链接到 `/usr/lib/libSystem.B.dylib` 是 darwin 系统的特点，用户态只有链接到此才能进行系统调用。
至于其他的系统调用完全类似，读者可以举一反三，这里不再枚举赘述。

## 运行时实现的 `libc` 调用清单

- pthread_attr_init
- pthread_attr_setstacksize
- pthread_attr_setdetachstate
- pthread_create
- exit
- raise
- open
- close
- read
- write
- mmap
- munmap
- madvise
- error
- usleep
- mach_timebase_info
- mach_absolute_time
- gettimeofday
- sigaction
- pthread_sigmask
- sigaltstack
- getpid
- kill
- setitimer
- sysctl
- fcntl
- kqueue
- kevent
- pthread_mutex_init
- pthread_mutex_lock
- pthread_mutex_unlock
- pthread_cond_init
- pthread_cond_wait
- pthread_cond_timedwait_relative_np
- pthread_cond_signal

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)

