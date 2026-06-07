---
weight: 5206
title: "16.6 运行时统计量"
---

# 16.6 运行时统计量

画像（[16.5](./perf.md)）与追踪（[16.3](./trace.md)）是"出事时拉来诊断"的工具;而要**持续监控**
一个服务的健康度,堆多大、GC 多频、goroutine 多少、调度延迟如何,需要的是**运行时指标**。这
一节讲清 Go 暴露指标的方式及其演进。

## 16.6.1 从 MemStats 到 runtime/metrics

历史上，程序通过 `runtime.ReadMemStats` 读一个 `MemStats` 结构（[12.8](../../part4memory/ch12alloc/mstats.md)）
拿内存指标。但它有硬伤：字段**写死**在结构体里（加新指标要改 API、破坏兼容）、读取还要短暂
**stop-the-world**、较重。Go 1.16 引入了现代的 **`runtime/metrics`** 包来取代它：指标以
**"名字 + 值"**的形式按需查询（如 `/gc/heap/allocs:bytes`、`/sched/latencies:seconds`），新增
指标无需改 API，读取也更轻、更细。它还能给出**分布**（直方图）而非仅标量,比如调度延迟的分布、
GC 停顿的分布，这对理解尾延迟远比一个平均值有用。新代码监控运行时，应一律用 `runtime/metrics`。

`runtime/metrics` 暴露的指标覆盖了本书剖析的几乎所有子系统：内存与 GC
（[12](../../part4memory/ch12alloc)、[13](../../part4memory/ch13gc)）、调度
（[9](../../part3concurrency/ch09sched)，如 goroutine 数、调度延迟）、以及 CPU 占用的细分。
换句话说，它是运行时把自己的内部状态对外开的一扇窗,读懂这些指标，就是在读懂运行时此刻的
处境。

## 16.6.2 接入可观测性体系

光有指标还不够，要把它们**持续采集、存储、告警**。Go 程序通常通过 `expvar`（标准库，把变量
以 JSON 暴露在 HTTP 端点）或更常见的 **Prometheus 客户端**，把 `runtime/metrics` 的数据导出为
监控系统能抓取的格式,再配上 Grafana 看板、告警规则，构成完整的可观测性链路。云原生时代，
"Go 服务暴露 `/metrics`、Prometheus 抓取、Grafana 展示"几乎是标配。Go 在这条链路上的位置，
是提供一个**轻量、可扩展、覆盖全运行时**的指标源。

## 16.6.3 三类可观测性数据

把本章的诊断工具按"可观测性三支柱"归位，全局就清楚了。**指标**（metrics，本节）：持续的、
聚合的数值，回答"系统整体怎么样、趋势如何",用于监控告警。**追踪**（traces，[16.3](./trace.md)
的执行追踪，及分布式追踪）：事件的时间线，回答"这一次具体发生了什么、慢在哪"。**画像**
（profiles，[16.5](./perf.md)）：资源去向的聚合，回答"资源花在哪些代码上"。再加上**日志**
（logs，结构化的 `log/slog`），四者互补，覆盖"持续监控 → 定位问题 → 深入剖析"的完整诊断路径。
Go 把这四类的基础设施**全部内建或以官方包提供**,这是它在生产环境广受青睐的重要原因：一个 Go
服务，开箱就具备相当深的自我观测能力，无需重度依赖外部 APM。理解了这套可观测性版图，就理解了
为什么 Go 特别适合写需要长期运行、需要被运维盯着的服务端程序。

## 延伸阅读的文献

1. The Go Authors. *runtime/metrics 包.* https://pkg.go.dev/runtime/metrics
2. The Go Authors. *expvar 包.* https://pkg.go.dev/expvar
3. Prometheus. *Go client library / instrumenting Go applications.*
   https://prometheus.io/docs/guides/go-application/
4. 本书 [12.8 内存统计](../../part4memory/ch12alloc/mstats.md)、[16.3 性能追踪](./trace.md)、
   [16.5 基准测试与画像](./perf.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
