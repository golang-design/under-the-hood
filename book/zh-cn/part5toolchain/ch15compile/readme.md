---
weight: 5100
title: "第 15 章 编译器流水线"
bookCollapseSection: true
---

# 第 15 章 编译器流水线

- [15.1 词法与文法](./parse.md)
- [15.2 中间表示](./ssa.md)
- [15.3 优化器](./optimize.md)
- [15.4 指针检查器](./unsafe.md)
- [15.5 逃逸分析](./escape.md)
- [15.6 cgo](./cgo.md)
- [15.7 过去、现在与未来](./future.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
一个程序不含特洛伊木马，这样的声明可以信任到什么程度？也许更重要的是信任编写软件的人。
</I></br>
<I>
To what extent should one trust a statement that a program is free of Trojan
horses? Perhaps it is more important to trust the people who wrote the
software.
</I></br>
<div class="quote-right">
-- Ken Thompson, "Reflections on Trusting Trust", 1984
</div>
</div>

这两句话印在 Ken Thompson 图灵奖演讲《Reflections on Trusting Trust》的篇首。
演讲描述了一个能够代代相传的编译器后门：它只存在于编译器的二进制文件中，
源码里看不出任何痕迹（[3.3.4](../../part1overview/ch03life/bootstrap.md)）。程序员审查的是源码，
运行的却是编译器的产物，二者之间隔着编译器这一环。本章打开这一环，考察 Go 1.26
的编译器如何把源码变为机器码。

本章沿着编译流水线展开，流水线的总览见 [3.2](../../part1overview/ch03life/compile.md)。[15.1](./parse.md)
讨论词法与文法分析：分号的自动插入，递归下降分析器如何处理文法中的歧义并从错误中恢复，以及前端从 yacc 到
`syntax` 包的演变。[15.2](./ssa.md) 讨论中间表示：统一 IR、`ir` 与 walk，以及 SSA 的构造、
优化趟与重写规则。[15.3](./optimize.md) 讨论优化器中的内联、去虚化、性能制导优化与边界检查消除。[15.4](./unsafe.md)
讨论 `unsafe.Pointer` 的合法模式，以及在运行时检查这些模式的 checkptr。[15.5](./escape.md)
讨论逃逸分析如何把程序抽象为一张带权有向图并在图上求解，以及这一实现的演变与局限。[15.6](./cgo.md)
讨论 cgo 如何在 Go 与 C 两套运行时约定之间转换，指针传递规则的由来，
以及跨越这一边界的代价。[15.7](./future.md) 按时间回顾编译器的演进。
汇编与调用约定见[第 2 章](../../part1overview/ch02asm/readme.md)，
自举与链接见[第 3 章](../../part1overview/ch03life/readme.md)。
