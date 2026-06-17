---
weight: 5203
title: "16.3 Execution Tracing"
---

# 16.3 Execution Tracing

`pprof` ([16.5](./perf.md)) answers the question "which functions is the time being spent in". It aggregates CPU samples taken over a window into a call tree and tells you that `json.Marshal` accounts for 30% of the CPU. But it cannot answer another class of question: a request took 50ms, and for 45ms of it the goroutine **was not running at all**, it was waiting. Waiting for what? A lock? The network? Interrupted by GC? Or it wanted to run but had no P available ([9.2](../../part3concurrency/ch09sched/steal.md))? A CPU profile knows nothing about "waiting", because it only samples the stack that is currently executing, and a blocked goroutine is on no CPU at all, so it is naturally never sampled.

Answering "why is it waiting" requires another tool, the **execution tracer**. It does not do statistical sampling; instead it **records runtime events one by one**, arranged into a single timeline by nanosecond-precision timestamp: which goroutine was created, started running, blocked, was woken, and ended at which instant; when each P started and stopped scheduling; which phase each GC reached; when each system call entered and returned. Hand this timeline to `go tool trace` to render, and you can see, millisecond by millisecond, exactly what happened inside the program. This section covers what it records, how to use it, and how in recent years it has evolved from "heavy and complete" toward "light and on demand".

## 16.3.1 What the Tracer Records: A Timeline of Runtime Events

The execution tracer is built into the runtime (`runtime/trace.go`). What it captures is not the function calls of user code but **state transitions at the runtime and scheduler level**. The design comments in `runtime/trace.go` lay out this list of events clearly:

- **Goroutine lifecycle**: creation (the go statement), start of running, blocking, being woken, exit;
- **Reasons for blocking**: blocking on a channel send or receive, on a `sync.Mutex`, on network I/O (the netpoller, [9.9 The Network Poller](../../part3concurrency/ch09sched/poller.md)), and on a `select` are each a different event type;
- **Scheduling activity of each P**: when a P starts, stops, and is preempted;
- **GC-related events**: mark start, mark end, the various STW (stop-the-world) pauses, and changes in heap size ([13.3](../../part4memory/ch13gc/pacing.md));
- **System calls**: entry, return, and the moment a P is handed back because the system call blocked.

Most events carry a **timestamp with nanosecond precision** and a **stack backtrace**. This means a trace tells you not only "a block happened here" but also "which line of code, at what depth in the call stack, it blocked at". Laying these events out on the time axis by P and by goroutine, `go tool trace` draws an interactive timeline from which you can read directly: at this instant, how many Ps are doing work, which goroutine is running on which P, why it stopped, and whether GC is contending with the application for CPU.

Its design principles are worth a mention, so as to understand why it can achieve low overhead. The tracer gives **each M its own set of write buffers**; an M writes events in place into its own buffer, with no need for cross-thread synchronization; it then advances in units of "generations", performing a global synchronization point at intervals to flush the previous generation's buffers out to the reader. The events themselves are encoded extremely compactly: a one-byte event type (the table of `EvGoCreate`, `EvGoStart`, `EvGoBlock`, `EvProcStart`, `EvGCBegin` in `internal/trace/tracev2`) followed by several LEB128 variable-length integers. A "goroutine blocked" event, landed on disk, is no more than:

```text
EvGoBlock | timestamp(varint) | reason(varint) | stackID(varint)
```

Timestamps and stacks are stored as "values relative within the current generation" or as "indices into the string table or stack table", rather than inlining the full string, which compresses a single event down to a few bytes. It is precisely these few points, "per-M local buffers + compact encoding + no inlining of duplicated data", that let the runtime overhead of tracing be squeezed into an acceptable range. So as not to depend on clock correctness, the tracer also gives each G and P a sequence counter, encoding the **partial order** between events directly into the data stream, so that `go tool trace` can reconstruct the correct causal timeline even under out-of-order writes across many cores.

## 16.3.2 Collecting a Trace with `runtime/trace`

The most direct usage is to mark off a window of time within the program and write the trace for that window into a file. `runtime/trace` exposes just two entry-point functions, `trace.Start(w io.Writer) error` and `trace.Stop()`:

```go
import (
    "os"
    "runtime/trace"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()

    if err := trace.Start(f); err != nil { // start recording runtime events
        log.Fatal(err)
    }
    defer trace.Stop()                      // stop and flush the buffers

    runMyProgram() // events during this execution go into trace.out
}
```

Open the collected `trace.out` with `go tool trace trace.out`, and it starts a local web server that renders a zoomable timeline. Besides hand-writing `Start/Stop`, there are two more convenient routes: adding `go test -trace=trace.out` in a test or benchmark gets you a trace file directly; anonymously importing `net/http/pprof` into a service program mounts an endpoint at `/debug/pprof/trace`, from which you can pull an online trace window on demand while running.

Runtime events alone are sometimes not enough to pin down latency at the **business** level, because the tracer does not understand which goroutine activity corresponds to your "single request". For this `runtime/trace` provides three kinds of **user annotation** that overlay business semantics onto the timeline:

```go
// region: annotate a time interval within one goroutine (enter and exit together, can nest)
trace.WithRegion(ctx, "encode", func() {
    encodeResponse(w, resp)
})

// task: annotate a logical task that may span goroutines and span time (such as one RPC)
ctx, task := trace.NewTask(ctx, "http-request")
defer task.End()

// log: drop a categorized, timestamped message onto the timeline
trace.Log(ctx, "cache", "miss")
```

`go tool trace` can gather, by task, the events scattered across multiple goroutines into a single logical chain, and can compute, by region, the time distribution of a stretch of code. `trace.IsEnabled()` lets you check whether tracing is on before annotating, to avoid needless overhead. In this way runtime events (why it is waiting) and business semantics (what it is doing) are aligned onto the same time axis.

## 16.3.3 What `go tool trace` Shows You

The main view of `go tool trace` puts time on the horizontal axis and lays out one row per P (logical processor) on the vertical axis, drawing each goroutine as a series of colored blocks on the P it belongs to. Reading this picture, a few typical phenomena are recognizable at a glance:

- **A P row blank for a long stretch**: a P sits idle while a goroutine is waiting to run, indicating a scheduling problem or load imbalance;
- **All P rows filled by GC at once**: a mark assist or STW is contending with the application for CPU, direct evidence that GC is disturbing latency;
- **A goroutine stops after some event and is only woken much later**: open it, and the stack backtrace will tell you which line it blocked at and whether it was waiting on a lock or the network.

Besides the timeline, the tool offers several derived views: goroutine analysis (a breakdown of each goroutine's running, blocked, and waiting time), network/synchronization/system-call blocking profiles, and the distribution of scheduling latency. In other words, **`pprof` gives you an aggregated call tree, and `go tool trace` gives you a frame-by-frame documentary of execution**. The former is good at "who eats CPU", the latter at "which stretch of waiting the time was spent in", and the two answer orthogonal questions.

## 16.3.4 Lowering the Overhead and the Flight Recorder

Execution tracing long had a sore point: **overhead**. Once the early implementation was turned on, the runtime overhead was considerable, and the trace file it produced grew linearly with time, a few seconds being a few hundred MB, wholly unsuited to leaving on continuously in production. So it could only "reproduce after the fact", but the very thing you most want to catch is often that kind of latency spike that occurs sporadically once every few hours and cannot be reproduced.

In 1.21 Go **rewrote** the tracer as an experimental feature, and made it the default in 1.22 (the overhaul behind this was led by Michael Knyszek, see further reading). After the rewrite the overhead dropped sharply, and more importantly it introduced the "generation" structure described above, making each generation of trace data **self-contained** (each generation re-enumerates the state of all live goroutines). This property of self-containment makes it possible to keep only the **most recent few generations** and discard older data, which is precisely the foundation of the **flight recorder**.

The flight recorder is like an aircraft's black box: it maintains a **sliding window** in memory, continuously retaining the trace of the most recent stretch of time, and normally **does not write to disk**, dumping this recent history all at once only at the moment you judge that "something went wrong". Go 1.25 **officially promoted it into the standard library** `runtime/trace` from the experimental package `golang.org/x/exp/trace` (proposal #63185). Its API is just five methods, and using it is almost the same as an ordinary trace:

```go
// Go 1.25: the flight recorder enters the standard library runtime/trace
fr := trace.NewFlightRecorder(trace.FlightRecorderConfig{
    MinAge:   5 * time.Second, // keep at least this much recent history in the window (default 10s)
    MaxBytes: 16 << 20,        // upper bound on memory the window occupies (default 10 MiB)
})
if err := fr.Start(); err != nil { // start recording continuously in memory, without writing to disk
    log.Fatal(err)
}
defer fr.Stop()

// ...the program keeps running, the flight recorder always retains "the most recent stretch"...

// in a callback that detected an anomaly (such as a slow request), snapshot the most recent window
if latency > threshold {
    f, _ := os.Create("spike.trace")
    fr.WriteTo(f) // write out the in-memory sliding window, getting the full trace of the last few seconds before the incident
    f.Close()
}
```

`FlightRecorderConfig` has only two knobs, `MinAge` (the minimum duration of the window) and `MaxBytes` (the upper bound on the window's memory), defaulting to 10 seconds / 10 MiB; the runtime trades off between the two, neither letting the window get so short that it misses the scene nor letting it grow without bound. `WriteTo` snapshots the current window to any `io.Writer`, and what you get is an ordinary trace that can be opened with `go tool trace`. Only one flight recorder may be active at any given moment, but it can coexist with a regular `trace.Start` consumer.

The significance of this for observability engineering is not small: it turns tracing from "heavy and complete, only reproducible after the fact" into "light and on demand, resident at hand". You keep the flight recorder running the whole time, adding almost no steady-state overhead, and only at the instant an alert fires, an SLO is breached, or a slow request is caught by middleware do you look back at what the scheduler and GC actually did over the last few seconds before the incident. Those "sporadic, hard-to-reproduce" tail latencies in production, for the first time, have a means of being caught in the act.

Low overhead is not without its cost either. The current implementation allows only one flight recorder active at a time throughout (the proposal notes this is a restriction that may be relaxed in the future); the window size is bounded indirectly by `MinAge` and `MaxBytes`, and the runtime trims by generation, so how long a snapshot actually covers will float with event density, and under high throughput, if `MaxBytes` is set too small, the window may be shorter than `MinAge`. Driving tracing overhead further down to "always on by default, resident at the same tier as metrics", and giving trace data a stable, cross-version parseable external format like pprof has, is work still being pushed forward in this direction (see the overhaul design document for details).

## 16.3.5 The Diagnostic Trio: Each with Its Own Role

Putting Go's diagnostic tools side by side makes the division of labor clear. The three answer three different classes of question:

| Tool | Question it answers | Data form | Typical scenario |
| --- | --- | --- | --- |
| `pprof` ([16.5](./perf.md)) | **Which functions** the resource (CPU/memory) is spent in | aggregated samples | CPU hotspots, attributing memory usage |
| Execution tracing (this section) | **What happened on the timeline and why it waited** | per-event sequence | tail latency, scheduling anomalies, GC interference |
| `runtime/metrics` ([16.6](./metric.md)) | How healthy the system is **overall** | continuous metrics | monitoring and alerting, capacity assessment |

`pprof` does **resource attribution**, answering "who is eating CPU, who is occupying memory"; execution tracing does the **event timeline**, answering "how scheduling and blocking unfolded over a stretch of time"; `runtime/metrics` does **health measurement**, answering "how GC frequency, heap size, and goroutine count change over time". The common route when facing a problem is: first look at metrics to spot the anomaly (latency rising, GC growing more frequent), use pprof to locate which stretch of code ate the resource, and if the problem lies in "waiting" rather than "computing", then use trace to see the causality on the timeline. The three complement one another, covering different facets from aggregate to per-event, from resource to time series.

Go **builds all three into the standard library and toolchain**, so you can profile your own program deeply without bringing in a third-party APM, which is a source of confidence for Go in observability. The execution tracer is especially special: it faces the runtime internals head-on (the scheduler, GC, the netpoller), making visible the **actual operation** of those mechanisms covered in the earlier parts of this book. Reading a trace picture is almost watching [9 The Scheduler](../../part3concurrency/ch09sched) and [13 Garbage Collection](../../part4memory/ch13gc) perform live in your own program; the "P contending for work, GC marking, goroutines queued on the netpoller" that you could ordinarily only imagine from the source and the documentation become, at this moment, segments of colored blocks on the screen that you can click open and zoom into.

## Further Reading

1. The Go Authors. *Package runtime/trace.* https://pkg.go.dev/runtime/trace ;
   *Command trace (`go tool trace`).* https://pkg.go.dev/cmd/trace
2. Dmitry Vyukov. *Go Execution Tracer (design proposal).* 2014.
   https://go.googlesource.com/proposal/+/master/design/17432-traces.md
3. Michael Knyszek. *More predictable benchmarking with `testing.B.Loop`; Execution tracer overhaul & flight recorder.* The Go Blog, 2024.
   https://go.dev/blog/execution-traces-2024
4. Michael Knyszek et al. *Execution tracer overhaul (design document).*
   https://go.googlesource.com/proposal/+/master/design/60773-execution-tracer-overhaul.md
5. The Go Authors. *Flight recorder API in `runtime/trace` (Go 1.25, proposal #63185).*
   https://go.dev/issue/63185
6. The Go Authors. *`runtime/trace.go`, `src/runtime/trace/`.*
   https://github.com/golang/go/tree/master/src/runtime/trace
7. This book: [16.5 Benchmarking and Profiling](./perf.md), [16.6 Runtime Statistics](./metric.md),
   [9 The Scheduler](../../part3concurrency/ch09sched), [13 Garbage Collection](../../part4memory/ch13gc).
