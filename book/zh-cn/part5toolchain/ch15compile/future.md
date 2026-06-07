---
weight: 5107
title: "15.7 过去、现在与未来"
---

# 15.7 过去、现在与未来

编译器是 Go 工具链里改动最频繁、却对用户最透明的部分,你的代码一行不改，重新编译就更快、更
小、更优。这一节回顾编译器的演进，并展望它的方向。

## 15.7.1 过去：从 C 到 Go，从 Plan 9 到 SSA

编译器自身经历了两次大变。其一是**语言**：早期（到 Go 1.4）编译器用 C 写，Go 1.5 自举为用 Go
写（[3.3](../../part1overview/ch03life/bootstrap.md)）。其二是**架构**：早期后端沿用 Plan 9 编译器
的传统，Go 1.7 引入 **SSA 后端**（[15.2](./ssa.md)），带来了显著更好的代码生成与一个更现代、
更易扩展的优化框架。这两次重构都对用户透明,人们只是发现编译出的程序变快了、二进制变小了。

## 15.7.2 现在：寄存器 ABI 与 PGO

近年两项进展尤其重要。**寄存器调用约定**（Go 1.17，[2.2](../../part1overview/ch02asm/callconv.md)、
[6.1](../../part2lang/ch06func/func.md)）：从栈传参改为寄存器传参，约 5% 的整体提速，完全透明。
**性能制导优化 PGO**（Go 1.21，[15.3](./optimize.md)）：用真实运行画像指导内联与去虚化，是
编译器从"静态猜测"转向"数据驱动"的一步。还有持续的**泛型**支持（[8.3](../../part2lang/ch08generics/checker.md)
的 types2 与 GC 形状 stenciling）、以及对编译速度的持续守护。

## 15.7.3 未来：在速度与优化之间继续走钢丝

编译器的未来，仍是那条贯穿全书的张力,**编译速度**与**生成代码质量**之间的平衡
（[1.1](../../part1overview/ch01intro/history.md)）。可预见的方向包括：PGO 的进一步发力（更多
优化能利用画像数据）、泛型代码的性能优化（消解 GC 形状字典的间接开销，
[8.4](../../part2lang/ch08generics/future.md)）、与新 GC（Green Tea，
[13.11](../../part4memory/ch13gc/history.md)）协同的代码生成、以及对新硬件特性（向量指令等）的
更好利用。但有一条几乎可以肯定不会变：**Go 不会为了多榨几个百分点的运行性能，而牺牲它引以为傲
的编译速度**,这是它的立身之本。

回看编译器这条线，它完美诠释了 Go 工具链的工作方式：**持续地、对用户透明地变好，每一步都在
既定的价值排序（快、简单、可工程化）下做取舍，敢于推倒重写（C→Go、Plan9→SSA），也敢于
引入新范式（PGO 的数据驱动）。** 这台把你的源码变成飞快二进制的机器，本身就是 Go 工程哲学
最精密的体现。

## 延伸阅读的文献

1. The Go Authors. *cmd/compile/README（编译器架构与演进）.*
   https://github.com/golang/go/blob/master/src/cmd/compile/README.md
2. Keith Randall. *Generating Better Machine Code with SSA*（Go 1.7 SSA 后端）.
   https://go.dev/talks/2015/gogo.slide
3. The Go Authors. *PGO / 寄存器 ABI 设计文档.* https://go.dev/doc/pgo ；
   https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md
4. 本书 [15.2 中间表示](./ssa.md)、[15.3 优化器](./optimize.md)、
   [8 泛型](../../part2lang/ch08generics).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
