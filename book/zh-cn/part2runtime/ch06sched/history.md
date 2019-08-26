# 调度器: 过去、现在与未来

[TOC]

## 演进史

Go 的运行时调度器只经历了两个主要版本的迭代。Go 语言诞生之初的调度器，和我们现在所看到的从 Go 1.1 起引入的工作窃取调度器。

### 早期的调度器实现

#### 单线程版调度器

> 
> 调度器首次注释 https://github.com/golang/go/commit/96824000ed89d13665f6f24ddc10b3bf812e7f47#diff-1fe527a413d9f1c2e5e22e08e605a192

Go 调度器负责将准备运行的 goroutine `g` 与等待工作的调度程序 `m` 相匹配。
如果有准备好的 `g` 且没有等待的 `m`，则 `ready()` 将在新的 OS 线程中启动一个新的 m，
这样所有准备好的（有限多个） `g` 可以同时运行。现在，m 永远不会退出。

默认的最大 `m` 数为 1：go 运行单线程。

这是因为某些锁的细节必须处理（特别是选择未正确锁定）并且因为尚未为 OS X 编写低级代码。
设置环境变量 `$gomaxprocs` 现在更改 `sched.mmax`。即使是在单个进程中可以无死锁地运行的程序，如果有机会也可以使用更多的ms。
例如，主筛将使用与质数一样多的 `m`（最多 `sched.mmax`），允许管道的不同阶段并行执行。
我们可以重新考虑这个选择，只是开始阻止系统调用的新 `m`，但这将限制试图做的并行计算量。
一般来说，人们可以想象对调度程序进行各种改进，但现在的目标只是在 Linux 和 OS X 上运行。

#### 多线程版调度器

// By default, Go keeps only one kernel thread (m) running user code
// at a single time; other threads may be blocked in the operating system.
// Setting the environment variable $GOMAXPROCS or calling
// runtime.GOMAXPROCS() will change the number of user threads
// allowed to execute simultaneously.  $GOMAXPROCS is thus an
// approximation of the maximum number of cores to use.

### 工作窃取调度器

## 改进展望

### 非均匀访存感知的调度器设计

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

针对这一点，Go 官方已经提出了具体的调度器设计 [VYUKOV, 2014]，但由于工作量巨大，甚至没有提上日程。

TODO: 介绍设计

## 总结

TODO:

[返回目录](./readme.md) | [上一节](./sync.md) | 下一节

## 进一步阅读的参考文献

- [VYUKOV, 2014] [Vyukov, Dmitry. NUMA-aware scheduler for Go. 2014](https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)

