---
weight: 2113
title: "6.13 过去、现在与未来"
---

# 6.13 过去、现在与未来

## 演进史

Go 的运行时调度器只经历了两个主要版本的迭代。Go 语言诞生之初的调度器，和我们现在所看到的从 Go 1.1 起引入的工作窃取调度器。

### 单线程版调度器

最早期（Go 1 之前）的 Go 调度器甚至不能良好的支持多线程 [Cox, 2008]，即默认的最大 `m` 数为 1。
这个版本的调度器负责将准备运行的 goroutine `g` 
与等待工作的调度程序 `m` 相匹配。如果有准备好的 `g` 且没有等待的 `m`，则会在新的 OS 线程中启动一个新的 m，
这样所有准备好的（有限多个）`g` 可以同时运行。并且，这时的 `m` 无法退出。

原因在于最早先的 Go 只适当的支持了 Linux，甚至连目标支持的 OS X （当时还没有更名为 macOS）也尚未实现。
其中一个主要的问题就在调度器锁的处理并不完善、垃圾回收的支持也不够完整。

### 多线程版调度器

随后的一年时间中，调度器得到了完善的改进，能够正式的支持多个系统线程的版本 [Cox, 2009]。
但这时仍然需要用户态代码通过 $GOMAXPROCS 或 runtime.GOMAXPROCS() 调用来调整最大核数。
而 `m` 不能退出的问题仍然没有得到改进。

### 工作窃取调度器

随着 Go 1.1 的出现，Go 的运行时调度器得到了质的飞越，调度器正式引入 M 的本地资源 P [Vyukov, 2013]，
大幅降低了任务调度时对全局锁的竞争，提出了沿用至今的 MPG 工作窃取式调度器设计。
我们已经在前面的使用了大量篇幅介绍这一调度器的设计，这里便不再赘述了。

## 改进展望：非均匀访存感知的调度器设计

目前的调度器设计总是假设 M 到 P 的访问速度是一样的，即不同的 CPU 核心访问多级缓存、内存的速度一致。
但真实情况是，假设我们有一个田字形排布的四个物理核心：

```
           L2 ------------+
           |              |
        +--+--+           |
       L1     L1          |
       |       |          |
    +------+------+       |
    | CPU1 | CPU2 |       |
    +------+------+       L3
    | CPU3 | CPU4 |       |
    +------+------+       |
       |       |          |
      L1      L1          |
        +--+--+           |
           |              |
           L2-------------+
```


那么左上角 CPU1 访问 CPU 2 的 L1 缓存，要远比访问 CPU3 或 CPU 4 的 L1 缓存，**在物理上**，快得多。
这也就是我们所说的 NUMA（non-uniform memory access，非均匀访存）架构，更一般地说这种架构的系统是也是一个分布式的系统。

针对这一点，Go 官方已经提出了具体的调度器设计 [Vyukov, 2014]，但由于工作量巨大，甚至没有提上日程。

TODO: 介绍设计

## 小结

Go 语言用户态代码的调度核心在未来的十年里只进行了两次改进，足见其设计功力，
但随着 Go 语言的大规模应用，以及越来越多的在多核机器上使用调度器的性能问题也会逐渐暴露出来，
让我们对未来下一个大版本的改进拭目以待。

## 进一步阅读的参考文献

- [Cox, 2008] [Russ Cox, clean up scheduler, 2008](https://github.com/golang/go/commit/96824000ed89d13665f6f24ddc10b3bf812e7f47#diff-1fe527a413d9f1c2e5e22e08e605a192)
- [Cox, 2009] [Russ Cox, things are much better now, 2009](https://github.com/golang/go/commit/fe1e49241c04c748d0e3f4762925241adcb8d7da)
- [Vyukov, 2013] [Dmitry Vyukov, runtime: improved scheduler, 2013](https://github.com/golang/go/commit/779c45a50700bda0f6ec98429720802e6c1624e8)
- [Vyukov, 2014] [Dmitry Vyukov, NUMA-aware scheduler for Go. 2014](https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub)

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).

