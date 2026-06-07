---
weight: 4103
title: "12.3 初始化"
---

# 12.3 初始化

分配器在程序启动的 `schedinit`（[3.5](../../part1overview/ch03life/boot.md)）阶段由 `mallocinit`
完成奠基。这一节看它启动时铺设的内存版图,尤其是"虚拟地址空间"与"物理内存"的分离，这是
理解 Go 内存占用的关键。

## 12.3.1 arena：以巨块组织地址空间

Go 把堆的地址空间切成固定大小的 **arena**（64 位平台上每个 64MB）。arena 是地址空间管理的
基本粒度,堆按需一个个 arena 地扩张。每个 arena 配有一份**元数据**：记录其中每个字是否为指针的
位图（供 GC 扫描，[13 垃圾回收](../../part4memory/ch13gc)）、以及指向各 span 的索引。这套
"arena + 元数据"的布局，让运行时能从任意一个堆地址快速反查出"它属于哪个 span、是不是指针、
是否存活",这些查询是 GC 与分配的高频操作。

## 12.3.2 保留 vs 提交：虚拟内存的两段式

一个常让人误解 Go 内存占用的点，是**保留**（reserve）与**提交**（commit）的区别。`mallocinit`
会向操作系统**保留**一大片虚拟地址空间,但保留只是"占个号"，并不真正消耗物理内存。只有当某段
地址真正被写入时，操作系统才**提交**物理页给它。所以你可能看到一个 Go 进程的虚拟内存
（VIRT）很大、而实际驻留内存（RES）小得多,这通常不是泄漏，而是分配器预留了地址空间以备
增长。这种"先廉价地占地址、用时才费物理内存"的两段式，是现代分配器的通行做法,它让堆能在
一片连续的地址区间里平滑增长，避免地址碎片。

## 12.3.3 启动即就位

`mallocinit` 跑完，分配器的骨架就立起来了：arena 的组织方式确定、元数据结构就位、页分配器
（[12.7](./pagealloc.md)）初始化、各级缓存（mcache 随 P 创建、mcentral 按尺寸类建立）准备完毕。
此后程序的每一次分配，都是在这套版图上取一块、记一笔。把初始化看清楚，就明白了 Go 程序
"还没怎么干活内存就占了一截"的由来,那多半是地址保留与元数据，而非真实的堆使用。本章接下来
三节，走一遍在这套版图上分配大、小、微对象的具体路径。

## 延伸阅读的文献

1. The Go Authors. *runtime/malloc.go：mallocinit / arena 布局.*
   https://github.com/golang/go/blob/master/src/runtime/malloc.go
2. The Go Authors. *runtime/mheap.go：heapArena.*
   https://github.com/golang/go/blob/master/src/runtime/mheap.go
3. 本书 [3.5 启动引导](../../part1overview/ch03life/boot.md)、[12.7 页分配器](./pagealloc.md)、
   [13 垃圾回收](../../part4memory/ch13gc).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
