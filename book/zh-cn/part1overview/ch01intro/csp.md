---
weight: 1103
title: "1.3 顺序进程通讯"
---

# 1.3 顺序进程通讯

Go 并发模型的思想源头，是 Hoare 1978 年提出的**顺序进程通讯**（Communicating Sequential
Processes, CSP）。这一节从思想史的角度交代这份血脉,它解释了 goroutine 与 channel 为何是
今天这个样子。channel 与 select 的实现细节、CSP 与 Actor 的精确对比，留待
[10.1](../../part3concurrency/ch10chan)展开;这里关心的是"为什么是 CSP"。

## 1.3.1 CSP 的核心主张

CSP 的核心是一句反直觉的口号：**进程之间不共享状态，只通过传递消息来协调。** 在共享内存的
世界里，多个线程读写同一块内存，靠锁来防止彼此踩踏,这既危险（数据竞争、死锁）又难以推理。
CSP 反其道而行：每个顺序进程守着自己的状态，要协作就**发消息**，通过一个同步的通信动作来交接
数据与控制。Go 把这条主张凝成那句广为人知的格言："**不要以共享内存的方式通信，而要以通信的
方式共享内存。**"

需要澄清一处史实（详见 [10.1](../../part3concurrency/ch10chan)）：Hoare 1978 的原始 CSP 其实
**没有**第一类的 channel,通信按进程名寻址;作为可传递实体的 channel，是 1985 年的专著与 occam
语言才确立的。Go 继承的，更接近这条后期的、以 channel 为中心的脉络。

## 1.3.2 Go 对 CSP 的取舍

Go 没有照搬 CSP，而是做了务实的改造，每一处改动都体现它的工程口味：

- **不是纯 CSP**：Go **保留**了共享内存与锁（[11 同步](../../part3concurrency/ch11sync)）。它把
  CSP 作为**首选**而非**唯一**,该用 channel 表达通信时用 channel，该用锁保护一小块状态时用锁
  （[10.9](../../part3concurrency/ch10chan)）。这种"不教条"正是 Go 的风格。
- **channel 是第一类值**：可以传递、存储、经 channel 发送 channel,这让通信拓扑能在运行时变化，
  比原始 CSP 灵活。
- **goroutine 极廉价**：CSP 的"进程"在 Go 里是 goroutine（[9.3](../../part3concurrency/ch09sched/mpg.md)），
  起步仅 2KB 栈，可同时存在百万计,这让"为每件并发的事开一个进程"从理论上的优雅变成实践中的
  可行。
- **select 即守卫选择**：occam 的 `ALT` 在 Go 里成了 `select`,在多个通信中择一而动。

## 1.3.3 为什么这条血脉重要

选择 CSP 而非别的并发范式（如 Actor 模型，见 [10.1](../../part3concurrency/ch10chan)），深刻
塑造了 Go 程序的样貌。它鼓励你把并发程序想象成"一组各自顺序执行、彼此用 channel 连接的小
进程",数据沿 channel 流动，所有权随之转移，竞争与锁的心智负担因此大为减轻。这与 Go 整体的
"显式、简单"哲学（[1.2](./go.md)）一脉相承,通信是显式的（你看得见 channel），并发单元是廉价
而独立的。理解了 CSP 这份思想血脉，再去读 [9 调度器](../../part3concurrency/ch09sched) 与
[10 通道](../../part3concurrency/ch10chan)，就能既见树木（实现细节）、又见森林（为何如此设计）。

## 延伸阅读的文献

1. C. A. R. Hoare. "Communicating Sequential Processes." *CACM*, 21(8), 1978.
   https://doi.org/10.1145/359576.359585 ；专著：Prentice Hall, 1985.
2. Rob Pike. *Concurrency Is Not Parallelism.* 2012. https://go.dev/blog/waza-talk
3. The Go Authors. *Share Memory By Communicating.* https://go.dev/blog/codelab-share
4. 本书 [10.1 CSP 的思想与谱系](../../part3concurrency/ch10chan)（CSP/π-演算/Actor 的深入对比）.

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
