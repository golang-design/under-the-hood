# 1 引导

本节讨论程序引导流程。

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

```c
TEXT main(SB),NOSPLIT,$0
	// Remove the return address from the stack.
	// rt0_go doesn't expect it to be there.
	ADDL	$4, SP
	JMP	runtime·rt0_go(SB) // 跳转到 runtime.rt0_go
```

从汇编的 `JMP` 指令可以看出，程序会立即跳转到 `runtime·rt0_go`：

```c
TEXT runtime·rt0_go(SB),NOSPLIT,$0
	// copy arguments forward on an even stack
	MOVQ	DI, AX		// argc
	MOVQ	SI, BX		// argv

(...)

	// set up %gs
	CALL	runtime·ldt0setup(SB)

	// store through it, to make sure it works
	get_tls(BX)
	MOVL	$0x123, g(BX)
	MOVL	runtime·m0+m_tls(SB), AX
	CMPL	AX, $0x123
	JEQ	ok
	MOVL	AX, 0	// abort
ok:
	// set up m and g "registers"
	get_tls(BX)
	LEAL	runtime·g0(SB), DX
	MOVL	DX, g(BX)
	LEAL	runtime·m0(SB), AX

	// 保存 m->g0 = g0
	MOVL	DX, m_g0(AX)
	// 保存 g0->m = m0
	MOVL	AX, g_m(DX)

	CALL	runtime·emptyfunc(SB)	// fault if stack check is wrong

	// convention is D is always cleared
	CLD

	CALL	runtime·check(SB)

	// 保存参数 argc, argv
	MOVL	120(SP), AX
	MOVL	AX, 0(SP)
	MOVL	124(SP), AX
	MOVL	AX, 4(SP)
	CALL	runtime·args(SB)
	CALL	runtime·osinit(SB)
	CALL	runtime·schedinit(SB)

	// 创建运行程序的 goroutine
	PUSHL	$runtime·mainPC(SB)	// 入口
	PUSHL	$0	// arg size
	CALL	runtime·newproc(SB)
	POPL	AX
	POPL	AX

	// 运行当前 M
	CALL	runtime·mstart(SB)

	CALL	runtime·abort(SB)
	RET
```

## 引导准备

从上面的汇编代码我们可以看出，整个准备过程按照如下顺序进行：

`runtime·g0`、`runtime·m0` 是一组全局变量，在程序运行之初就已经创建完成（编译器完成数据段相关翻译），定义位于`runtime/proc.go`。除了程序参数外，会首先将 m0 与 g0 互相关联（在[调度器](5-sched/basic.md)中讨论 M 与 G 之间的关系）。

然后会调用一个空函数 `runtime·emptyfunc` 进行堆栈溢出检查，这个函数什么也不做，只是强制进行一次压栈和出栈操作。

```c
TEXT runtime·emptyfunc(SB),0,$0-0
	RET
```

`runtime·check`: `runtime/runtime1.go` 进行类型检查，基本上属于对编译器翻译工作的一个校验，我们不关心这部分的代码：

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

接下来我们看到 `argc, argv` 作为参数传递给 `runtime·args` （`runtime/runtime1.go`）处理程序参数的相关事宜，这不是我们所关心的内容。

`runtime·osinit`（`runtime/os_darwin.go`）在不同平台上实现略有不同，但所有的平台都会做的一件事情是：获得 CPU 核心数，这与调度器有关。macOS 还会额外完成物理页大小的查询，这与内存分配器有关。

  ```go
	func osinit() {
		ncpu = getncpu()
		physPageSize = getPageSize()
	}
  ```


`runtime·schedinit`: `runtime/proc.go` 各种初始化

`runtime·mainPC` 在数据段中被定义为 `runtime·main` 创建主 goroutine：

```c
DATA	runtime·mainPC+0(SB)/4,$runtime·main(SB)
```

`runtime·newproc`: `runtime/proc.go` 创建 G 并将主 goroutine 放至 G 队列中

`runtime·mstart`: `runtime/proc.go` 执行 M

`runtime·abort` 这个使用 INT 指令执行中断，最终退出程序，loop 后的无限循环永远不会被执行。
  
```c
TEXT runtime·abort(SB),NOSPLIT,$0-0
	INT	$3
loop:
	JMP	loop
```

在整个准备过程中我们需要着重关注下面四个部分，这四个函数及其后续调用关系完整实现了整个 Go 运行时的所有机制：

- `runtime·schedinit`： 在[2 初始化概览](2-init.md)讨论
- `runtime·main`：在[3 主 goroutine 生命周期](3-main.md)讨论
- `runtime·newproc`：创建 G，在[5 调度器：初始化](5-sched/init.md)讨论
- `runtime·mstart`：运行 M，在[5 调度器：执行调度](5-sched/exec.md)讨论

## 总结

Go 程序既不是从 `main.main` 直接启动，也不是从 `runtime.main` 直接启动。
相反，我们通过 GDB 调试寻找 Go 程序的入口地址，发现实际的入口地址位于 `runtime.rt0_go`。

在执行 `main.main` 前，Go 程序会完成自身三大核心组件（内存分配器、goroutine 调度器、垃圾回收器）
的初始化工作。

## 进一步阅读的参考文献

1. [A Quick Guide to Go's Assembler](https://golang.org/doc/asm)
2. [A Manual for the Plan 9 assembler](https://9p.io/sys/doc/asm.html)
3. [Debugging Go Code with GDB](https://golang.org/doc/gdb)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)