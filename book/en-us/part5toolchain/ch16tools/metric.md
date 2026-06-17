---
weight: 5206
title: "16.6 Runtime Metrics"
---

# 16.6 Runtime Metrics

Profiling ([16.5](./perf.md)) and tracing ([16.3](./trace.md)) belong to the family of "pull it in to diagnose when something goes wrong" tools: they cost a fair amount, produce a lot of output, and suit the case where you already suspect a problem somewhere and want to capture a window of time or a single request to look at closely. But in production the more common question is not "profile this for me right now"; it is "has this service been healthy over the past week, when did it start degrading, and should we page someone at midnight?" Answering questions like these does not rely on a one-off deep dive. It relies on **continuous, low-cost, long-retainable numbers**: how big the heap is, how often GC runs, whether the goroutine count is climbing, whether the tail of scheduling latency is rising. These numbers are **runtime metrics**.

The difference between metrics and profiles is at heart "aggregate vs. detail" and "always-on vs. on-demand." A profile attributes every allocation, every slice of CPU, to a specific call stack; it carries a lot of information and is expensive to collect. A metric keeps only an aggregated scalar or distribution; a single read is nearly free, so you can sample it every few seconds and keep sampling for months. This section explains the two interfaces Go exposes for metrics, how they evolved, and how metrics plug into a complete observability stack.

## 16.6.1 From MemStats to runtime/metrics

Historically, the only entry point for a program to read runtime memory metrics was `runtime.ReadMemStats`, which fills a `MemStats` struct ([12.8](../../part4memory/ch12alloc/mstats.md)):

```go
// runtime.MemStats: fields are hard-wired into the struct (excerpt)
type MemStats struct {
    Alloc      uint64 // heap bytes currently occupied by live objects
    HeapInuse  uint64 // heap bytes including in-use spans
    NumGC      uint32 // number of completed GC cycles
    PauseTotalNs uint64       // cumulative STW pause (nanoseconds)
    PauseNs    [256]uint64    // ring buffer of the most recent 256 pauses
    // ... plus about thirty more fields
}

var m runtime.MemStats
runtime.ReadMemStats(&m) // reading requires a brief stop-the-world
```

This interface has three hard limitations. First, the fields are **hard-wired** into the struct: for the runtime to expose a new metric, it has to add a field to `MemStats` and change a public API, which is bound by Go's compatibility promise and so is done cautiously, leaving many internal states with no way out at all. Second, to obtain a self-consistent snapshot, `ReadMemStats` briefly **stops the world** on every read, a cost that is not negligible under high-frequency collection. Third, the pause information amounts to a single `PauseNs` ring array plus cumulative totals; to know "what is the P99 of the pauses" you have to compute it yourself from the raw array, and that array only holds the most recent 256 entries, having long since dropped the long-term distribution.

Go 1.16 introduced the **`runtime/metrics`** package to address these problems systematically. It changes metrics from "struct fields" into **"name + value"** key-value pairs: each metric is identified by a string key of the form `/gc/heap/allocs:bytes`, where the key is a **path** and a **unit** separated by a colon (encoding the unit into the key is deliberate: if the unit changes, the semantics most likely change too, and that should be a new key). Adding a metric is just adding a row to the runtime's metric table, touching no existing API, which lets the metric set **evolve freely** along with the runtime, and even allows different Go implementations to expose different metric sets.

The reading interface is built around three types. `Sample` is a "name + value" slot for one sampling; `Value` is a type-tagged union; `ValueKind` records whether the value is a `uint64`, a `float64`, or a **histogram**:

```go
// runtime/metrics: a key-value, extensible metric interface (sketch)
type Sample struct {
    Name  string // metric name, must be one of the names listed by metrics.All()
    Value Value  // filled in by Read
}

type Value struct {
    kind   ValueKind // KindUint64 / KindFloat64 / KindFloat64Histogram / KindBad
    scalar uint64    // scalar value, interpreted by kind
    // non-scalar values such as histograms are stored separately via a pointer
}

func (v Value) Kind() ValueKind            { return v.kind }
func (v Value) Uint64() uint64             { /* panics if kind does not match */ }
func (v Value) Float64() float64           { /* ... */ }
func (v Value) Float64Histogram() *Float64Histogram { /* ... */ }
```

Reading means first filling in the names you want to read, then handing them to `metrics.Read` to fill the values in batch. The runtime promises that the `Kind` of a given metric is **guaranteed not to change**, so the caller can safely assert the type of a known metric directly; only when a specified name does not exist will the corresponding `Value` be `KindBad`:

```go
import "runtime/metrics"

// a few metrics worth monitoring continuously: heap, GC frequency, goroutine count, scheduling latency distribution
var samples = []metrics.Sample{
    {Name: "/memory/classes/heap/objects:bytes"}, // heap occupied by live objects
    {Name: "/gc/cycles/total:gc-cycles"},          // cumulative GC cycles, frequency derivable from it
    {Name: "/sched/goroutines:goroutines"},        // number of live goroutines
    {Name: "/sched/latencies:seconds"},            // scheduling latency distribution (histogram)
}

func collect() {
    metrics.Read(samples) // reuse the same slice to avoid allocating each time
    heap := samples[0].Value.Uint64()
    gcCount := samples[1].Value.Uint64()
    goroutines := samples[2].Value.Uint64()
    latency := samples[3].Value.Float64Histogram()
    _ = heap; _ = gcCount; _ = goroutines; _ = latency
}
```

Unlike `MemStats`, `Read` does not need a global stop-the-world to fetch scalars; a single collection is light enough to put inside a goroutine that fires every second and runs indefinitely.

## 16.6.2 Distribution Over Average: Histograms and Tail Latency

The most valuable step `runtime/metrics` takes over `MemStats` is turning a class of metrics into **distributions** rather than scalars. Scheduling latency `/sched/latencies:seconds`, the various STW pauses `/sched/pauses/total/gc:seconds`, and heap allocation sizes `/gc/heap/allocs-by-size:bytes` all have values that are a `Float64Histogram`:

```go
// runtime/metrics.Float64Histogram: the distribution of a set of values (sketch)
type Float64Histogram struct {
    Counts  []uint64  // count per bucket; Counts[n] falls in [Buckets[n], Buckets[n+1])
    Buckets []float64 // bucket boundaries, monotonically increasing; len(Buckets) == len(Counts)+1
}
```

Why a distribution? Because for metrics like latency, **the average lies**. A service with an average scheduling latency of 50 microseconds sounds fine, but if 1% of goroutines wait 10 milliseconds before being scheduled onto a CPU, the average flattens this long tail completely, and it is precisely that 1% that determines the stutter the user feels. Monitoring latency means watching **quantiles** (P50, P99, P999), and a quantile can only be estimated from a distribution, never derived back from an average. The histogram exists for exactly this: it preserves the shape of the entire distribution at bucket granularity.

Estimating a quantile from a histogram means accumulating counts along the buckets and finding the bucket where the cumulative fraction first crosses the target quantile:

```go
// estimate the q-th quantile (0<q<1) from a Float64Histogram, returning the bucket's lower bound
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
            return h.Buckets[i] // it falls in this bucket; take its lower bound as the estimate
        }
    }
    return h.Buckets[len(h.Buckets)-1]
}
```

Bucket boundary granularity determines estimation accuracy. The runtime chose a **log-linear** bucket distribution for latency metrics: the high bits split into "super-buckets" of different magnitudes by exponent, and each super-bucket is then linearly subdivided into several sub-buckets, so that across latencies spanning several orders of magnitude it keeps a roughly constant relative resolution. This contrasts with `MemStats.PauseNs`, that ring array which only stores the most recent 256 raw values: the histogram loses no history, has no count limit, and naturally supports merging across processes and across time windows (just add two histograms together), exactly the form a monitoring system is happy to consume.

## 16.6.3 Metrics Are Each Subsystem's Window to the Outside

The metrics `runtime/metrics` exposes cover nearly every subsystem this book has dissected, and reading these keys is reading the runtime's situation at this very moment. By path prefix they fall roughly into a few families:

- `/gc/*` and `/memory/classes/*`: the panorama of garbage collection and memory ([12](../../part4memory/ch12alloc),
  [13](../../part4memory/ch13gc)). `/gc/heap/live:bytes` is the live heap marked by the previous GC,
  `/gc/heap/goal:bytes` is the target heap size for the current cycle, and their ratio is exactly the quantity the GC pacer ([13.4](../../part4memory/ch13gc/pacing.md))
  is regulating; differencing `/gc/cycles/total:gc-cycles` over time gives the GC frequency; `/memory/classes/total:bytes`
  is all the memory the runtime maps from the system, and it is the number the `GOMEMLIMIT` soft cap actually watches.
- `/sched/*`: the scheduler's state ([9](../../part3concurrency/ch09sched)). `/sched/goroutines:goroutines`
  is the number of live goroutines, and a continuous rise is often a sign of a goroutine leak; `/sched/latencies:seconds` is
  the scheduling latency distribution discussed above; `/sched/gomaxprocs:threads` is the current `GOMAXPROCS`.
- `/sched/pauses/*` and `/cpu/classes/*`: quantifying GC's interference with the application. `/sched/pauses/total/gc:seconds`
  is the distribution of STW pauses caused by GC (the old key `/gc/pauses:seconds` is deprecated and points to it); `/cpu/classes/gc/total:cpu-seconds`
  estimates the CPU consumed by GC, and comparing it with `/cpu/classes/total:cpu-seconds` tells you GC's CPU tax rate.
- `/sync/mutex/wait/total:seconds`: the cumulative time goroutines have spent blocked on `sync.Mutex`/`sync.RWMutex` and the runtime's
  internal locks; taking its rate gives a rough view of whether global lock contention is worsening, and for a closer look you switch to mutex profiling ([16.5](./perf.md)).

None of these metrics is a side channel tailored for some particular tool; they are the standard outlets through which the runtime opens up its internal counters. `metrics.All()`
returns at any time the complete list of `Description` entries supported by the current version (with name, English description, `Kind`, and whether the metric is cumulative),
from which you can discover the metric set dynamically at runtime rather than hard-coding it, which is exactly how an interface designed for version compatibility ought to be used.

## 16.6.4 Plugging Into the Observability Stack

Reading the metrics out is not enough on its own; you have to **collect them continuously, store them remotely, visualize them, and alert on them** to form an operable pipeline. Go provides two layers of entry points along this pipeline.

The lightest layer is the standard library's `expvar`. It hangs variables in JSON form on an HTTP endpoint (default `/debug/vars`),
and at package initialization it has already `Publish`ed `memstats` (a JSON rendering of a `runtime.MemStats`) and `cmdline`.
Simply importing it anonymously in your program gets you a memory metrics endpoint for free:

```go
import (
    _ "expvar" // auto-registers /debug/vars and publishes memstats, cmdline
    "expvar"
    "net/http"
)

// you can also publish custom metrics, e.g. write the sampled heap size into an exported integer variable
var heapLive = expvar.NewInt("heap_live_bytes")

func init() {
    go http.ListenAndServe(":6060", nil) // /debug/vars is already hung on the default mux
}
```

`expvar` wins on zero dependencies and being available at a moment's notice, suiting debugging and lightweight introspection; but its JSON format is not the common language of monitoring systems, and it does not directly support histograms and labels. The layer more commonly used in production is the **Prometheus client library**: the official
`client_golang` includes a built-in collector that translates `runtime/metrics` metrics (histograms included) into Prometheus's
text format, hung on the conventional `/metrics` endpoint:

```go
import (
    "net/http"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
    // promhttp.Handler() collects Go runtime metrics (go_* / process_*) by default
    http.Handle("/metrics", promhttp.Handler())
    http.ListenAndServe(":2112", nil)
}
```

Downstream the pipeline is standardized: Prometheus scrapes `/metrics` on a schedule and stores the time series in its own database; Grafana connects to Prometheus
to draw dashboards; alerting rules (such as "`/sched/goroutines` doubles within five minutes" or "GC pause P99 exceeds 10ms") are
triggered by Prometheus's Alertmanager. In the cloud-native era, "the Go service exposes `/metrics`, Prometheus scrapes,
Grafana displays" is almost the default assembly. Go's position in it is clear: provide a **lightweight, extensible, whole-runtime-covering**
metrics source, and leave the storage, querying, and alerting, which are language-agnostic, to mature external systems.

## 16.6.5 The Three Pillars of Observability, and Logs

Sorting this chapter's diagnostic tools by the industry's "three pillars of observability" makes the whole diagnostic map clear:

| Pillar | Question answered | Form | Implementation in Go |
| --- | --- | --- | --- |
| Metrics | how is the system overall, what is the trend | continuous aggregated numbers / distributions | `runtime/metrics`, `expvar` (this section) |
| Traces | what exactly happened this one time, where is it slow | a timeline of events | execution tracing ([16.3](./trace.md)), distributed tracing |
| Profiles | which code the resources went into | aggregation of where resources go | `pprof` ([16.5](./perf.md)) |

Each does its own job, yet they connect to one another: metrics handle **continuous monitoring** and alert when a trend goes abnormal; traces answer **where one specific request is slow**; profiles handle **attributing some resource consumption to code**. Monitoring alerts find the heap is growing, you switch to an allocation profile to
locate which code is allocating, then use a trace to see where GC stalls within one specific request, a typical "from surface to point"
diagnostic path.

Beyond the three pillars there is usually a fourth category, **logs**. Since Go 1.21 the standard library's `log/slog`
([7.3](../../part2lang/ch07errors/context.md)) provides structured logging, turning a log from a single string line into a key-value record that can be filtered, aggregated, and alerted on by
field, filling in exactly the piece of "recording the context of discrete events." Worth pointing out: Go provides
all four of these infrastructures **either built in or via official packages**: metrics in `runtime/metrics` and `expvar`, tracing in
`runtime/trace`, profiling in `runtime/pprof`, and logging in `log/slog`. A Go service has fairly deep
self-observation ability out of the box, with no heavy dependence on external APM probes. This also explains why Go is especially suited to writing server programs that need to run for a long time and need
to be watched continuously by operators: observability is not bolted on after the fact, but a capability the runtime and standard library prepared from the start.

## Further Reading

1. The Go Authors. *Package runtime/metrics.* https://pkg.go.dev/runtime/metrics
   (the key-value metric interface, `Sample`/`Value`/`Float64Histogram`, `All` and the complete metric list)
2. Michael Knyszek. *Proposal: API for unstable runtime metrics (#37112).* 2020.
   https://github.com/golang/go/issues/37112 (the design motivation for `runtime/metrics` and the case for replacing `MemStats`)
3. The Go Authors. *Package expvar.* https://pkg.go.dev/expvar
   (the `/debug/vars` JSON endpoint, publishing `memstats` and `cmdline` by default)
4. The Go Authors. *Package runtime, type MemStats.* https://pkg.go.dev/runtime#MemStats
   (the old fixed-field memory statistics and its stop-the-world read semantics)
5. Prometheus Authors. *Instrumenting a Go application / client_golang.*
   https://prometheus.io/docs/guides/go-application/ ,
   https://github.com/prometheus/client_golang (the `/metrics` endpoint and the runtime metrics collector)
6. The Go Authors. *Package log/slog.* https://pkg.go.dev/log/slog (structured logging)
7. This book: [12.8 Memory Statistics](../../part4memory/ch12alloc/mstats.md),
   [13.4 GC Pacing](../../part4memory/ch13gc/pacing.md), [16.3 Performance Tracing](./trace.md),
   [16.5 Benchmarking and Profiling](./perf.md), [7.3 Error Formatting and Context](../../part2lang/ch07errors/context.md).
