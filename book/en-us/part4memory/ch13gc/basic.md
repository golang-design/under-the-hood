---
weight: 4201
title: "13.1 The Basic Idea of Garbage Collection"
---

# 13.1 The Basic Idea of Garbage Collection

Garbage collection (GC) frees the programmer from manual `free`, at the cost that the runtime must decide for itself which memory is still useful and which can be reclaimed. Go's GC treats low latency as its first priority: it would rather give up a little throughput and memory than let stalls (stop-the-world pauses) grow beyond the sub-millisecond range. This section sets up the theoretical coordinates of GC: reachability, mark-sweep, the tricolor abstraction, and where Go sits within the GC design space. The sections that follow are the elaboration of this basic idea.

Before we begin, let us borrow a set of terms that run through the whole chapter. Dijkstra and colleagues [Dijkstra et al., 1978] split a program with GC into two semi-independent roles: the mutator and the collector. The mutator is the user-level code; the one thing it does that concerns GC is to modify the reference relationships between objects, that is, to add and remove directed edges on an "object graph." The collector is the part of the runtime responsible for finding and reclaiming garbage. Every difficulty in this chapter stems from the fact that these two must run at the same time.

## 13.1.1 Reachability Means Liveness

GC judges liveness by reachability: starting from a set of roots, any object that can be reached by following pointers is considered live, and anything unreachable is garbage. Go's root set has three kinds: global variables, variables on the stack of each goroutine, and pointers that may be held in registers. The collector traverses the object graph from these roots and marks every object reachable along the way.

Reachability is a conservative and safe approximation. It does not actually know whether some object will ever be read again; it only knows that "whatever the roots cannot reach, the program can certainly never use again." The semantic question "is this block of memory still useful" is thereby turned into a graph traversal problem: start from the roots and walk the object graph; keep what you can reach, reclaim what you cannot.

There is also a dividing line here between Go and many collectors built on C/C++. Go's GC is precise (also called type-accurate): with the help of type information generated at compile time and span metadata ([12.2](../ch12alloc/component.md)), the runtime can tell exactly whether a word is a pointer or an ordinary integer. A conservative collector cannot do this; it can only treat any bit pattern that "looks like a pointer" as a pointer, which may lead to misjudgment and makes it unable to move objects. Precision is the precondition that lets many of Go's later designs (the write barrier, stack scanning) hold together.

## 13.1.2 Mark-Sweep

The most classic implementation is mark-sweep, first proposed by McCarthy in 1960 when he implemented Lisp [McCarthy, 1960]. It divides reclamation into two phases. The mark phase traverses the object graph from the roots and marks every reachable object:

```go
func mark() {
    worklist.Init()                       // queue of grey objects waiting to be scanned
    for root := range roots {             // start from the root set
        ref := *root
        if ref != nil && !isMarked(ref) {
            setMarked(ref)                // mark and enqueue
            worklist.Add(ref)
            for !worklist.Empty() {
                ref := worklist.Remove()  // take one marked object
                for fld := range Pointers(ref) {
                    child := *fld
                    if child != nil && !isMarked(child) {
                        setMarked(child)  // mark each of its reachable child objects
                        worklist.Add(child)
                    }
                }
            }
        }
    }
}
```

The sweep phase scans the entire heap, reclaims unmarked objects as garbage, and clears the mark bits of live objects to prepare for the next round:

```go
func sweep() {
    for scan := heap.Start(); scan < heap.End(); scan = scan.Next {
        if isMarked(scan) {
            unsetMarked(scan) // live: clear the mark, keep it for the next round
        } else {
            free(scan)        // unreachable: reclaim
        }
    }
}
```

Go uses exactly mark-sweep, rather than copying (relocating live objects into a new space) or reference counting (each object records how many times it is referenced). This is a set of trade-offs. Mark-sweep does not move objects, so pointers stay stable, which is especially friendly to cgo (a Go pointer held on the C side will not be shifted out from under it), but it produces fragmentation. Copying is naturally free of fragmentation, yet it must relocate objects and generally has to reserve half the space as a semispace. Reference counting reclaims promptly and spreads out the pauses, but it cannot resolve circular references, and every pointer write must update a count, an overhead amortized onto the mutator's hot path.

Go chooses mark-sweep and then hands its biggest weakness, fragmentation, to the allocator. The runtime's allocation is based on size classes ([12.1](../ch12alloc/basic.md)): objects are grouped by size into a fixed set of buckets, and objects in the same bucket are laid out at equal size within the same mspan. This way the external fragmentation that "not moving" would bring is compressed into the internal fragmentation of "uneven sizes within a bucket," whose upper bound is controllable (about 12.5% in the worst case). The comment at the top of mgc.go states this trade-off plainly: allocation proceeds in per-P size-segregated regions, which both suppresses fragmentation and, in the common case, avoids locking. In other words, Go does not eliminate fragmentation by moving objects but suppresses it at the source through the allocator's layout, and this is exactly what gives Go the confidence to use a non-moving collector.

## 13.1.3 The Tricolor Abstraction

Run tricolor marking as an animation: root objects turn grey first; the grey wavefront keeps shading its white neighbors grey and turning itself black, until the grey set is empty; then the sweep phase reclaims the still-white, unreachable objects. You can watch the wavefront advance step by step.

<div class="viz" data-viz="gc-tricolor"></div>

To let marking proceed concurrently with the mutator (which is the key to low latency), we need an abstraction that can describe the intermediate state of "marking halfway done." This is the tricolor marking that Dijkstra and colleagues proposed in 1978 [Dijkstra et al., 1978]. From the collector's perspective it divides objects in the heap into three colors:

- White (possibly dead): objects the collector has not yet visited. At the start of reclamation all objects are white; those still white at the end are unreachable and are candidates for reclamation.
- Grey (the wavefront): objects the collector has already visited but one or more of whose internal pointers have not yet been scanned, so they may still point to white objects.
- Black (definitely live): objects the collector has already visited and all of whose fields have been scanned; a black object will no longer point directly to any white object.

```mermaid
flowchart LR
    W["White<br/>not yet visited, reclamation candidate"] -->|"referenced by a grey object, shaded grey"| G["Grey<br/>visited, references not yet fully scanned"]
    G -->|"all of its own references scanned, turns black"| B["Black<br/>visited and all references scanned, deemed live"]
    B -.->|"marking ends, those still white are garbage"| DONE["hand to sweep for reclamation"]
```

Marking begins by shading all the roots grey, then repeats one action over and over: take a grey object, scan its references, shade the white objects it reaches grey, then turn itself black, until there are no more grey objects. The rules defined by this process produce a wavefront that keeps advancing. Grey objects form the boundary between black and white, that is, the wavefront itself; as marking proceeds, the wavefront divides the object graph into a black region behind it whose liveness is confirmed and a white region ahead of it that has not yet been touched, and it keeps advancing until all reachable objects have been swallowed into the black region. When the wavefront vanishes (no grey objects), marking is complete, and whatever is still white at this moment is garbage.

Tricolor is really just a name given to marking progress; objects are not actually painted any color. Which color an object belongs to is determined entirely by its mark bit and whether it is still in the worklist:

```go
func isWhite(ref interface{}) bool {
    return !isMarked(ref) // unmarked
}
func isGrey(ref interface{}) bool {
    return worklist.Find(ref) // marked, waiting to be scanned
}
func isBlack(ref interface{}) bool {
    return isMarked(ref) && !isGrey(ref) // marked, already scanned
}
```

The value of the tricolor abstraction lies precisely in making "marking progress" explicit. With it, and only with it, can we state precisely, on the premise that the mutator is modifying the object graph at the same time, which conditions a concurrent collector must maintain to stay correct. That is the invariant of the next section.

## 13.1.4 The Cost of Concurrency: The Tricolor Invariant

A serial mark-sweep suspends the entire mutator while it runs; to the user code, reclamation is a single atomic step, and its correctness needs no argument. The cost is that the pause time grows linearly with the heap. To press the pause down into the sub-millisecond range, we must let marking run concurrently with the mutator, and this immediately brings a thorny correctness problem.

Imagine marking is halfway done. At this point the mutator changes a pointer: it detaches a white object from some grey object and reattaches it beneath an object that has already turned black. A black object, by definition, will no longer be scanned by the collector, so this white object, although still reachable, will never again get the chance to be shaded grey and turned black. When marking ends it is still white and will be wrongly reclaimed as garbage, after which the program reads from a block of memory that has already been reclaimed. This is the fundamental risk of concurrent marking: the mutator can, right under the collector's nose, "hide a white object beneath a black object."

The skeleton of concurrent marking is not far from the serial version; the difference is only that it advances a small step at a time, chopping the work into pieces interleaved with the mutator:

```go
func markSome() bool {
    if worklist.Empty() {     // the start of a round
        scan(roots)           // scan the roots, rebuild the grey set
        if worklist.Empty() { // the grey set is fully processed
            sweep()           // marking is over, move into sweeping
            return false
        }
    }
    ref := worklist.Remove()  // advance one step: take a grey object
    scan(ref)                 // scan it, shade its white children grey, turn itself black
    return true
}

func scan(ref interface{}) {
    for fld := range Pointers(ref) {
        if child := *fld; child != nil {
            shade(child) // shade the referenced object grey
        }
    }
}

func shade(ref interface{}) {
    if !isMarked(ref) {
        setMarked(ref)
        worklist.Add(ref)
    }
}
```

To plug the wrong reclamation, we must maintain the tricolor invariant. It has a strong version and a weak version. The strong invariant requires that a black object must not point to a white object; no such edge is ever allowed to exist. The weak invariant relaxes this by one notch: a black object may point to a white object, but that white object must at the same time be protected by some grey object (that is, it remains reachable from the roots along an all-grey path), so that it will not be missed. Which invariant to maintain corresponds to a different write barrier design ([13.2](./barrier.md)).

The invariant does not hold of its own accord; it must be guarded by inserting a small piece of code at the very moment the mutator changes a pointer, which is the write barrier. It does a little shading work on demand when a pointer is written, bringing that dangerous edge back into the collector's view. In mgc.go the switch for the tricolor invariant is bound to the GC phase: the write barrier is on only in the `_GCmark` and `_GCmarktermination` phases and off the rest of the time, so as not to add needless burden to the mutator's hot path.

By now the three core pieces of Go's concurrent GC are all in place: tricolor marking gives the language of progress, the tricolor invariant gives the condition for correctness, and the write barrier gives the means to maintain the condition. The rest of this chapter takes them apart one by one: the write barrier ([13.2](./barrier.md)), pacing ([13.3](./pacing.md)), marking ([13.4](./mark.md)), sweeping ([13.5](./sweep.md)), and termination ([13.6](./termination.md)).

## 13.1.5 Design Trade-offs, Lineage, and Positioning

Placing Go's choices within the lineage of GC is what gives several of its trade-offs their weight.

The intellectual source of mark-sweep is McCarthy's serial implementation in 1960. Dijkstra and colleagues' "on-the-fly" algorithm in 1978 was the first to run it concurrently with the mutator, laying down the tricolor abstraction and the invariant. Hudson and Moss in 2003 further gave a rigorous proof that this kind of concurrent collector is complete, correct, and terminating [Hudson & Moss, 2003]. Go's collector stands directly on this line, and the comments in mgc.go explicitly trace its "intellectual bloodline" back to Dijkstra's on-the-fly algorithm.

Looking sideways at others, the mainstream JVMs (HotSpot's G1, ZGC, and so on) mostly choose moving, generational collectors: they eliminate fragmentation by relocating objects and concentrate effort on young objects through the generational hypothesis. Go does the opposite, neither moving nor generational. Not moving is for pointer stability and cgo friendliness, with fragmentation backstopped by size classes ([13.1.2](#1312-mark-sweep)). Not generational is because the generational hypothesis yields limited dividends in Go: the compiler's escape analysis ([15.5](../../part5toolchain/ch15compile/escape.md)) already allocates a large number of short-lived objects directly on the stack, where they are reclaimed together with the stack when the goroutine exits, never passing through heap GC at all; what does land on the heap is mostly objects that need to live for a long time, so the young generation has little left in it to begin with.

The most fundamental dividing line lies in the objective function. Most traditional collectors put lowering total pause time and raising throughput first; the Go team instead ranks low latency ahead of throughput and memory footprint. Rather than asking "how long does one GC pause in total," it asks "how can GC run more concurrently with the mutator, using an appropriate fraction of the CPU to spread the pause out until it is almost imperceptible." For exactly this reason, Go's concurrent pause time is essentially independent of an object's generation or size, which is a different worldview from the trade-off of generational, moving collectors. Performance trade-offs never come for free: Go spends a little throughput and memory to buy sub-millisecond, predictable pauses.

## Further Reading

1. John McCarthy. "Recursive Functions of Symbolic Expressions and Their Computation by
   Machine, Part I." *Communications of the ACM*, 3(4), 1960, 184-195.
   https://doi.org/10.1145/367177.367199 (the source of mark-sweep).
2. Edsger W. Dijkstra, Leslie Lamport, A. J. Martin, C. S. Scholten, E. F. M. Steffens.
   "On-the-Fly Garbage Collection: An Exercise in Cooperation." *Communications of the ACM*,
   21(11), 1978, 966-975. https://doi.org/10.1145/359642.359655 (the foundation of tricolor marking and concurrent GC).
3. Richard E. Hudson, J. Eliot B. Moss. "Sapphire: Copying Garbage Collection without Stopping
   the World." *Concurrency and Computation: Practice and Experience*, 15(3-5), 2003, 223-261.
   https://doi.org/10.1002/cpe.712 (the proof that a concurrent collector is complete, correct, and terminating).
4. Richard Jones, Antony Hosking, Eliot Moss. *The Garbage Collection Handbook: The Art of
   Automatic Memory Management.* 2nd ed., CRC Press, 2023.
5. Austin Clements, Rick Hudson. "Go 1.5 concurrent garbage collector pacing."
   2015. https://go.dev/blog/go15gc (the design orientation of Go's choice of low-latency concurrent collection).
6. The Go Authors. *runtime/mgc.go (GC overview comments, including phases and intellectual bloodline).*
   https://github.com/golang/go/blob/master/src/runtime/mgc.go
7. This book: [12.1 Design Principles of Memory Allocation](../ch12alloc/basic.md),
   [12.2 Allocator Components](../ch12alloc/component.md), [13.2 Write Barrier Techniques](./barrier.md).
