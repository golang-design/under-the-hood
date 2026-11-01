---
weight: 4100
title: "Chapter 12 Memory Allocator"
bookCollapseSection: true
---

# Chapter 12 Memory Allocator

- [12.1 Design Principles](./basic.md)
- [12.2 Components](./component.md)
- [12.3 Initialization](./init.md)
- [12.4 Large Object Allocation](./largealloc.md)
- [12.5 Small Object Allocation](./smallalloc.md)
- [12.6 Tiny Object Allocation](./tinyalloc.md)
- [12.7 The Page Allocator](./pagealloc.md)
- [12.8 Memory Statistics](./mstats.md)
- [12.9 Past, Present, and Future](./history.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Memory allocation is widely considered to be either a solved problem or an insoluble one.</I></br>
<div class="quote-right">
-- Paul R. Wilson et al., "Dynamic Storage Allocation: A Survey and Critical Review", 1995
</div>
</div>

The epigraph comes from the abstract of the 1995 survey by Wilson et al. The survey goes on to
observe that earlier theoretical analyses and experimental evaluations mostly assumed that a
program's requests are random and independent, whereas real programs behave with important
regularities, and an allocator performs well in practice only if it exploits them. Go's allocator
faces one further constraint: Go has no explicit `free`, the garbage collector decides when an
object can be reused, and the collector does not move objects. The allocator must therefore be
designed together with the collector, and fragmentation can be controlled only at allocation time.

[12.1](./basic.md) covers the goals the allocator must balance, the structure it inherits from
TCMalloc, and the design of size classes and of dispatch by size and type. [12.2](./component.md)
introduces `mspan`, `mcache`, `mcentral`, `mheap` and the other components, and how they cooperate.
[12.3](./init.md) covers initialization at startup, the division of the address space, and the
reservation, mapping and commitment of memory. [12.4](./largealloc.md) through
[12.6](./tinyalloc.md) cover the allocation paths for large, small and tiny objects in turn.
[12.7](./pagealloc.md) covers the page allocator, which manages pages with bitmaps and a radix tree,
and the scavenger, which returns physical memory to the operating system. [12.8](./mstats.md) covers
how the runtime accounts for memory and reports it through `runtime.ReadMemStats`, `runtime/metrics`
and the heap profile. [12.9](./history.md) reviews the evolution of the allocator in chronological
order. The collector's implementation is in [Chapter 13](../ch13gc/readme.md), and the allocation of
goroutine execution stacks is in [Chapter 14](../ch14stack/readme.md).
