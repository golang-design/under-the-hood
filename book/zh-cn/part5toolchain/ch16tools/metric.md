---
weight: 5206
title: "16.6 运行时统计量"
---

# 16.6 运行时统计量

画像（[16.5](./perf.md)）与追踪（[16.3](./trace.md)）属于「出事时拉来诊断」的工具：它们成本
偏高、产出庞大，适合在你已经怀疑某处有问题时，针对一段时间或一次请求采下来细看。但生产环境
里更常见的问题不是「现在帮我剖析一下」，而是「这个服务过去一周健康吗、什么时候开始劣化的、
该不该半夜把人叫起来」。回答这类问题靠的不是一次性的深剖，而是**持续的、低成本的、可长期
保留的数值**：堆有多大、GC 多频繁、goroutine 数量是否在涨、调度延迟的尾部有没有抬头。这类
数值就是**运行时指标**（metrics）。

指标和画像的区别，本质是「聚合 vs 明细」与「常驻 vs 按需」。画像把每一次分配、每一段 CPU
归因到具体调用栈，信息量大、采集贵；指标只保留聚合后的标量或分布，单次读取近乎免费，因而
可以每隔几秒采一次、连续采上几个月。这一节讲清 Go 暴露指标的两套接口、它们的演进，以及
指标如何接入完整的可观测性体系。

## 16.6.1 从 MemStats 到 runtime/metrics

历史上，程序读运行时内存指标的唯一入口是 `runtime.ReadMemStats`，它填充一个 `MemStats`
结构（[12.8](../../part4memory/ch12alloc/mstats.md)）：

```go
// runtime.MemStats：字段写死在结构体里（节选）
type MemStats struct {
    Alloc      uint64 // 当前存活对象占用的堆字节
    HeapInuse  uint64 // 含已用 span 的堆字节
    NumGC      uint32 // 已完成的 GC 轮数
    PauseTotalNs uint64       // 累计 STW 停顿（纳秒）
    PauseNs    [256]uint64    // 最近 256 次停顿的环形缓冲
    // ... 还有约三十个字段
}

var m runtime.MemStats
runtime.ReadMemStats(&m) // 读取时需短暂 stop-the-world
```

这套接口有三处硬伤。其一，字段**写死**在结构体里：运行时想暴露一个新指标，就得往
`MemStats` 里加字段、改公开 API，受 Go 兼容性承诺约束，加得很慎重，于是许多内部状态根本
没有出口。其二，`ReadMemStats` 为了取得自洽快照，读取时要短暂 **stop-the-world**，在高频
采集下成本不可忽略。其三，停顿信息只有一个 `PauseNs` 环形数组和累计值，想知道「停顿的 P99
是多少」得自己从原始数组里算，而那个数组只存最近 256 次，早就漏掉了长期分布。

Go 1.16 引入 **`runtime/metrics`** 包来系统性地解决这些问题。它把指标从「结构体字段」改成
**「名字 + 值」**的键值对：每个指标由一个形如 `/gc/heap/allocs:bytes` 的字符串键标识，键由
一个**路径**和一个**单位**用冒号分隔组成（把单位编进键里是有意的：单位若变了，语义多半也
变了，那就该换一个新键）。新增指标只是往运行时的指标表里加一行，不触动任何已有 API，这让
指标集可以随运行时**自由演进**，甚至允许不同 Go 实现暴露互不相同的指标集。

读取接口围绕三个类型展开。`Sample` 是一次采样的「名字 + 值」槽位；`Value` 是一个带类型标签
的联合；`ValueKind` 标明这个值是 `uint64`、`float64`，还是一个**直方图**：

```go
// runtime/metrics：键值式、可扩展的指标接口（速写）
type Sample struct {
    Name  string // 指标名，须取自 metrics.All() 列出的名字
    Value Value  // 由 Read 填充
}

type Value struct {
    kind   ValueKind // KindUint64 / KindFloat64 / KindFloat64Histogram / KindBad
    scalar uint64    // 标量值，按 kind 解释
    // 直方图等非标量值另存指针
}

func (v Value) Kind() ValueKind            { return v.kind }
func (v Value) Uint64() uint64             { /* kind 不符则 panic */ }
func (v Value) Float64() float64           { /* ... */ }
func (v Value) Float64Histogram() *Float64Histogram { /* ... */ }
```

读取就是先填好要读的名字，再交给 `metrics.Read` 批量填值。运行时承诺：给定指标的 `Kind`
**保证不变**，因此调用方可以放心地对某个已知指标直接断言其类型；只有当指定的名字不存在时，
对应 `Value` 才会是 `KindBad`：

```go
import "runtime/metrics"

// 持续监控关心的几个指标：堆、GC 频率、goroutine 数、调度延迟分布
var samples = []metrics.Sample{
    {Name: "/memory/classes/heap/objects:bytes"}, // 存活对象占用的堆
    {Name: "/gc/cycles/total:gc-cycles"},          // 累计 GC 轮数，可据此算频率
    {Name: "/sched/goroutines:goroutines"},        // 存活 goroutine 数
    {Name: "/sched/latencies:seconds"},            // 调度延迟分布（直方图）
}

func collect() {
    metrics.Read(samples) // 复用同一个 slice 以避免每次分配
    heap := samples[0].Value.Uint64()
    gcCount := samples[1].Value.Uint64()
    goroutines := samples[2].Value.Uint64()
    latency := samples[3].Value.Float64Histogram()
    _ = heap; _ = gcCount; _ = goroutines; _ = latency
}
```

与 `MemStats` 不同，`Read` 不需要全局 stop-the-world 来取标量，单次采集足够轻，可以放进一个
每秒触发的 goroutine 里长期跑。

## 16.6.2 分布优于平均：直方图与尾延迟

`runtime/metrics` 相对 `MemStats` 最有价值的一步，是把一类指标做成了**分布**而非标量。调度
延迟 `/sched/latencies:seconds`、各类 STW 停顿 `/sched/pauses/total/gc:seconds`、堆分配大小
`/gc/heap/allocs-by-size:bytes`，这些指标的值是一个 `Float64Histogram`：

```go
// runtime/metrics.Float64Histogram：一段值的分布（速写）
type Float64Histogram struct {
    Counts  []uint64  // 每个桶的计数；Counts[n] 落在 [Buckets[n], Buckets[n+1])
    Buckets []float64 // 桶边界，单调递增；len(Buckets) == len(Counts)+1
}
```

为什么要分布？因为对延迟这类指标，**平均值会骗人**。一个服务平均调度延迟 50 微秒听起来很好，
但若有 1% 的 goroutine 等了 10 毫秒才被调度上 CPU，平均值会把这条长尾完全抹平，而恰恰是这
1% 决定了用户感受到的卡顿。监控延迟要看的是**分位数**（P50、P99、P999），而分位数只能从分布
里估，无法从平均值反推。直方图正是为此存在：它在桶的粒度上保留了整条分布的形状。

从直方图估一个分位数，就是沿桶累加计数，找到累计占比首次越过目标分位的那个桶：

```go
// 从 Float64Histogram 估第 q 分位（0<q<1），返回桶下界
func quantile(h *metrics.Float64Histogram, q float64) float64 {
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    if total == 0 {
        return 0
    }
    thresh := uint64(float64(total) * q)
    var cum uint64
    for i, c := range h.Counts {
        cum += c
        if cum >= thresh {
            return h.Buckets[i] // 落入此桶，取其下界为估计
        }
    }
    return h.Buckets[len(h.Buckets)-1]
}
```

桶边界粒度决定了估计精度，运行时为延迟类指标选了**对数-线性**（log-linear）的桶分布：高位
按指数划分出量级各异的「超级桶」，每个超级桶内部再线性等分为若干子桶，于是在跨越多个数量级
的延迟上都能保持大致恒定的相对分辨率。这与 `MemStats.PauseNs` 那个只存最近 256 次原始值的环形数组形成对照：
直方图不丢历史、不限次数，且天然支持跨进程、跨时间窗口的合并（两个直方图相加即可），正是
监控系统乐于消费的形态。

## 16.6.3 指标是每个子系统对外的窗口

`runtime/metrics` 暴露的指标几乎覆盖了本书剖析过的每一个子系统，读懂这些键就是在读运行时
此刻的处境。按路径前缀，它们大致分为几族：

- `/gc/*` 与 `/memory/classes/*`：垃圾回收与内存的全景（[12](../../part4memory/ch12alloc)、
  [13](../../part4memory/ch13gc)）。`/gc/heap/live:bytes` 是上轮 GC 标记到的存活堆，
  `/gc/heap/goal:bytes` 是本轮的目标堆大小，两者之比正是 GC 步调器（[13.4](../../part4memory/ch13gc/pacing.md)）
  在调节的量；`/gc/cycles/total:gc-cycles` 对时间求差就是 GC 频率；`/memory/classes/total:bytes`
  是运行时向系统映射的全部内存，它是 `GOMEMLIMIT` 软上限真正盯着的数字。
- `/sched/*`：调度器的状态（[9](../../part3concurrency/ch09sched)）。`/sched/goroutines:goroutines`
  是存活 goroutine 数，持续上涨往往是 goroutine 泄漏的信号；`/sched/latencies:seconds` 是
  上面讲的调度延迟分布；`/sched/gomaxprocs:threads` 是当前 `GOMAXPROCS`。
- `/sched/pauses/*` 与 `/cpu/classes/*`：把 GC 对应用的干扰量化。`/sched/pauses/total/gc:seconds`
  是 GC 引发的 STW 停顿分布（旧键 `/gc/pauses:seconds` 已弃用，指向它）；`/cpu/classes/gc/total:cpu-seconds`
  估算 GC 占用的 CPU，与 `/cpu/classes/total:cpu-seconds` 相比即可知 GC 的 CPU 税率。
- `/sync/mutex/wait/total:seconds`：goroutine 累计阻塞在 `sync.Mutex`/`sync.RWMutex` 及运行时
  内部锁上的时间，对它求速率能粗看全局锁争用是否恶化，细看则转 mutex 画像（[16.5](./perf.md)）。

这些指标都不是为某个工具定制的旁路，而是运行时把内部计数器开出来的标准出口。`metrics.All()`
随时返回当前版本支持的完整 `Description` 列表（含名字、英文描述、`Kind`、是否为累计量），
据此即可在运行时动态发现而非硬编码指标集，这正是面向版本兼容设计的接口该有的用法。

## 16.6.4 接入可观测性体系

光把指标读出来还不够，要把它们**持续采集、远端存储、可视化、告警**，才构成可运维的链路。
Go 在这条链路上提供两层接入点。

最轻量的一层是标准库的 `expvar`。它把变量以 JSON 形式挂在一个 HTTP 端点（默认 `/debug/vars`），
并在包初始化时就 `Publish` 了 `memstats`（即一份 `runtime.MemStats` 的 JSON）和 `cmdline`。
只要在程序里匿名导入它，就白得一个内存指标端点：

```go
import (
    _ "expvar" // 自动注册 /debug/vars，并发布 memstats、cmdline
    "expvar"
    "net/http"
)

// 也可发布自定义指标，例如把采到的堆大小写进一个公开的整型变量
var heapLive = expvar.NewInt("heap_live_bytes")

func init() {
    go http.ListenAndServe(":6060", nil) // /debug/vars 已挂在默认 mux 上
}
```

`expvar` 胜在零依赖、随手可得，适合调试与轻量内省；但它的 JSON 格式不是监控系统的通用语言，
也不直接支持直方图与标签。生产环境更常用的一层，是 **Prometheus 客户端库**：官方的
`client_golang` 内置一个采集器，把 `runtime/metrics` 的指标（含直方图）翻译成 Prometheus
的文本格式，挂在约定俗成的 `/metrics` 端点上：

```go
import (
    "net/http"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
    // promhttp.Handler() 默认就会采集 Go 运行时指标（go_* / process_*）
    http.Handle("/metrics", promhttp.Handler())
    http.ListenAndServe(":2112", nil)
}
```

链路的下游是标准化的：Prometheus 定时抓取 `/metrics`，把时序存进自己的库；Grafana 接 Prometheus
画看板；告警规则（如「`/sched/goroutines` 五分钟内翻倍」或「GC 停顿 P99 超过 10ms」）则由
Prometheus 的 Alertmanager 触发。云原生时代，「Go 服务暴露 `/metrics`、Prometheus 抓取、
Grafana 展示」几乎是默认装配。Go 在其中的位置很清楚：提供一个**轻量、可扩展、覆盖全运行时**的
指标源，而把存储、查询、告警这些与语言无关的部分交给成熟的外部系统。

## 16.6.5 可观测性三支柱与日志

把本章的诊断工具按业界的「可观测性三支柱」归位，整张诊断版图就清楚了：

| 支柱 | 回答的问题 | 形态 | Go 中的实现 |
| --- | --- | --- | --- |
| 指标 metrics | 系统整体怎么样、趋势如何 | 持续的聚合数值 / 分布 | `runtime/metrics`、`expvar`（本节） |
| 追踪 traces | 这一次具体发生了什么、慢在哪 | 事件的时间线 | 执行追踪（[16.3](./trace.md)）、分布式追踪 |
| 画像 profiles | 资源花在哪些代码上 | 资源去向的聚合 | `pprof`（[16.5](./perf.md)） |

三者各司其职，又彼此衔接：指标负责**持续监控**，在趋势异常时告警；追踪负责回答某一次具体
请求**慢在哪**；画像负责把某种资源消耗**归因到代码**。监控告警发现堆在涨，转去看分配画像
定位是哪段代码在分配，再用追踪看具体一次请求里 GC 卡在何处，这是一条典型的「从面到点」的
诊断路径。

三支柱之外通常还要加上第四类，**日志**（logs）。Go 1.21 起标准库的 `log/slog`
（[7.3](../../part2lang/ch07errors/context.md)）提供结构化日志，把日志从一行字符串变成可按
字段过滤、聚合、告警的键值记录，正好补上「记录离散事件的上下文」这一块。值得点出的是，
这四类基础设施 Go 几乎**全部内建或以官方包提供**：指标在 `runtime/metrics`、`expvar`，追踪在
`runtime/trace`，画像在 `runtime/pprof`，日志在 `log/slog`。一个 Go 服务开箱就具备相当深的
自我观测能力，无需重度依赖外部 APM 探针。这也解释了为什么 Go 特别适合写需要长期运行、需要
被运维持续盯着的服务端程序：可观测性不是事后贴上去的，而是运行时与标准库一开始就备好的能力。

## 延伸阅读的文献

1. The Go Authors. *Package runtime/metrics.* https://pkg.go.dev/runtime/metrics
   （键值式指标接口、`Sample`/`Value`/`Float64Histogram`、`All` 与完整指标列表）
2. Michael Knyszek. *Proposal: API for unstable runtime metrics (#37112).* 2020.
   https://github.com/golang/go/issues/37112 （`runtime/metrics` 的设计动机与取代 `MemStats` 的论证）
3. The Go Authors. *Package expvar.* https://pkg.go.dev/expvar
   （`/debug/vars` JSON 端点，默认发布 `memstats`、`cmdline`）
4. The Go Authors. *Package runtime, type MemStats.* https://pkg.go.dev/runtime#MemStats
   （旧式固定字段内存统计，及其 stop-the-world 读取语义）
5. Prometheus Authors. *Instrumenting a Go application / client_golang.*
   https://prometheus.io/docs/guides/go-application/ 、
   https://github.com/prometheus/client_golang （`/metrics` 端点与运行时指标采集器）
6. The Go Authors. *Package log/slog.* https://pkg.go.dev/log/slog （结构化日志）
7. 本书 [12.8 内存统计](../../part4memory/ch12alloc/mstats.md)、
   [13.4 GC 步调](../../part4memory/ch13gc/pacing.md)、[16.3 性能追踪](./trace.md)、
   [16.5 基准测试与画像](./perf.md)、[7.3 错误格式与上下文](../../part2lang/ch07errors/context.md).
