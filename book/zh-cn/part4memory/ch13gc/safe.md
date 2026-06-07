---
weight: 4207
title: "13.7 安全点分析"
---

# 13.7 安全点分析

GC 要扫描一个 goroutine 的栈、要让所有 goroutine 配合开启写屏障，都需要在它们停于**安全点**
时进行,只有此刻，运行时才确切知道栈上每个槽是不是活指针。安全点这个概念在调度的抢占一节
（[9.7](../../part3concurrency/ch09sched/preemption.md)）已系统讲过，这里从 GC 的角度补足它与
栈扫描、写屏障的关系。

## 13.7.1 安全点与栈图

GC 扫描栈（[13.4](./mark.md)）时，必须知道**每个栈帧里哪些槽是活指针**。编译器为每个**安全点**
生成一份**栈图**（stack map）,记录在该程序点上，栈帧中哪些位置存着活指针。只有停在有栈图的
安全点，GC 才能准确地扫描栈、不遗漏也不误判。这就是为什么扫描栈要先把 goroutine 停到安全点,
非安全点处缺乏精确的指针信息（[9.7](../../part3concurrency/ch09sched/preemption.md) 详述了协作式
与异步两类安全点，以及异步抢占处用保守扫描内层帧的取舍）。

## 13.7.2 GC 与抢占的合流

GC 需要"把某个 goroutine 停到安全点以扫它的栈"，调度器需要"把某个 goroutine 停到安全点以
抢占它",这两件事用的是**同一套机制**。GC 标记开始时要扫描各 goroutine 的栈（混合写屏障下，
开始时把栈置黑、之后不再重扫，[13.2](./barrier.md)），正是借助抢占机制把目标 goroutine 停到
安全点来完成的。一个忙等的紧致循环（[9.7](../../part3concurrency/ch09sched/preemption.md) 的
经典难题）若不能被抢占到安全点，就会拖住 GC,这正是 Go 1.14 异步抢占要解决的核心动因之一。
GC 与调度在安全点这件事上深度合流:抢占机制既服务于调度公平，也服务于 GC 的栈扫描。

## 13.7.3 安全点的成本与意义

维护安全点不是免费的：编译器要在安全点生成栈图（增大二进制）、运行时要能把 goroutine 停到
安全点（抢占机制的全部复杂度）。但它换来的是**精确 GC**,Go 能准确分辨指针与非指针，从而安全地
扫描、（未来若做整理则）移动对象，且不会把恰好像地址的整数误当指针保留。这与保守式 GC
（不区分指针、把所有像指针的字都当指针）形成对比:精确 GC 更彻底（不会因"假指针"而漏收内存）、
为移动式回收留了可能，代价是需要编译器与运行时维护这套安全点与栈图基础设施。Go 选择精确 GC，
是它"编译器与运行时深度协同"（[3.2](../../part1overview/ch03life/compile.md)）的又一体现,也是
它能持续优化 GC（如向 Green Tea 演进）的底气所在。

## 延伸阅读的文献

1. 本书 [9.7 协作与抢占](../../part3concurrency/ch09sched/preemption.md)（安全点、TTSP、异步抢占）.
2. The Go Authors. *runtime: stack maps / safepoints*（栈图与安全点实现）.
   https://github.com/golang/go/blob/master/src/runtime/stack.go
3. Richard Jones et al. *The Garbage Collection Handbook*（精确 vs 保守 GC）. 2023.
4. 本书 [13.2 写屏障](./barrier.md)、[13.4 标记](./mark.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
