---
weight: 4300
title: "第 14 章 执行栈管理"
bookCollapseSection: true
---

# 第 14 章 执行栈管理

goroutine 廉价到可以同时存在百万个（[9.3](../../part3concurrency/ch09sched/mpg.md)），一个关键
原因藏在它的**栈**里。操作系统线程的栈通常一上来就预留以兆字节计的固定空间，百万个就是 TB
级，根本不可行。Go 的 goroutine 栈起步只有 **2KB**，且**按需增长**。这套「小而可增长」的栈，
是 goroutine 廉价的物理基础。本章讲清它如何设计、如何分配、如何增长与收缩，以及这背后从分段栈
到连续栈的设计演进。

- [14.1 连续栈的设计](./design.md)
- [14.2 栈的分配与缓存](./alloc.md)
- [14.3 栈的增长](./grow.md)
- [14.4 栈的拷贝与指针调整](./copy.md)
- [14.5 栈的收缩与演进](./shrink.md)

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
