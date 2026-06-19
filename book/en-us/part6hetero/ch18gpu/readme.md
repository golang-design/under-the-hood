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

This chapter is the mechanical foundation of the part. The GPU is the most typical form of
heterogeneous compute: a device with its own memory, its own execution model, and its own
scheduling logic, hanging alongside the host and connected to Go by a single FFI boundary.
We begin from that boundary, watching how a cgo call leaves Go's stack and enters the
driver; then we watch how the runtime faces a block it can neither preempt nor measure;
next we draw the line between device memory and the Go heap, working out why the collector
must not touch device memory and yet threatens the host memory handed across; and finally
we return to the concurrency model itself, to see how the GPU's asynchrony meets the
concurrency of goroutines.
