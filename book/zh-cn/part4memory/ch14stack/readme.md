---
weight: 4300
title: "第 14 章 执行栈管理"
bookCollapseSection: true
---

# 第 14 章 执行栈管理

- [14.1 连续栈的设计](./design.md)
- [14.2 栈的分配与缓存](./alloc.md)
- [14.3 栈的增长](./grow.md)
- [14.4 栈的拷贝与指针调整](./copy.md)
- [14.5 栈的收缩与演进](./shrink.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
为了使栈保持很小，Go 的运行时采用大小可调而有上限的栈。新创建的 goroutine 只分得几千字节，
这几乎总是够用的；不够时，运行时会自动增大（以及缩小）存放栈的内存，使大量 goroutine
得以容身于不大的内存之中。
</I></br>
<I>
To make the stacks small, Go's run-time uses resizable, bounded stacks. A newly minted
goroutine is given a few kilobytes, which is almost always enough. When it isn't, the
run-time grows (and shrinks) the memory for storing the stack automatically, allowing
many goroutines to live in a modest amount of memory.
</I></br>
<div class="quote-right">
-- The Go Authors, "Go FAQ: Why goroutines instead of threads?"
</div>
</div>

Go FAQ 在解释为何采用 goroutine 而非线程时写下了这段话，随后又补充两点：这样做的 CPU
开销平均每次函数调用约为三条廉价的指令；在同一地址空间中创建数十万个 goroutine 是可行的，而如果 goroutine
只是线程，系统资源在数量小得多时就会耗尽。这几句话涵盖了本章的主要内容：栈从很小开始，按需增大或缩小；
调整由每个函数开头的一项检查触发，代价就是那几条指令；栈的大小则受一个上限约束。与线程栈不同，goroutine
的**栈**（stack）不由操作系统提供，而是运行时从页堆中分配的一段连续内存，
必要时可以整体迁移到别处（[9.3](../../part3concurrency/ch09sched/mpg.md)）。

[14.1](./design.md) 介绍栈在运行时中的表示，以及 Go 从分段栈改为连续栈的经过与理由。[14.2](./alloc.md)
讨论栈的分配：按 P 划分的本地缓存、全局栈池、大栈的处理，以及 Go 1.19 起根据平均栈用量确定的初始大小。
[14.3](./grow.md) 讨论栈的增长：函数序言中的检查（指令层面的细节见
[2.4](../../part1overview/ch02asm/args.md)）如何经由 `morestack` 进入 `newstack`，新栈的大小如何确定，
以及栈的上限。[14.4](./copy.md) 讨论栈的拷贝：运行时如何借助编译器生成的栈映射，
找到并调整所有指向旧栈的指针，如何与并发的 channel 操作同步，这些要求又如何反过来约束了逃逸分析与
`unsafe` 的使用规则。[14.5](./shrink.md) 讨论栈的收缩：它为何在垃圾回收扫描栈时进行、何时必须推迟，
减半与四分之一的判据带来怎样的空间保证，最后与操作系统线程、Rust 和 Java 虚拟线程的做法作比较。
借用栈检查实现的协作式抢占见 [9.7](../../part3concurrency/ch09sched/preemption.md)。
