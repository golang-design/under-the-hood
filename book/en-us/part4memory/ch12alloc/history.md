---
weight: 4109
title: "12.9 Past, Present, and Future"
---

# 12.9 Past, Present, and Future

Go's allocator was written in C by Cox in 2008, and its header comment says it is based on TCMalloc
[[Cox, 2008](#ref-cox-2008)]. Over the following decade or so it was rewritten in Go, the form of
the heap metadata changed several times, and the management of the address space, of pages and of
returning physical memory were each redesigned. The earlier sections have already described the
origin of each component as they introduced it. This section strings these changes together in time
and adds two histories the other sections do not cover, the rewrite of the allocator from C to Go
and the successive rewrites of the heap bitmap, before turning to several pieces of ongoing work.
The evolution on the collector side is covered in [13.12](../ch13gc/history.md).

The following table lists the main changes to the allocator by release, with the sections where each
is discussed in detail:

| Version | Main change | See |
|:----|:--------|:----|
| 2008 | Written in C, based on TCMalloc | [12.1.2](./basic.md) |
| Go 1.1 | The local cache moves from M to P | [12.1.2](./basic.md) |
| Go 1.3 | Page size grows from 4 KiB to 8 KiB; tiny object allocation introduced | [12.1.2](./basic.md), [12.6](./tinyalloc.md) |
| Go 1.4 | The runtime's internal `free` is removed; `mallocgc` is written in Go | 12.9.1 |
| Go 1.5 | The allocator is converted to Go as a whole; the heap bitmap shrinks to 2 bits per word; the heap reservation grows to 512 GB | 12.9.1, 12.9.2, [12.3.2](./init.md) |
| Go 1.7 | An allocation bitmap replaces the free list within a span | [12.2.1](./component.md) |
| Go 1.8 | The size class table is generated at build time | [12.1.2](./basic.md) |
| Go 1.9 | The free list of large spans becomes a treap; objects without pointers use separate spans | [12.7.2](./pagealloc.md), 12.9.2 |
| Go 1.11 | The heap becomes a sparse map of arenas | [12.3.2](./init.md) |
| Go 1.12 | More aggressive memory return; Linux switches to `MADV_FREE` | [12.7.7](./pagealloc.md), [12.3.4](./init.md) |
| Go 1.13 | Background scavenger; page allocation becomes first-fit | [12.7](./pagealloc.md) |
| Go 1.14 | The page allocator becomes a bitmap and radix tree; per-P page cache | [12.7](./pagealloc.md) |
| Go 1.15 | The central cache uses `spanSet` | [12.2.3](./component.md) |
| Go 1.16 | `runtime/metrics`; Linux switches back to `MADV_DONTNEED` | [12.8.4](./mstats.md), [12.3.4](./init.md) |
| Go 1.19 | Soft memory limit | [12.7.8](./pagealloc.md) |
| Go 1.20 | The heap bitmap shrinks to 1 bit per word | 12.9.2 |
| Go 1.22 | Allocation headers | [12.1.4](./basic.md), 12.9.2 |
| Go 1.24 | `mallocgc` is split into independent allocation paths; GC programs removed | [12.1.4](./basic.md), 12.9.2 |
| Go 1.26 | Heap base address randomization; wasm arenas shrink to 512 KiB; Green Tea enabled by default; `runtimefreegc` experiment | [12.3](./init.md), [12.2.1](./component.md), 12.9.4 |
| Go 1.27 | Specialized allocation functions are the default for size classes up to 80 bytes | [12.1.4](./basic.md) |

## 12.9.1 From C to Go: Go 1.4 and Go 1.5

Through Go 1.3, the runtime was written mainly in C, and the allocator was spread across files such
as `malloc.goc`, `mheap.c`, `mcentral.c` and `mcache.c`. The first step of the rewrite in Go was to
remove the parts that have no counterpart in the Go language. During the Go 1.4 development cycle,
Vyukov deleted the runtime's internal `free`, and the commit message lists five reasons
[[Vyukov, 2014](#ref-vyukov-2014)]:

```text
1. Significantly simplifies runtime.
2. This code proved to be buggy.
3. Free is incompatible with bump-the-pointer allocation.
4. We want to write runtime in Go, Go does not have free.
5. Too much code to free env strings on startup.
```

The fourth gives the fundamental motivation: the runtime was going to be written in Go, and Go has
no `free`. The third points to another incompatibility: bump-pointer allocation only advances a
pointer, so an object freed individually cannot be reused by it.

In the same month, Randall wrote a Go version of `mallocgc`, `gomallocgc`; the commit message says
that only a few calls had been switched to it so far, while the many calls in C code still used the
original C version [[Randall, 2014](#ref-randall-2014)]. The Go 1.4 release notes explain the reason
for the migration: much of the runtime was translated from C to Go so that the collector could scan
the runtime's own stacks and know precisely which variables are still live
[[Go Authors, 2014a](#ref-go-authors-2014a)]. Even so, the body of the allocator was still C when Go
1.4 shipped: in the source tree, `malloc.go` coexisted with `malloc.c`, `mheap.c`, `mcentral.c` and
`mcache.c`.

In November 2014, Cox converted the allocator and the collector to Go as a whole on the dev.cc
branch. The commit message says the conversion was done by automated tools, followed only by the
changes necessary to make the code compile and run [[Cox, 2014](#ref-cox-2014)]. This branch shipped
with Go 1.5, whose release notes announce that the compiler and runtime are now written entirely in
Go (plus a little assembler), with C no longer involved in the implementation
[[Go Authors, 2015a](#ref-go-authors-2015a)]. The mechanical translation preserved the structure and
comments of the C code, and traces remain visible today: the header comment of `mcentral.go` still
describes two long-gone lists as `c->nonempty` and `c->empty` ([12.2.3](./component.md)).

Writing Go's allocator in Go brought a constraint that did not exist in the C era: the allocator
cannot depend on the heap it manages itself. C code never allocates memory implicitly and contains
no write barriers, whereas Go code may allocate on the heap because of escape, and writing a pointer
may carry a write barrier. The runtime's development guide therefore requires that some objects be
allocated outside the garbage-collected heap, in what the document calls unmanaged memory
[[Go Authors, 2026a](#ref-go-authors-2026a)]:

```text
In general, the runtime tries to use regular heap allocation. However,
in some cases the runtime must allocate objects outside of the garbage
collected heap, in *unmanaged memory*. This is necessary if the
objects are part of the memory manager itself or if they must be
allocated in situations where the caller may not have a P.
```

Structures such as `mheap`, `mspan`, `mcentral` and `heapArena` either exist as global variables or
are allocated in unmanaged memory by `fixalloc`, `persistentalloc` and the like
([12.2.5](./component.md)), and they embed `sys.NotInHeap`. For such types the compiler forbids heap
allocation by `new`, `make` or implicit means, and writes of pointers to them can omit write
barriers. The comment on `NotInHeap` says that the latter is the real use of the mechanism: in some
places in the scheduler and allocator write barriers are not allowed, and in others they are not
worth the cost [[Go Authors, 2026b](#ref-go-authors-2026b)]. `//go:nowritebarrierrec` asks the
compiler to check that no write barrier appears in a function or in any function it calls
recursively [[Go Authors, 2026a](#ref-go-authors-2026a)]. A condition that C satisfied by nature
became, in Go, a rule the compiler checks item by item.

## 12.9.2 Evolution of Heap Metadata: Go 1.0 to Go 1.24

Precise collection requires the allocator to record, for each word on the heap, whether it is a
pointer ([12.1.5](./basic.md)). This information was originally stored in a single bitmap together
with several other pieces of metadata, and was rewritten many times afterwards:

| Version | Pointer information | Other metadata |
|:----|:--------|:----------|
| Go 1.0 | Not recorded; the interior of objects is scanned conservatively | 4 bits per word in the bitmap: allocated, no pointers (a block boundary when unallocated), marked, special record |
| Go 1.1 | The collector starts scanning by type information, recorded in the span | Same |
| Go 1.4 | 2 bits per word, distinguishing invalid, scalar, pointer and multi-word values | Plus 1 boundary bit and 1 marked bit, 4 bits per word in all |
| Go 1.5 | 1 bit per word | Boundary bit removed; the other bit is the mark bit in an object's first word, the checkmark bit in its second word, and in the remaining words means the object's description has not ended |
| Go 1.7 | Same | Mark bits move out of the heap bitmap into 1 bit per object in the span |
| Go 1.9 | Same | Objects without pointers use separate spans, distinguished by span class |
| Go 1.11 | Same | The bitmap is divided by arena and distributed sparsely with the heap |
| Go 1.16 | Same | Checkmarks move into a separate bitmap |
| Go 1.20 | 1 bit per word, read and written in word-sized batches | Plus 1 bit per word in a bitmap marking that no pointers follow |
| Go 1.22 | Objects up to 512 bytes use a bitmap at the end of the span; larger objects store a type pointer in their first word; the type pointer of a large object is stored in the span | The bitmap covering the whole heap no longer exists |
| Go 1.24 | GC programs are removed; bitmaps of large types are built by the runtime on demand | Same |

The first rows of the table are based on the source of each release
[[Go Authors, 2012](#ref-go-authors-2012); [Go Authors, 2014b](#ref-go-authors-2014b);
[Go Authors, 2015b](#ref-go-authors-2015b)]. In Go 1.1, Ziak made the collector interpret type
information while scanning [[Ziak, 2013](#ref-ziak-2013)]; the release notes say the collector
became more precise, at the cost of a little CPU time, in exchange for significantly smaller heaps,
especially on 32-bit platforms [[Go Authors, 2013](#ref-go-authors-2013)]. The changes in Go 1.11
and Go 1.16 respectively made the bitmap sparse by arena and moved checkmarks into a separate bitmap
[[Clements, 2018](#ref-clements-2018); [Clements, 2020](#ref-clements-2020)]. In Go 1.20, Randall
reduced the pointer information to 1 bit per word so that word-sized operations handle up to 64 bits
at once, and added a separate bitmap indicating that no pointers follow
[[Randall, 2022](#ref-randall-2022)].

Reading the table row by row shows that every rewrite since has moved some piece of information out
of the per-word bitmap to a place that matches the granularity at which it changes.

The boundary of an object is determined by the object size of its span. Objects in one span all have
the same size, so boundaries can be computed from addresses and need not be recorded word by word.
When Hudson removed the boundary bit, the reasoning was that finding a boundary would no longer
require reading a bitmap scattered across the heap, which reduces cache misses; the garbage
benchmark was measured to slow down by 2%, but the bitmap could now shrink to 2 bits per word
[[Hudson, 2015](#ref-hudson-2015)].

Mark state and allocation state belong to the object, not the word, and 1 bit per object suffices.
Their lifetimes also differ from pointer information: mark bits are cleared and rebuilt in every
collection cycle, whereas pointer information is written once at allocation time. After Go 1.7 moved
the mark bits into the span, sweeping could hand this cycle's mark bitmap directly to the allocator
as the allocation bitmap of the next cycle, with no free list to build ([12.2.1](./component.md))
[[Hudson, 2016](#ref-hudson-2016)].

Whether an object contains pointers is determined jointly by size class and type, and Go 1.9 encoded
it in the span class. Clements pointed out that previously, each time the collector greyed an object
it had to read the object's heap bitmap to tell whether it needed no scanning; and mixing objects
with and without pointers also lowered the density of scannable objects per page, adding to TLB
pressure [[Clements, 2017](#ref-clements-2017)].

Pointer layout is determined by the type. All objects of one type share a single type description,
yet the heap bitmap expands and writes a copy for every object at every allocation. Go 1.22 made
objects larger than 512 bytes store only a pointer to the type description, the allocation header,
and the collector expands it by type when scanning ([12.1.4](./basic.md))
[[Knyszek, 2023a](#ref-knyszek-2023a); [Go Authors, 2024](#ref-go-authors-2024)]. Smaller objects
still use a bitmap, because for them an extra 8 bytes per object costs more than the bitmap. Go 1.24
further removed GC programs, the compressed form of pointer information the compiler generated for
large types, and has the runtime build the bitmap on demand instead
[[Randall, 2024](#ref-randall-2024)].

Allocation headers bring Go closer to runtimes such as the Java virtual machine. As the HotSpot
glossary describes it, every object carries a two-word object header, whose second word points to a
metaobject describing the object's layout and behavior [[OpenJDK, n.d.](#ref-openjdk-nd)]. The
difference is that Go pays for this one word only on larger objects with pointers; objects without
pointers and objects up to 512 bytes carry no header.

The position of the allocation header also went back and forth once. With the header at the start of
the object, the object's start address is guaranteed only 8-byte alignment, whereas the allocator
had in practice provided 16-byte alignment. To preserve this property, Knyszek for a time moved the
header to the end of the slot, at the cost of slightly worse locality during scanning
[[Knyszek, 2023b](#ref-knyszek-2023b)]. Persistent regressions then appeared on the performance
dashboard, caused precisely by the header at the end: the machines used by earlier benchmarks had a
large enough L3 cache to mask the extra cache misses. The allocation header was therefore moved back
to the start of the object before Go 1.22 shipped, and the commit message admits that 16-byte
alignment was largely a by-product of the implementation and was never written into any
documentation [[Knyszek, 2023c](#ref-knyszek-2023c)].

## 12.9.3 Address Space, Pages and Returning Memory: Go 1.11 to Go 1.19

The early allocator reserved large ranges of address space and rarely returned memory. On 64-bit
platforms, Go 1.0 reserved one contiguous range of addresses for the heap, which grew to 512 GB from
Go 1.5 on ([12.3.2](./init.md)); free memory was returned only by a periodic scavenger. The Go 1.13
release notes recall that previously, after a peak, the heap could hold on to memory for more than
five minutes; the new release returns memory more aggressively so that other applications on the
same machine can use it [[Go Authors, 2019b](#ref-go-authors-2019b)].

The changes in the following releases can be summarized broadly as two shifts of focus. The first
was from address space to physical memory. Go 1.11 made the heap a set of sparse arenas, removing
the upper limit on heap size [[Go Authors, 2018](#ref-go-authors-2018)]. Go 1.12 returned memory to
the operating system more aggressively, especially when a large allocation could not reuse existing
heap space [[Go Authors, 2019a](#ref-go-authors-2019a)]. Go 1.13 added the background scavenger
([12.7.7](./pagealloc.md)). Go 1.14 rewrote the page allocator, significantly reducing lock
contention at large `GOMAXPROCS` [[Go Authors, 2020](#ref-go-authors-2020);
[Knyszek, 2019](#ref-knyszek-2019)]. The design document also points out that with a per-page
bitmap, the scavenger's job becomes conceptually much simpler: combining the allocation bitmap with
the bitmap recording scavenged state finds runs of free, unscavenged pages, which are returned with
one system call [[Knyszek, 2019](#ref-knyszek-2019)] ([12.7](./pagealloc.md)).

The second shift was to leave the observation and bounding of memory use to the deployer. Go 1.16
introduced `runtime/metrics`, a stable interface replacing functions such as `runtime.ReadMemStats`
([12.8.4](./mstats.md)) [[Go Authors, 2021](#ref-go-authors-2021)]. Go 1.19 added the soft memory
limit, which the scavenger takes as its target when returning memory ([12.7.8](./pagealloc.md))
[[Go Authors, 2022](#ref-go-authors-2022); [Knyszek, 2021](#ref-knyszek-2021)].

A reversal in how Linux returns memory shows that observability matters as much as efficiency. Go
1.12 switched to `MADV_FREE`, which is more efficient than `MADV_DONTNEED`, at the cost that the
process's resident memory does not drop until the kernel actually reclaims it
[[Go Authors, 2019a](#ref-go-authors-2019a)]. Systems that monitor processes by resident memory
therefore overestimated the memory use of Go programs, and some users had to set
`GODEBUG=madvdontneed=1`. Go 1.16 switched back to `MADV_DONTNEED`; the release notes say that
process-level statistics such as resident memory now reflect the physical memory a Go process
actually uses more accurately, and systems that had set this option to improve monitoring no longer
need it [[Go Authors, 2021](#ref-go-authors-2021)]. The differences between the two approaches on
each platform are covered in [12.3.4](./init.md).

## 12.9.4 Reducing Allocation and Collection Work: Go 1.24 to Date

In recent releases the focus has shifted from the layout of memory to the cost of allocation and
collection themselves. In Go 1.24, Knyszek split `mallocgc` into independent paths distinguished by
size and by whether the object contains pointers. The commit message says the original `mallocgc`
had many branches and complex state, and that in real programs a considerable share of allocation
time was spent in it; together with several earlier changes, the geometric mean of the time of
several allocation benchmarks fell by 11.58% [[Knyszek, 2024b](#ref-knyszek-2024b)]. Building on
this, Go 1.27 enables, by default, specialized allocation functions for size classes up to 80 bytes,
in which the size class is a compile-time constant ([12.1.4](./basic.md)).

On the collector side, Green Tea accumulates and scans objects by span
[[Knyszek and Clements, 2025](#ref-knyszek-clements-2025)], which requires the allocator to reserve
space for marking at the end of a single-page span, so the number of slots in a span is smaller than
in the size class table ([12.2.1](./component.md), [13.11](../ch13gc/greentea.md)). How the
allocator lays out objects directly affects whether the collector can exploit locality.

Another effort brings `free` back into the runtime in a different form. Go 1.26 added
`runtime.freegc`, controlled by `GOEXPERIMENT=runtimefreegc` and off by default
[[thepudds, 2025](#ref-thepudds-2025)]. Its only caller may be the compiler
[[Go Authors, 2026c](#ref-go-authors-2026c)]:

```go
// freegc must be called by the effective owner of ptr who knows
// the pointer is logically dead, with no possible aliases that might
// be used past that moment. In other words, ptr must be the
// last and only pointer to its referent.
//
// The intended caller is the compiler.
```

Unlike the `free` that Go 1.4 deleted, `freegc` is not called by hand in runtime code but inserted
by the compiler based on static analysis: an object is freed only when a pointer is proven to be the
last reference to it. The only user at present is alias analysis within escape analysis: for a local
slice grown in a loop with `s = append(s, ...)`, if the compiler can prove its backing array has no
aliases, it calls `growsliceNoAlias` instead, freeing the old backing array immediately after growth
[[Malloy, 2025](#ref-malloy-2025)]; Go 1.26 does this only for element types without pointers
[[Go Authors, 2026c](#ref-go-authors-2026c)].

A freed object is not handed back to the sweeper. It is strung onto a list in the local cache,
indexed by span class, called `reusableNoscan`, with the list pointer stored in the object's first
word. When allocating a small object without pointers, the allocator checks this list first
[[Go Authors, 2026c](#ref-go-authors-2026c)]:

```go
	// First, check for a reusable object.
	if runtimeFreegcEnabled && c.hasReusableNoscan(spc) {
		// We have a reusable object, use it.
		x := mallocgcSmallNoscanReuse(c, span, spc, size, needzero)
		mp.mallocing = 0
		releasem(mp)
		return x, size
	}
```

The free list that Go 1.7 replaced with a bitmap within the span reappears as a side list in the
local cache; `allocBits` is still rewritten only by the sweeper ([12.5.5](./smallalloc.md)). A freed
object can be reused at once, without waiting for the next collection cycle. The commit message
reports that in an experiment where `strings.Builder` freed its old buffer after growing, the
benefit increased with the number of writes, up to roughly a factor of two; it also states that the
standard library will not call `freegc` explicitly and that user code can never call it
[[thepudds, 2025](#ref-thepudds-2025)]. In Go 1.26, `freegc` handles only objects without pointers
between 16 bytes and 32 KiB minus the allocation header size; objects with pointers are left for
later commits.

## 12.9.5 Outlook

These pieces of work are all under way. After specialized allocation functions became the default in
Go 1.27, the main branch has already removed the corresponding experiment switch for Go 1.28
[[Matloob, 2026](#ref-matloob-2026)]. The tracking issue for `runtimefreegc`, #74299, is still open,
and support for objects with pointers has not yet been merged: in Go 1.26, calling `freegc` with an
object that contains pointers fails outright [[Go Authors, 2026c](#ref-go-authors-2026c)]. Attempts
to let programmers manage some memory explicitly, namely the `arena` experiment from Go 1.20 and the
memory regions design proposed in 2024, are covered in [13.12.5](../ch13gc/history.md) and
[13.12.7](../ch13gc/history.md). The memory regions design document attributes the problems of
arenas to two points: making them useful requires adding parameters to a large number of APIs, and
they combine poorly with existing mechanisms such as escape analysis
[[Knyszek, 2024a](#ref-knyszek-2024a)]. `freegc` takes another route: it changes neither the
language nor the API, and the compiler frees memory where it can prove it safe.

These directions have one thing in common: none moves objects, and none requires the mutator to keep
write barriers on all the time. Instead, they try to reduce the memory that must be allocated and
collected, or to make memory that has already been allocated be reused sooner.

## 12.9.6 Summary

Every change to the allocator has re-balanced allocation speed, memory footprint and cooperation
with the collector. The successive rewrites of the metadata moved each piece of information to a
place matching its granularity of change: the heap bitmap shrank from 4 bits per word to 1 bit per
word, and larger objects keep only a type pointer. Memory management turned from reserving address
space to controlling resident memory, and then to obeying a budget set by the deployer. The
allocation path kept cutting synchronization and branches: the local cache moved to the P, lock
contention in the central cache and page allocator was reduced step by step, and `mallocgc` was
split into independent paths specialized by size class. Go 1.4 deleted `free` in order to rewrite
the runtime in Go, and the Go 1.26 experiment brings it back into the runtime under the compiler's
control. These changes still embody the same set of goals laid out in [12.1](./basic.md); only the
balance point among them keeps moving as hardware, deployment environments and the collector change.

## Further Reading

- <a id="ref-clements-2017"></a>[Clements, 2017] Austin Clements. runtime: separate spans of noscan
  objects. Go commit 1a033b1a70, 2017. https://go.dev/cl/41251
  Shipped in Go 1.9.
- <a id="ref-clements-2018"></a>[Clements, 2018] Austin Clements. runtime: make the heap bitmap
  sparse. Go commit c0392d2e7f, 2018. https://go.dev/cl/85883 Shipped in Go 1.11.
- <a id="ref-clements-2020"></a>[Clements, 2020] Austin Clements. runtime: move checkmarks to a
  separate bitmap. Go commit d19fedd180, 2020. https://go.dev/cl/244539 Shipped in Go 1.16.
- <a id="ref-cox-2008"></a>[Cox, 2008] Russ Cox. malloc in runtime (not used by default). Go commit
  e29ce175ed, 2008. https://github.com/golang/go/commit/e29ce175eda2016b93e755b6a5ae759b5b692834
  Shipped in Go 1.
- <a id="ref-cox-2014"></a>[Cox, 2014] Russ Cox. [dev.cc] runtime: convert memory allocator and
  garbage collector to Go. Go commit 1e2d2f0947, 2014. https://go.dev/cl/167540043 Shipped in Go
  1.5.
- <a id="ref-go-authors-2012"></a>[Go Authors, 2012] The Go Authors. src/pkg/runtime/mgc0.c. Go 1
  source. https://github.com/golang/go/blob/go1/src/pkg/runtime/mgc0.c The heap bitmap with 4 bits
  per word.
- <a id="ref-go-authors-2013"></a>[Go Authors, 2013] The Go Authors. *Go 1.1 Release Notes.* 2013.
  https://go.dev/doc/go1.1
- <a id="ref-go-authors-2014a"></a>[Go Authors, 2014a] The Go Authors. *Go 1.4 Release Notes.* 2014.
  https://go.dev/doc/go1.4
- <a id="ref-go-authors-2014b"></a>[Go Authors, 2014b] The Go Authors. src/runtime/mgc0.h. Go 1.4
  source. https://github.com/golang/go/blob/go1.4/src/runtime/mgc0.h
- <a id="ref-go-authors-2015a"></a>[Go Authors, 2015a] The Go Authors. *Go 1.5 Release Notes.* 2015.
  https://go.dev/doc/go1.5
- <a id="ref-go-authors-2015b"></a>[Go Authors, 2015b] The Go Authors. src/runtime/mbitmap.go. Go
  1.5 source. https://github.com/golang/go/blob/go1.5/src/runtime/mbitmap.go The heap bitmap with 2
  bits per word.
- <a id="ref-go-authors-2018"></a>[Go Authors, 2018] The Go Authors. *Go 1.11 Release Notes.* 2018.
  https://go.dev/doc/go1.11
- <a id="ref-go-authors-2019a"></a>[Go Authors, 2019a] The Go Authors. *Go 1.12 Release
  Notes.* 2019. https://go.dev/doc/go1.12#runtime More aggressive return of memory to the operating
  system, especially when a large allocation cannot reuse existing heap space; Linux switches to
  `MADV_FREE`.
- <a id="ref-go-authors-2019b"></a>[Go Authors, 2019b] The Go Authors. *Go 1.13 Release
  Notes.* 2019. https://go.dev/doc/go1.13#runtime
- <a id="ref-go-authors-2020"></a>[Go Authors, 2020] The Go Authors. *Go 1.14 Release Notes.* 2020.
  https://go.dev/doc/go1.14#runtime
  The page allocator is rewritten as a bitmap plus radix tree.
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.16 Release Notes.* 2021.
  https://go.dev/doc/go1.16#runtime
  `runtime/metrics`; Linux switches back to `MADV_DONTNEED`.
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *Go 1.19 Release Notes.* 2022.
  https://go.dev/doc/go1.19#runtime
  The soft memory limit `GOMEMLIMIT`.
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. *Go 1.22 Release Notes.* 2024.
  https://go.dev/doc/go1.22#runtime
  Allocation headers.
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. src/runtime/HACKING.md. Go
  1.26 source. https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/HACKING.md The
  runtime's development conventions, including unmanaged memory and write-barrier-related
  directives.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  src/internal/runtime/sys/nih.go. Go 1.26 source.
  https://github.com/golang/go/blob/release-branch.go1.26/src/internal/runtime/sys/nih.go
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. src/runtime/malloc.go. Go
  1.26 source. https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/malloc.go
  `freegc` and its reuse path.
- <a id="ref-hudson-2015"></a>[Hudson, 2015] Rick Hudson. runtime: Remove boundary bit logic. Go
  commit 122384e489, 2015. https://go.dev/cl/6665 Shipped in Go 1.5.
- <a id="ref-hudson-2016"></a>[Hudson, 2016] Rick Hudson. [dev.garbage] runtime: allocate directly
  from GC mark bits. Go commit 3479b065d4, 2016. https://go.dev/cl/19470 Shipped in Go 1.7.
- <a id="ref-knyszek-2019"></a>[Knyszek, 2019] Michael Knyszek. *Scaling the Go page
  allocator.* 2019.
  https://go.googlesource.com/proposal/+/master/design/35112-scaling-the-page-allocator.md
- <a id="ref-knyszek-2021"></a>[Knyszek, 2021] Michael Knyszek. *Soft memory limit.* 2021.
  https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md
- <a id="ref-knyszek-2023a"></a>[Knyszek, 2023a] Michael Anthony Knyszek. runtime: implement
  experiment to replace heap bitmap with alloc headers. Go commit 38ac7c41aa, 2023.
  https://go.dev/cl/437955 Shipped in Go 1.22.
- <a id="ref-knyszek-2023b"></a>[Knyszek, 2023b] Michael Anthony Knyszek. runtime: make alloc
  headers footers instead. Go commit 1e250a2199, 2023. https://go.dev/cl/537886 Reverted by the next
  commit within the Go 1.22 development cycle.
- <a id="ref-knyszek-2023c"></a>[Knyszek, 2023c] Michael Anthony Knyszek. runtime: put allocation
  headers back at the start the object. Go commit 0ef169abb1, 2023. https://go.dev/cl/543255 Shipped
  in Go 1.22.
- <a id="ref-knyszek-2024a"></a>[Knyszek, 2024a] Michael Knyszek. *Memory regions* (design document
  and GitHub discussion #70257). 2024. https://go.dev/design/70257-memory-regions
  https://github.com/golang/go/discussions/70257
- <a id="ref-knyszek-2024b"></a>[Knyszek, 2024b] Michael Anthony Knyszek. runtime: refactor mallocgc
  into several independent codepaths. Go commit 8730fcf885, 2024. https://go.dev/cl/614257 Shipped
  in Go 1.24.
- <a id="ref-knyszek-clements-2025"></a>[Knyszek and Clements, 2025] Michael Knyszek, Austin
  Clements. *runtime: green tea garbage collector* (Go issue #73581, design discussion of Green Tea,
  Go 1.25 / 1.26). 2025. https://github.com/golang/go/issues/73581 ; source in
  `runtime/mgcmark_greenteagc.go`.
- <a id="ref-malloy-2025"></a>[Malloy, 2025] PJ Malloy. *Directly freeing user memory to reduce GC
  work* (Go issue #74299). 2025. https://go.dev/design/74299-runtime-freegc
- <a id="ref-matloob-2026"></a>[Matloob, 2026] Michael Matloob. internal/goexperiment: remove
  sizespecializedmalloc GOEXPERIMENT setting. Go commit 4a7645b730, 2026. https://go.dev/cl/806981
  On the main branch, targeting Go 1.28 (Go issue #80279); not yet in a stable release.
- <a id="ref-openjdk-nd"></a>[OpenJDK, n.d.] The OpenJDK Community. *HotSpot Glossary of Terms.*
  https://openjdk.org/groups/hotspot/docs/HotSpotGlossary.html
  The entries "object header" and "klass pointer".
- <a id="ref-randall-2014"></a>[Randall, 2014] Keith Randall. runtime: rewrite malloc in Go. Go
  commit 4aa50434e1, 2014. https://go.dev/cl/108840046 Shipped in Go 1.4.
- <a id="ref-randall-2022"></a>[Randall, 2022] Keith Randall. runtime: redo heap bitmap. Go commit
  6a9c674a09, 2022. https://go.dev/cl/422634
  Shipped in Go 1.20.
- <a id="ref-randall-2024"></a>[Randall, 2024] Keith Randall. runtime: get rid of gc programs for
  types. Go commit 45869f5931, 2024. https://go.dev/cl/616255 Shipped in Go 1.24.
- <a id="ref-thepudds-2025"></a>[thepudds, 2025] thepudds. runtime: add runtime.freegc to reduce GC
  work. Go commit fecfcaa4f6, 2025. https://go.dev/cl/673695 Shipped in Go 1.26, off by default.
- <a id="ref-vyukov-2014"></a>[Vyukov, 2014] Dmitriy Vyukov. runtime: get rid of free. Go commit
  cecca43804, 2014. https://go.dev/cl/116390043
  Shipped in Go 1.4.
- <a id="ref-ziak-2013"></a>[Ziak, 2013] Jan Ziak. runtime: interpret type information during
  garbage collection. Go commit 9204eb4d3c, 2013. https://go.dev/cl/6945069 Shipped in Go 1.1.
- This book: [12.1 Design Principles](./basic.md), [12.2 Components](./component.md),
  [12.7 The Page Allocator](./pagealloc.md), [Chapter 13 Garbage Collector](../ch13gc),
  [13.12 Past, Present, and Future](../ch13gc/history.md).
