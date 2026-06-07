---
weight: 1202
title: "2.2 调用规范"
---

# 2.2 调用规范

调用规范（calling convention / ABI）规定了一次函数调用在机器层面如何进行：参数与返回值放哪里、
谁负责保存哪些寄存器、栈帧如何布局。它是编译器、汇编代码、运行时三者之间必须共同遵守的契约。
[6.1](../../part2lang/ch06func/func.md) 已从语言视角讲过从栈到寄存器的演进，这一节补足它在
汇编与运行时层面的含义,二者合起来才完整。

## 2.2.1 两套 ABI：ABI0 与 ABIInternal

Go 现在并存两套调用规范。**ABI0** 是早期的、**基于栈**的规范：参数与返回值全部通过栈内存传递，
布局稳定、简单。手写的 Plan 9 汇编（[2.1](./asm.md)）遵循 ABI0,因为它布局可预测，人写起来
心里有数。**ABIInternal** 是 Go 1.17 引入的、**基于寄存器**的内部规范：尽量用寄存器传参与返回，
省去大量栈内存读写，带来约 5% 的整体提速。所有 Go 源码编译出的函数走 ABIInternal。

两套并存，意味着边界处需要**桥接**：当 ABIInternal 的 Go 代码调用 ABI0 的汇编函数（或反过来），
编译器会生成一小段包装代码（wrapper）做参数的重新摆放。理解"为何有两套 ABI"，是读懂运行时
里那些 `·f<ABIInternal>`、`·g<ABI0>` 符号标注的钥匙。

## 2.2.2 栈帧、保存寄存器与栈增长检查

一次调用压入一个**栈帧**，存放参数区、局部变量、被保存的寄存器、返回地址。Go 的调用规范还
嵌进了一件别家少有的事：**栈增长检查**。几乎每个函数的序言（prologue）都有一小段代码，比较
栈指针与 `g.stackguard0`，判断当前栈空间是否够用,不够就跳进 `morestack` 去扩栈
（[14 执行栈](../../part4memory/ch14stack)）。这段检查还被 Go 的**协作式抢占**搭了便车
（[9.7](../../part3concurrency/ch09sched/preemption.md)）：把 `stackguard0` 改成哨兵值，就能让
函数在下次调用时"顺便"让出。一个看似纯粹的 ABI 细节（序言里的栈检查），同时服务了栈增长与
抢占两件事,这是 Go 把多种机制叠在一个低成本检查点上的典型手法。

## 2.2.3 为何自定义 ABI

Go 没有沿用平台标准 ABI（如 System V AMD64），而是定义了自己的内部 ABI。代价是**与外部目标
文件不能直接互通**,调用 C 代码（cgo）必须跨越 ABI 边界，有实打实的开销
（[15 编译器](../../part5toolchain/ch15compile)）。收益则是**完全的掌控**：调用规范可以按 Go
运行时的需要演进,从 ABI0 平滑切换到寄存器版的 ABIInternal，正是因为这套 ABI 是 Go 自己的、
不必兼容任何外部约定。这与 [2.1](./asm.md) 维护自有汇编器、[6.1](../../part2lang/ch06func/func.md)
的取舍是同一种哲学：**Go 宁可牺牲与外部世界的无缝互通，也要保住对自身实现的主权。** 这份主权，
正是它能在不惊动用户代码的前提下，反复优化运行时底层的根本原因。

## 延伸阅读的文献

1. The Go Authors. *Go internal ABI specification (ABIInternal).*
   https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md
2. Austin Clements et al. *Proposal: Register-based Go calling convention*（Go 1.17）.
   https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md
3. The Go Authors. *A Quick Guide to Go's Assembler*（ABI0、伪寄存器）. https://go.dev/doc/asm
4. 本书 [6.1 函数调用](../../part2lang/ch06func/func.md)、
   [14 执行栈管理](../../part4memory/ch14stack)、
   [9.7 协作与抢占](../../part3concurrency/ch09sched/preemption.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
