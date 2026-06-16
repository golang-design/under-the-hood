---
weight: 5203
title: "16.3 性能追踪"
---

# 16.3 性能追踪

`pprof`（[16.5](./perf.md)）回答的是「时间花在哪些函数上」。它把一段时间里的 CPU 采样聚合
成一棵调用树，告诉你 `json.Marshal` 占了 30% 的 CPU。但它答不了另一类问题：一个请求耗了
50ms，其中 45ms 这个 goroutine **根本没在跑**，它在等。等什么？等锁？等网络？被 GC 打断？
还是想跑却没有 P 可用（[9.2](../../part3concurrency/ch09sched/steal.md)）？CPU 画像对「等待」
一无所知，因为它只采样正在执行的栈，一个阻塞的 goroutine 不在任何 CPU 上，自然不会被采到。

回答「为什么等」要靠另一件工具，**执行追踪器**（execution tracer）。它不做统计抽样，而是
**逐条记录运行时事件**，按纳秒级时间戳排成一条时间线：哪个 goroutine 在哪一刻被创建、开始
跑、阻塞、被唤醒、结束;每个 P 何时开始与停止调度;每次 GC 走到哪个阶段;每个系统调用何时
进出。把这条时间线交给 `go tool trace` 渲染，你能逐毫秒地看清程序里发生了什么。这一节讲它
记录什么、怎么用、以及它近年从「重而全」走向「轻而按需」的演进。

## 16.3.1 追踪器记录什么：运行时事件的时间线

执行追踪器内建在运行时里（`runtime/trace.go`），它捕获的不是用户代码的函数调用，而是
**运行时与调度器层面的状态转移**。`runtime/trace.go` 的设计注释把这份事件清单列得很清楚：

- **goroutine 生命周期**：创建（go 语句）、开始运行、阻塞、被唤醒、退出;
- **阻塞的原因**：在 channel 收发、在 `sync.Mutex`、在网络 I/O（netpoller，[9.7](../../part3concurrency/ch09sched/poll.md)）、在 `select` 上各是不同的事件类型;
- **每个 P 的调度活动**：P 何时启动、停止、被抢占;
- **GC 相关事件**：标记开始、标记结束、各 STW（stop-the-world）停顿、堆大小的变化（[13.3](../../part4memory/ch13gc/pacing.md)）;
- **系统调用**：进入、返回、以及因系统调用阻塞而交还 P 的时刻。

大多数事件都附带一个**纳秒精度的时间戳**和一份**栈回溯**。这意味着 trace 不仅告诉你「这里
发生了一次阻塞」，还告诉你「是哪一行代码、在哪个调用栈深处阻塞的」。把这些事件按 P、按
goroutine 在时间轴上铺开，`go tool trace` 画出一张可交互的时间线，你能直接读出：这一刻有
几个 P 在干活、哪个 goroutine 跑在哪个 P 上、它为什么停下、GC 是不是正在和业务抢 CPU。

它的设计原理值得一提，以便理解它为什么能做到低开销。追踪器给**每个 M 各配一组写缓冲**，M
把事件就地写进自己的缓冲，无需跨线程同步;再以「代」（generation）为单位推进，每隔一段时间
做一次全局同步点，把上一代的缓冲刷出给读取者。事件本身被编码得极紧凑：一个字节的事件类型
（`internal/trace/tracev2` 里那张 `EvGoCreate`、`EvGoStart`、`EvGoBlock`、`EvProcStart`、
`EvGCBegin` 的表）后面跟若干 LEB128 变长整数。一条「goroutine 阻塞」事件，落到磁盘上不过是：

```text
EvGoBlock | timestamp(varint) | reason(varint) | stackID(varint)
```

时间戳与栈都以「在本代内的相对值」或「字符串表/栈表里的下标」存放，而非内联完整字符串，这把
单条事件压到了几个字节。正是「每 M 本地缓冲 + 紧凑编码 + 不内联重复数据」这几点，让追踪的
运行时开销得以压到可接受的范围。追踪器为了不依赖时钟正确性，还给每个 G 和 P 配了序列计数器，
把事件间的**偏序**直接编码进数据流，使 `go tool trace` 即便在多核乱序写入下也能重建出正确的
因果时间线。

## 16.3.2 用 `runtime/trace` 采集一段追踪

最直接的用法是在程序里圈定一段时间，把这段时间的 trace 写进文件。`runtime/trace` 暴露的
入口就两个函数，`trace.Start(w io.Writer) error` 与 `trace.Stop()`：

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

    if err := trace.Start(f); err != nil { // 开始记录运行时事件
        log.Fatal(err)
    }
    defer trace.Stop()                      // 停止并刷出缓冲

    runMyProgram() // 这段执行期间的事件都会进入 trace.out
}
```

采到的 `trace.out` 用 `go tool trace trace.out` 打开，它会起一个本地 Web 服务，渲染出可缩放
的时间线。除手写 `Start/Stop` 外，还有两条更省事的路子：测试与基准里加 `go test -trace=trace.out`
就能直接得到 trace 文件;给服务程序匿名导入 `net/http/pprof`，便会在 `/debug/pprof/trace`
挂上一个端点，运行中按需拉取一段在线追踪。

光有运行时事件，有时还不够定位**业务**层面的延迟，因为追踪器看不懂你的「一次请求」对应哪些
goroutine 活动。为此 `runtime/trace` 提供了三种**用户标注**，把业务语义叠加到时间线上：

```go
// region：标注一个 goroutine 内的时间区间（同进同出，可嵌套）
trace.WithRegion(ctx, "encode", func() {
    encodeResponse(w, resp)
})

// task：标注一段可能跨 goroutine、跨时间的逻辑任务（如一次 RPC）
ctx, task := trace.NewTask(ctx, "http-request")
defer task.End()

// log：在时间线上打一条带分类的时间戳消息
trace.Log(ctx, "cache", "miss")
```

`go tool trace` 能按 task 把分散在多个 goroutine 上的事件聚成一条逻辑链，按 region 统计某段
代码的耗时分布。`trace.IsEnabled()` 可在标注前判断追踪是否开启，避免无谓开销。这样，运行时
事件（为什么等）与业务语义（在做哪件事）就对齐到了同一条时间轴上。

## 16.3.3 `go tool trace` 看到的画面

`go tool trace` 的主视图把横轴设为时间、纵轴按每个 P（逻辑处理器）分行，每个 goroutine 在它
所属的 P 上画成一段段色块。读这张图，几个典型现象一眼可辨：

- **某条 P 行长时间空白**：有 P 闲着，却有 goroutine 在等待运行，说明存在调度或负载不均的问题;
- **所有 P 行同时被 GC 占满**：一次标记辅助或 STW 正在和业务抢 CPU，这是 GC 干扰延迟的直接证据;
- **某个 goroutine 在某事件后停住、很久才被唤醒**：点开它，栈回溯会告诉你它阻塞在哪行、等的是锁还是网络。

除时间线外，工具还提供几张派生视图：goroutine 分析（每个 goroutine 的运行、阻塞、等待时间
拆解）、网络/同步/系统调用阻塞画像、以及调度延迟分布。换句话说，**`pprof` 给你一棵聚合的
调用树，`go tool trace` 给你一部逐帧的运行纪录片**。前者擅长「谁吃 CPU」，后者擅长「时间都
耗在哪段等待上」，二者回答的是正交的问题。

## 16.3.4 低开销化与飞行记录仪

执行追踪长期有个痛点：**开销**。早期实现一旦开启，运行时开销可观，且生成的 trace 文件随时间
线性膨胀，几秒钟就是几百 MB，根本不适合在生产环境常开。于是它只能「事后复现」，可偏偏最想
抓的，往往是那种几小时才偶发一次、复现不出来的延迟尖刺。

Go 在 1.21 把追踪器**重写**为一个实验特性、并在 1.22 设为默认（背后是 Michael Knyszek 主导的
overhaul，见延伸阅读）。重写后开销大幅下降，更关键的是引入了前述的「分代」结构，让每一代
trace 数据**自包含**（每代都会重新枚举所有存活 goroutine 的状态）。自包含这一性质，使得只
保留**最近若干代**、丢弃更早的数据成为可能，这正是**飞行记录仪**（flight recorder）的地基。

飞行记录仪像飞机的黑匣子：它在内存里维护一个**滑动窗口**，持续保留最近一段时间的追踪，平时
**不落盘**，只在你判断「出事了」的那一刻，把这段最近历史一次性 dump 出来。Go 1.25 把它从
`golang.org/x/exp/trace` 的实验包**正式提升进标准库** `runtime/trace`（提案 #63185）。它的
API 就五个方法，用起来与一段普通追踪几乎一样：

```go
// Go 1.25：飞行记录仪进入标准库 runtime/trace
fr := trace.NewFlightRecorder(trace.FlightRecorderConfig{
    MinAge:   5 * time.Second, // 窗口至少保留最近这么久（默认 10s）
    MaxBytes: 16 << 20,        // 窗口占用的内存上限（默认 10 MiB）
})
if err := fr.Start(); err != nil { // 开始在内存里持续记录，不落盘
    log.Fatal(err)
}
defer fr.Stop()

// ……程序持续运行，飞行记录仪始终保留「最近一段」……

// 在某个检测到异常（如一次慢请求）的回调里，把最近窗口快照下来
if latency > threshold {
    f, _ := os.Create("spike.trace")
    fr.WriteTo(f) // 把内存中的滑动窗口写出，得到出事前最近几秒的完整 trace
    f.Close()
}
```

`FlightRecorderConfig` 只有 `MinAge`（窗口的最小时长）与 `MaxBytes`（窗口的内存上限）两个
旋钮，缺省是 10 秒 / 10 MiB;运行时在二者之间取舍，既不让窗口太短而错过现场，也不让它无界
膨胀。`WriteTo` 把当前窗口快照到任意 `io.Writer`，得到的就是一份能用 `go tool trace` 打开的
普通 trace。同一时刻只允许一个飞行记录仪活动，但它可以和一个常规的 `trace.Start` 消费者并存。

这件事的意义在可观测性工程上不小：它把追踪从「重而全、只能事后复现」变成「轻而按需、随身
常驻」。你让飞行记录仪一直转着，几乎不增加稳态开销，只在告警触发、SLO 越界、或一次慢请求
被中间件捕获的瞬间，回看出事前最近几秒里调度器与 GC 到底干了什么。生产环境里那些「偶发、
难复现」的尾延迟，第一次有了被当场抓住的手段。

低开销也并非没有代价。当前实现允许全程同时只有一个飞行记录仪活动（提案里注明这是可在未来
放宽的限制）;窗口大小由 `MinAge` 与 `MaxBytes` 间接约束，运行时按代裁剪，因此快照实际覆盖
多长时间会随事件密度浮动，高吞吐下若 `MaxBytes` 偏小，窗口可能短于 `MinAge`。把追踪开销
进一步降到「始终默认开启、与 metrics 同级常驻」，以及让 trace 数据像 pprof 那样有稳定的、
跨版本可解析的对外格式，是这一方向仍在推进的工作（详见 overhaul 设计文档）。

## 16.3.5 诊断三件套：各司其职

把 Go 的诊断工具放在一起看，分工就清楚了。三者回答的是三类不同的问题：

| 工具 | 回答的问题 | 数据形态 | 典型场景 |
| --- | --- | --- | --- |
| `pprof`（[16.5](./perf.md)） | 资源（CPU/内存）花在**哪些函数** | 聚合采样 | CPU 热点、内存占用归因 |
| 执行追踪（本节） | 时间线上**发生了什么、为什么等** | 逐事件序列 | 尾延迟、调度异常、GC 干扰 |
| `runtime/metrics`（[16.6](./metric.md)） | 系统**整体健康度**如何 | 持续指标 | 监控告警、容量评估 |

`pprof` 做**资源归因**，回答「谁在吃 CPU、谁在占内存」;执行追踪做**事件时间线**，回答
「某段时间里调度与阻塞如何展开」;`runtime/metrics` 做**健康度量**，回答「GC 频率、堆大小、
goroutine 数随时间如何变化」。遇到问题时的常见路线是：先看 metrics 发现异常（延迟升高、GC
变频），用 pprof 定位是哪段代码吃了资源，若问题出在「等待」而非「计算」，再用 trace 看清
时间线上的因果。三者互补，覆盖了从聚合到逐事件、从资源到时序的不同切面。

Go 把这三者都**内建进标准库与工具链**，无需引入第三方 APM 即可对自己的程序做深度剖析，这是
Go 在可观测性上的一处底气。执行追踪器尤其特别：它直面运行时内部（调度器、GC、netpoller），
把本书前几部分讲过的那些机制的**实际运行**可视化了出来。读懂一张 trace 图，几乎就是在亲眼
看 [9 调度器](../../part3concurrency/ch09sched)、[13 垃圾回收](../../part4memory/ch13gc) 在你
自己的程序里现场演出，平时只能在源码与文档里想象的「P 在抢活、GC 在标记、goroutine 在
netpoller 上排队」，此刻成了屏幕上一段段可点开、可放大的色块。

## 延伸阅读的文献

1. The Go Authors. *Package runtime/trace.* https://pkg.go.dev/runtime/trace ;
   *Command trace（`go tool trace`）.* https://pkg.go.dev/cmd/trace
2. Dmitry Vyukov. *Go Execution Tracer（design proposal）.* 2014.
   https://go.googlesource.com/proposal/+/master/design/17432-traces.md
3. Michael Knyszek. *More predictable benchmarking with `testing.B.Loop`; Execution tracer overhaul & flight recorder.* The Go Blog, 2024.
   https://go.dev/blog/execution-traces-2024
4. Michael Knyszek 等. *Execution tracer overhaul（设计文档）.*
   https://go.googlesource.com/proposal/+/master/design/60773-execution-tracer-overhaul.md
5. The Go Authors. *Flight recorder API in `runtime/trace`（Go 1.25, proposal #63185）.*
   https://go.dev/issue/63185
6. The Go Authors. *`runtime/trace.go`、`src/runtime/trace/`.*
   https://github.com/golang/go/tree/master/src/runtime/trace
7. 本书 [16.5 基准测试与画像](./perf.md)、[16.6 运行时统计量](./metric.md)、
   [9 调度器](../../part3concurrency/ch09sched)、[13 垃圾回收](../../part4memory/ch13gc).
