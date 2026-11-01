---
weight: 2200
title: "第 5 章 数据结构"
bookCollapseSection: true
---

# 第 5 章 数据结构

- [5.1 数组与切片](./slice.md)
- [5.2 字符串与零拷贝转换](./string.md)
- [5.3 散列表：原理与安全](./map.md)
- [5.4 Swiss Table 与 Go 1.24 实现](./swisstable.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>数据压倒一切。如果已经选择了正确的数据结构并且把一切都组织得井井有条，正确的算法也就不言自明。</I></br>
<I>Data dominates. If you've chosen the right data structures and organized things well, the algorithms will almost always be self-evident.</I></br>
<div class="quote-right">
-- Rob Pike, "Notes on Programming in C"
</div>
</div>

切片、字符串与 `map` 是 Go 程序中最常用的三种数据结构。它们的语法都很简单，背后却各有一套运行时布局与增长
策略。`append` 何时复制，切片之间何时共享内存，字符串转换何时需要分配，`map` 为何遍历无序、
为何不能并发写，这些问题都可以从其布局与实现中推出，而不必作为孤立的规则记忆。

本章分四节讨论。5.1 讨论数组与切片的内存布局、增长策略，以及编译器为减少分配所做的工作；5.2 讨论字符串的
不可变性、UTF-8 以及零拷贝转换；5.3 讨论散列表的一般原理与哈希洪水攻击；5.4 讨论 Go 1.24 基于 Swiss Table
的 `map` 实现。
