---
weight: 2300
title: "第 6 章 函数、延迟与恐慌"
bookCollapseSection: true
---

# 第 6 章 函数、延迟与恐慌

- [6.1 函数调用](./func.md)
- [6.2 延迟语句](./defer.md)
- [6.3 恐慌与恢复内建函数](./panic.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>由此而言，ALGOL 里的过程在某种意义上是二等公民，它们永远只能亲自现身，无法由一个变量或表达式来代表。</I></br>
<I>Thus in a sense procedures in ALGOL are second class citizens, they always have to appear in person and can never be represented by a variable or expression.</I></br>
<div class="quote-right">
-- Christopher Strachey, "Fundamental Concepts in Programming Languages"
</div>
</div>

函数作为**一等公民**（first-class citizen），意味着它可以像普通的值一样被赋值、作为参数传递、
作为结果返回，并且可以捕获其定义环境中的变量而成为闭包。Strachey 在 1967 年 8 月哥本哈根国际计算机程序设计
暑期学校的讲义中区分了一等与二等的对象，并以 ALGOL 的过程作为二等公民的例子，这份讲义直到
2000 年才正式发表。

本章讨论 Go 中与函数有关的三项机制的实现：函数值与闭包在内存中的表示及其调用方式（6.1），`defer`
如何保证无论从哪条路径离开函数，清理工作都会执行（6.2），以及 `panic` 与 `recover`
如何沿调用栈传播并被截获（6.3）。三者共用同一套运行时机制：延迟调用依赖闭包，panic 的处理依赖延迟调用，
而正常返回与 panic 时执行延迟调用的又是同一段代码。理解这套机制，便能看清 Go 在使用的便利、
运行的性能与控制流的显式性之间所做的取舍。
