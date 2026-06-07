---
weight: 4109
title: "12.9 过去、现在与未来"
---

# 12.9 过去、现在与未来

分配器不是一蹴而就的，它随 Go 的演化不断被打磨。回顾这条演进线，能看清当前设计是从哪些权衡里
长出来的，也能瞥见未来的方向。

## 12.9.1 过去：从 tcmalloc 到 Go 化

Go 分配器最初是 **tcmalloc**（[12.1](./basic.md)）的一个 Go 移植：继承了线程缓存、尺寸类、
中心仓库这套骨架。但它逐步"Go 化"，长出 tcmalloc 没有的东西,最根本的，是为**精确垃圾回收**
服务的元数据（每个 span 的指针位图、类型信息）。C 的 tcmalloc 服务于手动 `free`，无需知道
对象里哪里是指针;Go 的分配器必须与 GC 共生（[12.1](./basic.md)），所以每一块内存都带着供 GC
追踪的信息。这是 Go 分配器与其祖先最大的分野。

## 12.9.2 现在：几次关键重写

近年几次重写显著改善了它：

- **Go 1.12**：把面向 OS 的内存归还（scavenging）做得更平滑，缓解了内存"还得太猛或太懒"的问题。
- **Go 1.14**：**页分配器重写**为位图加基数树（[12.7](./pagealloc.md)），大幅提升大堆、高并发下
  的分配扩展性。
- **Go 1.16 / 1.19**：`runtime/metrics`（[12.8](./mstats.md)）与**软内存上限 `GOMEMLIMIT`**
  （[12.7](./pagealloc.md)），让内存行为更可观测、可控。
- **持续**：对象元数据的布局也几经调整（如把指针位图从堆外集中存储改为对象头部的方式），
  以改善缓存局部性与 GC 扫描效率。

## 12.9.3 未来：与 GC 的协同演进

分配器的未来，与垃圾回收器（[13 垃圾回收](../../part4memory/ch13gc)）的未来紧紧绑在一起,因为
二者本是一体（[12.1](./basic.md)）。Go 1.25/1.26 的 **Green Tea GC**（一种更注重内存局部性、
以 span/页为粒度组织扫描的回收器，见 [13 垃圾回收](../../part4memory/ch13gc)）就同时影响着分配
布局与回收方式,它要求分配器以更利于"成块扫描"的方式组织对象。可以预见，分配器会继续朝着
"更好的局部性、更低的元数据开销、与 GC 更紧的协同"演进。回看这条历史，会发现一条不变的主线：
**每一次改动，都是在分配速度、内存占用、GC 友好这三者之间重新寻找平衡**,这正是
[12.1](./basic.md) 立下的那组目标，在时间里不断被重新平衡的过程。

## 延伸阅读的文献

1. The Go Authors. *Go GC / runtime release notes*（1.12/1.14/1.16/1.19 内存相关）.
   https://go.dev/doc/devel/release
2. Michael Knyszek. *Scalable page allocator / Soft memory limit 提案.*
   https://go.googlesource.com/proposal/+/master/design/35112-scaling-the-page-allocator.md
3. The Go Team. *Green Tea GC 设计讨论*（go1.25/1.26）.
   https://github.com/golang/go/issues/73581
4. 本书 [12.1 设计原则](./basic.md)、[13 垃圾回收](../../part4memory/ch13gc).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
