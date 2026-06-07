---
weight: 1102
title: "1.2 Go 语言综述"
---

# 1.2 Go 语言综述

这一节为全书搭一个骨架：用一张鸟瞰图，把 Go 的几大支柱及其在本书中的位置串起来。后续每一章
都是对这里某个支柱的深入,先有全局，再钻细节，读起来不至迷路。

## 1.2.1 三层视角

理解 Go 可以分三层。**语言层**：语法、类型系统、并发原语,你写的代码。**运行时层**：调度器、
内存分配器、垃圾回收器,一个与你的程序一起编译进二进制、在背后默默支撑的"小操作系统"。
**工具链层**：编译器、链接器、模块系统、可观测性工具,把源码变成可运行、可诊断的程序。本书
正是按这三层（外加历史与基础）组织的。Go 的一个鲜明特点是：**运行时层极其厚重**,它把调度、
GC、栈管理等本属操作系统范畴的复杂度，接管进了语言运行时，以换取 goroutine、自动内存管理这些
上层的简洁。本书大半篇幅都在剖析这个"背后的运行时"。

## 1.2.2 几大支柱与本书地图

- **并发**：goroutine（[9 调度器](../../part3concurrency/ch09sched)）、channel 与 CSP
  （[10 通道](../../part3concurrency/ch10chan)、[1.3](./csp.md)）、共享内存同步与内存模型
  （[11 同步](../../part3concurrency/ch11sync)）。这是 Go 最具辨识度的部分，本书着墨最多。
- **类型系统**：结构化、隐式满足的接口（[4.2](../../part2lang/ch04type/interface.md)）、组合优于
  继承、2022 年加入的泛型（[8 泛型](../../part2lang/ch08generics)）。
- **内存管理**：基于 tcmalloc 思路的分配器（[12 内存分配器](../../part4memory/ch12alloc)）、
  并发标记清除的垃圾回收（[13 垃圾回收](../../part4memory/ch13gc)）、可增长的连续栈
  （[14 执行栈](../../part4memory/ch14stack)）。
- **错误处理**：错误即值（[7 错误处理](../../part2lang/ch07errors)），而非异常。
- **工具链**：以编译速度为先的编译器（[15 编译器](../../part5toolchain/ch15compile)）、丰富的
  可观测性工具（[16 工具与可观测性](../../part5toolchain/ch16tools)）、解决"依赖地狱"的模块系统
  （[17 模块](../../part5toolchain/ch17modules)）。

## 1.2.3 设计的内在一致性

把这些支柱放在一起看，会发现它们并非互不相干的特性堆砌，而服从同一组价值观:**简单优于复杂、
显式优于隐式、组合优于继承、可读与可维护优于聪明、编译速度与工程规模优于语言的极致表达力。**
正因如此，理解 Go 的任何一个局部，最好都回到这组价值观去对照,为什么调度器是协作式加信号
抢占而非别的（[9.7](../../part3concurrency/ch09sched/preemption.md)）、为什么内存模型只给顺序
一致原子（[11.9](../../part3concurrency/ch11sync/mem.md)）、为什么泛型等了十三年又做得如此
克制（[8.1](../../part2lang/ch08generics/history.md)），答案最终都指回这里。本书的剖析，既是在
讲"Go 怎么实现的"，也是在反复印证"Go 为何如此选择"。

## 延伸阅读的文献

1. The Go Authors. *The Go Programming Language Specification.* https://go.dev/ref/spec
2. Rob Pike. *Go at Google: Language Design in the Service of Software Engineering.* 2012.
   https://go.dev/talks/2012/splash.article
3. Alan A. A. Donovan, Brian W. Kernighan. *The Go Programming Language.* 2015.
4. The Go Authors. *Effective Go.* https://go.dev/doc/effective_go

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
