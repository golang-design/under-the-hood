---
weight: 3207
title: "10.7 Engineering Practice and Cross-Language Comparison"
---

# 10.7 Engineering Practice and Cross-Language Comparison

The previous sections took the internal structure of a channel, the send and receive paths,
and the implementation of select all the way down. Once we understand the mechanism, a harder
and more engineering-flavored question follows: when should we use a channel, and when should we
not. Go's slogan, "Do not communicate by sharing memory; instead, share memory by communicating,"
is easily read as "any shared state should go through a channel," but that is not what its author
meant. This section reduces that slogan to an actionable rule of thumb, sets it against the lighter
tools in the chapter on synchronization primitives ([Chapter 11](../ch11sync/readme.md)),
and then places Go's choice within the lineage of the CSP family, so we can understand its specific
coordinates in the design space.

## 10.7.1 The channel is not a universal hammer

At GopherCon 2018, Bryan C. Mills of the Go team gave a talk titled "Rethinking Classical
Concurrency Patterns." He reviewed the concurrency idioms commonly found in textbooks one by one,
and concluded that a fair share of them, when implemented with channels, are actually harder to
get right and slower than using the primitives in the `sync` package.

The first example is "simulating a condition variable with a channel." A common approach is to use
a buffered channel as a "signal slot," where sending means notify and receiving means wait:

```go
// Anti-pattern: using a channel as a condition variable looks elegant but the edges are all traps
type Cond struct {
    ch chan struct{}
}

func (c *Cond) Wait()   { <-c.ch }
func (c *Cond) Signal() { c.ch <- struct{}{} } // blocks when there is no waiter
```

It works when there is "exactly one waiter and exactly one notifier," but the moment the number of
waiters is indeterminate, the problems appear: `Signal` blocks or loses the signal when no one is
waiting, `Broadcast` (waking all waiters) cannot be expressed, and rechecking the condition predicate
(after being woken, the caller must judge again whether the condition truly holds) has nowhere to go.
The right tool is `sync.Cond` ([11.4](../ch11sync/cond.md)): its `Wait` returns the caller back into
the loop to recheck the predicate after waking, and `Broadcast` wakes all waiters at once, semantics
that a channel does not natively provide.

The second example is "doing the worker pool wrong." Textbooks often present a pool that dispatches
tasks through one channel and collects results through another, but many implementations forget to
handle two things: "how to cancel the remaining workers after one worker errors out" and "how to
avoid a worker blocking forever on a send when the main goroutine returns early," which plants leaks
and deadlocks. Mills's advice is: when all you need to do is "wait for a group of concurrent tasks to
all finish," `sync.WaitGroup` ([11.5](../ch11sync/waitgroup.md)) combined with `context`
([11.8](../ch11sync/context.md)) cancellation is far clearer than a hand-rolled channel pool:

```go
// The right path: to wait for a group of tasks to finish, use WaitGroup, not a channel assembly
var wg sync.WaitGroup
for _, task := range tasks {
    wg.Add(1)
    go func(t Task) {
        defer wg.Done()
        t.Run(ctx)
    }(task)
}
wg.Wait()
```

## 10.7.2 A bit of mechanism-level explanation

"Channels are slower than mutexes" is a piece of folk wisdom that circulates widely in the Go
community. It is not made up out of thin air, but it is also often exaggerated, and the small kernel
of truth in it deserves to be spelled out.

Return to the implementation we saw in [10.2](./impl.md): every channel send or receive, whether or
not it hits the buffer, must first grab `hchan.lock`, the mutex, and then operate on the ring buffer
or the wait queues; and when the peer happens to be blocked, it must also detach the peer's `sudog`,
wake it, and trigger a scheduler handoff ([Chapter 9](../ch09sched/schedule.md)). In other words,
the fast path of a channel already has a lock embedded in it; there is no "lock-free fast path" to
speak of. By contrast, `sync.Mutex` ([11.2](../ch11sync/mutex.md)) and `sync/atomic`
([11.3](../ch11sync/atomic.md)) can complete a lock and unlock with a single CAS instruction under
no contention, without even entering the runtime.

So the mechanism-level gap becomes clear: if the goal is merely "to protect a small piece of in-place
shared state," using a channel amounts to wrapping that state in an extra layer of lock plus a possible
scheduler handoff, and the cost is naturally higher than reaching directly for atomic or mutex. We
should stress that this conclusion holds only in the "guarding small state" scenario, and should not
be generalized into "channels are always slow." The official FAQ phrases this question with restraint,
giving no single benchmark number but advising a trade-off by expressiveness: whichever form expresses
the intent more directly and more simply is the one to use, leaving performance to be measured at the
true hot spots.

## 10.7.3 The discriminating rule

Condensing the discussion above into a rule that is easy to remember:

- **Use a channel** when the essence of the problem is **communication**: passing ownership of data
  between goroutines (handing off a piece of data and never touching it again), stringing together the
  stages of a pipeline, broadcasting a signal or propagating cancellation, or expressing the choice
  of "who arrives first among multiple events" (select).
- **Use mutex / atomic** when the essence of the problem is **guarding a small piece of in-place
  shared state**: a counter, a map read and written by multiple goroutines, a piece of configuration
  that needs atomic updates. In these scenarios a channel does not help, and is slower.

In one sentence: a channel manages "the flow of data and the transfer of ownership," and a mutex
manages "the in-place protection of state." The two are not in competition but each has its own job.
Once this line is drawn clearly, almost all hesitation over "which one to use" disappears.

## 10.7.4 Two channel idioms that stand on solid ground

After the boundary is drawn, the few idioms that channels truly excel at become all the more worth
remembering.

**A buffered channel as a semaphore.** A buffered channel of capacity $n$ is naturally a counting
semaphore: a send takes a slot, a receive returns a slot, and when the buffer is full the sender
blocks, so concurrency is capped at $n$. This technique already appeared when we discussed buffer
semantics in [10.6](./lockfree.md); here is its most common form, used to throttle a group of
goroutines:

```go
sem := make(chan struct{}, maxConcurrency) // capacity is the concurrency cap
for _, job := range jobs {
    sem <- struct{}{}        // take a slot, block when full
    go func(j Job) {
        defer func() { <-sem }() // return the slot when done
        j.Do()
    }(job)
}
```

**errgroup + context for structured concurrency.** When a group of goroutines is not just "all must
finish" but also requires "cancel everyone if any one errors, and carry the first error back,"
`golang.org/x/sync/errgroup` (part of the extension library `x/sync`, not in the standard library)
stitches together `WaitGroup`, error propagation, and `context` cancellation. This is exactly how
structured concurrency lands in Go: the lifetime of the child goroutines is constrained within the
lexical scope of a single `Wait`, and will not escape into an ownerless leak.

```go
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    g.Go(func() error {
        return fetch(ctx, url) // if any returns non-nil, ctx is cancelled and the rest exit early accordingly
    })
}
if err := g.Wait(); err != nil { // returns the first non-nil error
    return err
}
```

Note that the channel has retreated behind the scenes here: the cancellation signal of `context` is
itself carried by a `done` channel ([11.8](../ch11sync/context.md)), and errgroup encapsulates the
select logic of "who errors first," so the user faces only the two actions `g.Go` and `g.Wait`. This
is precisely the discriminating rule in action: communication goes to the channel, aggregation and
guarding go to the sync primitives, each playing to its strength.

## 10.7.5 Cross-language comparison

Go's channel did not arise from nothing. Its direct ancestor is Hoare's CSP from 1978, and building
CSP's communication primitive into a general-purpose language, complemented by a choice construct, is
a path that has been walked many times. Placing the peer systems side by side makes Go's coordinates
in the design space much clearer. Several dimensions are of interest: whether the default is
synchronous (whether send and receive rendezvous when unbuffered), whether there is a built-in
multi-way choice construct, whether channels are statically typed, and the communication topology
(point-to-point or mailbox).

| System | Default synchronicity | Choice construct | Typed | Topology |
| --- | --- | --- | --- | --- |
| Go `chan` | synchronous when unbuffered (rendezvous) | `select` | yes (`chan T`) | point-to-point, multi-receive multi-send |
| occam (CSP) | fully synchronous, unbuffered | `ALT` | yes | point-to-point |
| Erlang | asynchronous mailbox | `receive` with pattern matching | no (dynamic) | per-process mailbox |
| Rust `std::sync::mpsc` | asynchronous by default (`channel()` is unbounded); only `sync_channel(0)` rendezvous | none in the standard library; needs `crossbeam`'s `select!` or tokio | yes | multi-send single-receive (MPSC) |
| Clojure core.async | unbuffered by default (synchronous) | `alt!` / `alts!` | no (dynamic) | point-to-point |
| Kotlin `Channel` | `RENDEZVOUS` by default (capacity 0, synchronous) | `select` expression | yes | point-to-point |

A few points are worth expanding. occam is the purest descendant of CSP, with communication uniformly
synchronous and unbuffered; Go's unbuffered channel is precisely of this lineage. Erlang takes a
different path: processes communicate via asynchronous mailboxes and a send never blocks, which stands
in contrast to Go's default of "unbuffered means rendezvous," reflecting the divide between the actor
model and the CSP model over "whom to synchronize." Rust's standard-library `mpsc` is asynchronous by
default and allows only a single receiver, and more importantly it **has no built-in choice construct**:
to wait on multiple channels at once, one has to resort to `crossbeam-channel`'s `select!` or an async
runtime, a sharp difference from Go's making `select` a built-in language keyword. Clojure's core.async
was introduced by Rich Hickey in 2013, explicitly modeled on Go, with even the naming of the `go` macro
and `alt!` bearing traces of homage; the difference is that it is built on the JVM, performs the
coroutine transform via macros, and its channels are not statically typed. Kotlin's `Channel` is
rendezvous by default, consistent with Go, and provides a `select` expression, which can be seen as a
re-implementation of Go's design in a coroutine language.

Reading this table to the end reveals a pattern: the combination of built-in, statically typed,
synchronous-by-default, with choice as a first-class construct, is exactly Go's set of trade-offs.
It gives up the decoupling of Erlang's mailbox, where a send never blocks, in exchange for the explicit
synchronization semantics of sender and receiver at the rendezvous point and compile-time type checking.
Trade-offs in performance never come for free, and neither do trade-offs in design.

## 10.7.6 A question not yet closed: structured concurrency

Looking toward the design frontier, we see a place that Go has not yet fully closed off. What errgroup
provides is "library-level" structured concurrency, resting on convention rather than language
enforcement: a programmer can still casually write `go f()` outside of `g.Go`, launching a goroutine
bound by no `Wait`, and the runtime will not stop it nor will the compiler warn. In other words, Go's
`go` keyword itself is "unstructured," and a goroutine's lifetime can escape arbitrarily out of the
function that launched it.

This is exactly what Nathaniel J. Smith criticized in his widely circulated 2018 article. Drawing on
Python's Trio library, he proposed the concept of a "nursery": all child tasks must be launched within
a single lexical block, and before the block ends the parent task blocks waiting for all child tasks to
converge, so that the lifetime of a goroutine aligns strictly with the lexical structure of the code and
leaks are blocked at the language level. This idea later influenced Kotlin's `coroutineScope`, Swift's
`async let`, and Java 21's `StructuredTaskScope` (JEP 453/480). The Go community has also repeatedly
discussed whether to add a similar structured constraint to `go`, but because it would change the
language's most signature lightweight goroutine model, it remains an open trade-off to this day, with no
settled conclusion. For those writing Go today, the takeaway is pragmatic: make errgroup the default, and
leave bare `go` to the few cases that genuinely have reason to "fire and forget," using discipline to make
up for the enforcement the language does not yet provide.

## Further reading

1. Bryan C. Mills. "Rethinking Classical Concurrency Patterns." *GopherCon 2018.*
   https://www.youtube.com/watch?v=5zXAHh5tJqQ (a re-examination of idioms such as condition variables and worker pools)
2. The Go Authors. *Frequently Asked Questions (FAQ): "Why are there no untagged
   unions...", "Should I define methods on values or pointers?", and the entries on the mutex versus
   channel trade-off.* https://go.dev/doc/faq
3. Andrew Gerrand. "Share Memory By Communicating." *The Go Blog*, 2010.
   https://go.dev/blog/codelab-share
4. Rich Hickey. "Clojure core.async Channels." *clojure.org news*, 2013.
   https://clojure.org/news/2013/06/28/clojure-core-async-channels (the core.async announcement post,
   stating explicitly that it is modeled on Go)
5. The Rust Project. *Module `std::sync::mpsc`.*
   https://doc.rust-lang.org/std/sync/mpsc/ (`channel` asynchronous unbounded vs `sync_channel` rendezvous)
6. C. A. R. Hoare. "Communicating Sequential Processes." *Communications of the ACM*,
   21(8), 1978. https://doi.org/10.1145/359576.359585 (the theoretical source of the channel and ALT)
7. Nathaniel J. Smith. "Notes on structured concurrency, or: Go statement considered
   harmful." 2018. https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/
   (the source exposition of nursery and structured concurrency)
8. This book: [11.2 Mutex](../ch11sync/mutex.md), [11.3 Atomic Operations](../ch11sync/atomic.md),
   [11.5 WaitGroup](../ch11sync/waitgroup.md), [11.8 Context](../ch11sync/context.md).
