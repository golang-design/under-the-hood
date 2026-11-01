---
weight: 6100
title: "Chapter 18 GPU and Heterogeneous Compute"
bookCollapseSection: true
---

# Chapter 18 GPU and Heterogeneous Compute

- [18.1 Crossing the FFI Boundary](./boundary.md)
- [18.2 The Scheduler and Blocking Foreign Calls](./sched.md)
- [18.3 The Divide Between Device Memory and the Garbage Collector](./memory.md)
- [18.4 The Asynchronous Programming Model](./model.md)

The GPU is the most typical form of heterogeneous compute. It has its own memory, its own execution
model and its own command queues, sits on the host side, and is connected to a Go program through a
single FFI boundary. This chapter is about that boundary itself; the graphics, inference and agent
chapters that follow all build on its conclusions.

Section 18.1 covers the cost of crossing: the fixed cost of a cgo call, the asynchronous semantics
of GPU commands ("return once enqueued"), kernel launch overhead, how asynchronous submission,
operator fusion and CUDA Graphs reduce the number of crossings, and the ways of avoiding cgo
altogether (purego, Wasm, a pure Go rewrite, an out-of-process service). Section 18.2 covers how
blocking foreign calls affect the scheduler: how sysmon takes back a P stuck in C code, why
concurrent blocking calls inflate the thread count, how an extra M is borrowed when a foreign thread
calls back into Go, and how a single owner goroutine locked to its thread handles the thread
affinity of device contexts. Section 18.3 covers the divide between device memory and the Go heap:
why device addresses are not governed by the pointer rules, how `runtime.Pinner` and page-locked
memory differ as two kinds of "pinning", why an asynchronous transfer requires extending the pin
until the transfer completes, and what unified memory changes and what it does not. Section 18.4
covers how three kinds of parallelism relate: goroutine concurrency, GPU SIMT and CPU SIMD; how
streams and events connect to goroutines; the experimental `simd` package in Go 1.27; and the
criteria for deciding whether a computation is worth handing to a GPU.
