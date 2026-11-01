---
weight: 5300
title: "第 17 章 模块与依赖"
bookCollapseSection: true
---

# 第 17 章 模块与依赖

- [17.1 依赖管理的难点](./challenges.md)
- [17.2 语义化版本管理](./semantics.md)
- [17.3 最小版本选择算法](./minimum.md)
- [17.4 vgo 与 dep 之争](./fight.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>你也许会问：为什么不照其他语言的做法去做？Java 有 Maven，Node 有 NPM，Ruby 有 Bundler，Rust 有 Cargo。这怎么还不是一个已经解决的问题？</I></br>
<I>You might wonder: Why not do what other languages do? Java has Maven, Node has NPM, Ruby has Bundler, Rust has Cargo. How is this not a solved problem?</I></br>
<div class="quote-right">
-- Russ Cox, "The Principles of Versioning in Go"
</div>
</div>

题记是 Cox 在 2019 年替读者提出的问题。Cox 的回答是，Go 从 `dep` 的实践中认识到，Bundler、Cargo 与 `dep`
共同采用的那条路线中有一些决定会让软件工程更加复杂，Go 模块因此作出了不同的选择。
本章讨论这些选择及其由来。

17.1 讨论依赖管理为何困难：没有版本的 `go get`、钻石依赖、一般版本选择问题的 NP 完全性与可重复构建，以及
Go 据此提出的三条原则；17.2 讨论语义化版本与导入兼容性规则，即把主版本写进导入路径，
以及没有标签的代码如何以伪版本参与排序；17.3 讨论最小版本选择算法，它为何能避开 NP 完全、
高保真构建的收益与代价，以及模块图剪枝、工作区与工具链管理对它的扩展；17.4 讨论 `dep` 与 vgo 之间的分歧、Go
模块从实验走向默认的过程，以及保证同一版本内容不变的 `go.sum` 与校验和数据库。
