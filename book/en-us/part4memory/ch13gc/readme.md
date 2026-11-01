---
weight: 4200
title: "Chapter 13 Garbage Collector"
bookCollapseSection: true
---

# Chapter 13 Garbage Collector

- [13.1 The Basic Idea of Garbage Collection](./basic.md)
- [13.2 Write Barrier Techniques](./barrier.md)
- [13.3 Trigger Frequency and the Pacing Algorithm](./pacing.md)
- [13.4 Scan Marking and Mark Assist](./mark.md)
- [13.5 Sweeping and Bitmaps](./sweep.md)
- [13.6 Mark Termination Phase](./termination.md)
- [13.7 Safe-Point Analysis](./safe.md)
- [13.8 The Generational Hypothesis and Generational Collection](./generational.md)
- [13.9 The Request Hypothesis and the Request-Oriented Collector](./roc.md)
- [13.10 Finalizers](./finalizer.md)
- [13.11 Green Tea: Locality-Aware Marking](./greentea.md)
- [13.12 Past, Present, and Future](./history.md)
- [13.13 A Unified Theory of Garbage Collection](./unifiedgc.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
When is the best time to do a GC? When nobody is looking. Using camera
to track eye movement when subject looks away do a GC.
</I></br>
<div class="quote-right">
-- Rick Hudson, "Go GC: Latency Problem Solved", 2015
</div>
</div>

In his GopherCon 2015 talk, Hudson posed this question right after the slide that named GC latency
as the main obstacle. After the joke, the next two slides gave two other answers: pop up a spinning
icon while waiting on the network, or trade throughput for lower GC latency. Go 1.5 chose the last
one: the collector runs concurrently with the program and takes a share of CPU time in exchange for
shorter pauses ([13.12.2](./history.md)). Over the following decade the collector's evolution has
largely revolved around the same problem: how to strike a better balance among pause time, CPU
overhead and memory footprint.

This chapter examines how Go's collector makes that trade. [13.1](./basic.md) introduces
reachability, mark-sweep and the tricolor abstraction, and places Go among the kinds of collectors.
[13.2](./barrier.md) covers the write barrier that concurrent marking requires, and the hybrid write
barrier Go adopted. [13.3](./pacing.md) through [13.7](./safe.md) follow the stages of one
collection cycle: how the pacer uses `GOGC` and the soft memory limit to decide when to start a
cycle, how mark workers and mark assists share the marking work, how sweeping reclaims dead objects,
how the mark termination phase decides that marking is complete, and how the collector uses stack
maps to find pointers on stacks. [13.8](./generational.md) and [13.9](./roc.md) cover two designs
that were tried and not adopted, generational collection and request-oriented collection.
[13.10](./finalizer.md) covers finalizers, cleanup functions and weak pointers.
[13.11](./greentea.md) covers Green Tea, enabled by default since Go 1.26. [13.12](./history.md)
reviews the collector's evolution in chronological order, and [13.13](./unifiedgc.md) revisits Go's
collector through the unified theory of tracing and reference counting. For how objects are
allocated, see [Chapter 12](../ch12alloc/readme.md).
