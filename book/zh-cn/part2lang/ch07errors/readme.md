---
weight: 2400
title: "第 7 章 错误处理"
bookCollapseSection: true
---

# 第 7 章 错误处理

- [7.1 问题的演化](./value.md)
- [7.2 错误值检查](./inspect.md)
- [7.3 错误格式与上下文](./context.md)
- [7.4 错误语义](./semantics.md)
- [7.5 错误处理的未来](./future.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>定义错误不存在。</I></br>
<I>Define errors out of existence.</I></br>
<div class="quote-right">
-- John Ousterhout, "A Philosophy of Software Design"
</div>
</div>

错误是程序预见到、却无法正常完成的情形。语言如何让例程报告错误、让调用方处理错误，历来有两种
传统：以返回值报告，或以异常传播。Go 属于前者。它把错误定义为只有一个方法的接口 `error`，由
函数作为最后一个返回值交给调用方，再由调用方显式检查；真正异常的情形则交给 `panic` 与
`recover`（见 [6.3](../ch06func/panic.md)）。

这一设计给了程序员很大的自由：错误可以是一个字符串、一个哨兵值、一个带字段的结构，也可以是
一棵包装了其他错误的树。自由也带来了问题：错误应当以何种形式定义，调用方如何可靠地辨认它，
上下文如何附加，冗长的 `if err != nil` 能否简化。本章依次讨论这些问题：7.1 回顾错误处理的两种
传统以及 `error` 类型从 2008 年到 Go 1 的演变；7.2 讨论 Go 1.13 引入的包装与 `errors.Is`、`errors.As`，
以及 Go 1.26 的 `errors.AsType`；7.3 讨论错误消息、上下文、调用栈与结构化日志；7.4
从库作者的角度讨论错误应当以何种形式暴露；7.5 讨论 2018 年至 2025 年间几次简化错误处理语法的
尝试，以及 Go 团队最终不再寻求语法改变的决定。
