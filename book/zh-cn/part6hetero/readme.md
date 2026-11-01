---
weight: 6000
title: "第六部分 异构计算与 AI 时代的 Go"
bookCollapseSection: true
---

# 第六部分 异构计算与 AI 时代的 Go

- [第 18 章 GPU 与异构计算](./ch18gpu)
- [第 19 章 图形](./ch19graphics)
- [第 20 章 AI 推理与服务](./ch20inference)
- [第 21 章 AI Agent 运行时](./ch21agent)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>cgo 不是 Go。</I></br>
<I>Cgo is not Go.</I></br>
<div class="quote-right">
-- Rob Pike, "Go Proverbs", 2015
</div>
</div>

前五部分讨论的是一个相对封闭的系统：调度器把 goroutine 复用在操作系统线程上，分配器与垃圾回收器管理 Go
自己的堆，编译器与链接器把这一切组装成一个静态链接的可执行文件。过去十年间，大量计算移到了这个系统之外：
张量位于 GPU 的显存中，模型权重以 GB 计，图形驱动与推理引擎大多以 C、C++ 或厂商的运行时实现。Go
程序要使用这些能力，就必须与运行时管辖之外的代码和内存协作。

题记出自 Pike 的 Go 谚语，说的正是这种协作的代价：调用 C 代码时，Go
的许多保证不再成立（[15.6](../part5toolchain/ch15compile/cgo.md)）。本部分讨论 Go 如何在由加速器、
外部运行时与远端模型构成的异构环境中工作。CUDA、Metal、llama.cpp、MCP 等都会出现，但重点不在介绍这些框架，
而在借助它们考察前五部分的机制在运行时边界之外如何发挥作用。框架更替很快，它们要解决的问题却相对稳定。

这些负载的共同之处在于一条**外部函数接口**（foreign function interface，FFI）边界。向 GPU 提交计算、
调用本地推理运行时、向图形驱动提交一帧画面，Go 代码都要离开运行时管理的范围，进入一段运行时无法抢占、
无法追踪其内存、也无法预知时长的外部执行。跨越这条边界最常见的方式是 cgo；也有一些库借助 purego 等手段，
在不启用 cgo 的情况下直接调用系统的动态库（[第 18 章](./ch18gpu/readme.md)）。无论采用哪种方式，
边界上都有三个反复出现的问题。

其一，调度器如何应对一段看不见的阻塞。一次 kernel 启动或一次跨设备拷贝，
对运行时而言只是一个迟迟不返回的外部调用。进入 cgo 调用的 goroutine 仍持有它的 P；调用阻塞超过一个 sysmon
周期（至少 20 微秒）之后，sysmon 才可能把 P 夺回，移交给其他线程
（[9.8](../part3concurrency/ch09sched/sysmon.md)）。外部库若在自己创建的线程上回调 Go，
运行时还要把这个陌生的线程临时纳入管理。

其二，垃圾回收器与外部内存的分界。显存不在 Go 的堆中，回收器看不见它，只能由程序显式释放。
交给外部代码的主机内存则仍由回收器管理：cgo 的指针传递规则规定，调用返回之后，C 代码只能在内存已由
`runtime.Pinner` 固定时保留指向它的指针。Go 目前的回收器并不移动堆上的对象，
这些规则为将来可能移动对象的回收器留出了余地（[15.6](../part5toolchain/ch15compile/cgo.md)）。

其三，并发模型的匹配。GPU 的异步执行、推理服务的批处理、Agent 的流式输出，都不是 goroutine 天然的形状。[第
10 章](../part3concurrency/ch10chan/readme.md)的 channel 与
[11.8](../part3concurrency/ch11sync/context.md) 的 context 能否胜任背压、超时、
扇入与扇出等场景，是本部分要回答的问题之一。

本部分分为四章，沿着这条边界由近及远展开。[第 18 章](./ch18gpu/readme.md)讨论 GPU 与异构计算：FFI 边界、
阻塞的外部调用如何影响调度、显存与 Go 堆的分界，以及异步编程模型，是其余各章的基础。[第
19 章](./ch19graphics/readme.md)讨论图形：渲染管线如何在 CPU 与 GPU 之间分工，OpenGL
上下文与窗口系统为何把渲染和事件处理限定在特定的操作系统线程上，以及软件渲染与浏览器中的渲染。[第
20 章](./ch20inference/readme.md)讨论 AI 推理与服务：Go 为何多出现在推理与服务一侧而非训练一侧，
本地推理运行时如何接入，分词与张量如何表示，以及服务中的批处理与流式输出。[第
21 章](./ch21agent/readme.md)讨论 AI Agent 的运行时：Agent 的控制循环、工具调用与 MCP，
以及流式输出中的背压与取消。

阅读本部分不需要预先了解 CUDA 或深度学习，需要的是前五部分建立的基础：什么是系统调用，什么是抢占，
回收器如何判断对象可达，channel 如何在 goroutine 之间传递数据的所有权。有了这些基础，就能看到异构计算与 AI
只是同一套原理在新场景中的应用。
