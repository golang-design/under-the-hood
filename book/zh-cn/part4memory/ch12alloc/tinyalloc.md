---
weight: 4106
title: "12.6 微对象分配"
---

# 12.6 微对象分配

小于 **16 字节且不含指针**的对象,典型如一个 `int`、一个小字符串的底层字节、一个布尔包装,
有一条更省的特殊路径：**微对象分配器**（tiny allocator）。这一节看它如何把许多微小的对象塞进
一个块里，以减少浪费。

## 12.6.1 把零碎拼起来

问题在于：若按尺寸类（[12.1](./basic.md)）分配，一个 1 字节的对象也得占最小的 8 字节那一类,
对海量微对象，这种浪费会累积成可观的内部碎片。微对象分配器的解法是**合并**：mcache 里维护一个
当前的 **tiny 块**（16 字节）和一个偏移量;分配微对象时，先看当前 tiny 块剩下的空间够不够，
够就直接在偏移处划一小段、推进偏移,**多个微对象因此共享同一个 16 字节块**。只有当前 tiny 块
装不下了，才取一个新的 16 字节块。这样，几个原本各占 8 字节的微对象，可能被紧凑地装进同一个
16 字节块里。

## 12.6.2 为什么必须无指针

微对象分配有一条硬性前提：**对象不能含指针**。原因牵涉垃圾回收（[13 垃圾回收](../../part4memory/ch13gc)）：
GC 以对象为单位追踪存活与扫描指针，而 tiny 块里塞了多个逻辑上独立的对象,若它们含指针，GC
就无法干净地分辨"块里哪个子对象还活着、哪些指针该扫描"。把微对象限定为**无指针**（纯标量数据），
就回避了这个难题,整个 tiny 块要么作为一团无指针数据被整体处理，GC 无需深入其内部结构。
这是一处典型的"用约束换简单"：放弃对含指针微对象的合并，换来 GC 逻辑的清爽。

## 12.6.3 一个不起眼却普遍的优化

微对象看似边角料，实则极其普遍,字符串与字节切片的小片段、`for range` 里的小临时值、众多小
标量，都可能走这条路。tiny 分配器让这些零碎不至于每个都浪费一个尺寸类的最小块，在分配密集的
程序里能实打实地降低内存占用与 GC 压力。它和大对象的"直取直还"（[12.4](./largealloc.md)）、
小对象的"尺寸类缓存"（[12.5](./smallalloc.md)）一起，构成了 Go 分配器**因材施教**的三条路,
对不同大小、不同特征的对象，各用最合适的策略。这种对常见情形的精细照顾，正是一个成熟分配器
的功力所在。

## 延伸阅读的文献

1. The Go Authors. *runtime/malloc.go：mallocgc 的 tiny 分配分支与 mcache.tiny.*
   https://github.com/golang/go/blob/master/src/runtime/malloc.go
2. The Go Authors. *runtime/mcache.go：tiny / tinyoffset 字段.*
   https://github.com/golang/go/blob/master/src/runtime/mcache.go
3. 本书 [12.5 小对象分配](./smallalloc.md)、[12.4 大对象分配](./largealloc.md)、
   [13 垃圾回收](../../part4memory/ch13gc).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
