---
weight: 3307
title: "11.7 Concurrency-Safe Hash Table"
---

# 11.7 Concurrency-Safe Hash Table

The built-in `map` is not safe for concurrent use. When several goroutines read and write the same
`map` without synchronization, the runtime makes a best effort to detect it and terminates the
program with `fatal error: concurrent map writes` or `concurrent map read and map write`; `recover`
cannot intercept this ([5.4.4](../../part2lang/ch05data/swisstable.md)). The most direct way to
share a table among goroutines is to pair an ordinary `map` with a lock:

```go
type RWMutexMap struct {
	mu   sync.RWMutex
	data map[string]int
}

func (m *RWMutexMap) Load(k string) (v int, ok bool) {
	m.mu.RLock()
	v, ok = m.data[k]
	m.mu.RUnlock()
	return
}

func (m *RWMutexMap) Store(k string, v int) {
	m.mu.Lock()
	m.data[k] = v
	m.mu.Unlock()
}
```

This is simple, the caller chooses the key and value types, and in most workloads it is fast enough.
Its bottleneck is the read lock itself: `RLock` and `RUnlock` each perform one atomic add on
`readerCount` ([11.2.6](./mutex.md)), so every reader modifies the same cache line. In 2016 Bryan C.
Mills reported that on a multicore machine, merely taking and releasing the read lock repeatedly
became about 8 times slower per operation as `GOMAXPROCS` grew [[Mills, 2016a](#ref-mills-2016a)].
`sync.Map` targets workloads so read-heavy that even the read lock is too expensive. It has had two
generations of implementation so far: the two-table design introduced in Go 1.9, and the concurrent
hash-trie that became the default in Go 1.24.

## 11.7.1 A Taxonomy of Concurrent Hash Tables

There are roughly four routes to a concurrent hash table.

**A single global lock.** The `RWMutexMap` above is an example. It is correct and simple, but all
writes serialize on one lock, and reads also modify the lock's state.

**Lock striping.** The table is divided into segments, each with its own lock; a key falls into a
segment by its hash, and an operation locks only that segment. Doug Lea's `ConcurrentHashMap` for
Java is the classic example [[Lea, n.d.](#ref-lea-nd)]. The Java 7 documentation states that the
table is internally partitioned to permit the number of concurrent updates indicated by the
constructor parameter `concurrencyLevel` (default 16) [[Oracle, 2011](#ref-oracle-2011)]; the Java 8
documentation downgrades the parameter to a hint about sizing [[Oracle, 2014](#ref-oracle-2014)].

**Lock-free hash tables.** In 2007, Cliff Click presented a concurrent hash table whose abstract
describes it as "wait-free (lock-free)". He claimed single-threaded performance better than most
hash tables and multithreaded performance better than every implementation compared, scaling to 768
CPUs even under heavy modification. The correctness argument also takes a different route: instead
of the usual reasoning about happens-before, memory ordering and memory barriers, the algorithm
needs no memory barriers, no double-word compare-and-swap, and no spin loops around compare-and-swap
[[Click, 2007](#ref-click-2007)].

**Hash tries.** In 2001, Phil Bagwell built on the Array Mapped Trie to propose the **hash array
mapped trie** (HAMT): the hash of a key is cut into fixed-width pieces, each piece selects a branch
at one level, and each node records in a bitmap which branches exist, so space is allocated only for
branches that are present. It needs no preallocated root table, and the time for insertion, lookup
and deletion is independent of the size of the key set [[Bagwell, 2001](#ref-bagwell-2001)]. HAMT
later became the basis of the immutable maps in Scala, Clojure and other languages. In 2012,
Aleksandar Prokopec et al. extended it into the concurrent trie CTrie, which is lock-free and
supports efficient non-blocking snapshots [[Prokopec et al., 2012](#ref-prokopec-et-al-2012)].

The first generation of `sync.Map` lies on none of these routes; it is a specialization for
read-mostly workloads. The second generation belongs to the hash-trie family but differs from both
HAMT and CTrie in key respects, as Section 11.7.4 explains.

## 11.7.2 First Generation: Two Tables, Read and Write Separated

Alongside the read-write lock report, Mills opened issue #18177. For tables with a high
read-to-write ratio, a carefully maintained `atomic.Value` is often a better fix than repairing the
read-write lock; the standard library already has many such tables, especially in the `reflect`
package; but such a table is hard to implement correctly and efficiently, so the standard library
should provide one [[Mills, 2016b](#ref-mills-2016b)]. The implementation was first published as
`golang.org/x/sync/syncmap`, then moved into the standard library in February 2017 and shipped with
Go 1.9 [[Mills, 2017](#ref-mills-2017)].

The original documentation was only a few words. In issue #21587, Rob Pike criticized it as "correct
but unhelpful": a newcomer reading it could not tell how `Map` differs from `map`, when to use it
and when not to, or what its performance characteristics are. Russ Cox then rewrote the
documentation [[Cox, 2017](#ref-cox-2017)], and the rewrite is still in use
[[Go Authors, 2026a](#ref-go-authors-2026a)]. `Map` is a specialized type; most code should use a
plain `map` with separate locking or coordination, for better type safety and for ease of
maintaining other invariants alongside the table's contents. `Map` is optimized for two common uses:
first, a key is written once but read many times, as in a cache that only grows; second, multiple
goroutines read, write and overwrite disjoint sets of keys.

The two uses share one property: once the map is warm, most operations hit keys that already exist.
The first generation exploits this by splitting the table in two, one that can be read without
locking and one protected by a mutex. The definition in Go 1.23 is as follows, with comments
abridged:

```go
type Map struct {
	mu Mutex

	// read contains the portion of the map's contents that are safe for
	// concurrent access (with or without mu held).
	// ……
	read atomic.Pointer[readOnly]

	// dirty contains the portion of the map's contents that require mu to be
	// held. To ensure that the dirty map can be promoted to the read map quickly,
	// it also includes all of the non-expunged entries in the read map.
	// ……
	dirty map[any]*entry

	// misses counts the number of loads since the read map was last updated that
	// needed to lock mu to determine whether the key was present.
	// ……
	misses int
}

// readOnly is an immutable struct stored atomically in the Map.read field.
type readOnly struct {
	m       map[any]*entry
	amended bool // true if the dirty map contains some key not in m.
}
```

`read` points to an immutable `readOnly` whose `map` is never modified once published, so any
goroutine can read it without a lock. `dirty` holds all the live keys of `read` plus newly written
keys, and may be accessed only while holding `mu`. Both tables store `*entry`, and the same key
points to the same `entry` in both. The value lives in an atomic pointer `p` inside the `entry`, so
updating an existing key takes a single atomic operation on `p`, and both tables see the new value
without locking.

A read looks in `read` first. On a hit it returns immediately; on a miss with `amended` true,
`dirty` contains keys that `read` lacks, so the reader takes the lock, consults `dirty`, and counts
one miss. When the number of misses reaches the size of `dirty`, `dirty` as a whole is promoted to
be the new `read`:

```go
func (m *Map) missLocked() {
	m.misses++
	if m.misses < len(m.dirty) {
		return
	}
	m.read.Store(&readOnly{m: m.dirty})
	m.dirty = nil
	m.misses = 0
}
```

The comment justifies the threshold: promotion pays off only once the misses are enough to amortize
the cost of copying `dirty`. After promotion `dirty` is empty; the next write of a new key makes
`dirtyLocked` shallow-copy `read` into a fresh `dirty`. A newly written key initially lives only in
`dirty`, so reading it takes the lock; only after one promotion does it enter `read`, after which
reads of it are lock-free.

Deletion also avoids the lock where it can. If the key is in `read`, deletion atomically sets its
`entry.p` to nil and the key stays in `read`; if the key is only in `dirty`, deletion takes the lock
and removes it from `dirty` directly. `entry.p` therefore has three states:

- a regular pointer: the key is valid and recorded in `read`, and also in `dirty` if `dirty` is
  non-nil;
- nil: the key is deleted, and either `dirty` is nil or `dirty` still holds this `entry`;
- `expunged`: the key is deleted, `dirty` is non-nil, and `dirty` does not hold this `entry`.

When `dirtyLocked` copies `read`, it uses compare-and-swap to turn each `entry` with a nil value
into `expunged` and does not copy it into the new `dirty`. Only when that `dirty` is itself promoted
to `read` do these keys truly disappear from `read`. If someone writes a key that is already
`expunged` in the meantime, the writer must first change it back to nil under the lock and add it to
`dirty`; otherwise readers that go through `dirty` would not find it. The distinction between nil
and `expunged` exists precisely to remember whether `dirty` still holds the `entry`.

The design has costs as well. A new key waits for one promotion before it reaches the lock-free
path. The first new key written after each promotion copies the entire `read`, so when the key set
keeps changing the copying recurs. There is still only one lock, so as writes grow, all slow paths
crowd back onto `mu`. There are also many pointers: in issue #21031, Mills pointed out that the
implementation wastes CPU time chasing pointers and, in steady state, costs at least one extra
pointer of memory per key [[Mills, 2017b](#ref-mills-2017b)].

## 11.7.3 Interface and Synchronization Guarantees

The interface of `sync.Map` grew step by step during the first generation:

| Version | Methods added | Issue |
| --- | --- | --- |
| Go 1.9 | `Load`, `Store`, `LoadOrStore`, `Delete`, `Range` | #18177 |
| Go 1.15 | `LoadAndDelete` | #33762 |
| Go 1.20 | `Swap`, `CompareAndSwap`, `CompareAndDelete` | #51972 |
| Go 1.23 | `Clear` | #61696 |

`LoadAndDelete`, `Swap`, `CompareAndSwap` and `CompareAndDelete` were implemented by Changkun Ou
[[Ou, 2019](#ref-ou-2019)] [[Ou, 2022a](#ref-ou-2022a)].

The documentation states its guarantee in the vocabulary of the memory model: a write operation
synchronizes before any read operation that observes its effect. It lists which calls count as reads
and which as writes. `Load`, `LoadAndDelete`, `LoadOrStore`, `Swap`, `CompareAndSwap` and
`CompareAndDelete` are read operations; `Delete`, `LoadAndDelete`, `Store` and `Swap` are write
operations; `LoadOrStore` is a write operation when it returns `loaded` set to false;
`CompareAndSwap` and `CompareAndDelete` are write operations when they succeed
[[Go Authors, 2026a](#ref-go-authors-2026a)]. Cox wrote this passage in 2022, and it shipped with Go
1.19 [[Cox, 2022](#ref-cox-2022)]; the classification of the three methods added in Go 1.20 was
added afterwards by Changkun Ou [[Ou, 2022b](#ref-ou-2022b)].

The semantics of `LoadOrStore` deserve a closer look. If the key is absent it stores the given
value; if present it returns the existing one; both happen in a single indivisible operation. Each
goroutine calls it with its own proposal, exactly one store succeeds, and every caller gets the same
value. This is the consensus problem of Section 11.3.3: like compare-and-swap, `LoadOrStore` solves
consensus for any number of goroutines ([11.3.3](./atomic.md)):

```go {run=true}
package main

import (
	"fmt"
	"sync"
)

func main() {
	type result struct {
		actual any
		loaded bool
	}
	var m sync.Map
	var results [8]result
	var wg sync.WaitGroup
	for id := range results {
		wg.Go(func() {
			actual, loaded := m.LoadOrStore("key", id) // each proposes its own ID
			results[id] = result{actual, loaded}
		})
	}
	wg.Wait()

	stored, agree := 0, true
	for _, r := range results {
		if !r.loaded {
			stored++ // loaded is false: this call stored the value
		}
		agree = agree && r.actual == results[0].actual
	}
	fmt.Println("calls that stored a value:", stored)
	fmt.Println("all calls got the same value:", agree)
}
```

The output is:

```
calls that stored a value: 1
all calls got the same value: true
```

## 11.7.4 Second Generation: HashTrieMap

The second generation was not written for `sync.Map`. In 2024, for the upcoming `unique` package (Go
1.23), Michael Knyszek added a concurrent hash-trie, `HashTrieMap`, to the new internal package
`internal/concurrent` [[Knyszek, 2024a](#ref-knyszek-2024a)]. The commit message says it is built
for frequent successful lookups and comparatively rare insertions and deletions; single-threaded
`LoadOrStore` performs on par with a locked `map`, and `Load` scales perfectly on the 24 cores of
the author's machine. It was later moved to `internal/sync` and extended to cover every `sync.Map`
operation. Knyszek found that `HashTrieMap[any, any]` was faster than `sync.Map` on nearly every
benchmark, and in Go 1.24 made it the default implementation of `sync.Map`
[[Knyszek, 2024b](#ref-knyszek-2024b)] [[Knyszek, 2024c](#ref-knyszek-2024c)]. In the
microbenchmarks listed in issue #70683, lookups that mostly miss became about 27% faster, and the
repeated-allocation and repeated-deletion cases constructed to exploit the old implementation's
weaknesses became about 67% and 78% faster; lookups that mostly hit became about 7% slower. The Go
1.24 release notes say the new implementation especially improves modifications: modifying disjoint
key sets of a large map is much less likely to contend, and lookups no longer need a warm-up to
achieve low contention. If a problem arises, setting `GOEXPERIMENT=nosynchashtriemap` at build time
switches back to the old implementation [[Go Authors, 2025](#ref-go-authors-2025)]. After the switch
had been on by default for a full release cycle, Knyszek removed the old implementation in Go 1.26
[[Knyszek, 2025](#ref-knyszek-2025)].

Today's `sync.Map` is only a wrapper that forwards each method to `HashTrieMap`:

```go
type Map struct {
	_ noCopy

	m isync.HashTrieMap[any, any]
}

func (m *Map) Load(key any) (value any, ok bool) {
	return m.m.Load(key)
}
```

The trie has two kinds of nodes [[Go Authors, 2026b](#ref-go-authors-2026b)]:

```go
const (
	// 16 children. This seems to be the sweet spot for
	// load performance: any smaller and we lose out on
	// 50% or more in CPU performance. Any larger and the
	// returns are minuscule (~1% improvement for 32 children).
	nChildrenLog2 = 4
	nChildren     = 1 << nChildrenLog2
	nChildrenMask = nChildren - 1
)

// indirect is an internal node in the hash-trie.
type indirect[K comparable, V any] struct {
	node[K, V]
	dead     atomic.Bool
	mu       Mutex // Protects mutation to children and any children that are entry nodes.
	parent   *indirect[K, V]
	children [nChildren]atomic.Pointer[node[K, V]]
}

// entry is a leaf node in the hash-trie.
type entry[K comparable, V any] struct {
	node[K, V]
	overflow atomic.Pointer[entry[K, V]] // Overflow for hash collisions.
	key      K
	value    V
}
```

An internal node, `indirect`, has 16 child slots, each an atomic pointer. A leaf, `entry`, holds a
key and a value, and keys with identical hashes are chained through `overflow`. On a 64-bit platform
the hash of a key has 64 bits, each level consumes 4 of them to select a child, so the trie is at
most 16 levels deep. The hash function is taken from the hash function of the corresponding `map`
type, and each table also draws a random seed at initialization, so the same key hashes differently
in different tables; this is the same defense against hash flooding that the built-in `map` uses
([5.3.2](../../part2lang/ch05data/map.md)).

Lookup uses only atomic loads:

```go
func (ht *HashTrieMap[K, V]) Load(key K) (value V, ok bool) {
	ht.init()
	hash := ht.keyHash(abi.NoEscape(unsafe.Pointer(&key)), ht.seed)

	i := ht.root.Load()
	hashShift := 8 * goarch.PtrSize
	for hashShift != 0 {
		hashShift -= nChildrenLog2

		n := i.children[(hash>>hashShift)&nChildrenMask].Load()
		if n == nil {
			return *new(V), false
		}
		if n.isEntry {
			return n.entry().lookup(key)
		}
		i = n.indirect()
	}
	panic("internal/sync.HashTrieMap: ran out of hash bits while iterating")
}
```

Starting from the root, each level takes 4 bits of the hash and atomically loads the corresponding
child slot. An empty slot means the key is absent; a leaf means comparing keys along its overflow
chain; an internal node means descending one level. Reading a leaf's `key` and `value` needs no
atomic operations because a leaf is never modified after it is published: when `Swap` or
`CompareAndSwap` changes the value of a key, it builds a new leaf under the lock and replaces the
old one instead of rewriting it. Unlike the first generation, every key takes the same lock-free
path, with no warm-up of the form "lock first, lock-free only after promotion".

A write first finds its position lock-free in the same way, then locks the internal node that owns
the position and, under the lock, rechecks two things: whether the slot still holds what was just
seen, and whether the node has been marked `dead`. If a check fails, it releases the lock and
restarts from the root. Take `LoadOrStore` inserting a new key. If the target slot is empty, it
stores the new leaf directly. If the slot already holds a different leaf, the trie must grow one or
more levels of internal nodes until the hashes of the two keys diverge at some level. The new
subtree is built privately and attached to the slot with a single atomic store at the end; the
comment explains that publishing last means readers never see an intermediate state in which the old
leaf is missing from the tree. The lock covers a single internal node, so writes in different
subtrees proceed in parallel, which amounts to a form of lock striping that grows with the shape of
the tree.

When a deletion leaves an internal node empty, the deleter, still holding that node's lock, locks
the parent, marks the node `dead`, unlinks it from the parent, and keeps checking upward so that the
tree stays compact. Locks are always acquired child before parent, and other operations such as
insertion lock only one node, so deadlock cannot occur. A node marked `dead` may still be found by a
concurrent writer, so writers check `dead` under the lock and restart from the root if they find it;
readers do not check `dead`: an unlinked node is already empty, so a reader inside it only gets "key
absent", which matches the state after the deletion.

Compared with the two tries of Section 11.7.1, `HashTrieMap` keeps HAMT's idea of indexing a trie by
successive pieces of the hash, but every internal node has a fixed 16 slots, without HAMT's bitmap
compression; its read path is lock-free while its write path locks a single node, unlike the fully
lock-free CTrie; and it provides no snapshots, as the documentation of `Range` and `All` states
explicitly that iteration does not necessarily correspond to any consistent snapshot of the table.
All these trade-offs favor simplicity and read speed.

## 11.7.5 When to Use It

The two generations differ inside, but the documentation's guidance has not changed: most code
should use a plain `map` with a lock, and `sync.Map` is worth using only for the two uses it
declares, and only when lock contention has been measured to be the bottleneck. The new
implementation removes some pathologies of the old one, such as whole-table copying when the key set
changes often and the warm-up of new keys, but its interface still uses `any` for keys and values,
which has two costs.

The first is type safety. The compiler cannot check key and value types, and a value read back needs
a type assertion. The second is allocation. Converting a non-pointer value to `any` usually
allocates on the heap, so a table keyed by `string` pays an extra allocation on every write;
`HashTrieMap` itself is generic, but `sync.Map` can only use `HashTrieMap[any, any]`. Because of
compatibility constraints, `sync.Map` cannot be turned into a generic type. In 2025 Ian Lance Taylor
proposed a new `sync/v2` package with a generic `Map` and `Pool` to replace the existing two types;
as of Go 1.26 the proposal is still under discussion [[Taylor, 2025](#ref-taylor-2025)].

## Further Reading

- <a id="ref-bagwell-2001"></a>[Bagwell, 2001] Phil Bagwell. *Ideal Hash Trees.* EPFL Technical
  Report,
  2001. https://infoscience.epfl.ch/record/64398
  The HAMT, the origin of hash tries.
- <a id="ref-click-2007"></a>[Click, 2007] Cliff Click. *A Fast Wait-Free HashTable.* Stanford EE380
  Computer Systems Colloquium, February 21, 2007.
  https://web.stanford.edu/class/ee380/Abstracts/070221.html
- <a id="ref-cox-2017"></a>[Cox, 2017] Russ Cox. sync: document when and when not to use Map. Go
  commit 3f150934e2, 2017. https://go.dev/cl/83796 Fixes issue #21587; shipped with Go 1.10.
- <a id="ref-cox-2022"></a>[Cox, 2022] Russ Cox. runtime, sync, sync/atomic: document happens-before
  guarantees. Go commit a71ca3dfbd, 2022. https://go.dev/cl/381316
  Shipped with Go 1.19.
- <a id="ref-go-authors-2025"></a>[Go Authors, 2025] The Go Authors. *Go 1.24 Release Notes.*
  https://go.dev/doc/go1.24
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *sync.Map documentation.*
  https://pkg.go.dev/sync#Map
  The official statement of the two intended uses and of the memory-model guarantees.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  *internal/sync/hashtriemap.go.* Go source tree.
  https://github.com/golang/go/blob/master/src/internal/sync/hashtriemap.go The excerpts in this
  section are from Go 1.26.
- <a id="ref-knyszek-2024a"></a>[Knyszek, 2024a] Michael Anthony Knyszek. internal/concurrent: add
  HashTrieMap. Go commit fa470f6245, 2024. https://go.dev/cl/573956
  Shipped with Go 1.23.
- <a id="ref-knyszek-2024b"></a>[Knyszek, 2024b] Michael Anthony Knyszek. sync: make
  HashTrieMap[any, any] the default implementation of Map. Go commit aecb8faa91, 2024.
  https://go.dev/cl/608335 Shipped with Go 1.24.
- <a id="ref-knyszek-2024c"></a>[Knyszek, 2024c] Michael Anthony Knyszek. Go issue #70683. *sync:
  replace Map implementation with HashTrieMap.* 2024. https://github.com/golang/go/issues/70683
  Records the Go 1.24 replacement and its microbenchmarks.
- <a id="ref-knyszek-2025"></a>[Knyszek, 2025] Michael Anthony Knyszek. sync: remove synchashtriemap
  GOEXPERIMENT. Go commit e15a14c4dd, 2025. https://go.dev/cl/690395
  Shipped with Go 1.26.
- <a id="ref-lea-nd"></a>[Lea, n.d.] Doug Lea. *Overview of package util.concurrent
  (ConcurrentHashMap).* and JSR-166.
  http://gee.cs.oswego.edu/dl/classes/EDU/oswego/cs/dl/util/concurrent/intro.html The classic
  implementation of a lock-striped concurrent hash table.
- <a id="ref-mills-2016a"></a>[Mills, 2016a] Bryan C. Mills. Go issue #17973. *sync: RWMutex scales
  poorly with CPU count.* 2016. https://github.com/golang/go/issues/17973
- <a id="ref-mills-2016b"></a>[Mills, 2016b] Bryan C. Mills. Go issue #18177. *sync: add a Map to
  replace RWLock+map usage.* 2016. https://github.com/golang/go/issues/18177
- <a id="ref-mills-2017"></a>[Mills, 2017] Bryan C. Mills. sync: import Map from x/sync/syncmap. Go
  commit 959025c0ac, 2017. https://go.dev/cl/36617 Shipped with Go 1.9.
- <a id="ref-mills-2017b"></a>[Mills, 2017b] Bryan C. Mills. Go issue #21031. *sync: reduce pointer
  overhead in Map.* 2017. https://github.com/golang/go/issues/21031
- <a id="ref-oracle-2011"></a>[Oracle, 2011] Oracle. ConcurrentHashMap. *Java Platform, Standard
  Edition 7 API Specification*, 2011.
  https://docs.oracle.com/javase/7/docs/api/java/util/concurrent/ConcurrentHashMap.html
- <a id="ref-oracle-2014"></a>[Oracle, 2014] Oracle. ConcurrentHashMap. *Java Platform, Standard
  Edition 8 API Specification*, 2014.
  https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ConcurrentHashMap.html
- <a id="ref-ou-2019"></a>[Ou, 2019] Changkun Ou. sync: add new Map method LoadAndDelete. Go commit
  2e8dbae85c, 2019. https://go.dev/cl/205899
  Fixes issue #33762; shipped with Go 1.15.
- <a id="ref-ou-2022a"></a>[Ou, 2022a] Changkun Ou. sync: add new Map method Swap, CompareAndSwap,
  CompareAndDelete. Go commit 395323c4d0, 2022. https://go.dev/cl/399094
  Fixes issue #51972; shipped with Go 1.20.
- <a id="ref-ou-2022b"></a>[Ou, 2022b] Changkun Ou. sync: document memory model for
  Swap/CompareAnd{Swap,Delete} in Map. Go commit f07910bd57, 2022. https://go.dev/cl/459715
  Shipped with Go 1.21.
- <a id="ref-prokopec-et-al-2012"></a>[Prokopec et al., 2012] Aleksandar Prokopec, Nathan G.
  Bronson, Phil Bagwell, Martin Odersky. "Concurrent Tries with Efficient Non-Blocking
  Snapshots." *PPoPP 2012*, 151–160, 2012. https://doi.org/10.1145/2145816.2145836 The CTrie.
- <a id="ref-taylor-2025"></a>[Taylor, 2025] Ian Lance Taylor. Go issue #71076. *proposal: sync/v2:
  new package.* 2025. https://github.com/golang/go/issues/71076
- This book: [5.3 Hash Tables: Principles and Security](../../part2lang/ch05data/map.md),
  [5.4 Swiss Table and the Go 1.24 Implementation](../../part2lang/ch05data/swisstable.md),
  [11.2 Mutex](./mutex.md), [12.2 Components](../../part4memory/ch12alloc/component.md) (the
  mcentral rework, "restructuring data structures for concurrency", is the same kind of evolution).
