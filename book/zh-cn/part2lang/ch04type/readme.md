---
weight: 2100
title: "第 4 章 类型系统"
bookCollapseSection: true
---

# 第 4 章 类型系统

- [4.1 运行时类型系统](./type.md)
- [4.2 接口](./interface.md)
- [4.3 类型别名](./alias.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
大道至简。
</I></br>
<I>
Simplicity is complicated.
</I></br>
<div class="quote-right">
-- Rob Pike
</div>
</div>

类型是编译器与运行时之间的约定。在编译期，类型检查器依据类型规则判定程序是否合法；在运行时，接口、反射、
垃圾回收器以及 map 等机制，则依赖编译器为每个类型生成的描述信息。Go 的类型规则相当简单，但这种简单建立在
一套精心设计的表示之上。

本章讨论类型在这两个阶段的表现。4.1 介绍运行时的类型描述符：编译期的类型在运行时保留了哪些信息，类型
标识与可比较性等规则如何借助这些信息实现。4.2 讨论接口的两字表示、基于接口表的动态分派，以及类型断言与
类型 switch 的实现。4.3 讨论类型别名：它只存在于编译期，是为解决大型代码库中的类型迁移问题而引入的。
