---
weight: 5206
title: "16.6 运行时统计量"
---

# 16.6 运行时统计量

剖析（[16.5](./perf.md)）与执行追踪（[16.3](./trace.md)）适合在怀疑某处有问题时，
深入考察一段时间或一次请求。长期运行的服务还需要回答另一类问题：堆在过去一周是否持续增长，
回收是否越来越频繁，调度延迟的高分位从何时开始上升。回答这类问题依靠的是**运行时指标**（metrics）：
开销很低、可以每隔几秒读取一次的聚合数值与分布，由监控系统长期保存、绘制成图表并据此告警。

Go 有两套读取运行时统计的接口：自 Go 1 起提供的 `runtime.ReadMemStats`
[[Go Authors, 2026c](#ref-go-authors-2026c)]，以及 Go 1.16 引入的 `runtime/metrics`。两者的差别、`runtime/metrics`
的设计动机 [[Knyszek, 2020](#ref-knyszek-2020)]，以及它为什么不必停止一切，已在
[12.8.3](../../part4memory/ch12alloc/mstats.md) 与 [12.8.4](../../part4memory/ch12alloc/mstats.md) 讨论。
本节讨论 `runtime/metrics` 的使用：指标目录如何组织，直方图如何表示分布，若干指标如何测量，
以及指标如何接入监控系统。

## 16.6.1 指标目录

`runtime/metrics` 不把指标写成结构体的字段，而是以字符串命名，完整的列表由 `metrics.All` 返回。
包文档据此建议，程序应当按 `All` 返回的列表读取指标，以便在不同的 Go 版本之间保持兼容；
确实需要读取某个特定的指标时，可以借助构建标签区分版本。指标可能被废弃并移除，但这被视为罕见的例外，
只会伴随运行时的重大变化发生 [[Go Authors, 2026a](#ref-go-authors-2026a)]。包文档还作了两项保证：
一个指标的值的类型（`ValueKind`）永远不变，必须改变时就换用新的名字；浮点数值永远不会是 NaN 或无穷大。
下面的程序按名称的第一段统计指标的数量与类型：

```go {run=true}
package main

import (
	"fmt"
	"runtime/metrics"
	"strings"
)

func main() {
	var order []string
	count := map[string]int{}
	kinds := map[metrics.ValueKind]int{}
	for _, d := range metrics.All() {
		family, _, _ := strings.Cut(d.Name[1:], "/")
		if count[family] == 0 {
			order = append(order, family)
		}
		count[family]++
		kinds[d.Kind]++
	}
	fmt.Println("指标总数：", len(metrics.All()))
	for _, f := range order {
		fmt.Printf("  /%-8s %2d\n", f, count[f])
	}
	fmt.Println("uint64：", kinds[metrics.KindUint64],
		"float64：", kinds[metrics.KindFloat64],
		"直方图：", kinds[metrics.KindFloat64Histogram])
}
```

以 Go 1.26.10 运行的输出如下：

```
指标总数： 114
  /cgo       1
  /cpu      11
  /gc       26
  /godebug  48
  /memory   14
  /sched    13
  /sync      1
uint64： 94 float64： 12 直方图： 8
```

除 `/godebug` 外的 66 个指标按子系统分属六族，下面把 `/gc` 与 `/memory` 合并介绍
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

- `/gc` 与 `/memory`：垃圾回收与内存。`/memory/classes` 下的指标把运行时映射的全部内存不重不漏地分类
  （[12.8.1](../../part4memory/ch12alloc/mstats.md)）；`/gc/heap/live:bytes` 是上一轮回收标记到的存活堆，`/gc/heap/goal:bytes`
  是本轮回收结束时的目标堆大小，由调步器根据前者与 `GOGC`、内存限制等设置算出
  （[13.3](../../part4memory/ch13gc/pacing.md)）；`/gc/gogc:percent` 与 `/gc/gomemlimit:bytes`
  则是这两项设置的当前值。
- `/sched`：调度器（[第 9 章](../../part3concurrency/ch09sched)），包括 goroutine 与线程的数量、`GOMAXPROCS`、
  调度延迟与停止一切的暂停时长。
- `/cpu/classes`：Go 1.20 加入，估计 CPU 时间在用户代码、垃圾回收、内存归还与空闲之间的分配
  [[Knyszek, 2022c](#ref-knyszek-2022c)]。指标的说明特别指出，这些估计值偏高，不能与操作系统测得的 CPU
  时间直接比较，只能在同族的指标之间比较。
- `/sync/mutex/wait/total:seconds`：goroutine 阻塞在锁上的累计时间，Go 1.20 加入
  [[Knyszek, 2022b](#ref-knyszek-2022b)]，起初只统计 `sync.Mutex` 与 `sync.RWMutex`，Go 1.22
  起也计入运行时内部的锁 [[Go Authors, 2024](#ref-go-authors-2024)]。说明建议用它观察锁竞争的整体变化，
  需要细节时再采集锁竞争剖面或阻塞剖面（[16.5.5](./perf.md)）。
- `/cgo/go-to-c-calls:calls`：Go 调用 C 函数的次数。

`/godebug` 族的指标数目取决于运行时支持多少项 GODEBUG 设置，它们的用途在下文讨论。

## 16.6.2 直方图

延迟一类的量不宜只看平均值。平均调度延迟为 50 µs 的服务，可能有 1% 的 goroutine 要等待 10 ms 才能运行，
而这 1% 恰恰是用户感受到的卡顿；平均值把这条长尾完全抹平了。监控延迟要看的是高分位（如 P99），
高分位只能从分布中估计，无法从平均值反推。`runtime/metrics` 用 `Float64Histogram` 表示分布
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
// Float64Histogram represents a distribution of float64 values.
type Float64Histogram struct {
	// Counts contains the weights for each histogram bucket.
	//
	// Given N buckets, Count[n] is the weight of the range
	// [bucket[n], bucket[n+1]), for 0 <= n < N.
	Counts []uint64

	// Buckets contains the boundaries of the histogram buckets, in increasing order.
	// ……
	// Buckets[0] is permitted to have value -Inf and Buckets[len(Buckets)-1] is
	// permitted to have value Inf.
	//
	// For a given metric name, the value of Buckets is guaranteed not to change
	// between calls until program exit.
	// ……
	Buckets []float64
}
```

N 个桶有 N + 1 个边界，首尾两个边界可以是负无穷与正无穷，以容纳超出范围的值。
一个指标的边界在程序退出之前不会改变，监控系统只需读取一次。目前的 8 个直方图都是累积的：
桶的计数自程序启动起只增不减 [[Go Authors, 2026a](#ref-go-authors-2026a)]。要得到最近一分钟的分布，
应当把两次读数的 `Counts` 逐桶相减，而不是直接使用某一次的读数；后者反映的是程序启动以来的全部历史。

时间类的直方图在运行时内部由 `timeHistogram` 记录。它是一种 **HDR 直方图**（high dynamic range
histogram），这种结构因同名的开源库 HdrHistogram 而广为人知
[[HdrHistogram Authors, n.d.](#ref-hdrhistogram-authors-nd)]，设计目标是在跨越多个数量级的取值范围内保持大
致恒定的相对精度。运行时的注释说明了它的构造 [[Go Authors, 2026e](#ref-go-authors-2026e)]：

```go
	// For the time histogram type, we use an HDR histogram.
	// Values are placed in buckets based solely on the most
	// significant set bit. Thus, buckets are power-of-2 sized.
	// Values are then placed into sub-buckets based on the value of
	// the next timeHistSubBucketBits most significant bits. Thus,
	// sub-buckets are linear within a bucket.
	//
	// Therefore, the number of sub-buckets (timeHistNumSubBuckets)
	// defines the error. This error may be computed as
	// 1/timeHistNumSubBuckets*100%. For example, for 16 sub-buckets
	// per bucket the error is approximately 6%.
	// ……
	timeHistMinBucketBits = 9
	timeHistMaxBucketBits = 48 // Note that this is exclusive; 1 higher than the actual range.
	timeHistSubBucketBits = 2
	timeHistNumSubBuckets = 1 << timeHistSubBucketBits
	timeHistNumBuckets    = timeHistMaxBucketBits - timeHistMinBucketBits + 1
	// Two extra buckets, one for underflow, one for overflow.
	timeHistTotalBuckets = timeHistNumBuckets*timeHistNumSubBuckets + 2
```

以纳秒为单位的时长先按最高位所在的位置归入某个桶，每个桶覆盖一段 2 的幂次的区间；
再按其后两位归入四个等宽的子桶之一。因此相对误差至多约为 1/4，即 25%。记录一个值只需求出最高位的位置，
再对相应的计数做一次原子加法，开销足够低，可以放在调度器的路径上。注释中「16 个子桶、误差约 6%」
的例子是早先的配置：Michael Knyszek 在 Go 1.20 中提高了最小桶的下限，并把子桶减为 4 个，
直方图的大小因此缩小约三分之二，提交说明的理由是「我们不需要 6% 的精
度」[[Knyszek, 2022a](#ref-knyszek-2022a)]。下面的程序读出调度延迟直方图的边界：

```go {run=true}
package main

import (
	"fmt"
	"runtime/metrics"
)

func main() {
	s := []metrics.Sample{{Name: "/sched/latencies:seconds"}}
	metrics.Read(s)
	b := s[0].Value.Float64Histogram().Buckets
	ns := func(sec float64) float64 { return sec * 1e9 }
	fmt.Println("边界数：", len(b), "桶数：", len(b)-1)
	fmt.Printf("最低的边界（ns）：%v %.0f %.0f %.0f %.0f\n", b[0], ns(b[1]), ns(b[2]), ns(b[3]), ns(b[4]))
	for i := range b {
		if ns(b[i]) == 1<<20 { // 约 1.05 ms
			fmt.Printf("2^20 至 2^21 ns 之间的边界：%.0f %.0f %.0f %.0f %.0f\n",
				ns(b[i]), ns(b[i+1]), ns(b[i+2]), ns(b[i+3]), ns(b[i+4]))
		}
	}
	fmt.Printf("最后两个边界：%.0f ns，%v\n", ns(b[len(b)-2]), b[len(b)-1])
}
```

输出如下：

```
边界数： 163 桶数： 162
最低的边界（ns）：-Inf 0 64 128 192
2^20 至 2^21 ns 之间的边界：1048576 1310720 1572864 1835008 2097152
最后两个边界：140737488355328 ns，+Inf
```

40 个桶各分 4 个子桶，再加上下溢与上溢两个桶，共 162 个。最低的子桶宽 64 ns；在 1 ms 附近，2^20 至 2^21 ns
的区间被等分为四段，每段宽 262144 ns，约为区间起点的 25%。最后一个有限的边界是 2^47 ns，约 1.6 天，
更长的时长都落入上溢桶。由此也可以看出，从这样的直方图估计高分位，结果只能精确到所在的桶：报告的 P99 若是
1.31 ms，真实值可能在 1.31 ms 至 1.57 ms 之间的任何位置。

## 16.6.3 几个指标的测量方式

### 调度延迟与锁等待

`/sched/latencies:seconds` 记录 goroutine 从可运行到真正开始运行之间等待的时间。它由 Michael Pratt 在 Go
1.17 中加入，提交说明指出这一指标是近似值：它以抽样代替记录每一次调度延迟
[[Pratt, 2021](#ref-pratt-2021)]。抽样发生在 goroutine 的状态转换中
[[Go Authors, 2026e](#ref-go-authors-2026e)]：

```go
	if (oldval == _Grunning || oldval == _Gsyscall) && (newval != _Grunning && newval != _Gsyscall) {
		// Track every gTrackingPeriod time a goroutine transitions out of _Grunning or _Gsyscall.
		// Do not track _Grunning <-> _Gsyscall transitions, since they're two very similar states.
		if casgstatusAlwaysTrack || gp.trackingSeq%gTrackingPeriod == 0 {
			gp.tracking = true
		}
		gp.trackingSeq++
	}
```

`gTrackingPeriod` 为 8：每个 goroutine 每 8 次离开运行状态，才有一次被跟踪，跟踪期间的状态转换要调用
`nanotime` 读取时间。状态转换位于调度的热路径上，抽样使这部分开销降为原来的八分之一。
代价是直方图的计数只是全部调度事件中约八分之一的样本：分布的形状有代表性，计数本身却不是调度的总次数。`/sync/mutex/wait/total:seconds`
复用同一套跟踪，它是一个总量，因此在累加时乘以 8，注释写道：「because
we're sampling, we have to multiply by our sampling period to get a more representative estimate of the
absolute value」。

### 内存限制

设置了内存限制（`GOMEMLIMIT`）的服务，常需要监控离限制还有多远。`runtime/debug.SetMemoryLimit`
的文档给出了运行时实际控制的量 [[Go Authors, 2026f](#ref-go-authors-2026f)]：

```go
// More specifically, the following expression accurately reflects
// the value the runtime attempts to maintain as the limit:
//
//	runtime.MemStats.Sys - runtime.MemStats.HeapReleased
//
// or in terms of the runtime/metrics package:
//
//	/memory/classes/total:bytes - /memory/classes/heap/released:bytes
```

运行时映射的全部内存中，已经归还给操作系统的部分不计入限制。监控时应当用这一差值与 `/gc/gomemlimit:bytes`
比较，而不是只看 `/memory/classes/total:bytes`。

### goroutine 的状态

Go 1.26 为调度器加入了一组新的指标：按状态统计的 goroutine 数量 `/sched/goroutines/not-in-go:goroutines`、`/sched/goroutines/runnable:goroutines`、`/sched/goroutines/running:goroutines`
与
`/sched/goroutines/waiting:goroutines`，程序启动以来创建的 goroutine 总数
`/sched/goroutines-created:goroutines`，以及运行时拥有的线程数 `/sched/threads/total:threads`
[[Knyszek, 2025](#ref-knyszek-2025); [Go Authors, 2026g](#ref-go-authors-2026g)]。这类指标的需求在
2016 年就已提出（Go issue #15490）。指标的说明强调这些计数是近似的，各状态之和不保证等于
`/sched/goroutines:goroutines` [[Go Authors, 2026a](#ref-go-authors-2026a)]。可运行的 goroutine 长期居高，
说明可用的处理器不足以及时运行它们；等待中的 goroutine 随时间单调增长，则提示可能存在 goroutine
泄漏（[16.1](./deadlock.md)）。

### GODEBUG 的非默认行为

Go 1.21 把 GODEBUG 确立为兼容机制：改变已有行为的修正通常配有一项 GODEBUG 设置，
程序可以借此暂时保留旧行为。Russ Cox 在描述这一机制的设计文档中提出，运行时应当为每项设置提供一个计数器
`/godebug/non-default-behavior/<name>:events`，记录程序因非默认设置而执行旧行为的次数
[[Cox, 2022](#ref-cox-2022); [Cox, 2023](#ref-cox-2023)]。理由是：
开发者需要知道何时可以安全地删除某项设置，测试只是第一步，生产环境的指标可以证实测试的结论；
若生产系统报告的计数一直为零，删除这项设置就有了有力的依据。

以 `panicnil` 为例：Go 1.21 起，`panic(nil)` 会转为以 `*runtime.PanicNilError` 引发恐慌，`recover`
的结果不再是 `nil`；设置 `GODEBUG=panicnil=1` 则恢复旧行为。下面的程序在这一设置下运行：

```go {run=true env="GODEBUG=panicnil=1"}
package main

import (
	"fmt"
	"runtime/metrics"
)

func main() {
	defer func() {
		fmt.Printf("recover() 的结果：%v\n", recover())
		s := []metrics.Sample{{Name: "/godebug/non-default-behavior/panicnil:events"}}
		metrics.Read(s)
		fmt.Println("panicnil:events =", s[0].Value.Uint64())
	}()
	panic(nil)
}
```

输出如下：

```
recover() 的结果：<nil>
panicnil:events = 1
```

不加这项设置时，`recover` 返回 `panic called with nil argument`，计数为 0。只有执行了旧行为才计数，
仅仅设置了 GODEBUG 并不计数，这正是判断「旧行为是否还被用到」所需要的信息。

## 16.6.4 接入监控系统

标准库的 `expvar` 是最简单的出口。导入这个包时，它在默认的 `ServeMux` 上注册 `GET /debug/vars`，并发布
`cmdline` 与 `memstats` 两个变量，以 JSON 格式输出 [[Go Authors, 2026b](#ref-go-authors-2026b)]：

```go
func init() {
	if godebug.New("httpmuxgo121").Value() == "1" {
		http.HandleFunc("/debug/vars", expvarHandler)
	} else {
		http.HandleFunc("GET /debug/vars", expvarHandler)
	}
	Publish("cmdline", Func(cmdline))
	Publish("memstats", Func(memstats))
}
```

`memstats` 每次求值都调用 `runtime.ReadMemStats`，因此每次请求 `/debug/vars` 都会停止一切一次
（[12.8.4](../../part4memory/ch12alloc/mstats.md)）。`expvar` 的输出也不能表达直方图与标签，适合调试，
不适合高频的生产监控。

生产环境更常见的做法是由 Prometheus 定期抓取服务暴露的 `/metrics` 端点
[[Prometheus Authors, n.d.a](#ref-prometheus-authors-nda)]。官方客户端库 `client_golang` 的 Go 采集器在
1.12.0 版（2022 年 1 月）改为在 Go 1.17 及以上版本使用 `runtime/metrics`，并默认导出约 80 个新指标；1.12.2
版（2022 年 5 月）又撤回了这一默认值，恢复为与 `MemStats` 相当的指标集合，新指标改为需要显式启用。1.20.0
版（2024 年 8 月）在默认集合中加入了 `go_gc_gogc_percent`、`go_gc_gomemlimit_bytes` 与
`go_sched_gomaxprocs_threads` 三个指标，理由是 Go 团队推荐这几项
[[Prometheus Authors, n.d.b](#ref-prometheus-authors-ndb)]。更新日志没有说明撤回的原因。笔者认为，
这段反复反映了默认指标集合的取舍：每个直方图在 Prometheus 中按桶展开为许多条时间序列，导出的指标越多，
存储与查询的成本越高，而默认值的改变会影响所有升级客户端库的服务。需要全部指标时，可以显式启用：

```go
import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	reg := prometheus.NewRegistry()
	reg.MustRegister(collectors.NewGoCollector(
		collectors.WithGoCollectorRuntimeMetrics(collectors.MetricsAll), // 导出全部 runtime/metrics 指标
	))
	http.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	http.ListenAndServe(":2112", nil)
}
```

监控系统按固定间隔抓取这些累积的计数与直方图，对相邻两次读数求差，得到每个时间窗口内的速率与分布，
再据此绘图与告警，例如「最近五分钟调度延迟的 P99 超过 10 ms」。这里的求差与上文两次读取直方图再逐桶相减是
同一回事。

## 16.6.5 指标、剖面与追踪

本章的诊断工具产生的数据可以按回答的问题区分：

| 数据 | 回答的问题 | 形态 | Go 中的实现 |
| --- | --- | --- | --- |
| 指标 | 系统整体是否健康，趋势如何 | 持续的聚合数值与分布 | `runtime/metrics`、`expvar`（本节） |
| 剖面 | 资源花在哪些代码上 | 按调用栈聚合的样本 | `runtime/pprof`（[16.5](./perf.md)） |
| 追踪 | 某一段时间里具体发生了什么 | 按时间排列的事件 | `runtime/trace`（[16.3](./trace.md)） |
| 日志 | 某个离散事件发生时的上下文 | 结构化的记录 | `log/slog`（[7.3](../../part2lang/ch07errors/context.md)） |

OpenTelemetry 目前支持的信号包括追踪、指标与日志（另有用于传递上下文的 baggage），剖面则仍在制定之中
[[OpenTelemetry Authors, n.d.](#ref-opentelemetry-authors-nd)]。四者开销递增、信息量也递增，
因此常按从面到点的顺序使用：指标持续运行，发现趋势异常后告警；剖面把异常的资源消耗归因到代码；
追踪与日志再还原个别请求的经历。例如，监控发现存活堆持续增长，就采集堆剖面找出分配最多的调用栈；
若问题是偶发的长尾延迟，就采集执行追踪，查看那段时间里调度与垃圾回收的事件。这四类数据在 Go
中都由标准库提供：`runtime/metrics` 与 `expvar`，`runtime/pprof`，`runtime/trace`，以及 Go 1.21 加入的
`log/slog` [[Go Authors, 2026d](#ref-go-authors-2026d)]。

## 延伸阅读

- <a id="ref-cox-2022"></a>[Cox, 2022] Russ Cox. *Proposal: Extended backwards compatibility for Go.* Go
  design document, 2022. https://go.googlesource.com/proposal/+/master/design/56986-godebug.md
  GODEBUG 兼容机制的设计，其中提出了非默认行为计数器。
- <a id="ref-cox-2023"></a>[Cox, 2023] Russ Cox. internal/godebug: export non-default-behavior counters in
  runtime/metrics. Go commit 213495a4a6, 2023. https://go.dev/cl/453618
  随 Go 1.21 发布。
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. *Go 1.22 Release Notes.* 2024.
  https://go.dev/doc/go1.22
  `/sync/mutex/wait/total:seconds` 开始计入运行时内部的锁。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Package runtime/metrics.*
  https://pkg.go.dev/runtime/metrics
  键值式指标接口、`Sample`、`Value`、`Float64Histogram`、`All` 与完整的指标列表；本节依据 Go 1.26 的
  src/runtime/metrics/doc.go、description.go 与 histogram.go。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Package expvar.*
  https://pkg.go.dev/expvar
  `/debug/vars` JSON 端点，默认发布 `memstats`、`cmdline`；本节依据 Go 1.26 的 src/expvar/expvar.go。
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Package runtime, type MemStats.*
  https://pkg.go.dev/runtime#MemStats
  旧式固定字段内存统计，及其停止一切的读取语义。
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Package log/slog.*
  https://pkg.go.dev/log/slog
  结构化日志。
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors.
  src/runtime/histogram.go（`timeHistogram`）、src/runtime/proc.go（`casgstatus`）、src/runtime/runtime2.go（`gTrackingPeriod`）.
  Go 1.26 源码.
  https://github.com/golang/go/tree/release-branch.go1.26/src/runtime
- <a id="ref-go-authors-2026f"></a>[Go Authors, 2026f] The Go Authors. *Package runtime/debug, func
  SetMemoryLimit.* https://pkg.go.dev/runtime/debug#SetMemoryLimit
- <a id="ref-go-authors-2026g"></a>[Go Authors, 2026g] The Go Authors. *Go 1.26 Release Notes.* 2026.
  https://go.dev/doc/go1.26
  新增按状态统计 goroutine 数量的调度器指标。
- <a id="ref-hdrhistogram-authors-nd"></a>[HdrHistogram Authors, n.d.] *HdrHistogram: A High Dynamic Range
  (HDR) Histogram.* http://hdrhistogram.org/
- <a id="ref-knyszek-2020"></a>[Knyszek, 2020] Michael Knyszek. Go issue #37112. *runtime: API for
  unstable metrics.* 2020. https://github.com/golang/go/issues/37112
  `runtime/metrics` 的设计动机与取代 `MemStats` 的论证，
  详见 [12.8.4](../../part4memory/ch12alloc/mstats.md)。
- <a id="ref-knyszek-2022a"></a>[Knyszek, 2022a] Michael Anthony Knyszek. runtime: shrink time histogram
  buckets. Go commit 87eda2a782, 2022. https://go.dev/cl/427615
  随 Go 1.20 发布。
- <a id="ref-knyszek-2022b"></a>[Knyszek, 2022b] Michael Anthony Knyszek. runtime/metrics: add
  /sync/mutex/wait/total:seconds metric. Go commit 63ceff95fa, 2022. https://go.dev/cl/427618
  随 Go 1.20 发布，修复 Go issue #49881。
- <a id="ref-knyszek-2022c"></a>[Knyszek, 2022c] Michael Anthony Knyszek. runtime/metrics: add CPU stats.
  Go commit b7c28f484d, 2022. https://go.dev/cl/404307
  随 Go 1.20 发布，修复 Go issue #47216。
- <a id="ref-knyszek-2025"></a>[Knyszek, 2025] Michael Anthony Knyszek. runtime/metrics: add metrics for
  goroutine sched states. Go commit 13df972f68, 2025. https://go.dev/cl/690397
  随 Go 1.26 发布，对应 Go issue #15490。
- <a id="ref-opentelemetry-authors-nd"></a>[OpenTelemetry Authors, n.d.] *Signals.* OpenTelemetry
  documentation. https://opentelemetry.io/docs/concepts/signals/
- <a id="ref-pratt-2021"></a>[Pratt, 2021] Michael Pratt. runtime,runtime/metrics: add metric to track
  scheduling latencies. Go commit bedfeed54a, 2021. https://go.dev/cl/308933
  随 Go 1.17 发布。提交说明注明主要由 Michael Knyszek 编写。
- <a id="ref-prometheus-authors-nda"></a>[Prometheus Authors, n.d.a] Prometheus Authors. *Instrumenting a
  Go application / client_golang.* https://prometheus.io/docs/guides/go-application/ ；
  https://github.com/prometheus/client_golang
  `/metrics` 端点与运行时指标采集器。
- <a id="ref-prometheus-authors-ndb"></a>[Prometheus Authors, n.d.b] Prometheus Authors.
  *client_golang CHANGELOG.* https://github.com/prometheus/client_golang/blob/main/CHANGELOG.md
  1.12.0、1.12.2 与 1.20.0 版中 Go 采集器默认指标的变化。
- 本书 [12.8 内存统计](../../part4memory/ch12alloc/mstats.md)、[13.3
  触发频率及其调步算法](../../part4memory/ch13gc/pacing.md)、[16.3 性能追踪](./trace.md)、[16.5
  基准测试与性能剖析](./perf.md)、[7.3 错误格式与上下文](../../part2lang/ch07errors/context.md)、[16.1
  死锁检测](./deadlock.md).
