---
weight: 4210
title: "13.10 Finalizers"
---

# 13.10 Finalizers

Garbage collection gives a program the illusion of unlimited memory: memory is allocated but never
freed explicitly, an object that becomes unreachable may be reclaimed at any later moment, and at
the language level the death of an object is unobservable. The Go GC guide points out that three
features in the runtime library break this illusion: cleanups, weak pointers and finalizers. All
three let a program observe and react to the death of an object, and a finalizer can even reverse it
[[Go Authors, 2022a](#ref-go-authors-2022a)].

The finalizer is the oldest of the three. Cox added it to the runtime in February 2010, and the
documentation in that same commit already states the basic semantics that held for the following
decade and more [[Cox, 2010a](#ref-cox-2010a)]. According to the GC guide, finalizers were
introduced to simplify the interface between Go and C and to release non-memory resources: attach
one to a wrapper object that owns C memory or another resource, and the resource is released once
the wrapper is no longer in use. This purpose explains many of its restrictions, for example that an
object can have only one finalizer and that the finalizer can only be attached to the first byte of
an object [[Go Authors, 2022a](#ref-go-authors-2022a)]. The cleanup function added in Go 1.24 takes
over this purpose and fixes a fundamental problem in the finalizer design; the weak pointer, added
together with it, offers another way to observe the death of an object.

This section first shows how finalizers hook into marking and sweeping, then derives their
constraints from that mechanism, then introduces cleanups and weak pointers, and finally discusses
where such mechanisms stand in language design and what corresponds to them in other languages.

## 13.10.1 The Finalizer Mechanism

`runtime.SetFinalizer(obj, finalizer)` registers a finalizer for an object. `obj` must be a pointer
to an object obtained from `new`, from taking the address of a composite literal, or from taking the
address of a local variable; `finalizer` must be a function that takes a single argument to which
the type of `obj` is assignable, and its return values are ignored. If these conditions are not met,
`SetFinalizer` may abort the program [[Go Authors, 2026a](#ref-go-authors-2026a)].
`SetFinalizer(obj, nil)` cancels the registration; registering again on an object that already has a
finalizer aborts the program with the fatal error `finalizer already set`
[[Go Authors, 2026c](#ref-go-authors-2026c)].

The registration is not stored inside the object. It is a **special record** (special) on a linked
list hanging off the span that holds the object. Special records are manually managed list nodes
allocated off-heap, and the list is sorted by the object's offset within the span. Go 1.26 has ten
kinds of special records, including those for finalizers, cleanups, weak pointer handles and memory
profiling [[Go Authors, 2026f](#ref-go-authors-2026f)]. They are allocated by `fixalloc` and do not
live on the garbage-collected heap ([12.2.5](../ch12alloc/component.md)), and the `pageSpecials`
bitmap in `heapArena` marks which spans carry special records ([12.2.4](../ch12alloc/component.md)).
This structure dates from Go 1.3: previously finalizers were kept in a global hash table, and
Randall changed them to special records hanging off the span, using the same mechanism to record
profiling information [[Randall, 2014](#ref-randall-2014)].

The collector handles finalizer records in two steps, one during marking and one during sweeping.

During marking, `markrootSpans` uses `pageSpecials` to find the spans that carry special records and
processes the records in each. For a finalizer record it calls the following function (`mgcmark.go`)
[[Go Authors, 2026f](#ref-go-authors-2026f)]:

```go
func gcScanFinalizer(spf *specialfinalizer, s *mspan, gcw *gcWork) {
	// Don't mark finalized object, but scan it so we retain everything it points to.

	// A finalizer can be set for an inner byte of an object, find object beginning.
	p := s.base() + spf.special.offset/s.elemsize*s.elemsize

	// Mark everything that can be reached from
	// the object (but *not* the object itself or
	// we'll never collect it).
	if !s.spanclass.noscan() {
		scanObject(p, gcw)
	}

	// The special itself is also a root.
	scanblock(uintptr(unsafe.Pointer(&spf.fn)), goarch.PtrSize, &oneptrmask[0], gcw, nil)
}
```

The object itself is not marked, but everything reachable from it is, and the finalizer function is
treated as a root. The former guarantees that every object the finalizer can touch is still alive
when it runs; the latter keeps the finalizer function (which may be a closure on the heap) from
being collected. The comment at the start of `markrootSpans` calls these two points the two
invariants for objects with finalizers. The approach goes back to less than two months after
finalizers appeared: the first implementation needed two passes of mark and sweep, and Cox soon
changed it to scan the finalizer table specially during marking, which removed the second pass; the
comment on the new function `markfin` says that the block carrying the finalizer is not marked
itself, only what it points to [[Cox, 2010b](#ref-cox-2010b)]. This step originally ran in the
stop-the-world mark termination phase, where walking all spans cost about 1 millisecond per GB of
heap per core even if the program had no finalizers at all; since Go 1.6 it runs in the concurrent
mark phase [[Clements, 2015](#ref-clements-2015)].

When marking ends, an object that has a finalizer but is unmarked is one whose finalizer may run.
When the sweeper processes a span, it first walks the special records (`mgcsweep.go`, abridged)
[[Go Authors, 2026f](#ref-go-authors-2026f)]:

```go
		if !mbits.isMarked() {
			// This object is not marked and has at least one special record.
			// Pass 1: see if it has a finalizer.
			hasFinAndRevived := false
			endOffset := p - s.base() + size
			for tmp := siter.s; tmp != nil && tmp.offset < endOffset; tmp = tmp.next {
				if tmp.kind == _KindSpecialFinalizer {
					// Stop freeing of object if it has a finalizer.
					mbits.setMarkedNonAtomic()
					hasFinAndRevived = true
					break
				}
			}
			if hasFinAndRevived {
				// Pass 2: queue all finalizers and clear any weak handles. Weak handles are cleared
				// before finalization as specified by the weak package. See the documentation
				// for that package for more details.
				for siter.valid() && siter.s.offset < endOffset {
					// ...
					if special.kind == _KindSpecialFinalizer || special.kind == _KindSpecialWeakHandle {
						siter.unlinkAndNext()
						freeSpecial(special, unsafe.Pointer(p), size)
					} else {
						// All other specials only apply when an object is freed,
						// so just keep the special record.
						siter.next()
					}
				}
			} else {
				// Pass 2: the object is truly dead, free (and handle) all specials.
				// ...
			}
		}
```

Setting the mark bit makes the sweep keep the object as if it were alive; this is **resurrection**.
The finalizer record is then unlinked, and `freeSpecial` calls `queuefinalizer` on it, which puts
the object and its finalizer function into the queue `finq`; weak pointer handles on the same object
are zeroed (13.10.4). If `queuefinalizer` is called during marking it throws a fatal error: the
runtime assumes the finalizer queue does not grow during marking, so that it need not be rescanned
at mark termination [[Go Authors, 2026c](#ref-go-authors-2026c)]. The queue consists of blocks
allocated off-heap by `persistentalloc`, and the function and object pointers in the blocks are
scanned as roots in every mark cycle, so a queued object is not collected before its finalizer has
run.

Finalizers are executed by a dedicated goroutine. The first call to `SetFinalizer` starts it through
`createfing`; afterwards it parks whenever the queue is empty and is woken when the sweeper adds new
work. Its main loop is as follows (`mfinal.go`, abridged)
[[Go Authors, 2026c](#ref-go-authors-2026c)]:

```go
func runFinalizers() {
	// ...
	for {
		lock(&finlock)
		fb := finq
		finq = nil
		if fb == nil {
			gopark(finalizercommit, unsafe.Pointer(&finlock), waitReasonFinalizerWait, traceBlockSystemGoroutine, 1)
			continue
		}
		argRegs = intArgRegs
		unlock(&finlock)
		// ...
		for fb != nil {
			n := fb.cnt
			for i := n; i > 0; i-- {
				f := &fb.fin[i-1]
				// ...
				fingStatus.Or(fingRunningFinalizer)
				reflectcall(nil, unsafe.Pointer(f.fn), frame, uint32(framesz), uint32(framesz), uint32(framesz), &regs)
				fingStatus.And(^fingRunningFinalizer)

				// Drop finalizer queue heap references
				// before hiding them from markroot.
				// This also ensures these will be
				// clear if we reuse the finalizer.
				f.fn = nil
				f.arg = nil
				f.ot = nil
				atomic.Store(&fb.cnt, i-1)
			}
			// ...
		}
	}
}
```

The commit function `finalizercommit` of `gopark` releases `finlock` and sets the wait flag only
after the goroutine has entered the waiting state; the comment explains that this avoids waking a
goroutine that is still running and about to park. The argument of a finalizer may be a pointer or
an interface, so the argument frame is prepared here according to the argument type recorded at
registration and the call goes through `reflectcall`. After the call returns, the pointers in the
queue entry are cleared at once, so the queue no longer references the object. All finalizers are
executed one after another by this single goroutine, so a long-running finalizer delays all those
behind it, and the documentation therefore recommends starting a separate goroutine for
time-consuming work in a finalizer [[Go Authors, 2026a](#ref-go-authors-2026a)]. The first
implementation created a new goroutine for every finalizer; the change made less than two months
later moved them all to run in a single goroutine [[Cox, 2010a](#ref-cox-2010a)]
[[Cox, 2010b](#ref-cox-2010b)].

Finalizers run in another goroutine and are therefore concurrent with the rest of the program. In
issue #9442 in 2014, Vyukov pointed out that the synchronization relationship between the two was
undefined and proposed stating that `SetFinalizer` happens before the finalizer starts running
[[Vyukov, 2014](#ref-vyukov-2014)]. The Go memory model revised in 2022 adopted this: a call to
`SetFinalizer(x, f)` is synchronized before the finalization call `f(x)`
([11.9](../../part3concurrency/ch11sync/mem.md)) [[Go Authors, 2022b](#ref-go-authors-2022b)]. The
`SetFinalizer` documentation also warns that `KeepAlive(x)` or other uses of `x` do not guarantee
synchronization before `f(x)`, and a finalizer that accesses mutable state in `x` still needs a
mutex or atomic operations [[Go Authors, 2026a](#ref-go-authors-2026a)].

Putting the two steps together, an object with a finalizer spans at least two collection cycles from
becoming unreachable to being freed:

```mermaid
sequenceDiagram
    participant M as Mutator
    participant GC as Collector
    participant F as Finalizer goroutine
    M->>M: SetFinalizer(p, fn); afterwards p is unreachable
    Note over GC: Cycle N mark
    GC->>GC: Take the finalizer record as a root, mark what p references, do not mark p
    Note over GC: Cycle N sweep
    GC->>GC: p is unmarked: set its mark bit, unlink the finalizer record
    GC->>F: (p, fn) enters finq, wake up
    F->>F: Run fn(p), clear the queue's reference to p
    Note over GC: Cycle N+1
    GC->>GC: p is unmarked and has no finalizer record, freed by the sweep
```

## 13.10.2 Constraints Implied by the Mechanism

The finalizer documentation lists a long series of cautions. Most of them are not independent rules
but direct consequences of the two-step mechanism above. The following program builds three groups
of objects and triggers collection repeatedly, recording which finalizers or cleanups ran after each
cycle: a chain a → b → c with finalizers, a chain of the same structure with cleanups registered,
and two objects x and y that reference each other and each have a finalizer.

```go {run=true}
package main

import (
	"fmt"
	"runtime"
	"slices"
	"strings"
	"time"
)

type node struct {
	next *node
	name string
	data [64]byte
}

var events = make(chan string, 16)

// chain builds the three nodes a -> b -> c and registers a finalizer or a cleanup for each.
func chain(finalizer bool) {
	c := &node{name: "c"}
	b := &node{name: "b", next: c}
	a := &node{name: "a", next: b}
	for _, n := range []*node{a, b, c} {
		if finalizer {
			runtime.SetFinalizer(n, func(n *node) { events <- n.name })
		} else {
			runtime.AddCleanup(n, func(name string) { events <- name }, n.name)
		}
	}
}

// cycle builds x and y, which reference each other, and registers a finalizer for both.
func cycle() {
	x, y := &node{name: "x"}, &node{name: "y"}
	x.next, y.next = y, x
	runtime.SetFinalizer(x, func(n *node) { events <- n.name })
	runtime.SetFinalizer(y, func(n *node) { events <- n.name })
}

// rounds triggers n collections and reports which finalizers or cleanups ran after each.
func rounds(n int) {
	for i := 1; i <= n; i++ {
		runtime.GC()
		time.Sleep(20 * time.Millisecond) // leave time for finalizers and cleanups to run
		var ran []string
		for len(events) > 0 {
			ran = append(ran, <-events)
		}
		slices.Sort(ran)
		if len(ran) == 0 {
			ran = []string{"none"}
		}
		fmt.Printf("  round %d: %s\n", i, strings.Join(ran, " "))
	}
}

func main() {
	fmt.Println("finalizer chain:")
	chain(true)
	rounds(3)
	fmt.Println("cleanup chain:")
	chain(false)
	rounds(1)
	fmt.Println("cycle with finalizers:")
	cycle()
	rounds(2)
}
```

The output is:

```
finalizer chain:
  round 1: a
  round 2: b
  round 3: c
cleanup chain:
  round 1: a b c
cycle with finalizers:
  round 1: none
  round 2: none
```

The first group shows that finalizers run in dependency order. During marking in round 1, the
finalizer record of a acts as a root and marks b, which a references, and in turn c; b and c also
have finalizers but are already marked, so the sweep resurrects only a and queues its finalizer.
After a's finalizer has run, no object references b any more, so in round 2 b is the only unmarked
object with a finalizer, and in round 3 it is c's turn. The documentation puts it this way: if A
points to B, both have finalizers, and they are otherwise unreachable, only A's finalizer runs, and
once A is freed, B's finalizer can run [[Go Authors, 2026a](#ref-go-authors-2026a)]. The price is
that a chain of length $n$ needs at least $n$ collection cycles to be cleaned up completely, and the
GC guide therefore recommends keeping structures with finalizers shallow
[[Go Authors, 2022a](#ref-go-authors-2022a)].

The third group shows why cycles cannot be collected. The finalizer record of x marks y, which x
references, and the finalizer record of y marks x, so both are marked in every cycle; they are
neither resurrected nor freed, and the finalizers never run. The documentation says that if a cyclic
structure includes a block with a finalizer, the cycle is not guaranteed to be garbage collected and
the finalizer is not guaranteed to run, because there is no order that respects the dependencies
[[Go Authors, 2026a](#ref-go-authors-2026a)]. A pointer to itself also forms a cycle, so an object
with a finalizer must not be reachable from itself by any path
[[Go Authors, 2022a](#ref-go-authors-2022a)]. The runtime itself was affected by this restriction:
the early channel implementation contained a pointer to its own memory block, and on some systems of
the time channels relied on finalizers to release operating-system-level locks, so such channels
could not be collected ([10.2](../../part3concurrency/ch10chan/impl.md)). The second group belongs
to cleanups and is explained in 13.10.3.

Resurrection also delays the release of memory by at least one cycle. An object resurrected in cycle
$N$ can be freed only when the sweep judges it unreachable again in cycle $N+1$, after its finalizer
has run, and everything it references survives one extra cycle with it. A finalizer can also store
the pointer it receives in a global variable or send it through a channel, making the object truly
reachable again. The object then has no finalizer, and when it becomes unreachable again it is freed
directly without triggering any further cleanup.

The timing of finalizers is likewise unpredictable. It depends on when the next collection starts,
when the sweep reaches the span containing the object, and when the finalizer goroutine gets
scheduled. The documentation states explicitly that finalizers are not guaranteed to run before the
program exits, so relying on a finalizer to flush a `bufio.Writer` is wrong: the buffer is not
written out when the program exits [[Go Authors, 2026a](#ref-go-authors-2026a)]. `runtime.GC` also
only guarantees that finalizers have been queued, not that they have finished running
[[Go Authors, 2022a](#ref-go-authors-2022a)], which is why the program above sleeps briefly after
each collection. In addition, finalizers are not guaranteed to run for three kinds of objects:
zero-size objects, because they may share an address with other zero-size objects; objects created
during package-level variable initialization, because they may be allocated by the linker and not be
on the heap; and tiny objects combined with other objects in one allocation slot, which are not
collected as long as any object in the same block is alive ([12.6](../ch12alloc/tinyalloc.md)).

A subtler problem is a finalizer that runs too early. Within a function, an object may become
unreachable after its last mention, even while a call that uses its fields is still in progress. The
example in the `SetFinalizer` documentation is this: `p` points to a struct containing a file
descriptor `d`, a finalizer closes `d`, and the function's last use of `p` is
`syscall.Write(p.d, buf, size)`. As soon as the program enters `syscall.Write`, `p` may be
unreachable, and the finalizer may close `p.d` right then, making the write fail or even write to a
file that another goroutine has just opened and that reuses the same number
[[Go Authors, 2026a](#ref-go-authors-2026a)]. In issue #13347 in 2015, Taylor raised the same
problem with C pointers as the example: if a C pointer is stored in a Go struct and the struct's
finalizer frees it, then at the moment the pointer is passed to a C function the struct is already
dead, and the finalizer may free the pointer before the C code runs
[[Taylor, 2015](#ref-taylor-2015)]. The discussion led to `runtime.KeepAlive`, added in Go 1.7
[[Taylor, 2016](#ref-taylor-2016)]; the example in its documentation is as follows
[[Go Authors, 2026c](#ref-go-authors-2026c)]:

```go
p := &File{d}
runtime.SetFinalizer(p, func(p *File) { syscall.Close(p.d) })
var buf [10]byte
n, err := syscall.Read(p.d, buf[:])
// Ensure p is not finalized until Read returns.
runtime.KeepAlive(p)
// No more uses of p after this point.
```

`KeepAlive` itself does nothing. The compiler recognizes calls to it as an intrinsic operation that
keeps the argument alive at least up to the call site; a `println(x)` that never executes in the
function body makes calls such as `defer runtime.KeepAlive(x)`, which are not expanded as
intrinsics, work as well [[Go Authors, 2026c](#ref-go-authors-2026c)]
[[Go Authors, 2026f](#ref-go-authors-2026f)]. Boehm's 2003 paper comparing destructors and
finalizers had already pointed out that an object may well be finalized while one of its methods is
still executing, and that this must be resolved jointly by the language specification and client
code [[Boehm, 2003](#ref-boehm-2003)]. `Reference.reachabilityFence`, added in Java 9, plays the
same role as `KeepAlive` [[Oracle, 2023](#ref-oracle-2023)].

## 13.10.3 Cleanups

Most of the constraints in 13.10.2 stem from one design decision: the finalizer function takes the
object itself as its argument. To hand the object over, the collector must keep the object and
everything it references alive, and resurrection, the two-cycle delay and the leaking of cycles all
follow from that. Issue #67535, proposed by Knyszek in May 2024, lists four problems with
`SetFinalizer`: the finalizer must be attached to the first byte of an allocation, which requires
programmers to know the concept of an "allocation" that the language does not expose; an object can
have only one finalizer; objects in a cycle are not freed and their finalizers do not run; and an
object needs at least two collection cycles to be freed. The last two both come down to finalizers
allowing resurrection [[Knyszek, 2024a](#ref-knyszek-2024a)]. The proposed replacement is
`runtime.AddCleanup`, implemented by Amedee and released with Go 1.24
[[Amedee, 2024](#ref-amedee-2024)] [[Go Authors, 2025a](#ref-go-authors-2025a)]:

```go
func AddCleanup[T, S any](ptr *T, cleanup func(S), arg S) Cleanup
```

Some time after `ptr` becomes unreachable, the runtime calls `cleanup(arg)` in another goroutine.
The **cleanup** receives `arg`, not `ptr`. Typically `ptr` points to an object wrapping some
underlying resource, `arg` is the resource itself, for example a file descriptor, and the cleanup
releases it [[Go Authors, 2026b](#ref-go-authors-2026b)]. The proposal explains why the parameter
type is `func(S)` rather than `func()`: the explicit argument lowers the risk that the cleanup
accidentally captures `ptr`, and it also lets callers avoid allocating a closure for every
registration [[Knyszek, 2024a](#ref-knyszek-2024a)].

The difference in mechanism shows up on the marking side. A cleanup is also attached to the span as
a special record, which holds the cleanup function and its argument. During marking, `markrootSpans`
treats only the record itself as a root [[Go Authors, 2026f](#ref-go-authors-2026f)]:

```go
func gcScanCleanup(spc *specialCleanup, gcw *gcWork) {
	// The special itself is a root.
	scanblock(uintptr(unsafe.Pointer(&spc.cleanup)), unsafe.Sizeof(cleanupFn{}), &cleanupFnPtrMask[0], gcw, nil)
}
```

Compared with `gcScanFinalizer`, the call to `scanObject` is missing here, so what the object
references is no longer specially retained. When the sweep meets an unmarked object that carries
only cleanup records, it frees the object directly and queues the cleanup function; the comment in
`freeSpecial` reads [[Go Authors, 2026f](#ref-go-authors-2026f)]:

```go
	case _KindSpecialCleanup:
		sc := (*specialCleanup)(unsafe.Pointer(s))
		// Cleanups, unlike finalizers, do not resurrect the objects
		// they're attached to, so we only need to pass the cleanup
		// function, not the object.
		gcCleanups.enqueue(sc.cleanup)
		// ...
```

This explains the second group of results in the program above: all three cleanups run after the
first collection, and the objects on the chain are freed in the same cycle. The Go 1.24 release
notes summarize how cleanups differ from `SetFinalizer`: an object can have multiple cleanups
attached, cleanups can be attached to interior pointers, cleanups generally do not cause leaks when
objects form cycles, and cleanups do not delay the freeing of the object or of the objects it
references [[Go Authors, 2025a](#ref-go-authors-2025a)].

The constraints flip accordingly. A finalizer requires that the object not be reachable from itself;
a cleanup requires that the object not be reachable from the cleanup function or its argument,
because both are roots, and if `ptr` is reachable from them it stays reachable forever and the
cleanup never runs [[Go Authors, 2026b](#ref-go-authors-2026b)]. The most common misuse is passing
`ptr` itself as `arg`, on which `AddCleanup` panics directly. Go 1.26 adds two more checks: it
panics when `arg` points into the allocation that holds `ptr`, or when the closure of the cleanup
captures a pointer to that allocation [[Taylor, 2025](#ref-taylor-2025)]. These checks catch only
direct references; paths formed indirectly through other objects need `GODEBUG=checkfinalizers=1`,
added in Go 1.25. It runs a local mark with the special records as the only roots and reports a
possible leak if a path back to the object itself is found [[Knyszek, 2025c](#ref-knyszek-2025c)]
[[Go Authors, 2025b](#ref-go-authors-2025b)].

`AddCleanup` returns a `Cleanup` value whose `Stop` method cancels the registration once the
resource has been released through the normal path. If an object has both a finalizer and a cleanup,
the cleanup runs only after the finalizer has finished and the object is unreachable again and no
longer has a finalizer [[Go Authors, 2026b](#ref-go-authors-2026b)]. The corresponding handling in
the sweep code of 13.10.1 is that resurrecting an object unlinks only the records of the finalizer
and the weak pointer handle and leaves the other records in place, since they take effect only when
the object is freed.

The way cleanups are executed has changed once. In Go 1.24, cleanups and finalizers shared one queue
and one goroutine, although the documentation allowed cleanups to run concurrently with each other
from the start. Go 1.25 separates the two: the sweeper puts cleanups into blocks local to each P, a
full block moves to a global lock-free queue, and the last sweeper of the sweep phase moves the
remaining local blocks [[Knyszek, 2025a](#ref-knyszek-2025a)]; the goroutines that run cleanups are
created on demand, at most `max(GOMAXPROCS/4, 1)` of them
[[Go Authors, 2026d](#ref-go-authors-2026d)]. The release notes say this makes cleanups better
suited to heavy use such as in the `unique` package [[Go Authors, 2025b](#ref-go-authors-2025b)].
Correspondingly, there is no ordering guarantee among cleanups, even if the objects form a cycle
[[Go Authors, 2026b](#ref-go-authors-2026b)]. The GC guide therefore keeps a place for finalizers:
precisely because a finalizer resurrects the object, its execution order is better defined than that
of cleanups, so finalizers may still be useful for structures with complex destruction-order
requirements, although such cases are rare; otherwise cleanups are recommended since Go 1.24
[[Go Authors, 2022a](#ref-go-authors-2022a)]. The `SetFinalizer` documentation also says
[[Go Authors, 2026a](#ref-go-authors-2026a)]:

> New Go code should consider using [AddCleanup] instead, which is much
> less error-prone than SetFinalizer.

## 13.10.4 Weak Pointers

The `weak` package, added together with cleanups, provides **weak pointers**. `weak.Make(ptr)`
returns a `weak.Pointer[T]` that does not keep the object reachable; once the object is unreachable,
its `Value` method may return nil [[Knyszek, 2024b](#ref-knyszek-2024b)]
[[Go Authors, 2026e](#ref-go-authors-2026e)]. Section 13.1 uses it to observe whether an object has
been collected ([13.1.1](./basic.md)), and the `unique` package uses it to implement a
canonicalization table whose entries can be reclaimed ([5.2](../../part2lang/ch05data/string.md)).

A weak pointer does not store the object's address directly. It points to a heap-allocated handle
that holds the object's address; the object carries a special record for the weak pointer handle,
and the record references the handle. All weak pointers to the same offset of the same object share
one handle, so two weak pointers are equal if and only if the pointers they were created from are
equal, a property that still holds after the object has been collected
[[Go Authors, 2026e](#ref-go-authors-2026e)]. During marking, `markrootSpans` scans only the handle
field of the record, which keeps the handle alive without scanning the object the handle points to;
when the sweep decides the object is dead, `freeSpecial` zeroes the handle, and every later `Value`
call returns nil. The handle is padded to 16 bytes so that it is not combined with other tiny
objects in one block and retained along with them [[Go Authors, 2026f](#ref-go-authors-2026f)].

`Value` converts a weak pointer into an ordinary pointer, which needs special handling during
concurrent marking. The conversion may produce a new reference to an object that is not yet marked,
and if this pointer is stored only on a stack that has already been scanned, the collector would
never see it. `Value` therefore calls `shade` on the result during marking, and the source comment
explains that this maintains the same invariant as the Yuasa part of the write barrier
([13.2](./barrier.md)). During the mark termination phase, the runtime sets
`work.strongFromWeak.block` to block new conversions temporarily so that they do not keep producing
marking work ([13.6](./termination.md)) [[Go Authors, 2026f](#ref-go-authors-2026f)].

The interaction between weak pointers and finalizers is determined by the order in the sweep. The
sweep code in 13.10.1 zeroes the weak pointer handle while it queues the finalizer, so as soon as a
finalizer is queued, weak pointers to the object begin returning nil; if the finalizer resurrects
the object, weak pointers created for it afterwards get a new handle and are no longer equal to the
existing ones [[Go Authors, 2026e](#ref-go-authors-2026e)]. The holder of a weak pointer therefore
cannot regain the object while the finalizer runs.

Weak pointers have limitations too. Used as a map key, a weak pointer does not affect the
reachability of the corresponding value; if the value references the object the key points to, that
object stays alive. Knyszek notes that the concept that solves this problem is the ephemeron, which
is a possible future direction [[Knyszek, 2025b](#ref-knyszek-2025b)].

## 13.10.5 Positioning and Lineage

Finalizers and destructors are often mentioned together, but they differ in nature. Boehm's 2003
paper compares the two mechanisms: a C++ destructor is called synchronously when an object leaves
scope and suits objects with a clearly defined lifetime; finalization methods in Java, Modula-3 and
C# run in a separate thread, at a far less well-defined moment, after the collector finds the object
unreachable. The paper argues that the two are fundamentally different language facilities that can
complement each other, and that the asynchrony of finalizers is neither an accident of
implementation nor a defect of tracing collectors but a necessary condition for the correctness of
client code [[Boehm, 2003](#ref-boehm-2003)]. The slides Boehm used for the conference talk
summarize this conclusion as follows: the garbage collector should run finalizers in a separate
thread. Go runs finalizers in a dedicated goroutine, consistent with this conclusion.

Java's experience parallels Go's. Finalization has existed since Java 1.0, and JEP 421, delivered
with JDK 18, marked it deprecated for removal. The fundamental flaws it lists include: the delay
between an object becoming unreachable and its finalize method being called is unpredictable;
finalization code is unconstrained and can save a reference to the object and resurrect it;
finalization cannot be enabled on demand and cannot be cancelled; and finalize methods run on
unspecified threads in arbitrary order. One of the replacements JEP 421 recommends is `Cleaner`,
introduced in Java 9: a cleaning action cannot access the object itself, so it cannot resurrect it,
and a program can cancel a registration [[Christian and Marks, 2021](#ref-christian-2021)]
[[Oracle, 2023](#ref-oracle-2023)]. From `SetFinalizer` to `AddCleanup`, Go has travelled almost the
same road. JEP 421's assessment of `Cleaner` applies equally to `AddCleanup`: cleaning actions are
still scheduled by the collector, may suffer unbounded delay, and should not be used where resources
must be released promptly.

Go's approach is therefore to separate deterministic release from the safety net. The GC guide
advises releasing non-memory resources deterministically wherever possible and using finalizers and
cleanups as a fallback: resources such as file descriptors are subject to system limits that the
runtime does not know about, and the collection frequency is controlled by `GOGC`, which package
authors usually cannot control and which operators may set to widely different values. These two
points make finalizers and cleanups unsuitable as the only mechanism for releasing non-memory
resources. A package that wraps a non-memory resource should provide an explicit release method such
as `Close`, and then use a cleanup or finalizer on a best-effort basis to deal with the caller's
oversight, or report to the caller that the resource was not released correctly. By contrast, memory
resources such as memory allocated by C's `malloc` or mappings made by `mmap` are well suited to
being released by cleanups or finalizers [[Go Authors, 2022a](#ref-go-authors-2022a)]. For the
caller, deterministic release is done by an explicit `Close` together with `defer`
([6.2](../../part2lang/ch06func/defer.md)). The standard library itself is also migrating: in Go
1.26, `os.File` still uses `SetFinalizer` to close the file descriptor when the caller forgets
`Close`, next to the same code in the `net` package a note says "TODO Replace with
runtime.AddCleanup", and `os.Process` has already switched to `AddCleanup`
[[Go Authors, 2026f](#ref-go-authors-2026f)].

## 13.10.6 Summary

All the behavior of finalizers can be derived from a two-step mechanism: during marking, the
finalizer record acts as a root and marks everything the object references but not the object
itself; during sweeping, an unmarked object with a finalizer is resurrected and its finalizer
function is queued, to be executed one after another by a dedicated goroutine. Dependency order, the
leaking of cycles, a collection delay of at least two cycles and resurrection are all direct results
of this design. The cleanup of Go 1.24 receives not the object itself and treats only the cleanup
function and argument as roots during marking, which avoids resurrection; the price is that the
constraint flips to the object not being reachable from the cleanup function or its argument, and
that cleanups have no ordering among themselves. Weak pointers use a layer of handles to let a
program observe the death of an object without extending its life. None of the three is guaranteed
to run, and all can serve only as a safety net beyond deterministic release.

## Further Reading

- <a id="ref-amedee-2024"></a>[Amedee, 2024] Carlos Amedee. runtime: implement AddCleanup. Go CL
  627695, November 2024. https://go.dev/cl/627695
- <a id="ref-boehm-2003"></a>[Boehm, 2003] Hans-J. Boehm. Destructors, Finalizers, and
  Synchronization. In *Proceedings of the 30th ACM SIGPLAN-SIGACT Symposium on Principles of
  Programming Languages (POPL '03)*, pp. 262–272, 2003. https://doi.org/10.1145/604131.604153
  (technical report version HPL-2002-335; slides at https://hboehm.info/popl03/web/ )
- <a id="ref-christian-2021"></a>[Christian and Marks, 2021] Brent Christian, Stuart Marks. JEP 421:
  Deprecate Finalization for Removal. OpenJDK, 2021. https://openjdk.org/jeps/421
- <a id="ref-clements-2015"></a>[Clements, 2015] Austin Clements. runtime: scan objects with
  finalizers concurrently. Go CL 14982, September 2015. https://go.dev/cl/14982
- <a id="ref-cox-2010a"></a>[Cox, 2010a] Russ Cox. finalizers; merge package malloc into package
  runtime. Go commit 33e396a4a7 (CL 198085), February 2010.
  https://github.com/golang/go/commit/33e396a4a725a2da9cc9ef1f6a0734f0c1381b8d
- <a id="ref-cox-2010b"></a>[Cox, 2010b] Russ Cox. runtime: run all finalizers in a single
  goroutine. eliminate second pass of mark+sweep by scanning finalizer table specially. Go commit
  4e28cfe970 (CL 782041), March 2010. https://github.com/golang/go/commit/4e28cfe970
- <a id="ref-go-authors-2022a"></a>[Go Authors, 2022a] The Go Authors. A Guide to the Go Garbage
  Collector. https://go.dev/doc/gc-guide (a section "Finalizers, cleanups, and weak pointers" was
  added in 2025)
- <a id="ref-go-authors-2022b"></a>[Go Authors, 2022b] The Go Authors. The Go Memory Model. Version
  of June 6, 2022. https://go.dev/ref/mem#finalizer
- <a id="ref-go-authors-2025a"></a>[Go Authors, 2025a] The Go Authors. *Go 1.24 Release Notes:
  Improved finalizers.* https://go.dev/doc/go1.24#improved-finalizers (formerly at
  https://go.dev/doc/go1.24#new-runtimeaddcleanup-function)
- <a id="ref-go-authors-2025b"></a>[Go Authors, 2025b] The Go Authors. Go 1.25 Release Notes:
  runtime. https://go.dev/doc/go1.25#runtimepkgruntime
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *runtime.SetFinalizer.* Go
  standard library documentation. https://pkg.go.dev/runtime#SetFinalizer (the authoritative account
  of timing, resurrection, dependency order, and the KeepAlive dance)
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  *runtime.AddCleanup and runtime.Cleanup.* Go standard library documentation.
  https://pkg.go.dev/runtime#AddCleanup
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors.
  *runtime/mfinal.go* (`SetFinalizer`, `runFinalizers`, `createfing`, `KeepAlive`). Go 1.26.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/mfinal.go (formerly at
  https://github.com/golang/go/blob/master/src/runtime/mfinal.go)
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors.
  *runtime/mcleanup.go* (`AddCleanup`, `Cleanup.Stop`, handling of special records). Go 1.26.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/mcleanup.go (formerly at
  https://github.com/golang/go/blob/master/src/runtime/mcleanup.go)
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors. weak.Pointer. Go standard
  library documentation. https://pkg.go.dev/weak#Pointer
- <a id="ref-go-authors-2026f"></a>[Go Authors, 2026f] The Go Authors. src/runtime/mgcmark.go,
  mgcsweep.go, mheap.go; src/cmd/compile/internal/ssagen/intrinsics.go; src/os/file_unix.go,
  src/net/fd_posix.go, src/os/exec.go. Go 1.26.
  https://github.com/golang/go/tree/release-branch.go1.26/src
- <a id="ref-knyszek-2024a"></a>[Knyszek, 2024a] Michael Knyszek. *runtime: add AddCleanup* (issue
  #67535). https://github.com/golang/go/issues/67535 (the design motivation for AddCleanup and
  discussion of SetFinalizer's flaws)
- <a id="ref-knyszek-2024b"></a>[Knyszek, 2024b] Michael Knyszek. weak: new package providing weak
  pointers. golang/go#67552, 2024. https://go.dev/issue/67552
- <a id="ref-knyszek-2025a"></a>[Knyszek, 2025a] Michael Knyszek. runtime: schedule cleanups across
  multiple goroutines. Go CL 650697, 2025. https://go.dev/cl/650697 (corresponds to issue #71825:
  runtime: allow cleanups to run concurrently)
- <a id="ref-knyszek-2025b"></a>[Knyszek, 2025b] Michael Knyszek. From unique to cleanups and weak:
  new low-level tools for efficiency. The Go Blog, March 6, 2025.
  https://go.dev/blog/cleanups-and-weak
- <a id="ref-knyszek-2025c"></a>[Knyszek, 2025c] Michael Knyszek. runtime: add new GODEBUG
  checkfinalizer. Go CL 634599, 2025. https://go.dev/cl/634599 (corresponds to issue #72949:
  runtime: add debug mode for finalizers and cleanups)
- <a id="ref-oracle-2023"></a>[Oracle, 2023] Oracle. Java SE 21 API Specification:
  java.lang.ref.Cleaner; java.lang.ref.Reference.
  https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/ref/Cleaner.html ,
  https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/ref/Reference.html
- <a id="ref-randall-2014"></a>[Randall, 2014] Keith Randall. runtime: use special records hung off
  the MSpan to record finalizers and heap profile info. Go commit 020b39c3f3 (CL 13314053),
  January 2014. https://github.com/golang/go/commit/020b39c3f3
- <a id="ref-taylor-2015"></a>[Taylor, 2015] Ian Lance Taylor. runtime: spell out rules for
  finalizers, and implement them. golang/go#13347, 2015. https://go.dev/issue/13347
- <a id="ref-taylor-2016"></a>[Taylor, 2016] Ian Lance Taylor. runtime: add KeepAlive function. Go
  CL 23102, May 2016. https://go.dev/cl/23102
- <a id="ref-taylor-2025"></a>[Taylor, 2025] Ian Lance Taylor. runtime: panic on AddCleanup with
  self pointer (Go CL 697535); runtime: panic if cleanup function closes over cleanup pointer (Go CL
  714000).
  2025. https://go.dev/cl/697535 , https://go.dev/cl/714000
- <a id="ref-vyukov-2014"></a>[Vyukov, 2014] Dmitry Vyukov. doc: define how finalizers interact with
  memory model. golang/go#9442, 2014. https://go.dev/issue/9442
- This book: [6.2 The Defer Statement](../../part2lang/ch06func/defer.md),
  [12.2 Components](../ch12alloc/component.md),
  [12.6 Tiny Object Allocation](../ch12alloc/tinyalloc.md), [13.5 Sweeping and Bitmaps](./sweep.md).
