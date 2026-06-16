---
weight: 4300
title: "第 14 章 执行栈管理"
bookCollapseSection: true
---

# 第 14 章 执行栈管理

goroutine 廉价到可以同时存在百万个（[9.3](../../part3concurrency/ch09sched/mpg.md)），一个关键
原因藏在它的**栈**里。操作系统线程的栈通常一上来就预留以兆字节计的固定空间，百万个就是 TB
级，根本不可行。Go 的 goroutine 栈起步只有 **2KB**，且**按需增长**。这套「小而可增长」的栈，
是 goroutine 廉价的物理基础。本章讲清它如何设计、如何分配、如何增长与收缩，以及这背后从分段栈
到连续栈的设计演进。

- [14.1 连续栈的设计](./design.md)
- [14.2 栈的分配与缓存](./alloc.md)
- [14.3 栈的增长](./grow.md)
- [14.4 栈的拷贝与指针调整](./copy.md)
- [14.5 栈的收缩与演进](./shrink.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
为了把栈做小，Go 的运行时使用可伸缩、有界的栈。一个新生的 goroutine 只分到几 KB，这几乎总是够用的；
当它不够时，运行时会自动增长（与收缩）这块栈内存，从而让海量 goroutine 栖身于不大的内存里。
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

把栈做小、再让它按需伸缩，这一句话背后是一整套设计：栈在堆上由运行时托管而非绑死在线程上，
检查与抢占被压进函数序言的一条比较里，增长靠整段拷贝、收缩交给垃圾回收顺手完成。本章顺着这条线
拆解执行栈管理，从连续栈的设计取舍，到分配、增长、拷贝与指针调整，再到收缩与跨系统的演进坐标。
