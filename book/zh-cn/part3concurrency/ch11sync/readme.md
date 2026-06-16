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
<I>程序的构造可以使用更加简单的基础原语来表达这一事实，提供了一个有力的保障，即：这些基础原语所包含的内容能够与程序语言的其余部分在逻辑上保持一致。</I></br>
<I>The fact that the construction can be defined in terms of simpler underlying primitives is a useful guarantee that its inclusion is logically consistent with the remainder of the language.</I></br>
<div class="quote-right">
-- C.A.R. Hoare
</div>
</div>

在现代编程语言中，多线程间的同步通常采用互斥、信号量等传统共享内存的手段。Go 语言在
同步原语（Primitive）的选择上与大多数语言不同，基于 Channel 和 Select 消息通信式同步是该语言
本身真正意义上的同步原语。进而「传统意义」上的原子、互斥、条件变量、线程本地资源等
概念在 Go 语言中蜕变为用户态的同步模式（Pattern），形成了语言独有的特色。
