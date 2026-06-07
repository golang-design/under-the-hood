---
weight: 1201
title: "2.1 Plan 9 汇编语言"
---

# 2.1 Plan 9 汇编语言

读 Go 运行时的源码，迟早会撞见一种看起来既像汇编、又不太像任何熟悉汇编的代码,那是 Go 的
**Plan 9 风格汇编**。本书剖析调度器、栈切换、原子操作时不时会提到它（`gogo`、`mcall`、
`asyncPreempt` 等都是汇编例程）。这一节解释它是什么、为何存在、以及读懂它需要的几个关键概念,
不求让你会写，但求让你看懂运行时为何要下到这一层。

## 2.1.1 为什么 Go 有自己的汇编

Go 的汇编源自 **Plan 9 操作系统**（Go 设计者的老家）的汇编器传统。它不是某一种 CPU 的原生
汇编，而是一种**半抽象的、跨架构统一的**汇编语言：同一套语法与伪指令，由工具链翻译到各目标
架构的真实指令。这与 Go"一套工具链、交叉编译开箱即用"的目标一致,无需为每个架构学一套迥异
的汇编语法。

Go 为什么需要汇编？绝大多数 Go 代码当然不碰它,但运行时有少数地方**必须**：栈切换
（`gogo`/`mcall`，[9.4](../../part3concurrency/ch09sched/schedule.md)）要直接操纵 SP/PC，
原子操作要发特定 CPU 指令，系统调用入口、信号处理的现场保存（[9.6](../../part3concurrency/ch09sched/signal.md)）、
以及一些性能关键的内建函数，都需要绕过编译器、精确控制机器状态。汇编是运行时与硬件之间那
最后一层薄薄的、不可省略的胶水。

## 2.1.2 四个伪寄存器

Plan 9 汇编最容易让人困惑、也最该先弄懂的，是它的**伪寄存器**,它们不一定对应真实的物理寄存器，
而是工具链提供的抽象：

- **FP**（Frame Pointer）：访问函数**参数**,如 `arg+0(FP)`。
- **SP**（Stack Pointer）：访问函数的**局部变量**,注意它与硬件 SP 含义不完全相同。
- **PC**（Program Counter）：程序计数器，对应跳转。
- **SB**（Static Base）：访问**全局符号**,如 `runtime·foo(SB)`。

这套伪寄存器让同一份汇编能跨架构复用：你写 `arg+0(FP)` 表达"第一个参数"，工具链负责把它落到
各架构真实的传参位置上。理解了这四个伪寄存器，运行时里那些汇编例程就从天书变成了可读的
"对栈与寄存器的精确操作"。

## 2.1.3 它在本书中的角色

本书不教你写 Plan 9 汇编,那是另一本书的内容。但在剖析运行时最底层的机制时（goroutine 切换、
抢占信号注入、原子原语），无法回避它,那些操作的本质，正是"在汇编层面精确摆布 PC、SP 与
寄存器现场"。把这一节当作一个**词汇表**：当后文提到某个汇编例程时，你知道它身处的是这样一个
跨架构、带伪寄存器的抽象层，由 Go 自有的工具链翻译到真实硬件。Go 选择维护自己的汇编器，
而非复用 GNU as 等现成工具，代价是又多养了一套基础设施，收益是对代码生成、交叉编译、与
运行时的协同有了完全的掌控,这与 [6.1](../../part2lang/ch06func/func.md) 里"自定义内部 ABI"
的取舍同出一辙。

## 延伸阅读的文献

1. The Go Authors. *A Quick Guide to Go's Assembler.* https://go.dev/doc/asm
2. Rob Pike. *The Design of the Inferno Virtual Machine*（Plan 9 汇编传统的背景）.
3. The Go Authors. *cmd/internal/obj、cmd/asm*（汇编器实现）.
   https://github.com/golang/go/tree/master/src/cmd/asm
4. 本书 [9.4 调度循环](../../part3concurrency/ch09sched/schedule.md)（gogo/mcall 栈切换）、
   [6.1 函数调用](../../part2lang/ch06func/func.md)（调用约定）.

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
