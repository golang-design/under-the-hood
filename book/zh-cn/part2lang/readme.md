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
<I>数据主导一切。若你选对了数据结构并把一切组织妥当，算法几乎总是不言自明的。</I></br>
<I>Data dominates. If you've chosen the right data structures and organized things well, the algorithms will almost always be self-evident.</I></br>
<div class="quote-right">
-- Rob Pike, "Notes on Programming in C"
</div>
</div>

语言的语法是写给人看的，而语法背后的数据布局才是写给机器执行的。
本部分追问的正是这层落差：当我们写下一个接口、一段切片、一次 defer 或一个类型参数时，
编译器与运行时究竟为我们准备了怎样的内存表示与执行机制。
我们从类型系统这一全局骨架谈起，逐层进入字符串、切片、map 等数据结构的内部表示，
再到函数调用、延迟与恐慌恢复的控制流，错误作为普通值的处理范式，以及泛型如何在不牺牲性能的前提下被实现。
理解了这些实现，语言特性便不再是孤立的语法糖，而是一套彼此咬合、各有代价的工程决策。
