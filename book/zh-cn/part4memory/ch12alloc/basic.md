---
weight: 4101
title: "12.1 设计原则"
---

# 12.1 设计原则

每一次 `new`、每一个逃逸到堆上的变量、每一个 `make` 的切片，背后都是内存分配器在工作。它必须
同时满足几个互相拉扯的目标：**快**（分配是高频操作，不能慢）、**可扩展**（多核下不能因争锁而
退化）、**省**（碎片要少）、**且配合 GC**（分配出的内存要能被垃圾回收器追踪）。这一节讲清 Go
分配器为达成这些目标所选的核心原则,后续各节是它们的展开。

## 12.1.1 脱胎于 tcmalloc

Go 的分配器源自 Google 的 **tcmalloc**（thread-caching malloc）。tcmalloc 的核心洞察是：
绝大多数分配是小对象、且高频,若每次都去抢一把全局锁，多核下必然崩溃。它的解法是**线程本地
缓存**：每个线程（在 Go 里是每个 P）有一份私有的小对象缓存，分配小对象时直接从本地缓存拿，
**完全无锁**;只有本地缓存空了，才去更上层、加锁的结构补货。这个"快路径无锁、慢路径才加锁"的
分层思想，与 Go 调度器（[9.2](../../part3concurrency/ch09sched/steal.md)）、`sync.Pool`
（[11.6](../../part3concurrency/ch11sync/pool.md)）的每 P 分片如出一辙,是 Go 应对多核扩展性的
统一招式。

## 12.1.2 尺寸类：用规整换效率

分配器不会精确地分配你要的字节数，而是把大小**归整到一组预定义的尺寸类**（size class）。go1.26
约有 70 个尺寸类（8、16、24、32、48……直到 32KB）。申请 17 字节，实际给你 24 字节那一类。
这样做牺牲了一点空间（**内部碎片**），换来巨大的好处：同一尺寸类的对象大小一致，可以从一段
连续内存（一个 **span**）里像切豆腐一样等分出来，分配与回收都只是改几个位标记，无需复杂的
空闲链表合并。尺寸类的设计是一门平衡艺术,类分得越细碎片越小、但元数据越多，Go 选的这套
经过精心调校，把最坏内部碎片控制在约 12.5% 以内。

## 12.1.3 三类对象，三条路径

按大小，分配走三条不同的路（[12.4](./largealloc.md)–[12.6](./tinyalloc.md)）：**微对象**
（< 16 字节且无指针）被**合并**进一个小块以减少浪费;**小对象**（16 字节 ~ 32KB）走尺寸类
缓存的主路径;**大对象**（> 32KB）直接向堆按页申请。三条路对应三种典型场景的优化,小整数包装、
大缓冲区、海量小结构体，各得其所。

## 12.1.4 与 GC 共生

分配器不是孤立的,它与垃圾回收器（[13 垃圾回收](../../part4memory/ch13gc)）**深度共生**。每个
span 记录着其中对象的类型与存活位图，供 GC 扫描与清扫;分配本身还参与 GC 的**步调**
（[13.x pacing](../../part4memory/ch13gc)）,分配得越快，GC 触发得越勤。可以说，分配器与回收器
是同一套内存管理系统的两面：一个负责"给"，一个负责"收"，共享着 span、位图、尺寸类这些
基础设施。本章讲"给"，下一章讲"收"，但它们始终是一体的。

## 延伸阅读的文献

1. Sanjay Ghemawat, Paul Menage. *TCMalloc: Thread-Caching Malloc.*
   https://google.github.io/tcmalloc/design.html
2. The Go Authors. *runtime/malloc.go（分配器总览注释）.*
   https://github.com/golang/go/blob/master/src/runtime/malloc.go
3. The Go Authors. *runtime/sizeclasses.go（尺寸类表）.*
   https://github.com/golang/go/blob/master/src/runtime/sizeclasses.go
4. 本书 [12.2 组件](./component.md)、[13 垃圾回收](../../part4memory/ch13gc).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
