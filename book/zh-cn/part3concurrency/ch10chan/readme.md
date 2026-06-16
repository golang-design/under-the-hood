---
weight: 3200
title: "第 10 章 通道与 select"
bookCollapseSection: true
---

# 第 10 章 通道与 select

> 本章配有一个线上演讲：[YouTube 在线](https://www.youtube.com/watch?v=d7fFCGGn0Wc)，
> [Google Slides 讲稿](https://changkun.de/s/chansrc/)。

「不要以共享内存的方式通信，而要以通信的方式共享内存。」这句广为流传的格言，是 Go 并发哲学的
浓缩。channel 正是这句话的载体，它把同步与数据传递合二为一。CSP 的思想渊源已在
[1.3 顺序进程通讯](../../part1overview/ch01intro/csp.md) 交代，本章不再重复，而是聚焦于 channel
与 select 在运行时里**究竟如何实现**：一个 channel 在内存里长什么样、一次收发如何在两个
goroutine 间会合、关闭如何广播、`select` 如何在多路通信间公平而无死锁地择一，以及这套机制
为何选择有锁、又如何与内存模型咬合。

- [10.1 通道与 CSP 的工程化](./model.md)
- [10.2 hchan：通道的内部结构](./impl.md)
- [10.3 收发与直接传递](./sendrecv.md)
- [10.4 关闭的语义](./close.md)
- [10.5 select 的实现](./select.md)
- [10.6 内存模型与无锁演进](./lockfree.md)
- [10.7 工程实践与跨语言对照](./pattern.md)
