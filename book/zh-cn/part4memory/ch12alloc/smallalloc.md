---
weight: 4105
title: "12.5 小对象分配"
---

# 12.5 小对象分配

16 字节到 32KB 的小对象，是分配器的**主战场**,绝大多数分配落在这里，分配器的精巧也都为它而设。
这一节走一遍小对象分配的完整路径，它是 [12.2](./component.md) 那条补货链的具体演出。

## 12.5.1 三步走

分配一个小对象，运行时做三件事：

1. **定尺寸类**：把请求大小向上归整到最近的尺寸类（[12.1](./basic.md)）,17 字节归到 24 字节那类。
   这一步用一张预计算的查表，$O(1)$。
2. **从 mcache 取**：到当前 P 的 mcache（[9.3](../../part3concurrency/ch09sched/mpg.md)）里，找到
   该尺寸类对应的 span，从它的空闲槽位图里摘一个空槽返回。**全程无锁**,这是绝大多数分配走完
   就结束的快路径。
3. **补货（慢路径）**：若该尺寸类的 span 已无空槽，就向对应的 mcentral（加锁）换一个有空槽的
   span;mcentral 也没有，就向 mheap 要新页来切出一个 span。补完货，回到第 2 步取槽。

整条路径的精髓，就是把"最常见的情况"（本地有空槽）做成无锁的几条指令，把"偶尔的情况"
（本地用尽）才推给加锁的上层。

## 12.5.2 span 内的分配：位图取槽

一个 span 是同尺寸类对象的"宿舍楼",它用一个**空闲位图**（`allocBits` / `allocCache`）记录哪些
槽空着。分配就是在位图里找一个空位、置位、返回该槽地址。go1.26 用一个缓存的位段
（`allocCache`）加速"找下一个空槽"，使常见情况只需几条位运算。回收（清扫，
[13.x](../../part4memory/ch13gc)）则是 GC 根据存活标记重置位图,死对象的槽被重新标记为空，
可供再分配。这种"位图取槽"之所以高效，正得益于尺寸类带来的规整：同一 span 内对象等大，
槽与位一一对应，分配和回收都退化成位操作。

## 12.5.3 为何这条路如此重要

小对象分配的性能，几乎决定了 Go 程序的整体内存性能,因为它太高频了。这条路径的每一处设计，
都是为"让最常见的分配尽可能快"服务：尺寸类让定位 $O(1)$、每 P 的 mcache 让快路径无锁、
位图取槽让 span 内分配只是位运算。理解了它，就理解了为什么 Go 里"随手 new 一个小结构体"
几乎不花成本,以及为什么真正的内存性能问题，往往不在单次分配的速度，而在**分配的总次数**
（逃逸分析、对象复用，见 [15.escape](../../part5toolchain/ch15compile) 与
[11.6](../../part3concurrency/ch11sync/pool.md)）与它给 GC 带来的压力。微对象（< 16 字节）还有
一条更省的特殊路径，见 [12.6](./tinyalloc.md)。

## 延伸阅读的文献

1. The Go Authors. *runtime/malloc.go：mallocgc 小对象路径；mcache.nextFree.*
   https://github.com/golang/go/blob/master/src/runtime/malloc.go
2. The Go Authors. *runtime/mbitmap.go：span 的 allocBits / allocCache.*
   https://github.com/golang/go/blob/master/src/runtime/mbitmap.go
3. 本书 [12.2 组件](./component.md)、[12.6 微对象分配](./tinyalloc.md)、
   [13 垃圾回收](../../part4memory/ch13gc).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
