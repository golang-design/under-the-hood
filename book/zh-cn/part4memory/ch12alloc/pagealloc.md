---
weight: 4107
title: "12.7 页分配器"
---

# 12.7 页分配器

mheap（[12.2](./component.md)）之下，管理"哪些页空闲、哪些已用"的，是**页分配器**。它是整个
分配器的地基,所有 span 的页最终都从这里来。这一节看它的设计，以及 Go 1.14 那次把它从树形
结构换成位图加基数树的重写,这是一个"换数据结构换性能"的好例子。

## 12.7.1 问题：高效地找连续空闲页

页分配器要回答的核心问题是：**快速找到一段足够长的连续空闲页**（一个 span 需要连续的页），
并支持分配与归还。早期 Go 用一个 **treap**（树堆）按空闲块大小组织空闲页,能找，但树形结构有
两个软肋：操作是 $O(\log n)$、且涉及指针追逐与全局锁，在大堆、高并发分配下成为瓶颈。

## 12.7.2 Go 1.14 的重写：位图加基数树

Go 1.14 把页分配器重写为基于**位图 + 基数树（radix tree）**的结构,这是页分配器性能的一次
飞跃。核心思想：用一个巨大的**位图**记录每一页的空闲/占用状态（一页一位），找连续空闲页就变成
"在位图里找一段连续的 0"。但堆很大时，逐位扫描位图太慢，于是在位图之上叠一棵**基数树的摘要
（summary）**：树的每个节点概括它覆盖的那段位图里"最长的连续空闲页有多长、开头结尾各空多少"。
找一段长度为 N 的连续空闲页时，自顶向下沿摘要树走，跳过那些"最长空闲段都不够 N"的子树，
迅速定位到候选区域，再到位图里精确确定。

这套结构的好处：查找接近 $O(1)$ 摊还（树高是常数级，摘要让大段跳过成为可能）、缓存友好
（位图连续）、且为更细粒度的锁与并发归还创造了条件。它和 [11.7](../../part3concurrency/ch11sync/map.md)
的字典树、[9.10](../../part3concurrency/ch09sched/timer.md) 的堆一样，是"选对数据结构带来质变"
的又一个范例。

## 12.7.3 归还内存给操作系统

页分配器还负责把长期空闲的页**归还操作系统**（scavenging）。Go 不会一空闲就立刻归还,频繁的
归还与重新申请代价高、还会和操作系统的内存管理打架。它采取更克制的策略：后台的 scavenger
（受 `sysmon` 驱动，[9.8](../../part3concurrency/ch09sched/sysmon.md)）渐进地把闲置时间足够长的
页用 `madvise` 等机制交还，配合 Go 1.16 引入、Go 1.19 完善的**软内存上限**（`GOMEMLIMIT`）来
平衡"占着内存复用更快"与"还给系统更省"。归还策略的演进，是 Go 在"内存占用"与"分配速度"
之间持续调校的缩影,这条张力贯穿整个内存系统。

## 延伸阅读的文献

1. Michael Knyszek. *Proposal: Scalable page allocator*（Go 1.14 页分配器重写）.
   https://go.googlesource.com/proposal/+/master/design/35112-scaling-the-page-allocator.md
2. The Go Authors. *runtime/mpagealloc.go、mpagecache.go.*
   https://github.com/golang/go/blob/master/src/runtime/mpagealloc.go
3. Michael Knyszek. *Proposal: Soft memory limit (GOMEMLIMIT)*（Go 1.19）.
   https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md
4. 本书 [12.2 组件](./component.md)、[13 垃圾回收](../../part4memory/ch13gc).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
