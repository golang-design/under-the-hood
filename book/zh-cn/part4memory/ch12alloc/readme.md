---
weight: 4100
title: "第 12 章 内存分配器"
bookCollapseSection: true
---

# 第 12 章 内存分配器

- [12.1 设计原则](./basic.md)
- [12.2 组件](./component.md)
- [12.3 初始化](./init.md)
- [12.4 大对象分配](./largealloc.md)
- [12.5 小对象分配](./smallalloc.md)
- [12.6 微对象分配](./tinyalloc.md)
- [12.7 页分配器](./pagealloc.md)
- [12.8 内存统计](./mstats.md)
- [12.9 过去、现在与未来](./history.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>内存分配被普遍认为要么是一个已经解决的问题，要么是一个无法解决的问题。</I></br>
<I>Memory allocation is widely considered to be either a solved problem or an insoluble one.</I></br>
<div class="quote-right">
-- Paul R. Wilson et al., "Dynamic Storage Allocation: A Survey and Critical Review", 1995
</div>
</div>

这句话出自 Wilson 等人 1995 年那篇综述的摘要。综述接着指出，以往的理论分析与实验评测大多假设程序的请求
随机而相互独立，真实程序的行为却有重要的规律，分配器只有利用这些规律，才能在实践中表现良好。Go
的分配器还要多面对一层约束：Go 没有显式的 `free`，对象何时可以重用由垃圾回收器决定，回收器又不移动对象，
因此分配器必须与回收器一同设计，碎片也只能在分配时加以控制。

[12.1](./basic.md) 讨论分配器需要兼顾的目标、它从 TCMalloc 继承的结构，以及尺寸类与按大小、类型分流的
设计。[12.2](./component.md) 介绍 `mspan`、`mcache`、`mcentral`、`mheap` 等组件及其协作。
[12.3](./init.md) 讨论启动时的初始化、地址空间的划分，以及内存的预留、映射与提交。[12.4](./largealloc.md)
至 [12.6](./tinyalloc.md) 依次讨论大对象、小对象与微对象的分配路径。[12.7](./pagealloc.md)
讨论以位图与基数树管理页的页分配器，以及向操作系统归还物理内存的 scavenger。[12.8](./mstats.md)
讨论运行时如何统计内存，并经由 `runtime.ReadMemStats`、`runtime/metrics` 与堆剖面对外报告。
[12.9](./history.md) 按时间回顾分配器的演进。回收器的实现见[第 13 章](../ch13gc/readme.md)，
goroutine 执行栈的分配见[第 14 章](../ch14stack/readme.md)。
