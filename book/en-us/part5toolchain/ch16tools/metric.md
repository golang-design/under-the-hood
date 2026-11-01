---
weight: 5206
title: "16.6 Runtime Metrics"
---

# 16.6 Runtime Metrics

Profiling ([16.5 Benchmarking and Performance Profiling](./perf.md)) and execution tracing
([16.3 Execution Tracing](./trace.md)) suit the case where something is suspected to be wrong and a
period of time or a single request needs close examination. A long-running service has to answer
another kind of question: whether the heap has kept growing over the past week, whether collections
are becoming more frequent, since when the high percentiles of scheduling latency have been rising.
The answers come from runtime **metrics**: aggregate values and distributions that are cheap enough
to read every few seconds, which a monitoring system stores for the long term, plots as charts and
alerts on.

Go has two interfaces for reading runtime statistics: `runtime.ReadMemStats`, available since Go 1,
and `runtime/metrics`, introduced in Go 1.16 [[Go Authors, 2026c](#ref-go-authors-2026c)]. The
differences between them, the motivation for `runtime/metrics` [[Knyszek, 2020](#ref-knyszek-2020)]
and why it does not need to stop the world are discussed in
[12.8.3 A Consistent Snapshot Without Stopping the World](../../part4memory/ch12alloc/mstats.md) and
[12.8.4 Two Read Interfaces](../../part4memory/ch12alloc/mstats.md). This section covers the use of
`runtime/metrics`: how the metric catalog is organized, how histograms represent distributions, how
several metrics are measured, and how metrics reach a monitoring system.

## 16.6.1 The Metric Catalog

`runtime/metrics` does not expose metrics as struct fields. They are named by strings, and the
complete list is returned by `metrics.All`. The package documentation accordingly advises programs
to read the metrics listed by `All`, to stay compatible across Go versions; if a specific metric
must be read, build tags can distinguish versions. A metric may be deprecated and removed, but this
is considered a rare exception that accompanies only a major change in the runtime
[[Go Authors, 2026a](#ref-go-authors-2026a)]. The documentation makes two further guarantees: the
type of a metric's value (`ValueKind`) never changes, and when it must, a new name is used;
floating-point values are never NaN or infinity. The following program counts the metrics and their
kinds by the first segment of the name:

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
	fmt.Println("total metrics:", len(metrics.All()))
	for _, f := range order {
		fmt.Printf("  /%-8s %2d\n", f, count[f])
	}
	fmt.Println("uint64:", kinds[metrics.KindUint64],
		"float64:", kinds[metrics.KindFloat64],
		"histogram:", kinds[metrics.KindFloat64Histogram])
}
```

The output with Go 1.26.10 is:

```
total metrics: 114
  /cgo       1
  /cpu      11
  /gc       26
  /godebug  48
  /memory   14
  /sched    13
  /sync      1
uint64: 94 float64: 12 histogram: 8
```

The 66 metrics other than `/godebug` fall into six families by subsystem; the following introduces
`/gc` and `/memory` together [[Go Authors, 2026a](#ref-go-authors-2026a)]:

- `/gc` and `/memory`: garbage collection and memory. The metrics under `/memory/classes` classify
  all memory mapped by the runtime without overlap or omission
  ([12.8.1 Categories of Memory](../../part4memory/ch12alloc/mstats.md)). `/gc/heap/live:bytes` is
  the live heap marked by the previous collection, and `/gc/heap/goal:bytes` is the target heap size
  at the end of the current collection, computed by the pacer from the former together with settings
  such as `GOGC` and the memory limit
  ([13.3 Trigger Frequency and the Pacing Algorithm](../../part4memory/ch13gc/pacing.md));
  `/gc/gogc:percent` and `/gc/gomemlimit:bytes` are the current values of those two settings.
- `/sched`: the scheduler ([Chapter 9 The goroutine Scheduler](../../part3concurrency/ch09sched)),
  including the numbers of goroutines and threads, `GOMAXPROCS`, scheduling latency and
  stop-the-world pause durations.
- `/cpu/classes`: added in Go 1.20; it estimates how CPU time is divided among user code, garbage
  collection, scavenging and idle time [[Knyszek, 2022c](#ref-knyszek-2022c)]. The metric
  descriptions point out that these estimates run high and cannot be compared directly with the CPU
  time measured by the operating system, only with each other within the family.
- `/sync/mutex/wait/total:seconds`: the cumulative time goroutines have spent blocked on locks,
  added in Go 1.20 [[Knyszek, 2022b](#ref-knyszek-2022b)]. At first it counted only `sync.Mutex` and
  `sync.RWMutex`; since Go 1.22 it also includes locks inside the runtime
  [[Go Authors, 2024](#ref-go-authors-2024)]. The description recommends using it to observe overall
  changes in lock contention, and collecting a mutex or blocking profile when details are needed
  ([16.5.5 How the Runtime Collects Profiles](./perf.md)).
- `/cgo/go-to-c-calls:calls`: the number of calls from Go to C functions.

The number of metrics in the `/godebug` family depends on how many GODEBUG settings the runtime
supports; their use is discussed below.

## 16.6.2 Histograms

Quantities such as latency should not be judged by the mean alone. A service with a mean scheduling
latency of 50 µs may have 1% of goroutines waiting 10 ms before they run, and that 1% is exactly the
stutter users feel; the mean flattens this tail completely. Monitoring latency means looking at high
percentiles (such as P99), which can only be estimated from a distribution and cannot be derived
from the mean. `runtime/metrics` represents distributions with `Float64Histogram`
[[Go Authors, 2026a](#ref-go-authors-2026a)]:

```go
// Float64Histogram represents a distribution of float64 values.
type Float64Histogram struct {
	// Counts contains the weights for each histogram bucket.
	//
	// Given N buckets, Count[n] is the weight of the range
	// [bucket[n], bucket[n+1]), for 0 <= n < N.
	Counts []uint64

	// Buckets contains the boundaries of the histogram buckets, in increasing order.
	// ...
	// Buckets[0] is permitted to have value -Inf and Buckets[len(Buckets)-1] is
	// permitted to have value Inf.
	//
	// For a given metric name, the value of Buckets is guaranteed not to change
	// between calls until program exit.
	// ...
	Buckets []float64
}
```

N buckets have N + 1 boundaries, and the first and last boundaries may be negative and positive
infinity, to hold values outside the range. The boundaries of a metric do not change until the
program exits, so a monitoring system needs to read them only once. All 8 current histograms are
cumulative: the bucket counts only grow from program start
[[Go Authors, 2026a](#ref-go-authors-2026a)]. To get the distribution over the last minute, subtract
two readings of `Counts` bucket by bucket rather than using a single reading, which reflects the
entire history since the program started.

Inside the runtime, time histograms are recorded by `timeHistogram`. It is an **HDR histogram**
(high dynamic range histogram), a structure made widely known by the open-source library of the same
name, HdrHistogram [[HdrHistogram Authors, n.d.](#ref-hdrhistogram-authors-nd)]. Its design goal is
to keep a roughly constant relative precision over a value range that spans many orders of
magnitude. The comment in the runtime explains its construction
[[Go Authors, 2026e](#ref-go-authors-2026e)]:

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
	// ...
	timeHistMinBucketBits = 9
	timeHistMaxBucketBits = 48 // Note that this is exclusive; 1 higher than the actual range.
	timeHistSubBucketBits = 2
	timeHistNumSubBuckets = 1 << timeHistSubBucketBits
	timeHistNumBuckets    = timeHistMaxBucketBits - timeHistMinBucketBits + 1
	// Two extra buckets, one for underflow, one for overflow.
	timeHistTotalBuckets = timeHistNumBuckets*timeHistNumSubBuckets + 2
```

A duration in nanoseconds is first placed in a bucket by the position of its most significant bit,
so each bucket covers a power-of-2 interval; the next two bits then place it in one of four
equal-width sub-buckets. The relative error is therefore at most about 1/4, or 25%. Recording a
value takes only finding the position of the top bit and one atomic add on the corresponding
counter, cheap enough to sit on the scheduler's paths. The comment's example of "16 sub-buckets,
error about 6%" is an earlier configuration: in Go 1.20 Michael Knyszek raised the lower limit of
the smallest bucket and reduced the sub-buckets to 4, which shrank the histogram by about two
thirds; the commit message gives as its reason "we don't need 6%
precision" [[Knyszek, 2022a](#ref-knyszek-2022a)]. The following program reads out the boundaries of
the scheduling latency histogram:

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
	fmt.Println("boundaries:", len(b), "buckets:", len(b)-1)
	fmt.Printf("lowest boundaries (ns): %v %.0f %.0f %.0f %.0f\n", b[0], ns(b[1]), ns(b[2]), ns(b[3]), ns(b[4]))
	for i := range b {
		if ns(b[i]) == 1<<20 { // about 1.05 ms
			fmt.Printf("boundaries between 2^20 and 2^21 ns: %.0f %.0f %.0f %.0f %.0f\n",
				ns(b[i]), ns(b[i+1]), ns(b[i+2]), ns(b[i+3]), ns(b[i+4]))
		}
	}
	fmt.Printf("last two boundaries: %.0f ns, %v\n", ns(b[len(b)-2]), b[len(b)-1])
}
```

The output is:

```
boundaries: 163 buckets: 162
lowest boundaries (ns): -Inf 0 64 128 192
boundaries between 2^20 and 2^21 ns: 1048576 1310720 1572864 1835008 2097152
last two boundaries: 140737488355328 ns, +Inf
```

40 buckets with 4 sub-buckets each, plus the underflow and overflow buckets, make 162 in total. The
lowest sub-bucket is 64 ns wide; near 1 ms, the interval from 2^20 to 2^21 ns is divided into four
equal parts, each 262144 ns wide, about 25% of the start of the interval. The last finite boundary
is 2^47 ns, about 1.6 days, and longer durations fall into the overflow bucket. It also follows that
a high percentile estimated from such a histogram is accurate only to the bucket: if the reported
P99 is 1.31 ms, the true value may lie anywhere between 1.31 ms and 1.57 ms.

## 16.6.3 How Several Metrics Are Measured

### Scheduling Latency and Lock Wait

`/sched/latencies:seconds` records how long a goroutine waits between becoming runnable and actually
starting to run. Michael Pratt added it in Go 1.17, and the commit message points out that the
metric is approximate: it samples instead of recording every scheduling delay
[[Pratt, 2021](#ref-pratt-2021)]. The sampling happens in goroutine state transitions
[[Go Authors, 2026e](#ref-go-authors-2026e)]:

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

`gTrackingPeriod` is 8: of every 8 times a goroutine leaves the running state, only one is tracked,
and state transitions during tracking have to call `nanotime` to read the time. State transitions
lie on the hot path of scheduling, and sampling cuts this cost to one eighth. The price is that the
counts in the histogram are only about one eighth of all scheduling events: the shape of the
distribution is representative, but the counts are not the total number of schedulings.
`/sync/mutex/wait/total:seconds` reuses the same tracking; it is a total, so it is multiplied by 8
when accumulated, and the comment reads: "because we're sampling, we have to multiply by our
sampling period to get a more representative estimate of the absolute value".

### The Memory Limit

A service with a memory limit (`GOMEMLIMIT`) often needs to monitor how far it is from the limit.
The documentation of `runtime/debug.SetMemoryLimit` gives the quantity that the runtime actually
controls [[Go Authors, 2026f](#ref-go-authors-2026f)]:

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

Of all the memory mapped by the runtime, the part already returned to the operating system does not
count toward the limit. Monitoring should compare this difference with `/gc/gomemlimit:bytes` rather
than look only at `/memory/classes/total:bytes`.

### Goroutine States

Go 1.26 adds a group of new scheduler metrics: the number of goroutines by state,
`/sched/goroutines/not-in-go:goroutines`, `/sched/goroutines/runnable:goroutines`,
`/sched/goroutines/running:goroutines` and `/sched/goroutines/waiting:goroutines`; the total number
of goroutines created since program start, `/sched/goroutines-created:goroutines`; and the number of
threads owned by the runtime, `/sched/threads/total:threads` [[Knyszek, 2025](#ref-knyszek-2025);
[Go Authors, 2026g](#ref-go-authors-2026g)]. The need for such metrics was raised as early as 2016
(Go issue #15490). The descriptions stress that these counts are approximate, and that the sum over
the states is not guaranteed to equal `/sched/goroutines:goroutines`
[[Go Authors, 2026a](#ref-go-authors-2026a)]. A persistently high number of runnable goroutines
means the available processors cannot run them in time; a number of waiting goroutines that grows
monotonically over time hints at a possible goroutine leak
([16.1 Runtime Deadlock Detection](./deadlock.md)).

### Non-Default GODEBUG Behavior

Go 1.21 established GODEBUG as a compatibility mechanism: a fix that changes existing behavior
usually comes with a GODEBUG setting through which a program can temporarily keep the old behavior.
In the design document describing this mechanism, Russ Cox proposed that the runtime provide, for
each setting, a counter `/godebug/non-default-behavior/<name>:events` that records how many times
the program executed the old behavior because of a non-default setting [[Cox, 2022](#ref-cox-2022);
[Cox, 2023](#ref-cox-2023)]. The reasoning is that developers need to know when a setting can be
removed safely: testing is only a first step, and production metrics can confirm the conclusion of
the tests; if a production system keeps reporting a count of zero, there is strong evidence for
removing the setting.

Take `panicnil` as an example. Since Go 1.21, `panic(nil)` is turned into a panic with
`*runtime.PanicNilError`, and the result of `recover` is no longer `nil`; setting
`GODEBUG=panicnil=1` restores the old behavior. The following program runs under this setting:

```go {run=true env="GODEBUG=panicnil=1"}
package main

import (
	"fmt"
	"runtime/metrics"
)

func main() {
	defer func() {
		fmt.Printf("result of recover(): %v\n", recover())
		s := []metrics.Sample{{Name: "/godebug/non-default-behavior/panicnil:events"}}
		metrics.Read(s)
		fmt.Println("panicnil:events =", s[0].Value.Uint64())
	}()
	panic(nil)
}
```

The output is:

```
result of recover(): <nil>
panicnil:events = 1
```

Without this setting, `recover` returns `panic called with nil argument` and the count is 0. Only
executing the old behavior is counted; merely setting GODEBUG is not, which is exactly the
information needed to judge whether the old behavior is still used.

## 16.6.4 Connecting to a Monitoring System

The standard library's `expvar` is the simplest outlet. When the package is imported, it registers
`GET /debug/vars` on the default `ServeMux` and publishes two variables, `cmdline` and `memstats`,
in JSON format [[Go Authors, 2026b](#ref-go-authors-2026b)]:

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

`memstats` calls `runtime.ReadMemStats` on every evaluation, so each request to `/debug/vars` stops
the world once ([12.8.4 Two Read Interfaces](../../part4memory/ch12alloc/mstats.md)). The output of
`expvar` also cannot express histograms or labels; it suits debugging, not high-frequency production
monitoring.

In production the more common approach is for Prometheus to scrape the `/metrics` endpoint that a
service exposes periodically [[Prometheus Authors, n.d.a](#ref-prometheus-authors-nda)]. In version
1.12.0 (January 2022) of the official client library `client_golang`, the Go collector switched to
`runtime/metrics` on Go 1.17 and above and exported about 80 new metrics by default; version 1.12.2
(May 2022) withdrew this default and restored a set of metrics equivalent to `MemStats`, with the
new metrics requiring explicit opt-in. Version 1.20.0 (August 2024) added three metrics to the
default set, `go_gc_gogc_percent`, `go_gc_gomemlimit_bytes` and `go_sched_gomaxprocs_threads`, on
the grounds that the Go team recommends them
[[Prometheus Authors, n.d.b](#ref-prometheus-authors-ndb)]. The changelog does not explain why the
default was withdrawn. In my view, this back and forth reflects the trade-offs in choosing a default
metric set: in Prometheus each histogram expands by bucket into many time series, so the more
metrics are exported, the higher the cost of storage and queries, while a change of the default
affects every service that upgrades the client library. When all metrics are needed, they can be
enabled explicitly:

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
		collectors.WithGoCollectorRuntimeMetrics(collectors.MetricsAll), // export all runtime/metrics metrics
	))
	http.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	http.ListenAndServe(":2112", nil)
}
```

The monitoring system scrapes these cumulative counters and histograms at a fixed interval, takes
the difference between adjacent readings to get the rate and distribution within each time window,
and then draws charts and raises alerts from them, for example "the P99 of scheduling latency over
the last five minutes exceeds 10 ms". This differencing is the same thing as reading a histogram
twice and subtracting bucket by bucket, as described above.

## 16.6.5 Metrics, Profiles and Traces

The data produced by the diagnostic tools of this chapter can be distinguished by the question each
answers:

| Data | Question answered | Form | Implementation in Go |
| --- | --- | --- | --- |
| Metrics | Is the system healthy overall, and what is the trend | Continuous aggregate values and distributions | `runtime/metrics`, `expvar` (this section) |
| Profiles | Which code consumes the resources | Samples aggregated by call stack | `runtime/pprof` ([16.5 Benchmarking and Performance Profiling](./perf.md)) |
| Traces | What exactly happened during a period of time | Events in time order | `runtime/trace` ([16.3 Execution Tracing](./trace.md)) |
| Logs | The context of a discrete event when it happened | Structured records | `log/slog` ([7.3 Error Formatting and Context](../../part2lang/ch07errors/context.md)) |

OpenTelemetry currently supports the signals traces, metrics and logs (plus baggage for propagating
context), while profiles are still being defined
[[OpenTelemetry Authors, n.d.](#ref-opentelemetry-authors-nd)]. Overhead and information content
both increase across the four, so they are often used in order from the broad to the specific:
metrics run continuously and raise an alert when a trend looks abnormal; profiles attribute the
abnormal resource consumption to code; traces and logs then reconstruct what individual requests
went through. For example, if monitoring finds the live heap growing steadily, collect a heap
profile to find the call stacks that allocate the most; if the problem is occasional tail latency,
collect an execution trace and look at the scheduling and garbage collection events in that period.
All four kinds of data are provided by the Go standard library: `runtime/metrics` and `expvar`,
`runtime/pprof`, `runtime/trace`, and `log/slog`, added in Go 1.21
[[Go Authors, 2026d](#ref-go-authors-2026d)].

## Further Reading

- <a id="ref-cox-2022"></a>[Cox, 2022] Russ Cox. *Proposal: Extended backwards compatibility for
  Go.* Go design document, 2022.
  https://go.googlesource.com/proposal/+/master/design/56986-godebug.md The design of the GODEBUG
  compatibility mechanism, which proposes the non-default-behavior counters.
- <a id="ref-cox-2023"></a>[Cox, 2023] Russ Cox. internal/godebug: export non-default-behavior
  counters in runtime/metrics. Go commit 213495a4a6, 2023. https://go.dev/cl/453618 Shipped in Go
  1.21.
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. *Go 1.22 Release Notes.* 2024.
  https://go.dev/doc/go1.22
  `/sync/mutex/wait/total:seconds` starts counting locks inside the runtime.
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Package runtime/metrics.*
  https://pkg.go.dev/runtime/metrics The key-value metric interface, `Sample`, `Value`,
  `Float64Histogram`, `All` and the complete metric list; this section follows
  src/runtime/metrics/doc.go, description.go and histogram.go of Go 1.26.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Package expvar.*
  https://pkg.go.dev/expvar The `/debug/vars` JSON endpoint, which publishes `memstats` and
  `cmdline` by default; this section follows src/expvar/expvar.go of Go 1.26.
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Package runtime, type
  MemStats.* https://pkg.go.dev/runtime#MemStats The legacy fixed-field memory statistics and their
  stop-the-world read semantics.
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Package log/slog.*
  https://pkg.go.dev/log/slog
  Structured logging.
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors. src/runtime/histogram.go
  (`timeHistogram`), src/runtime/proc.go (`casgstatus`), src/runtime/runtime2.go
  (`gTrackingPeriod`). Go 1.26 source.
  https://github.com/golang/go/tree/release-branch.go1.26/src/runtime
- <a id="ref-go-authors-2026f"></a>[Go Authors, 2026f] The Go Authors. *Package runtime/debug, func
  SetMemoryLimit.* https://pkg.go.dev/runtime/debug#SetMemoryLimit
- <a id="ref-go-authors-2026g"></a>[Go Authors, 2026g] The Go Authors. *Go 1.26 Release
  Notes.* 2026. https://go.dev/doc/go1.26 Adds the scheduler metrics that count goroutines by state.
- <a id="ref-hdrhistogram-authors-nd"></a>[HdrHistogram Authors, n.d.] *HdrHistogram: A High Dynamic
  Range (HDR) Histogram.* http://hdrhistogram.org/
- <a id="ref-knyszek-2020"></a>[Knyszek, 2020] Michael Knyszek. Go issue #37112. *runtime: API for
  unstable metrics.* 2020. https://github.com/golang/go/issues/37112
  The motivation for `runtime/metrics` and the argument for replacing `MemStats`;
  see [12.8.4 Two Read Interfaces](../../part4memory/ch12alloc/mstats.md) for details.
- <a id="ref-knyszek-2022a"></a>[Knyszek, 2022a] Michael Anthony Knyszek. runtime: shrink time
  histogram buckets. Go commit 87eda2a782, 2022. https://go.dev/cl/427615 Shipped in Go 1.20.
- <a id="ref-knyszek-2022b"></a>[Knyszek, 2022b] Michael Anthony Knyszek. runtime/metrics: add
  /sync/mutex/wait/total:seconds metric. Go commit 63ceff95fa, 2022. https://go.dev/cl/427618
  Shipped in Go 1.20; fixes Go issue #49881.
- <a id="ref-knyszek-2022c"></a>[Knyszek, 2022c] Michael Anthony Knyszek. runtime/metrics: add CPU
  stats. Go commit b7c28f484d, 2022. https://go.dev/cl/404307 Shipped in Go 1.20; fixes Go issue
  #47216.
- <a id="ref-knyszek-2025"></a>[Knyszek, 2025] Michael Anthony Knyszek. runtime/metrics: add metrics
  for goroutine sched states. Go commit 13df972f68, 2025. https://go.dev/cl/690397 Shipped in Go
  1.26; corresponds to Go issue #15490.
- <a id="ref-opentelemetry-authors-nd"></a>[OpenTelemetry Authors, n.d.] *Signals.* OpenTelemetry
  documentation. https://opentelemetry.io/docs/concepts/signals/
- <a id="ref-pratt-2021"></a>[Pratt, 2021] Michael Pratt. runtime,runtime/metrics: add metric to
  track scheduling latencies. Go commit bedfeed54a, 2021. https://go.dev/cl/308933 Shipped in Go
  1.17. The commit message notes that it was mainly written by Michael Knyszek.
- <a id="ref-prometheus-authors-nda"></a>[Prometheus Authors, n.d.a] Prometheus Authors.
  *Instrumenting a Go application / client_golang.*
  https://prometheus.io/docs/guides/go-application/ ; https://github.com/prometheus/client_golang
  The `/metrics` endpoint and the runtime metrics collector.
- <a id="ref-prometheus-authors-ndb"></a>[Prometheus Authors, n.d.b] Prometheus Authors.
  *client_golang CHANGELOG.* https://github.com/prometheus/client_golang/blob/main/CHANGELOG.md
  Changes to the default metrics of the Go collector in versions 1.12.0, 1.12.2 and 1.20.0.
- This book: [12.8 Memory Statistics](../../part4memory/ch12alloc/mstats.md),
  [13.3 Trigger Frequency and the Pacing Algorithm](../../part4memory/ch13gc/pacing.md),
  [16.3 Execution Tracing](./trace.md), [16.5 Benchmarking and Performance Profiling](./perf.md),
  [7.3 Error Formatting and Context](../../part2lang/ch07errors/context.md),
  [16.1 Runtime Deadlock Detection](./deadlock.md).
