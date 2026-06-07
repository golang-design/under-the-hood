---
weight: 4108
title: "12.8 内存统计"
---

# 12.8 内存统计

分配器在工作的同时，还**记账**,记录分配了多少、堆有多大、GC 发生过几次。这些统计既供运行时
自己做决策（GC 步调、内存上限），也通过 `runtime.MemStats` 与 `runtime/metrics` 暴露给程序，
是诊断内存问题的第一手资料。这一节看它记了什么、怎么用。

## 12.8.1 记的是什么

运行时维护一组内存统计（`mstats`），关键的几项：**HeapAlloc**（当前存活对象占用的字节）、
**HeapSys**（向操作系统申请的堆地址空间）、**HeapInuse**（在用的 span 字节）、**HeapIdle**
（空闲的、可归还或复用的字节）、**HeapReleased**（已归还操作系统的字节）、以及 **NextGC**
（下一次 GC 的目标堆大小）、**NumGC**（GC 次数）、各阶段停顿时间等。这些数字大多由分配与清扫
路径**顺手更新**,每分配一个对象、每清扫一个 span，就在对应计数上记一笔。

需要分清几对容易混淆的量：**Sys 系列**（向操作系统要的地址空间，含大量未提交的保留，
[12.3](./init.md)）远大于**Alloc/Inuse 系列**（真实使用），这正是 [12.3](./init.md) 说的"虚拟
内存大不等于真在用"。看 Go 程序内存，HeapAlloc 与 HeapInuse 才反映真实占用。

## 12.8.2 两套接口：MemStats 与 metrics

历史上，程序通过 `runtime.ReadMemStats` 读一个 `MemStats` 结构体拿到这些数。但它有缺点：
字段固定（新指标难加）、且读取要 stop-the-world 一下、较重。Go 1.16 引入了更现代的
**`runtime/metrics`** 包：用"指标名 + 值"的可扩展方式暴露运行时指标（GC、内存、调度、
[16 工具与可观测性](../../part5toolchain/ch16tools)），新增指标无需改 API，读取也更轻。新代码
应优先用 `runtime/metrics`,它是 Go 可观测性现代化的一部分。

## 12.8.3 统计驱动决策

这些统计不只是给人看的，更是运行时自我调节的**输入**。GC 的步调器（[13.x pacing](../../part4memory/ch13gc)）
根据存活堆大小与分配速率，算出下次 GC 的触发点（NextGC），力求把 GC 开销维持在
`GOGC`（默认 100，即堆翻倍时回收）设定的目标附近;软内存上限 `GOMEMLIMIT`
（[12.7](./pagealloc.md)）也依赖这些统计来决定何时更激进地回收。换句话说，分配器记的账，
回过头来调节着分配与回收的节奏,记账与决策构成一个闭环。理解了这些统计的含义，既能读懂
`pprof`/`metrics` 里的内存画像，也能明白 `GOGC`/`GOMEMLIMIT` 这两个旋钮到底在拨动什么。

## 延伸阅读的文献

1. The Go Authors. *runtime.MemStats 文档.* https://pkg.go.dev/runtime#MemStats
2. The Go Authors. *runtime/metrics 包*（Go 1.16+）. https://pkg.go.dev/runtime/metrics
3. The Go Authors. *runtime/mstats.go.* https://github.com/golang/go/blob/master/src/runtime/mstats.go
4. 本书 [13 垃圾回收](../../part4memory/ch13gc)、
   [16 工具与可观测性](../../part5toolchain/ch16tools).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
