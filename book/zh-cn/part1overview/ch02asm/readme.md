---
weight: 1200
title: "第 2 章 汇编与调用约定"
bookCollapseSection: true
---

# 第 2 章 汇编与调用约定

- [2.1 Plan 9 汇编语言](./asm.md)
- [2.2 调用规范](./callconv.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>计算机科学里的任何问题，都能用增加一层间接来解决。</I></br>
<I>Any problem in computer science can be solved with another level of indirection.</I></br>
<div class="quote-right">
-- David Wheeler
</div>
</div>

源码迟早要落到机器上，而机器并不理解 goroutine、接口或闭包，它只认识寄存器、栈与一串地址。
本章面对的正是这条接缝：Go 没有直接借用某种 CPU 的原生汇编，而是维护了一套 Plan 9 风格、跨架构
统一的汇编语言，又在其上自定义了一套不与任何平台 ABI 兼容的调用规范。这两层间接看似舍近求远，
却换来了「一套工具链交叉编译到所有架构」与「不惊动用户代码即可优化底层」的主权。读懂它们，运行时
最底层那几页才从天书变成可读的现场操作。
