---
weight: 2500
title: "第 8 章 泛型"
bookCollapseSection: true
---

# 第 8 章 泛型

- [8.1 泛型设计的演进](./history.md)
- [8.2 基于合约的泛型](./contracts.md)
- [8.3 类型检查技术](./checker.md)
- [8.4 泛型的未来](./future.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>从某种意义上说，「概念」是一个古老的话题；但人们总觉得这是一个全新的内容。</I></br>
<I>"Concepts", in some ways, that's a very old topic; and other thinks it's new.</I></br>
<div class="quote-right">
-- Bjarne Stroustrup, "Concepts: The Future of Generic Programming"
</div>
</div>

「泛型编程」一词出自 David Musser 与 Alexander Stepanov 在 1989 年发表的同名论文。他们写道，泛型编程的核心
思想是从具体而高效的算法出发进行抽象，得到可以与不同的数据表示相组合的泛型算法，从而产生种类繁多而有用的
软件。这一思想后来成为 C++ 标准模板库的基础。

Go 直到 2022 年发布的 Go 1.18 才支持泛型。本章讨论这一特性的由来与实现：8.1 讨论 Go 为何长期没有泛型、
最终加入的语法，以及编译器以 GC 形状模板化加字典实现泛型的方式；8.2 讨论 2018 年的合约草案为何被放弃，
以及约束如何从「一段不会执行的代码」演变为以接口描述的类型集；8.3 讨论类型集、类型推断等类型检查问题，
以及编译器中的类型检查器 `types2`；8.4 讨论 Go 1.18 以后陆续加入的泛型包与语言特性（包括 Go 1.27
的泛型方法）、仍然缺席的能力，以及字典间接访问的性能代价。
