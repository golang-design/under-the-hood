---
weight: 3300
title: "第 11 章 同步原语与模式"
bookCollapseSection: true
---

# 第 11 章 同步原语与模式

- [11.1 共享内存式同步模式](./basic.md)
- [11.2 互斥锁](./mutex.md)
- [11.3 原子操作](./atomic.md)
- [11.4 条件变量](./cond.md)
- [11.5 同步组](./waitgroup.md)
- [11.6 缓存池](./pool.md)
- [11.7 并发安全散列表](./map.md)
- [11.8 上下文](./context.md)
- [11.9 内存一致模型](./mem.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>一种构造能够以更简单的底层原语来定义，这一事实是一个有用的保证：把它纳入语言，与语言的其余部分在逻辑上是一致的。</I></br>
<I>The fact that the construction can be defined in terms of simpler underlying primitives is a useful guarantee that its inclusion is logically consistent with the remainder of the language.</I></br>
<div class="quote-right">
-- C. A. R. Hoare, "Communicating Sequential Processes", 1978
</div>
</div>

Hoare 在 CSP 论文的结论中写道，输入、输出与并发应当被视为编程的原语，
但这并不意味着它们可以完全取代语言中的其他概念：一种更精巧的构造（例如过程或管程）若经常有用、
性质更容易证明、实现也比一般情形更高效，就有充分的理由为它提供专门的写法。Go 的取舍与此相合：channel 与
`select` 是语言的一部分（[第 10 章](../ch10chan/readme.md)），互斥锁、原子操作、条件变量等则由标准库的
`sync` 与 `sync/atomic` 包提供，而运行时实现 channel 所用的，本身就是一把锁
（[10.6.5](../ch10chan/lockfree.md)）。

本章讨论这些库层面的同步原语。11.1 回顾共享内存与消息传递这两种传统及其对偶关系；11.2 至 11.8
依次讨论互斥锁、原子操作、条件变量、同步组、缓存池、并发安全的散列表与上下文的实现与设计取舍；11.9
从硬件与编程语言的内存模型讲起，讨论 Go 的内存模型，即这些原语与 channel 共同提供的可见性保证。何时该用
channel、何时该用锁，见 [10.7](../ch10chan/pattern.md)。
