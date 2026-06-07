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

（自举、链接器、汇编器、调用规约已分别移至
[第 3 章 程序的生命周期](../../part1overview/ch03life)与
[第 2 章 汇编与调用约定](../../part1overview/ch02asm)。）

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
一个人应该在多大程度上相信一个程序宣称其不存在特洛伊木马？也许更重要的是要相信编写软件的人。
</I></br>
<I>
To what extent should one trust a statement that a program is free of Trojan
horses? Perhaps it is more important to trust the people who wrote the
software.
</I></br>
<div class="quote-right">
-- Ken Thompson
</div>
</div>


## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).