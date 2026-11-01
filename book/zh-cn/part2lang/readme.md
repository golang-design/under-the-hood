---
weight: 2000
title: "第二部分 语言特性的实现"
bookCollapseSection: true
---

# 第二部分 语言特性的实现

- [第 4 章 类型系统](./ch04type)
- [第 5 章 数据结构](./ch05data)
- [第 6 章 函数、延迟与恐慌](./ch06func)
- [第 7 章 错误处理](./ch07errors)
- [第 8 章 泛型](./ch08generics)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>数据压倒一切。如果已经选择了正确的数据结构并且把一切都组织得井井有条，正确的算法也就不言自明。</I></br>
<I>Data dominates. If you've chosen the right data structures and organized things well, the algorithms will almost always be self-evident.</I></br>
<div class="quote-right">
-- Rob Pike, "Notes on Programming in C"
</div>
</div>

语言的语法面向程序员，语法背后的数据布局与执行机制则面向机器。本部分讨论二者之间的对应关系：程序中出现一个
接口、一个切片、一条 `defer` 语句或一个类型参数时，编译器与运行时为之准备了怎样的内存表示与执行机制。

讨论从类型系统开始（第 4 章），它是其余各章的基础；随后依次是字符串、切片与 map 等数据结构的内部表示
（第 5 章），函数调用、`defer` 与 `panic` 的控制流（第 6 章），把错误作为普通值来处理的方式（第 7 章），
以及泛型如何在编译速度与运行性能之间取得平衡（第 8 章）。了解这些实现之后便可以看到，
各项语言特性并不是孤立的语法便利，而是一组相互关联、各有代价的工程决策。
