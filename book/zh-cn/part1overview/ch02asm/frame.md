---
weight: 1202
title: "2.2 汇编中的栈帧与符号"
---

# 2.2 汇编中的栈帧与符号

[2.1](./asm.md) 给出了 Plan 9 汇编的伪寄存器与寻址语法，那是「怎么写一行汇编」。本节把视线
抬高到一段完整例程：一个手写汇编函数如何用 `TEXT ·name(SB)` 声明自己的符号，如何用 `$framesize-argsize`
申明栈帧大小，`NOSPLIT` 又意味着什么。我们用运行时里三段真实例程（`Cas`、`gogo`、`morestack`）
把这些约定逐处对上号，读完之后，调度器与栈管理章节里那些汇编符号就从天书变成可读的现场操作。

## 2.2.1 从 Go 源码到 Plan 9 汇编：CAS 的逐槽对应

把抽象落到实处。运行时的原子比较交换 `Cas` 在 amd64 上是手写汇编，它的 Go 原型与汇编实现
逐字段对得上，是观察「Go 源码如何映射到 Plan 9 汇编」的好样本。Go 这一侧只有声明（函数体在
`.s` 文件里）：

```go
// internal/runtime/atomic：仅声明，实现在 atomic_amd64.s
//
//	if *ptr == old { *ptr = new; return true } else { return false }
func Cas(ptr *uint32, old, new uint32) bool
```

对应的 amd64 实现：

```asm
// internal/runtime/atomic/atomic_amd64.s
TEXT ·Cas(SB), NOSPLIT, $0-17
	MOVQ	ptr+0(FP), BX      // BX = ptr        （指针 8 字节，偏移 0）
	MOVL	old+8(FP), AX      // AX = old        （int32 4 字节，偏移 8）
	MOVL	new+12(FP), CX     // CX = new        （int32 4 字节，偏移 12）
	LOCK
	CMPXCHGL	CX, 0(BX)  // 原子：若 *ptr==AX 则 *ptr=CX
	SETEQ	ret+16(FP)         // 相等则把 1 写回返回值槽（偏移 16）
	RET
```

逐处对照即可读通这段代码，也能体会 FP 的作用：

- `TEXT ·Cas(SB)` 用 SB 声明全局符号 `Cas`，`·` 是包名分隔符，工具链会补全为
  `internal/runtime/atomic.Cas`。函数名以 SB 偏移给出，正是 2.1.2 里 SB 的职责。
- `$0-17` 是帧大小说明：**局部帧 0 字节，参数加返回值共 17 字节**。`17 = 8 + 4 + 4 + 1`，恰是
  `*uint32`（8）、两个 `uint32`（各 4）、`bool` 返回值（1）之和。`NOSPLIT` 表示这段代码不插入
  栈增长检查，本身不会触发 `morestack`。
- 三条 `MOVx ...(FP)` 把三个**参数**从调用方栈帧搬进寄存器，偏移 0、8、12 与 Go 签名里参数的
  排布一一对应。`MOVQ` 搬 8 字节（指针），`MOVL` 搬 4 字节（int32），后缀编码了操作宽度
  （B/W/L/Q 对应 1/2/4/8 字节）。
- `LOCK` 不是一条指令，而是修饰下一条指令的**前缀**，它令 `CMPXCHGL` 在多核上原子地独占目标
  缓存行。`CMPXCHGL` 隐式以 AX 为比较基准：若 `*ptr == AX` 则写入 CX，并置标志位。
- `SETEQ ret+16(FP)` 据标志位把 1 或 0 写回**返回值槽**，偏移 16 紧接在 17 字节区的末尾。

值得记住的是这份汇编只写一遍语法、却为多架构各有一份后端实现：386、arm64、riscv64 各自的
`atomic_*.s` 用同样的 `·Cas(SB)`、同样的 `ptr+0(FP)` 写法，落到各家真实的原子指令上。这就是
2.1.1 所说「一套语法、多个后端」在最小尺度上的样子。

## 2.2.2 运行时下到汇编的两处现场：gogo 与 morestack

CAS 展示了「调用约定 + 一条特殊指令」，调度器里的栈切换则展示了汇编**唯一能做**的事：把执行
现场整体搬走。Go 用一个 `gobuf` 结构保存 goroutine 的现场（SP、PC、g 指针等），`gogo` 的职责
就是把某个 `gobuf` 恢复进真实寄存器，从而「跳进」那个 goroutine：

```asm
// runtime/asm_amd64.s（裁剪：省去 g != nil 校验与实验性分支）
TEXT gogo<>(SB), NOSPLIT, $0
	get_tls(CX)
	MOVQ	DX, g(CX)            // 把目标 g 写回 TLS
	MOVQ	DX, R14              // R14 恒为当前 g（regabi 约定）
	MOVQ	gobuf_sp(BX), SP     // 恢复栈指针：换栈在此一句完成
	MOVQ	gobuf_bp(BX), BP     // 恢复帧基址
	MOVQ	gobuf_pc(BX), BX     // 取出目标 PC
	JMP	BX                       // 跳过去，从此 CPU 在新 goroutine 上执行
```

关键就在 `MOVQ gobuf_sp(BX), SP` 与末尾的 `JMP BX`：一句换掉栈指针，一句换掉程序计数器，CPU
的执行现场便从一个 goroutine 整体迁移到另一个。这种「把 SP/PC 当普通数据来读写」的操作，
高级语言里根本没有对应物，只能下到汇编。顺带一提，`R14` 恒等于当前 g 是 `<ABIInternal>`
寄存器调用约定的一部分，调用约定本身由 [2.3](./callconv.md) 详述，这里只需知道它解释了汇编里
为何能直接用 `R14` 取到当前 goroutine。

另一处是栈增长的序言 `morestack`。Go 的栈是按需增长的（[14](../../part4memory/ch14stack)），
编译器在函数入口插入检查，发现栈不够就跳来这里。`morestack` 必须在切到 g0 系统栈之前，把
**当前函数的现场**存进 `g.sched`，否则栈一搬走现场就丢了：

```asm
// runtime/asm_amd64.s（裁剪要点）
TEXT runtime·morestack(SB), NOSPLIT|NOFRAME, $0-0
	get_tls(CX)
	MOVQ	g(CX), DI                       // DI = 当前 g
	MOVQ	g_m(DI), BX                      // BX = m
	MOVQ	0(SP), AX                        // 取被增长函数的 PC（裸 0(SP)：硬件 SP）
	MOVQ	AX, (g_sched+gobuf_pc)(DI)       // 存进 g.sched.pc
	LEAQ	8(SP), AX                        // 算出其 SP
	MOVQ	AX, (g_sched+gobuf_sp)(DI)       // 存进 g.sched.sp
	// ...切到 m.g0 栈，最终 CALL runtime·newstack(SB) 完成扩容与重新调度
```

注意这里 `0(SP)`、`8(SP)` 都是**裸偏移**，用的是硬件 SP（2.1.2 的陷阱）：`morestack` 直接在机器
栈上读返回地址，所以必须用真实栈指针而非伪 SP。它常以 `morestack_noctxt` 的形式出现，那不过是
先把上下文寄存器清零、再跳进 `morestack` 的两行薄包装：

```asm
TEXT runtime·morestack_noctxt(SB), NOSPLIT, $0
	MOVL	$0, DX
	JMP	runtime·morestack(SB)
```

读懂这两段，调度与栈管理章节里反复出现的「保存/恢复现场」就不再神秘：它们都是在汇编层精确
摆布 PC、SP 与少数约定寄存器。

## 2.2.3 它在本书中的角色与取舍

[2.1](./asm.md) 与本节合起来是一份阅读词汇表，不是汇编教程。Go 选择维护自己的、Plan 9 风格的
跨架构汇编器，而不复用 GNU as 这类现成工具，这是一处清晰的工程取舍：**成本**是又多养了一套
汇编器、链接器与目标文件格式，每加一个架构都要补一个后端；**收益**是对代码生成、调用约定、栈
布局、与运行时的协同握有完全控制权，并让「一套工具链交叉编译到所有架构」成为可能。性能与可控
从不白来，它们的对价正是这套自有基础设施的长期维护负担。这与 [2.3 调用约定](./callconv.md)
选择自定义 ABI、[6.1](../../part2lang/ch06func/func.md) 自管函数调用的取舍同出一辙，三者是同一种
「为掌控而自造」的设计姿态。

把这两节当作后续阅读的脚手架即可。当 [9.4](../../part3concurrency/ch09sched/schedule.md) 用 `gogo`/`mcall`
切换 goroutine、[9.6](../../part3concurrency/ch09sched/signal.md) 在信号里保存现场、
[14](../../part4memory/ch14stack) 谈栈增长时，读者知道那些汇编符号身处怎样一个抽象层：FP 取参数、
SP 取局部、SB 取全局、PC 管跳转，由 Go 自有工具链翻译到真实硬件。带着这份词汇表，运行时最底层
的那几页就读得动了。

## 延伸阅读的文献

1. The Go Authors. *runtime/asm_amd64.s、internal/runtime/atomic.* https://github.com/golang/go/tree/master/src/runtime
   （本节 `gogo`/`morestack`/`Cas` 的出处）
2. The Go Authors. *Debugging Go Code with GDB.* https://go.dev/doc/gdb
   （把汇编与运行时现场对照调试）
3. 本书 [2.1 Plan 9 汇编语言](./asm.md)、[2.3 调用约定与寄存器 ABI](./callconv.md)（自定义 ABI）、
   [6.1 函数调用](../../part2lang/ch06func/func.md)、
   [9.4 调度循环](../../part3concurrency/ch09sched/schedule.md)（gogo/mcall 栈切换）、
   [14 栈管理](../../part4memory/ch14stack)（morestack 与栈增长）.
