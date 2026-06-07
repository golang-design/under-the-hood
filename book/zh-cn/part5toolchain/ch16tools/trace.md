---
weight: 5203
title: "16.3 性能追踪"
---

# 16.3 性能追踪

`pprof`（[16.5](./perf.md)）告诉你"时间花在哪些函数上"，却答不了"为什么这个 goroutine 卡了
5ms 没跑"。回答后者要靠**执行追踪器**（execution tracer，`go tool trace`）,它记录运行时层面的
**事件时间线**：goroutine 何时被调度、何时阻塞、GC 何时发生、系统调用何时进出。这一节讲清它
看什么、以及它近年的低开销化演进。

## 16.3.1 追踪运行时事件的时间线

执行追踪器（`runtime/trace`）捕获的是**运行时事件**：每个 goroutine 的创建、开始运行、被阻塞
（在 channel/锁/网络上）、被唤醒、结束;每个 P 上的调度活动;每次 GC 的各阶段
（[13.3](../../part4memory/ch13gc/pacing.md)）;系统调用的进出;STW 停顿等。把这些事件按时间轴
排开，`go tool trace` 画出一张可交互的时间线,你能看到"这一刻有几个 P 在干活、哪个 goroutine
在哪个 P 上、它为什么停了、GC 是不是正在抢 CPU"。

这让它擅长 `pprof` 答不了的问题：**延迟从哪来**。一个请求慢，是因为在等锁？在等网络？被 GC
打断？被调度器晾着没 P 可用（[9.2](../../part3concurrency/ch09sched/steal.md)）？这些"时间花在
等待上"的问题，CPU 画像看不见（它只统计在跑的时间），执行追踪却一目了然。它是诊断尾延迟、
调度异常、GC 干扰的首选工具。

## 16.3.2 低开销化：飞行记录仪

执行追踪历史上的痛点是**开销**：早期开启追踪有可观的性能损耗，且生成的 trace 文件巨大，
不适合在生产环境常开。近年 Go 对追踪器做了重写（Go 1.21/1.22 一带），大幅降低开销、并支持
**飞行记录仪**（flight recorder）模式,像飞机黑匣子一样，在内存里持续保留**最近一段**的追踪，
平时不落盘，只在出问题的瞬间把这段最近历史 dump 出来。这让"在生产环境捕捉偶发的延迟尖刺"
成为可能,你不必从头全程追踪（开销大、数据海量），而是让它一直转着、出事时回看最近几秒。
这是可观测性工程的一大进步：把"重而全"的追踪，变成"轻而按需"的随身记录。

## 16.3.3 三件工具各司其职

把 Go 的诊断三件套放在一起看，分工就清楚了：**`pprof`**（[16.5](./perf.md)）回答"资源
（CPU/内存）花在哪"（聚合统计）;**执行追踪**回答"时间线上发生了什么、为什么等"（事件序列）;
**`runtime/metrics`**（[16.6](./metric.md)）回答"系统整体健康度如何"（持续指标）。它们互补，
对应不同的诊断问题。Go 把这三者都**内建进标准库与工具链**,无需第三方 APM 就能对自己的程序
做深度剖析，这是 Go 在可观测性上的一大优势。执行追踪器尤其特别,它直面运行时内部
（调度器、GC、netpoller），把本书前几部分讲的那些机制的**实际运行**可视化了出来。读懂一张
trace 图，几乎就是在亲眼看 [9 调度器](../../part3concurrency/ch09sched)、
[13 GC](../../part4memory/ch13gc) 在你的程序里现场演出。

## 延伸阅读的文献

1. The Go Authors. *runtime/trace 与 go tool trace 文档.* https://pkg.go.dev/runtime/trace ；
   https://pkg.go.dev/cmd/trace
2. Dmitry Vyukov. *Go Execution Tracer 设计文档.*
   https://go.googlesource.com/proposal/+/master/design/17432-traces.md
3. Michael Knyszek. *Execution tracer overhaul / Flight recorder*（Go 1.21/1.22）.
   https://go.dev/blog/execution-traces-2024
4. 本书 [16.5 基准测试与画像](./perf.md)、[16.6 运行时统计量](./metric.md)、
   [9 调度器](../../part3concurrency/ch09sched).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
