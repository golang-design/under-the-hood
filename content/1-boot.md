# 1 引导

本节讨论程序引导流程。在阅读 Go 汇编代码之前，先铺垫一些概念：

FP: 帧指针: 实参与本地
PC: 程序计数器: 跳转与分支
SB: 静态基指针: 全局符号.
SP: 栈指针: 栈顶

- 符号 `foo(SB)` 表示 `foo` 在内存中的地址。

```c
// 位于 runtime/rt0_darwin_386.s
TEXT main(SB),NOSPLIT,$0
	// Remove the return address from the stack.
	// rt0_go doesn't expect it to be there.
	ADDL	$4, SP
	JMP	runtime·rt0_go(SB) // 跳转到 runtime.rt0_go
```

跳转到 `runtime·rt0_go`：

```c
// 位于 runtime/asm_386.s#92
TEXT runtime·rt0_go(SB),NOSPLIT,$0
	// copy arguments forward on an even stack
	MOVQ	DI, AX		// argc
	MOVQ	SI, BX		// argv

(...)


	// 位于 runtime/asm_386.s#L200
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
	PUSHL	$runtime·mainPC(SB)	// entry
	PUSHL	$0	// arg size
	CALL	runtime·newproc(SB)
	POPL	AX
	POPL	AX

	// 运行当前 M
	CALL	runtime·mstart(SB)

	CALL	runtime·abort(SB)
	RET
```

准备过程：

- runtime·g0: `runtime/proc.go#L80` 全局变量
- runtime·m0: `runtime/proc.go#L81` 全局变量
- runtime·emptyfunc: 用于堆栈检查

  ```c
  // runtime/asm_386.s#L909
  TEXT runtime·emptyfunc(SB),0,$0-0
	RET
  ```

- runtime·check `runtime/runtime1.go#L136` 进行类型检查
- runtime·args `runtime/runtime1.go#L60` 保存命令行参数
- runtime·osinit`runtime/os_darwin.go#L79` 获得 CPU 核心数
- runtime·schedinit `runtime/proc.go#L532`
- runtime·mainPC: `runtime·main` --> `runtime/proc.go#L110` 主 goroutine
- runtime·newproc: `runtime/proc.go#L3304`
- runtime·mstart: `runtime/proc.go#L1229` 执行 m0 （主 OS 线程）。
- runtime·abort
  
  ```c
  // runtime/asm_386.s#L865
  TEXT runtime·abort(SB),NOSPLIT,$0-0
      INT	$3
  loop:
      JMP	loop
  ```

整个过程中的重点：

- `runtime·schedinit`： 在 [2 初始化概览](2-init.md) 讨论
- `runtime·main`：在 [3 主 goroutine 生命周期](3-main.md) 讨论
- `runtime·newproc`：TODO
- `runtime·mstart`：TODO