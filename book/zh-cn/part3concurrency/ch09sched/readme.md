---
weight: 3100
title: "第 9 章 goroutine 调度器"
bookCollapseSection: true
---

# 第 9 章 goroutine 调度器

- [9.1 调度问题与 GMP 模型](./model.md)
- [9.2 工作窃取式调度](./steal.md)
- [9.3 MPG 模型与并发调度单元](./mpg.md)
- [9.4 调度循环](./schedule.md)
- [9.5 线程管理](./thread.md)
- [9.6 信号处理机制](./signal.md)
- [9.7 协作与抢占](./preemption.md)
- [9.8 系统监控](./sysmon.md)
- [9.9 网络轮询器](./poller.md)
- [9.10 计时器](./timer.md)
- [9.11 NUMA 感知与调度器的未来](./numa.md)
- [9.12 进一步阅读的参考文献](./ref.md)

（执行栈管理原属本章，现已移至 [第 14 章 执行栈管理](../../part4memory/ch14stack)。）


<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
性能提升不会凭空出现，它总是伴随着代码复杂度的上升。
</I></br>
<I>
The performance improvement does not materialize from the air, it 
comes with code complexity increase.
</I></br>
<div class="quote-right">
-- Dmitry Vyukov
</div>
</div>

Go 语言的调度器是笔者眼中整个运行时最迷人的组件了。
对于 Go 自身而言，它的设计和实现直接牵动了整个 Go 运行时的其他组件，是与用户态代码直接打交道的部分；
对于 Go 用户而言，调度器将极其复杂的运行时机制隐藏在了一个简单的关键字 `go` 之下。
为了保证高性能，调度器必须有效的利用计算的并行性和局部性原理；为了保证用户态的简洁，
调度器必须高效的对调度用户态不可见的网络轮询器、垃圾回收器进行调度；为了保证代码
执行的正确性，还必须严格的实现用户态代码的内存顺序等等。
总而言之，调度器的设计直接决定了 Go 运行时源码的表现形式。
