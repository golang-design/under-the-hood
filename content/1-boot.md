# 1 引导

本节讨论程序引导流程。本文涉及的 Go 源码包括以下文件：

```
src/runtime/rt0_darwin_amd64.s
src/runtime/asm_amd64.s
src/runtime/runtime1.go
src/runtime/os_darwin.go
```

## 入口

寻找初始入口，编写简单程序：

```go
package main

func main() {
	println("hello, world!")
}
```

编译：

```bash
go build -gcflags "-N -l" -ldflags=-compressdwarf=false -o main main.go
```

> `-gcflags "-N -l"` 用于关闭编译器代码优化与函数内联。
> 
> 此外还需注意，Go 1.11 开始将调试信息压缩为 DWARF，macOS 下的 gdb 不能解释 DWARF。
因此需要使用 GDB 调试需要增加 `-ldflags=-compressdwarf=false`。

```gdb
$ gdb main
(...)
(gdb) info files
Symbols from "/Users/changkun/dev/go-under-the-hood/demo/1-boot/main".
Local exec file:
        `/Users/changkun/dev/go-under-the-hood/demo/1-boot/main', file type mach-o-x86-64.
        Entry point: 0x1049e20
        0x0000000001001000 - 0x000000000104dfcf is .text
        (...)
(gdb) b *0x1049e20
Breakpoint 1 at 0x1049e20: file /usr/local/Cellar/go/1.11/libexec/src/runtime/rt0_darwin_amd64.s, line 8.
```

可以看到，程序的入口在 `rt0_darwin_amd64.s` 第八行，即：

```asm
TEXT _rt0_amd64_darwin(SB),NOSPLIT,$-8
	JMP	_rt0_amd64(SB)
```

进而跳转到 `asm_amd64.s`：

```asm
// _rt0_amd64 是 amd64 系统上使用内部链接时候常见的引导代码。
// 这是该程序从内核到普通 -buildmode=exe 程序的入口。
// 栈保存了参数的数量以及 C 风格的 argv
TEXT _rt0_amd64(SB),NOSPLIT,$-8
	MOVQ	0(SP), DI	// argc
	LEAQ	8(SP), SI	// argv
	JMP	runtime·rt0_go(SB)
```

从汇编的 `JMP` 指令可以看出，程序会立即跳转到 `runtime.rt0_go`：

```c
TEXT runtime·rt0_go(SB),NOSPLIT,$0
	// 将参数向前复制到一个偶数栈上
	MOVQ	DI, AX		// argc
	MOVQ	SI, BX		// argv
	SUBQ	$(4*8+7), SP		// 2args 2auto
	ANDQ	$~15, SP
	MOVQ	AX, 16(SP)
	MOVQ	BX, 24(SP)

	// 从给定（操作系统）栈中创建 istack。
	// _cgo_init 可能更新 stackguard
	MOVQ	$runtime·g0(SB), DI
	LEAQ	(-64*1024+104)(SP), BX
	MOVQ	BX, g_stackguard0(DI)
	MOVQ	BX, g_stackguard1(DI)
	MOVQ	BX, (g_stack+stack_lo)(DI)
	MOVQ	SP, (g_stack+stack_hi)(DI)

	// 寻找正在运行的处理器信息
	MOVL	$0, AX
	CPUID
	MOVL	AX, SI
	CMPL	AX, $0
	JE	nocpuinfo

	// 处理如何序列化 RDTSC。
	// 在 intel 处理器上，LFENCE 足够了。 AMD 则需要 MFENCE。
	// 其他处理器的情况不清楚，所以让用 MFENCE。
	CMPL	BX, $0x756E6547  // "Genu"
	JNE	notintel
	CMPL	DX, $0x49656E69  // "ineI"
	JNE	notintel
	CMPL	CX, $0x6C65746E  // "ntel"
	JNE	notintel
	MOVB	$1, runtime·isIntel(SB)
	MOVB	$1, runtime·lfenceBeforeRdtsc(SB)
notintel:

	// 加载 EAX=1 cpuid 标记
	MOVL	$1, AX
	CPUID
	MOVL	AX, runtime·processorVersionInfo(SB)

nocpuinfo:
	// 如果存在 _cgo_init, 调用
	MOVQ	_cgo_init(SB), AX
	TESTQ	AX, AX
	JZ	needtls
	// g0 已经存在 DI 中
	MOVQ	DI, CX	// Win64 使用 CX 来表示第一个参数
	MOVQ	$setg_gcc<>(SB), SI
	CALL	AX

	// _cgo_init 后更新 stackguard
	MOVQ	$runtime·g0(SB), CX
	MOVQ	(g_stack+stack_lo)(CX), AX
	ADDQ	$const__StackGuard, AX
	MOVQ	AX, g_stackguard0(CX)
	MOVQ	AX, g_stackguard1(CX)

#ifndef GOOS_windows
	JMP ok
#endif
needtls:
#ifdef GOOS_plan9
	// 跳过 TLS 设置 on Plan 9
	JMP ok
#endif
#ifdef GOOS_solaris
	// 跳过 TLS 设置 on Solaris
	JMP ok
#endif
#ifdef GOOS_darwin
	// 跳过 TLS 设置 on Darwin
	JMP ok
#endif

	LEAQ	runtime·m0+m_tls(SB), DI
	CALL	runtime·settls(SB)

	// 使用它进行存储，确保能正常运行
	get_tls(BX)
	MOVQ	$0x123, g(BX)
	MOVQ	runtime·m0+m_tls(SB), AX
	CMPQ	AX, $0x123
	JEQ 2(PC)
	CALL	runtime·abort(SB)
ok:
	// 程序刚刚启动，此时位于主 OS 线程
	// 设置 per-goroutine 和 per-mach 寄存器
	get_tls(BX)
	LEAQ	runtime·g0(SB), CX
	MOVQ	CX, g(BX)
	LEAQ	runtime·m0(SB), AX

	// 保存 m->g0 = g0
	MOVQ	CX, m_g0(AX)
	// 保存 m0 to g0->m
	MOVQ	AX, g_m(CX)

	CLD				// 约定 D 总是被清除
	CALL	runtime·check(SB)

	MOVL	16(SP), AX		// 复制 argc
	MOVL	AX, 0(SP)
	MOVQ	24(SP), AX		// 复制 argv
	MOVQ	AX, 8(SP)
	CALL	runtime·args(SB)
	CALL	runtime·osinit(SB)
	CALL	runtime·schedinit(SB)

	// 创建一个新的 goroutine 来启动程序
	MOVQ	$runtime·mainPC(SB), AX		// 入口
	PUSHQ	AX
	PUSHQ	$0			// 参数大小
	CALL	runtime·newproc(SB)
	POPQ	AX
	POPQ	AX

	// 启动这个 M
	CALL	runtime·mstart(SB)

	CALL	runtime·abort(SB)	// mstart 应该永不返回
	RET

	// 防止 debugger 调用 debugCallV1 的 dead-code elimination
	MOVQ	$runtime·debugCallV1(SB), AX
	RET

DATA	runtime·mainPC+0(SB)/8,$runtime·main(SB)
GLOBL	runtime·mainPC(SB),RODATA,$8
```

## 引导准备

从上面的汇编代码我们可以看出，整个准备过程按照如下顺序进行：

`runtime.g0`、`runtime.m0` 是一组全局变量，在程序运行之初就已经存在。
除了程序参数外，会首先将 m0 与 g0 互相关联（在[5 调度器：基本知识](5-sched/basic.md)中讨论 M 与 G 之间的关系）。

`runtime.check` 位于 `runtime/runtime1.go` 进行类型检查，
基本上属于对编译器翻译工作的一个校验，粗略看一下，我们不关心这部分的代码：

```go
func check() {
	var (
		a     int8
		b     uint8
		(...)
	)
	(...)

	if unsafe.Sizeof(a) != 1 {
		throw("bad a")
	}
	if unsafe.Sizeof(b) != 1 {
		throw("bad b")
	}
	(...)
}
```

接下来我们看到 `argc, argv` 作为参数传递给 `runtime·args` 
（`runtime/runtime1.go`）处理程序参数的相关事宜，这不是我们所关心的内容。

`runtime.osinit`（`runtime/os_darwin.go`）在不同平台上实现略有不同，
但所有的平台都会做的一件事情是：获得 CPU 核心数，这与调度器有关。
macOS 还会额外完成物理页大小的查询，这与内存分配器有关。

```go
func osinit() {
	ncpu = getncpu()
	physPageSize = getPageSize()
}
```


`runtime.schedinit` 来进行各种初始化工作，我们在 [2 初始化概览](2-init.md) 中详细讨论。

`runtime.mainPC` 在数据段中被定义为 `runtime.main` 保存主 goroutine 入口地址：

```c
DATA	runtime·mainPC+0(SB)/8,$runtime·main(SB)
```

起具体过程在 [3 主 goroutine 生命周期](3-main.md) 中详细讨论。

`runtime·newproc` 则负责创建 G 并将主 goroutine 放至 G 队列中，我们在 [5 调度器：初始化](5-sched/init.md) 中详细讨论。

`runtime·mstart` 开始启动调度循环，我们在 [5 调度器：执行调度](5-sched/exec.md) 中详细讨论。

`runtime·abort` 这个使用 INT 指令执行中断，最终退出程序，loop 后的无限循环永远不会被执行。
  
```c
TEXT runtime·abort(SB),NOSPLIT,$0-0
	INT	$3
loop:
	JMP	loop
```

在整个准备过程中我们需要着重关注下面四个部分，这四个函数及其后续调用关系完整实现了整个 Go 运行时的所有机制：

1. `runtime.schedinit`
2. `runtime.newproc`
3. `runtime.mstart`
4. `runtime.main`

## 总结

Go 程序既不是从 `main.main` 直接启动，也不是从 `runtime.main` 直接启动。
相反，我们通过 GDB 调试寻找 Go 程序的入口地址，在 `darwin/amd64` 上发现实际的入口地址
位于 `runtime._rt0_amd64_darwin`。随后经过一系列的跳转最终来到 `runtime.rt0_go`。

而在这个过程中会完成整个 Go 程序运行时的初始化、内存分配、调度器以及垃圾回收的初始化。
进而开始由调度器转为执行主 goroutine。

## 进一步阅读的参考文献

1. [A Quick Guide to Go's Assembler](https://golang.org/doc/asm)
2. [A Manual for the Plan 9 assembler](https://9p.io/sys/doc/asm.html)
3. [Debugging Go Code with GDB](https://golang.org/doc/gdb)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)