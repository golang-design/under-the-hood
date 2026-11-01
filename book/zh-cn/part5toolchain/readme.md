---
weight: 5000
title: "第五部分 编译器与工具链"
bookCollapseSection: true
---

# 第五部分 编译器与工具链

- [第 15 章 编译器流水线](./ch15compile)
- [第 16 章 工具与可观测性](./ch16tools)
- [第 17 章 模块与依赖](./ch17modules)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>你无法信任并非完全由你亲手创造的代码。</I></br>
<I>You can't trust code that you did not totally create yourself.</I></br>
<div class="quote-right">
-- Ken Thompson, "Reflections on Trusting Trust", 1984
</div>
</div>

这句话出自 Thompson 的图灵奖演讲。演讲紧接着指出，对源码的验证与审查再充分，也无法防止使用不可信的代码，
因为程序员审查的是源码，运行的却是编译器的产物。源码要经过一整条工具链才能成为可运行的程序，编译器、
链接器、构建系统以及依赖的传递闭包，每一环都在影响程序的行为，也影响程序是否可信。Go
对这一问题的回应之一，是从 Go 1.21 起实现了工具链的完全可复现，官方发布的工具链因此可以从源码重新构建并加
以比对（[3.3](../part1overview/ch03life/bootstrap.md)）。

本部分讨论 Go 的工具链，分为三章。[第 15 章](./ch15compile/readme.md)沿着编译器的流水线，
考察源码如何经过词法与文法分析、中间表示与优化变为机器码，以及逃逸分析、cgo 等编译器与运行时交界处的机制。[第
16 章](./ch16tools/readme.md)讨论围绕正确性与性能的工具：死锁检查、竞争检测、执行追踪、测试、
基准测试与性能剖析、运行时统计量，以及为编辑器提供语言服务的 gopls。[第
17 章](./ch17modules/readme.md)讨论模块与依赖管理：Go 如何以最小版本选择得到可复现的构建，又如何以
`go.sum` 与校验和数据库确保每个人下载到的都是同一份代码。
