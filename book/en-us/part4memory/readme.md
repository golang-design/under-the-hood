---
weight: 4000
title: "Part IV Memory"
bookCollapseSection: true
---

# Part IV Memory

- [Chapter 12 Memory Allocator](./ch12alloc)
- [Chapter 13 Garbage Collector](./ch13gc)
- [Chapter 14 Execution Stack Management](./ch14stack)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>On-the-fly garbage collection: an exercise in cooperation.</I></br>
<div class="quote-right">
-- Edsger W. Dijkstra, Leslie Lamport, et al., Communications of the ACM (1978)
</div>
</div>

Go programmers request memory with `new`, `make` and composite literals, but never release it
explicitly. Where memory comes from and when it can be reused is decided entirely by the runtime,
and these decisions directly affect a program's latency, throughput and memory footprint. The
quotation above is the title of a 1978 paper by Dijkstra, Lamport and others. The paper introduced
tricolor marking, which lets a collector run concurrently with a program that keeps modifying
pointers, hence "on-the-fly" collection; Go's concurrent collector is built on this idea
([13.1](./ch13gc/basic.md)).

This part has three chapters. Chapter 12 covers the memory allocator: it descends from TCMalloc,
divides objects into size classes, serves the vast majority of allocations from a per-P private
cache, and when that cache runs out requests memory from the central cache and then the page heap,
level by level. Chapter 13 covers the garbage collector: tricolor marking and the write barrier,
pacing, the implementation of marking and sweeping, and recent developments such as finalizers and
the Green Tea collector. Chapter 14 covers how a goroutine's execution stack is allocated, grown and
shrunk. The allocator decides where objects are placed, the collector decides when they can be
reused, and the stack holds data that does not escape to the heap; together they determine the
memory behavior of a Go program.
