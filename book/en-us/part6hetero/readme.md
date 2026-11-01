---
weight: 6000
title: "Part VI Heterogeneous Compute and Go in the AI Era"
bookCollapseSection: true
---

# Part VI Heterogeneous Compute and Go in the AI Era

- [Chapter 18 GPU and Heterogeneous Compute](./ch18gpu)
- [Chapter 19 Graphics](./ch19graphics)
- [Chapter 20 AI Inference and Serving](./ch20inference)
- [Chapter 21 AI Agent Runtimes](./ch21agent)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Cgo is not Go.</I></br>
<div class="quote-right">
-- Rob Pike, "Go Proverbs", 2015
</div>
</div>

The first five parts dealt with a relatively closed system: the scheduler multiplexes goroutines
onto operating system threads, the allocator and garbage collector manage Go's own heap, and the
compiler and linker assemble all of it into a statically linked executable. Over the past decade, a
great deal of computation has moved outside this system: tensors live in GPU memory, model weights
are measured in gigabytes, and graphics drivers and inference engines are mostly implemented in C,
C++ or vendor runtimes. A Go program that wants to use these capabilities must cooperate with code
and memory outside the runtime's jurisdiction.

The epigraph, one of Pike's Go proverbs, speaks to the cost of that cooperation: once C code is
called, many of Go's guarantees no longer hold ([15.6](../part5toolchain/ch15compile/cgo.md)). This
part discusses how Go works in a heterogeneous environment made of accelerators, external runtimes
and remote models. CUDA, Metal, llama.cpp and MCP all appear, but the point is not to introduce
these frameworks; it is to use them to examine how the mechanisms of the first five parts operate
beyond the runtime boundary. Frameworks change quickly, while the problems they solve are
comparatively stable.

What these workloads have in common is a **foreign function interface** (FFI) boundary. Submitting
work to a GPU, calling a local inference runtime, or handing a frame to a graphics driver all take
Go code out of the runtime's managed territory and into foreign execution that the runtime cannot
preempt, whose memory it cannot trace, and whose duration it cannot predict. The most common way
across this boundary is cgo; some libraries instead use techniques such as purego to call system
dynamic libraries directly without enabling cgo ([Chapter 18](./ch18gpu/readme.md)). Either way,
three problems recur at the boundary.

The first is how the scheduler copes with an invisible block. A kernel launch or a cross-device copy
is, to the runtime, merely a foreign call that is slow to return. A goroutine inside a cgo call
still holds its P; only after the call has blocked for longer than a sysmon period (at least 20
microseconds) can sysmon retake the P and hand it to another thread
([9.8](../part3concurrency/ch09sched/sysmon.md)). If the foreign library calls back into Go on a
thread it created itself, the runtime must also bring that unfamiliar thread under temporary
management.

The second is the boundary between the garbage collector and foreign memory. GPU memory is not in
the Go heap; the collector cannot see it, and the program must release it explicitly. Host memory
handed to foreign code is still managed by the collector: the cgo pointer-passing rules state that
after the call returns, C code may retain a pointer to such memory only if it has been pinned with
`runtime.Pinner`. Go's current collector does not move heap objects, and these rules leave room for
a future collector that might ([15.6](../part5toolchain/ch15compile/cgo.md)).

The third is matching the concurrency model. Asynchronous GPU execution, batching in inference
services and streaming output from agents are not naturally shaped like goroutines. Whether the
channels of [Chapter 10](../part3concurrency/ch10chan/readme.md) and the context of
[11.8](../part3concurrency/ch11sync/context.md) can handle backpressure, timeouts, fan-in and
fan-out is one of the questions this part sets out to answer.

The part has four chapters, which proceed along this boundary from near to far.
[Chapter 18](./ch18gpu/readme.md) covers GPUs and heterogeneous compute: the FFI boundary, how
blocking foreign calls affect scheduling, the line between GPU memory and the Go heap, and
asynchronous programming models; it is the foundation for the other chapters.
[Chapter 19](./ch19graphics/readme.md) covers graphics: how the rendering pipeline divides work
between CPU and GPU, why OpenGL contexts and window systems confine rendering and event handling to
particular operating system threads, and software rendering and rendering in the browser.
[Chapter 20](./ch20inference/readme.md) covers AI inference and serving: why Go appears more often
on the inference and serving side than on the training side, how local inference runtimes are
integrated, how tokens and tensors are represented, and batching and streaming in a service.
[Chapter 21](./ch21agent/readme.md) covers the runtime of AI agents: the agent control loop, tool
calling and MCP, and backpressure and cancellation in streaming output.

Reading this part requires no prior knowledge of CUDA or deep learning. It requires the foundations
laid in the first five parts: what a system call is, what preemption is, how the collector decides
that an object is reachable, and how a channel transfers ownership of data between goroutines. With
these in hand, heterogeneous compute and AI turn out to be applications of the same principles in a
new setting.
