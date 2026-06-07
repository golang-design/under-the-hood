---
weight: 5102
title: "15.2 中间表示"
---

# 15.2 中间表示

AST（[15.1](./parse.md)）忠实反映源码结构，却不适合做优化与代码生成,它太"高层"了。编译器
为此把 AST 降低到更适合机器处理的**中间表示**（IR），其中最关键的是 **SSA**（静态单赋值）形式。
这一节讲清 SSA 是什么、为何它是现代编译器优化的通用底座。

## 15.2.1 SSA：每个变量只赋值一次

SSA（Static Single Assignment）的核心规则简单到出奇：**每个变量在程序里只被赋值一次**。源码里
`x = 1; x = x + 1` 这种对同一个 `x` 多次赋值，在 SSA 里会被改写成 `x1 = 1; x2 = x1 + 1`,每次
赋值产生一个新的版本。当控制流汇合（如 if 的两个分支都给 `x` 赋了值），用一个特殊的 **φ（phi）
函数**把不同路径来的版本合并：`x3 = φ(x1, x2)`。

这个看似古怪的约束，带来一个巨大的好处：**数据流变得显式而清晰**。每个变量只有唯一的定义点，
"这个值从哪来、到哪去"一目了然。许多优化（[15.3](./optimize.md)）在 AST 上很难做、在 SSA 上
却变得直接,因为 SSA 把"值的流动"明明白白地摆了出来。SSA 是 LLVM、HotSpot C2、以及 Go 编译器
共同的选择，已是现代优化编译器的事实标准。

## 15.2.2 Go 的 SSA 流水线

Go 编译器（`cmd/compile/internal/ssa`）把类型检查后的 IR 转成 SSA，然后跑一长串**优化遍**
（pass），最后逐步把"与机器无关的 SSA"**降低**（lower）到"特定架构的 SSA"，再生成机器码。
一个有意思的工程细节：Go 的 SSA 优化规则很多是用一种**领域特定的重写规则**（`.rules` 文件）
声明式地写出来的,如"把 `x*2` 重写成 `x<<1`"、"把已知边界的数组访问去掉边界检查"。编译器
据这些规则自动生成匹配与重写代码。这让优化规则易读、易加、易验证,又是一处"用声明式描述
取代手写命令式"的设计（对照 [9.10](../../part3concurrency/ch09sched/timer.md)、
[12.7](../../part4memory/ch12alloc/pagealloc.md) 选对表示带来的简化）。

## 15.2.3 为何在 SSA 上做优化

把优化放在 SSA 这层中间表示上，是经过权衡的。太高层（AST）做优化，要反复分析数据流、容易
出错;太低层（机器码）做优化，又丢失了高层信息、且每个架构都得重做一遍。SSA 恰在中间：它
**与具体机器无关**（一份优化逻辑适用所有架构）、又**数据流显式**（优化好做）。Go 在这层集中做掉
内联、常量折叠、死代码消除、边界检查消除等大部分优化（[15.3](./optimize.md)），之后再降到各
架构。这种"在一个恰当的中间层集中发力"的分层，让编译器既能跨架构复用优化、又保持各阶段
职责清晰。理解了 SSA 这个底座，下一节的各种具体优化就都有了落脚点。

## 延伸阅读的文献

1. Ron Cytron et al. "Efficiently computing static single assignment form and the control
   dependence graph." *ACM TOPLAS*, 13(4), 1991. https://doi.org/10.1145/115372.115320 （SSA 经典）.
2. The Go Authors. *cmd/compile/internal/ssa（含 README 与 .rules 文件）.*
   https://github.com/golang/go/tree/master/src/cmd/compile/internal/ssa
3. Keith Randall. *Generating Better Machine Code with SSA*（Go SSA 后端演讲）.
   https://go.dev/talks/2015/gogo.slide
4. 本书 [15.1 词法与文法](./parse.md)、[15.3 优化器](./optimize.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
