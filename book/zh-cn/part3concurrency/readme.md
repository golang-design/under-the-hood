---
weight: 3000
title: "第三部分 并发"
bookCollapseSection: true
---

# 第三部分 并发

- [第 9 章 goroutine 调度器](./ch09sched)
- [第 10 章 通道与 select](./ch10chan)
- [第 11 章 同步原语与模式](./ch11sync)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>不要通过共享内存来通信，而要通过通信来共享内存。</I></br>
<I>Don't communicate by sharing memory, share memory by communicating.</I></br>
<div class="quote-right">
-- Rob Pike, "Go Proverbs"
</div>
</div>

Go 在语言层面直接支持并发：`go` 语句启动一个 goroutine，通道在 goroutine 之间传递值，`select`
在多个通信操作中择一执行。这组构造源自 Hoare 的通信顺序进程（[1.3](../part1overview/ch01intro/csp.md)）。
上面这句箴言出自 Pike 在 2015 年 Gopherfest SV 上的演讲，概括了与之相应的编程方式：让数据的所有权随消息在
goroutine 之间转移，而不是让多个 goroutine 在锁的保护下共同访问同一份状态。

本部分自底向上讨论这些构造的实现。第 9 章讨论调度器如何把大量 goroutine 复用到少量操作系统线程之上，
以及抢占、系统监控、网络轮询与计时器等配套机制；第 10 章讨论通道与 `select` 的数据结构，以及发送、接收、
关闭与多路选择的实现；第 11 章讨论 `sync` 包提供的互斥锁、条件变量、同步组等同步原语，以及原子操作、
上下文与 Go 的内存模型。通信与共享内存并不互斥：通道本身就由一把锁保护，许多场景中互斥锁仍是更直接的选择。
理解二者的实现与代价，才能在具体问题中作出恰当的选择。
