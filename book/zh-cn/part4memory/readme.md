---
weight: 4000
title: "第四部分 内存"
bookCollapseSection: true
---

# 第四部分 内存

- [第 12 章 内存分配器](./ch12alloc)
- [第 13 章 垃圾回收器](./ch13gc)
- [第 14 章 执行栈管理](./ch14stack)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>随时回收的垃圾收集：一次关于协作的演练。</I></br>
<I>On-the-fly garbage collection: an exercise in cooperation.</I></br>
<div class="quote-right">
-- Edsger W. Dijkstra, Leslie Lamport, et al., Communications of the ACM (1978)
</div>
</div>

Go 程序员通过 `new`、`make` 与复合字面量申请内存，却从不显式释放它。内存从何而来、何时可以重用，
全由运行时决定，而这些决定直接影响程序的延迟、吞吐与内存占用。上面的引文是 Dijkstra、Lamport
等人 1978 年一篇论文的标题。这篇论文提出了三色标记，使回收器能够与不断修改指针的程序同时运行，
即所谓「随时」（on-the-fly）回收；Go 的并发回收器正建立在这一思想之上（[13.1](./ch13gc/basic.md)）。

本部分分为三章。第 12 章讨论内存分配器：它源自 TCMalloc，按对象大小分级，以每个 P
私有的缓存服务绝大多数分配，缓存耗尽时再逐级向中心缓存与页堆申请。第 13 章讨论垃圾回收器：
三色标记与写屏障、回收节奏的调控、标记与清扫的实现，以及终结器与 Green Tea 回收器等新近的演进。
第 14 章讨论 goroutine 的执行栈如何分配、增长与收缩。分配器决定对象放在哪里，回收器决定它们何时可以重用，
栈则承载不逃逸到堆上的数据，三者共同决定了 Go 程序的内存行为。
