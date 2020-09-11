---
weight: 4300
title: "第 17 章 错误"
bookCollapseSection: true
---

# 第 17 章 错误

- [17.1 错误的演化](./value.md)
- [17.2 错误检查](./inspect.md)
- [17.3 错误格式化](./format.md)
- [17.4 不可恢复错误](./throw.md)
- [17.5 错误处理的未来](./future.md)

> _Define errors out of existence._
>
> -- John Ousterhout, "A philosophy of Software Design"

错误是什么？它从哪里来？到哪里去？当我们出现错误时，应该为其做些什么？
这些问题并不简单，但一旦回答了这些问题我们便能不再惧怕错误。
「错误」一词在不同编程语言中存在着不同的理解和诠释。
在 Go 语言的，错误被视普普通通的 —— 值。正因为值的特殊性，
从而 Go 语言允许程序员能够针对不同场景下的错误自行进行不同层次的高层抽象，
但又进一步要求程序员将得到的错误立即进行处理。
这一设计决定一方面给了程序员以极大的自由，但另一方面又在不断的困扰着程序员们，
使他们在拿到一个错误时，变得不知所措。

## 许可

[Go under the hood](https://github.com/golang-design/under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
