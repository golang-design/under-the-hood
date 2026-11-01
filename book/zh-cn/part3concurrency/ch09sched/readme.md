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

调度器是 Go 运行时中与用户代码关系最密切的组件。程序员只写下一个 `go` 关键字，调度器便要决定这个
goroutine 在哪个操作系统线程上、何时运行，何时让出处理器；它阻塞于系统调用、网络 I/O 或计时器时如何挂起，
条件满足后又如何恢复。为了获得良好的性能，调度器必须同时利用多核的并行性与缓存的局部性；
它还要与垃圾回收器、网络轮询器等用户不可见的运行时组件协同，并保证用户代码所依赖的内存顺序。笔者认为，
调度器是整个运行时中最值得细读的部分，运行时其他组件的许多设计，都要从调度器的角度才能理解。

本章的讨论分为三个层次。9.1 至 9.4 讨论调度的基本模型：调度问题与 GMP 模型的由来、工作窃取算法及其理论
保证、G、M、P 三种调度单元的结构，以及调度循环的执行过程。9.5 至 9.8 讨论调度器与操作系统的交互：线程的
创建与复用、信号处理、协作式与异步抢占，以及在后台巡视整个运行时的系统监控。9.9 至 9.11 讨论 goroutine
所等待的外部事件如何被管理，即网络轮询器与计时器，最后讨论 NUMA 感知调度这一设计完整却未曾落地的方案，以及
调度器尚待解决的问题。
