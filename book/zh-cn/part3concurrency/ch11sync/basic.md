---
weight: 3301
title: "11.1 共享内存式同步模式"
---

# 11.1 共享内存式同步模式

> 程序的构造可以用更简单的基础原语来表达，这一事实是一个有力的保障：这些原语所包含的内容，
> 能与程序语言的其余部分在逻辑上保持一致。
> ——  C. A. R. Hoare

## 11.1.1 并发的两大传统

并发编程历史上有两条大的传统。一条是**共享内存**：线程共享地址空间，靠互斥锁、信号量、条件
变量等手段协调对共享状态的访问,Dijkstra 1965 年的信号量、Hoare 1974 年的监管程是它的奠基石，
也是 C/C++、Java、操作系统内核的主流路数。另一条是**消息传递**：执行单元不共享状态，只通过
收发消息协调,Hoare 的 CSP（[10.1](../ch10chan)）与 Hewitt 的 Actor 模型是它的两支，Erlang、
occam 是它的代表。两条传统并非对立,Lauer 与 Needham 1979 年有一个著名论断："基于消息的系统
与基于共享内存（过程）的系统在表达能力上是对偶的、可互相转换的。" 区别更多在**何者更自然、
更不易错**。

Go 的立场很鲜明：它把消息传递（[channel](../ch10chan) 与 select）作为**语言层面的核心**，
凝成那句箴言"不要以共享内存的方式通信，而要以通信的方式共享内存"。但它并不否定共享内存,
传统的互斥、原子、条件变量、线程本地资源等，被降格为标准库 `sync` 与 `sync/atomic` 里的
**同步模式**（pattern）而非语言原语。有些问题，用一把锁保护一小段共享状态，比绕一圈用 channel
更直接、也更快;`sync` 包正是为这些场景准备的工具箱。

## 11.1.2 本章地图

本章逐一拆解这些共享内存式同步原语的实现与取舍,每一个都既讲清它解决什么问题，也讲清它
背后的理论传统与工程演进：

- **互斥锁**（[11.2](./mutex.md)）：最基本的临界区保护,从 Dijkstra 的互斥问题、futex 地基，
  到 Go 的正常/饥饿两种模式。
- **原子操作**（[11.3](./atomic.md)）：最贴近硬件的一层,共识层级、ABA、无锁谱系。
- **条件变量**（[11.4](./cond.md)）：等待条件成立,Hoare 与 Mesa 两种 signal 语义，以及为何
  在 Go 里常被 channel 取代。
- **同步组**（[11.5](./waitgroup.md)）：fork-join 的栅栏/计数闩。
- **缓存池**（[11.6](./pool.md)）：对象复用与 GC 减负,每 P 分片与 victim 缓存。
- **并发安全散列表**（[11.7](./map.md)）：并发散列表的解法谱系与 sync.Map 的两代实现。
- **上下文**（[11.8](./context.md)）：沿任务树传播取消与截止时间,协作式取消与结构化并发。
- **内存一致模型**（[11.9](./mem.md)）：上述一切之所以成立的底层契约。

读完本章会发现一条贯穿始终的主线：每一个原语都是在**正确、简单、性能**三者之间的一次具体
取舍，而 Go 的偏好始终是把简单与正确放在性能之前。这与 [9 调度器](../ch09sched)、
[10 通道](../ch10chan) 一脉相承,它们共同构成 Go 并发的全貌。

## 延伸阅读的文献

1. Edsger W. Dijkstra. "Cooperating Sequential Processes." 1968（信号量与共享内存同步）.
2. C. A. R. Hoare. "Monitors: An Operating System Structuring Concept." *CACM*, 17(10),
   1974. https://doi.org/10.1145/355620.361161
3. Hugh C. Lauer, Roger M. Needham. "On the Duality of Operating System Structures."
   *ACM SIGOPS OSR*, 13(2), 1979. https://doi.org/10.1145/850657.850658
   （消息传递与共享内存的对偶性）
4. The Go Authors. *The Go Memory Model.* https://go.dev/ref/mem ；
   *Effective Go：Share by communicating.* https://go.dev/doc/effective_go

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
