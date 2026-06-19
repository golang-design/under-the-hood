---
weight: 6000
title: "Part Six: Heterogeneous Compute and Go in the AI Era"
bookCollapseSection: true
---

# Part Six: Heterogeneous Compute and Go in the AI Era

- [Chapter 18 GPU and Heterogeneous Compute](./ch18gpu)
- [Chapter 19 Graphics](./ch19graphics)
- [Chapter 20 AI Inference and Serving](./ch20inference)
- [Chapter 21 AI Agent Runtimes](./ch21agent)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Cgo is not Go.</I></br>
<div class="quote-right">
-- Rob Pike, "Go Proverbs"
</div>
</div>

The first five parts read Go as a self-contained world. The scheduler multiplexes
goroutines onto its own threads, the allocator and garbage collector tend their own heap,
and the compiler and linker gather all of it into a single static binary. The boundary of
that world is exactly the source of its elegance. Yet over the past decade computation
itself has spilled across that boundary. Tensors flow through the GPU's device memory,
model weights are measured in gigabytes, a single inference makes hundreds of round trips
between host and device, and an AI agent is nothing but a control loop hung with tool
calls, waiting at length and producing in a stream. None of these workloads live inside
Go's world. They live outside it.

The question then sharpens: how does a language that stands on garbage collection and
goroutine scheduling deal with a heterogeneous world made of accelerators, foreign
runtimes, and remote models? This part is not a tour of frameworks. CUDA, llama.cpp,
Ollama, and MCP all appear, but they appear as evidence of some mechanism, not as the
subject to be explained. Frameworks go stale; last year's inference engine has a different
name this year. But the fundamental problem a framework solves does not go stale. As the
book said at the outset, code can always be rebuilt from scratch, but principles can
"live forever."

What brings these seemingly unrelated workloads together is that they share one fault
line: the **FFI boundary**. Whether submitting a kernel to the GPU, calling a local
inference runtime, or handing a frame to the graphics driver, Go's code must at some point
cross the cgo door, leave the runtime's managed territory, and enter a stretch of foreign
execution that it can neither preempt nor reclaim, and whose duration it does not even
know. Three mechanical problems recur on this boundary throughout the part.

First, **how the scheduler faces an invisible block**. A kernel launch, a cross-device
copy, is to the runtime just a C call that takes its time returning. The machinery of
`entersyscall`, P handoff, and sysmon preemption from Chapter 9 is put to the test here
again. And when the foreign world turns around and creates threads that call back into Go,
`needm` and `cgocallback` have to take an unfamiliar thread temporarily into the runtime.

Second, **the dividing line between the garbage collector and device memory**. Device
memory is not in Go's heap, and the collector cannot see it; the host memory handed to a
foreign call, meanwhile, may be moved or reclaimed by the collector at any moment. The
ownership and reachability of Chapters 12 and 13 come down to earth at `runtime.Pinner`
and the cgo pointer-passing rules.

Third, **the mismatch of concurrency models, and how to bridge it**. The asynchrony of the
GPU, the batching of inference, and the streaming output of an agent are none of them the
natural shape of a goroutine. The channels of Chapter 10 and the context cancellation of
Chapter 7 must prove themselves still sufficient in scenarios of backpressure, timeout,
and fan-out and fan-in.

The four chapters unfold along this boundary, from near to far. [Chapter 18](./ch18gpu)
faces GPU and heterogeneous compute head on, prying open the FFI boundary, scheduling
under a blocking call, the divide between device memory and the GC, and the asynchronous
programming model one by one; this is the mechanical foundation of the whole part.
[Chapter 19](./ch19graphics) turns to graphics, the oldest heterogeneous workload: how the
rendering pipeline splits CPU and GPU, why a graphics context is pinned to a particular
system thread, and the respective trade-offs of software rendering and rendering in the
browser. [Chapter 20](./ch20inference) walks to AI inference and serving, looking at why
Go camps at the inference and serving layer rather than the training layer, how a local
inference runtime's tensors cross the boundary, and which of the earlier mechanisms
tokenization, batching, and streaming each lean on. [Chapter 21](./ch21agent) closes on AI
agent runtimes, reducing an agent to a concurrency problem: the control loop, tool calls
and MCP, streaming and backpressure and cancellation, asking whether Go's concurrency
model is still handy on this youngest of workloads.

Reading this part does not require knowing CUDA or deep learning in advance. What it
requires is the intuition the first five parts built: what a system call is, what
preemption is, on what grounds the collector dares to move your objects, and why a channel
can transfer ownership. Bring these to the boundary, and the heterogeneous and the AI stop
being magic from another world, and become instead the same set of principles echoing
farther out.
