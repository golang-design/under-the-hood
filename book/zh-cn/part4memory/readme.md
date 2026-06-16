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

内存管理是运行时最隐秘、也最影响体感的部分：它在程序员看不见的地方决定着延迟、吞吐与可伸缩性。
这篇奠基性论文用「协作」二字道破了现代并发垃圾回收的本质，
回收器不再独占世界并粗暴地停顿程序，而是与不断产生垃圾的用户代码一同前进，彼此让步、彼此配合。
本部分正是沿着这条线索展开：先看内存分配器如何在多核之上以无锁的快路径切分与复用内存，
再深入垃圾回收器的三色标记、写屏障与并发回收，理解 Go 如何把停顿压到亚毫秒级，
最后回到每个 goroutine 的执行栈，看栈的按需增长与收缩如何支撑起百万级协程。
分配、回收与栈，三者共同构成了支撑 Go 程序运行的内存基座。
