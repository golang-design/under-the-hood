---
weight: 3200
title: "第 10 章 通道与 select"
bookCollapseSection: true
---

# 第 10 章 通道与 select

> 本章配有一个线上演讲：[YouTube 在线](https://www.youtube.com/watch?v=d7fFCGGn0Wc)，
> [Google Slides 讲稿](https://changkun.de/s/chansrc/)。

- [10.1 通道与 CSP 的工程化](./model.md)
- [10.2 hchan：通道的内部结构](./impl.md)
- [10.3 收发与直接传递](./sendrecv.md)
- [10.4 关闭的语义](./close.md)
- [10.5 select 的实现](./select.md)
- [10.6 内存模型与无锁演进](./lockfree.md)
- [10.7 工程实践与跨语言对照](./pattern.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>通道用以编排，互斥锁用以串行。</I></br>
<I>Channels orchestrate; mutexes serialize.</I></br>
<div class="quote-right">
-- Rob Pike, "Go Proverbs", Gopherfest SV 2015
</div>
</div>

「不要通过共享内存来通信，而应通过通信来共享内存」是 Go 并发编程中流传最广的一句格言，channel
是它在语言中的落实：一次发送与相应的一次接收，既传递了数据，也同步了两个 goroutine。CSP 的思想渊源已在
[1.3](../../part1overview/ch01intro/csp.md) 讨论，本章关注 channel 与 `select` 在运行时中的实现：channel
在内存中的结构，一次收发如何在两个 goroutine 之间完成，关闭如何通知所有等待者，`select`
如何在多个通信操作中公平地选出一个而不产生死锁，以及这些操作如何满足内存模型的要求。

Pike 的格言说明了 channel 的定位：它不是另一种锁，而是组织 goroutine 之间协作的手段。值得注意的是，
运行时实现 channel 所用的，恰恰是格言另一半中的互斥锁。本章从 channel 的语义与数据结构出发，依次讨论收发、
关闭与 `select` 的实现，再在 10.6 中说明 channel 为何至今仍是一个有锁的结构，最后在 10.7 中讨论何时该用
channel、何时该用锁，并与其他语言中的同类机制作比较。
