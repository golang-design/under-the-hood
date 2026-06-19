---
weight: 4109
title: "12.9 Past, Present, and Future"
---

# 12.9 Past, Present, and Future

The allocator did not arrive fully formed. It has been polished over and over as Go evolved. Tracing this line of evolution makes clear which trade-offs the current design grew out of, and gives a glimpse of where it is headed. One judgment worth keeping in mind first: nearly every major change to the allocator was not made to make "allocation itself faster," but to re-place a stone in the three-way game among allocation speed, memory footprint, and cooperation with the garbage collector. Once this main thread is read, the several rewrites below stop looking like isolated version trivia and become instead the same engineering problem being solved again and again.

## 12.9.1 Past: From tcmalloc to Becoming Go-ish

The Go allocator started life as a Go port of **tcmalloc** ([12.1](./basic.md)): it inherited that whole skeleton of thread caches, size classes, and a central repository (the mcache / mcentral / mheap of [12.2](./component.md) are exactly its three-tier counterpart). This skeleton solves the same old problem: lock contention on `malloc` under many threads. tcmalloc's answer is to keep the vast majority of allocations inside a per-thread local cache, completed lock-free, and Go inherited this judgment as is, only swapping "per-thread" for the "per-P" ([9.3](../../part3concurrency/ch09sched/mpg.md)) that fits its scheduling model better.

But the Go allocator gradually became "Go-ish," growing things tcmalloc neither had nor needed. The most fundamental of these is the metadata that serves **precise garbage collection**. C's tcmalloc serves manual `free`: the caller explicitly tells it "here, take this block back," and it need not know where inside an object the pointers are and where the scalars are. To it, a block of memory is just a stretch of bytes waiting to be reused. Go has no manual `free`. Reclamation is taken over by the GC, and a precise GC must be able to start from any heap address and decide "is this a pointer, and is the object it points to alive?" That requires the allocator, at the moment it hands out each block of memory, to attach enough type and liveness information: the pointer bitmap of each span (which words are pointers), the `noscan` flag on a size class indicating whether it contains pointers, and the mark bits shared with sweeping (the `gcmarkBits` on mspan in [12.2](./component.md), and [13.5](../ch13gc/sweep.md)).

This layer of metadata is the deepest divide between the Go allocator and its ancestor. It is not a finishing touch but the data-structure realization of the design principle "live in symbiosis with the GC" ([12.1](./basic.md)): the instant the allocator hands out memory, it has already paved the way for the scanning and reclamation to come. The cost is real too. Every block of heap memory must pay extra space for this information, and where this information lives and how it is organized became precisely the battlefield of several later rewrites.

Placed in the broader lineage, this divide is not a Go-specific quirk but the inevitable difference between "languages with a GC" and "languages that manage memory by hand." C/C++ allocators like tcmalloc and jemalloc never record the pointer layout inside an object, because their clients (C/C++ programs) handle `free` themselves, and the allocator has no need, nor any right, to ask about an object's semantics. Runtimes with precise GC, like Java's HotSpot and Go, are the opposite: an object's type information is either encoded in the object header (HotSpot's mark word plus klass pointer) or recorded in side metadata on the heap. Go chose the latter early on (the arena side bitmap), and in recent years has partly shifted toward the former (the allocation headers of [12.9.2](#1292-present-several-key-rewrites)). This back-and-forth over "should metadata sit against the object, or be stored elsewhere" is itself a classic question that GC-bearing runtimes keep polishing.

## 12.9.2 Present: Several Key Rewrites

Laying the past decade of evolution out by version, three threads advance in alternation: the rhythm of returning memory to the operating system, scalability at the page level, and the layout of object metadata.

### Return rhythm: smooth scavenging in Go 1.12

The early allocator's strategy for returning free memory to the operating system (scavenging) leaned toward "save up a batch, then dump it all back at once." The result was a sawtooth in the memory-footprint curve, and the returning action itself could cause pauses at inopportune moments. Go 1.12 made this smooth: it switched to more continuous, on-demand background scavenging, letting a process's resident memory (RSS) track real usage rather than swing up and down. This was a calibration along the "memory footprint" dimension. It did not change the allocation fast path, yet it markedly improved both the look on the monitoring curves and the real cost of long-running services.

### Page allocator: bitmap plus radix tree in Go 1.14

Below mcentral, mheap must answer a deceptively simple question: "which stretch of contiguous pages is free?" The early implementation maintained free intervals with a treap-based structure under a single global lock. As the heap grew large and concurrency rose, the overhead of this lock and the tree operations surfaced, becoming a scalability bottleneck for large-heap services. Go 1.14 rewrote the page allocator wholesale into a **bitmap plus radix tree** structure ([12.7](./pagealloc.md)): a bitmap directly records the free state of each page, and a bitwise scan finds contiguous free pages in bulk; a multi-level radix tree then builds a sparse index over this bitmap, turning "skip whole used regions in a vast address space" into a few array accesses.

```go
// The core abstraction of the page allocator (sketch, see 12.7)
type pageAlloc struct {
    // Multi-level radix tree: each node uses a packed group of counts to
    // summarize the "longest run of free pages" and boundary conditions in
    // its subtree, narrowing the search range level by level
    summary [summaryLevels][]pallocSum

    // Bitmap (two-dimensional index of chunks): each bit marks whether a page is free
    chunks [1 << pallocChunksL1Bits]*[1 << pallocChunksL2Bits]pallocData
}
```

This rewrite struck directly at the "scalability" dimension. It lowered page-level allocation under a large heap and high concurrency from "contend for a lock plus tree operations" to "a bitwise scan plus a few index levels," so that many cores requesting memory at once are no longer serialized by the same tree. It is also the foundation for later mechanisms such as `GOMEMLIMIT`: only when accounting at the page level is cheap enough can the runtime afford to inspect and return memory frequently.

### Observable and controllable: runtime/metrics in Go 1.16, GOMEMLIMIT in Go 1.19

A good allocation strategy alone is not enough. The services running on top still need to see and to tune memory behavior. Go 1.16 introduced `runtime/metrics` ([12.8](./mstats.md)), replacing the scattered `MemStats` fields with a semantically grounded, evolvable metrics interface, so that internal state such as heap size, amount returned, and GC triggers became quantities a program can query in a stable way.

Go 1.19 added a **soft memory limit, `GOMEMLIMIT`**, on top of this. It answers a problem that long plagued production deployments: inside a container, a Go process sees only `GOGC`, a relative trigger ratio, and cannot sense the hard constraint "the host only gave me 512MB." So it either gets OOM-killed, or tunes `GOGC` overly conservatively to stay safe and wastes CPU. `GOMEMLIMIT` gives the runtime a soft target for total memory:

```bash
# Keep the runtime's total heap usage within about 600 MiB (soft limit)
GOMEMLIMIT=600MiB ./server
```

As it approaches this target, the GC triggers more aggressively to drive the heap down, and when necessary returns memory to the operating system more proactively too. It is "soft" in that it does not guarantee the limit will never be exceeded; instead it shifts the GC trigger from purely ratio-based to one that also weighs an absolute ceiling. This is a knob, dialable by the deployer, between "memory footprint" and "GC frequency (that is, CPU overhead)." Worth a mention: to keep the GC from falling into a "death spiral" of continuous reclamation that burns all the CPU on GC as it nears the limit, the runtime also sets a cap on the GC's CPU usage (about 50%) as a backstop.

### Moving object metadata: allocation headers in Go 1.22

As said earlier, the pointer bitmap that serves the GC is the Go allocator's most peculiar burden, and where it lives has long been a choice with trade-offs. The early approach stored the bitmap collectively in each arena's off-heap metadata region (the arena metadata of [12.2](./component.md)). To scan an object, the GC first had to compute which arena it belongs to, then fetch the corresponding bitmap from that separate stretch of memory. The problem is locality: the object data is in one place and the bitmap describing it in another, so scanning bounces back and forth between two regions of memory and the cache hit rate suffers.

Go 1.22 changed how small objects are stored, introducing **allocation headers**. For pointer-containing objects above a certain size, the information describing their pointer layout (a pointer to the type) is placed directly in the object's **first word**, right against the object data itself:

```go
// Key constants in runtime/internal/gc (go1.26 source)
const (
    MallocHeaderSize       = 8                        // the header takes one word
    MinSizeForMallocHeader = goarch.PtrSize * goarch.PtrBits // 512 bytes on 64-bit
)
```

The elegance of the design lies in splitting by size: pointer-containing objects small enough (`heapBitsInSpan` is true, that is, no larger than `MinSizeForMallocHeader`) keep using the compact in-span bitmap and pay nothing for that one header word; only larger objects carry a header, because for them the relative cost of one word is negligible, while what it buys is the locality of "the type information right in front of the object" during scanning. To scan such an object, the GC first reads the type from the object's first word, then walks the pointers accordingly, with metadata and data sitting near the same cache line, saving that remote access to the off-heap bitmap. This is another fine trade-off between "memory footprint" (the extra header) and "GC scan efficiency" (better locality), and its choice to treat objects differently by size is exactly the allocator's meticulousness about metadata layout.

## 12.9.3 Future: Co-Evolving with the GC

The allocator's future is tightly bound to the future of the garbage collector ([13 Garbage Collection](../ch13gc)), because the two are one body to begin with ([12.1](./basic.md)). This shows vividly in the **Green Tea GC** ([13.11](../ch13gc/greentea.md)), now landed.

Green Tea is a marking algorithm introduced in Go 1.25 and on by default since Go 1.26 (turn it off with `GOEXPERIMENT=nogreenteagc`, see `runtime/mgcmark_greenteagc.go`). Its core idea fits in one sentence: **defer scanning and process in batches by span**. Traditional tri-color marking, the moment it meets a pointer, immediately goes to scan the target object; with objects scattered across the heap, scanning becomes random access to memory, and neither cache nor prefetch can help. Green Tea does the opposite: on seeing a pointer into some span, it only marks and enqueues that span, and once enough to-be-scanned objects have accumulated on the same span, scans them all in one pass.

```text
Traditional marking: see pointer -> scan that object at once -> follow its pointers and jump away again (random heap access)
Green Tea: see pointer -> mark and enqueue the containing span -> later scan the whole span together (sequential access, prefetchable)
```

To keep reclamation **precise** while batching, Green Tea keeps two sets of mark bits per span: one is the ordinary "marked" (marks), the other indicates "scanned" (scans). When a span is dequeued for processing, it writes back the union of the two into scans and uses the difference to pick out the objects "marked but not yet scanned" to scan, so it neither scans twice nor misses a mark. The span work queue even deliberately uses FIFO rather than the LIFO common to work buffers, because experience shows FIFO is better at gathering objects of the same span together.

This algorithm places a clear demand on the allocator: **objects must be organized in a way that favors "scanning in bulk."** The mark bits at the span level, the metadata stored uniformly at the end of the span by size class, the compact arrangement of objects within a span: these were the allocator's arrangements all along, and now they become the precondition for the GC to gain locality. Put differently, how the allocator places objects directly determines how much cache and prefetch dividend Green Tea can extract. The documentation even mentions that further specializing the scan loop by size class, and even introducing SIMD to scan in bulk, are later possibilities built on top of this regular layout.

Green Tea is not without cost either. The extra set of scans bits, the maintenance of the span work queue, and the extra bookkeeping from deferred scanning are all overhead paid for locality; it does not necessarily win on workloads where "objects are sparsely scattered and never accumulate into batches," which is one reason it went through a round of large-scale measurement and calibration between the experimental switch of 1.25 and the default-on of 1.26. This confirms exactly the main thread: no single way of placing objects is optimal for all loads, and each cooperative adjustment between allocator and GC is a bet on one class of typical load, then calibrated against measurements.

Looking back over the whole history, one unchanging main thread emerges: **every change is a fresh search for balance among allocation speed, memory footprint, and GC friendliness.** Go 1.12 tuned the return rhythm, Go 1.14 solved page-level scalability, Go 1.16 / 1.19 gave the knobs for observability and control, Go 1.22 moved the home of metadata, and Go 1.25 / 1.26 made the allocation layout serve faster scanning directly. They solve the same problem. This is exactly the set of goals laid down by [12.1](./basic.md), being repeatedly rebalanced over time. One can foresee that the allocator will keep evolving toward "better locality, lower metadata overhead, and tighter cooperation with the GC," and which way it steps at each turn depends on what the GC sitting across from it wants.

## Further Reading

1. The Go Authors. *Go 1.12 Release Notes* (smoother memory scavenging).
   https://go.dev/doc/go1.12#runtime
2. The Go Authors. *Go 1.14 Release Notes* (page allocator rewritten as bitmap plus radix tree).
   https://go.dev/doc/go1.14#runtime ; Michael Knyszek. *Scaling the Go page allocator.*
   https://go.googlesource.com/proposal/+/master/design/35112-scaling-the-page-allocator.md
3. The Go Authors. *Go 1.16 Release Notes* (`runtime/metrics`).
   https://go.dev/doc/go1.16#runtime
4. The Go Authors. *Go 1.19 Release Notes* (soft memory limit `GOMEMLIMIT`).
   https://go.dev/doc/go1.19#runtime ; Michael Knyszek. *Soft memory limit.*
   https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md
5. The Go Authors. *Go 1.22 Release Notes* (allocation headers).
   https://go.dev/doc/go1.22#runtime
6. The Go Team. *Green Tea GC design discussion* (go1.25 / 1.26).
   https://github.com/golang/go/issues/73581 ; source at
   `runtime/mgcmark_greenteagc.go`.
7. This book's [12.1 Design Principles](./basic.md), [12.2 Components](./component.md),
   [12.7 Page Allocator and Scavenging](./pagealloc.md), [13 Garbage Collection](../ch13gc).
