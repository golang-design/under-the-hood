---
weight: 1200
title: "第 2 章 汇编与调用约定"
bookCollapseSection: true
---

# 第 2 章 汇编与调用约定

- [2.1 Plan 9 汇编语言](./asm.md)
- [2.2 汇编中的栈帧与符号](./frame.md)
- [2.3 调用约定与寄存器 ABI](./callconv.md)
- [2.4 参数传递与栈帧布局](./args.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>计算机科学中的任何问题，都可以通过增加一个间接层来解决。</I></br>
<I>Any problem in computer science can be solved with another level of indirection.</I></br>
<div class="quote-right">
-- David Wheeler
</div>
</div>

CPU 并不理解 goroutine、接口与闭包，它只是逐条执行指令：在寄存器与内存之间传送数据、进行运算，并在
需要时跳转。Go 在源码与机器之间自行规定了两层约定：一套在各种体系结构上写法统一的汇编语言，以及一套
规定 Go 函数之间如何传递参数与返回值的调用约定。

本章依次讨论这两层约定。2.1 与 2.2 介绍如何阅读运行时中的汇编代码；2.3 与 2.4 讨论参数与返回值的
存放位置、栈帧的布局，以及几乎每个函数开头都有的栈空间检查。读完本章，读者应能读懂
`runtime/asm_amd64.s` 以及 `go build -gcflags=-S` 输出的汇编。
