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

让函数成为「一等公民」，意味着它能像普通值一样被赋值、传递、返回，还能捕获环境成为闭包。这份在
Strachey 时代尚属奢侈的能力，正是本章要拆解的对象：函数值在内存里如何表示，一次调用在底层如何
传参与返回，`defer` 怎样保证「无论从哪条路径离开，清理都会发生」，以及 `panic` 与 `recover`
如何在调用栈上展开又被截住。这些特性共享同一套运行时机器，把它讲透，就能看清 Go 在便利、性能与
显式控制流之间所做的取舍。
