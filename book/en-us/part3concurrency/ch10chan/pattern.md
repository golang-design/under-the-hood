---
weight: 3207
title: "10.7 Engineering Practice and Cross-Language Comparison"
---

# 10.7 Engineering Practice and Cross-Language Comparison

The previous six sections covered the semantics and implementation of channels. This section covers
their use: which problems suit a channel and which suit a lock, where the cost of a channel comes
from, and what different choices channels in other languages make.

The maxim "Do not communicate by sharing memory; instead, share memory by communicating" is often
read as saying that all shared state should be passed through channels, but the Go team does not
argue that. We first look at how Go team members have re-examined several classic concurrency
patterns, then discuss cost and a rule of thumb, and finally compare Go with other languages.

## 10.7.1 Rethinking Classical Concurrency Patterns

At GopherCon 2018, Bryan C. Mills of the Go team gave a talk titled "Rethinking Classical
Concurrency Patterns" [[Mills, 2018a](#ref-mills-2018a)], which examined in turn several patterns
inherited from other languages: futures and producer-consumer queues in asynchronous APIs, condition
variables, and worker pools. The talk boils down to two principles: start a goroutine only when
there is work to execute concurrently; and share by communicating.

A condition variable ([11.4](../ch11sync/cond.md)) is used together with a lock: the waiting side
checks the condition while holding the lock and, if it does not hold, calls `Wait`, which atomically
releases the lock and suspends; the side that changes the state calls `Signal` to wake one waiter,
or `Broadcast` to wake all of them. Mills takes an unbounded queue as an example. If the queue
offers `GetMany(n)`, which takes n elements at once after waiting until that many have accumulated,
then each `Put` of one element cannot know which waiter can now proceed and can only call
`Broadcast`. The talk lists four problems with this style:

- Useless wakeups. One `Put` wakes all `GetMany` callers, at most one of which can take elements;
  the others check the condition and wait again. `sync.Cond` itself does not wake waiters
  spuriously, and Mills has clarified this elsewhere: the problem is that one condition variable
  stands for many different conditions, so every waiter is woken by changes unrelated to it
  [[Mills, 2017a](#ref-mills-2017a)].
- Missed notifications. A condition variable separates notification from data; when code that
  modifies the data is added later, it is easy to forget to notify, and when notifications are cut
  to reduce useless wakeups, a necessary one may be removed.
- Starvation. Suppose one caller is waiting in `GetMany(3000)` and another calls `GetMany(3)`
  repeatedly in a loop. Both have about the same chance of being woken, but the latter takes 3
  elements each time it wakes, the queue stays nearly empty, and the former never gets 3000.
- No response to cancellation. `Wait` can only wait for events tied to its lock; it cannot be put in
  a `select` together with `ctx.Done()`, and after the caller cancels, the waiter still has to wait
  for the next notification before it notices. In 2016, Brad Fitzpatrick proposed letting `select`
  wait on condition variables [[Fitzpatrick, 2016](#ref-fitzpatrick-2016)]; the proposal remains
  undecided.

Mills holds that the root of these problems is that a condition variable is itself "communicating by
sharing memory": it only tells the waiters that "something changed", and what changed is left for
the woken party to find out by checking the shared variables. The remedy is to pass the thing
itself: the resource, the data, and metadata such as "who needs which data". The queue below is
rewritten in the style of the talk; `items` holds a non-empty slice of elements, and a `true` in
`empty` means that the queue is empty:

```go {run=true}
package main

import (
	"context"
	"fmt"
	"time"
)

type Queue struct {
	items chan []int // a non-empty slice of elements
	empty chan bool  // holds true when the queue is empty
}

func NewQueue() *Queue {
	q := &Queue{items: make(chan []int, 1), empty: make(chan bool, 1)}
	q.empty <- true
	return q
}

func (q *Queue) Put(v int) {
	var items []int
	select {
	case items = <-q.items:
	case <-q.empty:
	}
	q.items <- append(items, v)
}

func (q *Queue) Get(ctx context.Context) (int, error) {
	var items []int
	select {
	case items = <-q.items:
	case <-ctx.Done():
		return 0, ctx.Err()
	}
	v := items[0]
	if len(items) == 1 {
		q.empty <- true
	} else {
		q.items <- items[1:]
	}
	return v, nil
}

func main() {
	q := NewQueue()
	q.Put(1)
	q.Put(2)
	ctx := context.Background()
	for range 2 {
		v, err := q.Get(ctx)
		fmt.Println(v, err)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Millisecond)
	defer cancel()
	_, err := q.Get(ctx) // the queue is empty; wait until the timeout
	fmt.Println(err)
}
```

```
1 <nil>
2 <nil>
context deadline exceeded
```

Both channels have capacity 1 and together hold at most one value. The goroutine that takes the
value owns the queue until it puts the value back, so `items` acts as a lock and `empty` as a
semaphore with a single slot. What `Get` waits for is the element itself, so it never wakes up to
find the condition false; and because it sits in the same `select` as `ctx.Done()`, cancellation
takes effect immediately.

Mills's analysis of worker pools is similar. A worker pool starts a fixed number of goroutines in
advance, and they take work from a task channel. In languages whose unit of execution is the thread,
its benefit is reusing expensive threads; goroutines are cheap, so this benefit does not exist in
Go, and what remains is limiting the amount of work in flight. The cost is having to manage the
lifetime of these goroutines: if the task channel is not closed, the workers block forever and leak;
even if it is eventually closed correctly, they may idle for a long time. When a program deadlocks,
idle workers flood the goroutine dump and hide the few that are really stuck. The talk shows the
dump from a failed test, in which a pool of one hundred workers pushed one of the deadlocked
goroutines to the end of the fourth page. Goroutines are lightweight but not free: each idle worker
occupies at least a 2 KB stack ([1.2.2](../../part1overview/ch01intro/go.md)).

Mills's alternative is to start a goroutine only when there is a task, and to limit the number of
tasks in flight with a buffered channel used as a semaphore, the idiom of [10.6.3](./lockfree.md).
The difference is where the slot is acquired: Mills acquires it before the `go` statement, so that
only the single goroutine dispatching the tasks waits for a slot, and there is no crowd of already
started goroutines with nothing to do.

As early as 2017, Mills proposed removing `sync.Cond` in Go 2 [[Mills, 2017b](#ref-mills-2017b)], on
the grounds that most of the use cases described in the discussion of #16620 work fine with channels
instead: `Broadcast` corresponds to closing a channel ([10.4.3](./close.md)) and `Signal` to a send.
The proposal also went through the few uses of `sync.Cond` in the standard library one by one and
concluded that most of them use only `Broadcast` and can be replaced by channels directly. Since Go
1.19, the documentation of `sync.Cond` has said: "For many simple use cases, users will be better
off using channels than a Cond (Broadcast corresponds to closing a channel, and Signal corresponds
to sending on a channel)." The documentation also links to Mills's talk
[[Burke, 2022](#ref-burke-2022)].

The removal proposal was declined in 2023. Russ Cox wrote: "Even in a v2 of sync, I find it very
difficult to believe we would delete Cond. Condition variables are a fundamental building block for
many abstractions. It's true that most users should use higher-level abstractions, but sync also
exists to provide these building blocks, both Cond and Mutex." [[Cox, 2023a](#ref-cox-2023a)] Cox
also attached a work queue he had just written: he first tried channels, but found it frustrating to
think about channel synchronization while already holding a mutex, whereas `sync.Cond` seemed to say
exactly what he wanted to say [[Cox, 2023b](#ref-cox-2023b)]. The advice in the documentation,
together with this rejection, is the Go team's position today: channels for simple use cases, with
condition variables kept as a building block.

## 10.7.2 Where the Cost Comes From

"Channels are slower than mutexes" is a widely repeated claim. The program below measures the cost
of several synchronization operations in one goroutine; the round trip on an unbuffered channel
needs another goroutine to answer:

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

func main() {
	var n atomic.Int64
	var mu sync.Mutex
	lock := make(chan struct{}, 1)
	ping, pong := make(chan int), make(chan int)
	go func() {
		for v := range ping {
			pong <- v
		}
	}()

	for _, c := range []struct {
		name string
		f    func()
	}{
		{"atomic.Int64.Add", func() { n.Add(1) }},
		{"Mutex lock then unlock", func() { mu.Lock(); mu.Unlock() }},
		{"capacity-1 channel as a lock", func() { lock <- struct{}{}; <-lock }},
		{"one unbuffered channel round trip", func() { ping <- 1; <-pong }},
	} {
		r := testing.Benchmark(func(b *testing.B) {
			for b.Loop() {
				c.f()
			}
		})
		fmt.Printf("%6.1f ns  %s\n", float64(r.T.Nanoseconds())/float64(r.N), c.name)
	}
}
```

The result of one run (Apple M5 Pro, Go 1.26.10):

```
   2.5 ns  atomic.Int64.Add
   6.8 ns  Mutex lock then unlock
  20.1 ns  capacity-1 channel as a lock
 287.7 ns  one unbuffered channel round trip
```

Without contention, locking a `sync.Mutex` ([11.2](../ch11sync/mutex.md)) is one compare-and-swap
and unlocking is one atomic add ([11.3](../ch11sync/atomic.md)); both can be inlined at the call
site without entering the runtime [[Go Authors, 2026b](#ref-go-authors-2026b)]. When a channel of
capacity 1 is used as a lock, the send and the receive each call one runtime function, copy the
element and move the buffer index under the protection of `hchan.lock` ([10.2.6](./impl.md),
[10.3.1](./sendrecv.md)), and the cost is close to three times that of the mutex. Only a failing
non-blocking operation can skip the lock ([10.3.5](./sendrecv.md)); a successful send or receive
always takes it.

A round trip on an unbuffered channel is slower by more than an order of magnitude. Every handoff
makes one side suspend and the other wake it ([10.3.3](./sendrecv.md)), so a round trip is two
goroutine switches, and most of the cost is in scheduling, not in the lock. The Go FAQ also warns
that a program that spends more time on synchronization and communication than on useful computation
may run slower on several threads, because passing data between threads requires context switches;
the prime sieve in the language specification is such an example
[[Go Authors, 2026a](#ref-go-authors-2026a)].

These gaps matter only when the synchronization itself is the hot spot, however. When a concurrency
limit was added to errgroup (10.7.4), two implementations were compared, one managing waiters with a
mutex and one using a channel as a semaphore; the time per `Go` call showed no significant
difference (247 ns against 245 ns), and the latter allocated 8 fewer bytes per call
[[Ou, 2022a](#ref-ou-2022a)]: the difference is drowned in the rest of the cost of each call. At the
end of the talk Mills also explains that the recommended styles aim at clarity and robustness, with
reasonable asymptotic complexity and constant factors, but have not been benchmarked; if one chooses
a style that the talk does not recommend for performance reasons, one should write the reasons into
the documentation and submit the benchmarks that support the choice with it, because the language
changes little while implementations keep changing [[Mills, 2018a](#ref-mills-2018a)].

## 10.7.3 A Rule of Thumb

The maxim comes from Effective Go. Andrew Gerrand illustrated it with an example in a 2010 blog post
[[Gerrand, 2010](#ref-gerrand-2010)]: several pollers repeatedly take a URL from a set and visit it.
In the traditional thread style, each resource records whether it is being polled and when it was
last polled, the whole list is protected by one lock, and a poller locks, picks the resource that
has gone longest without polling, marks it, unlocks, and after the visit locks again to update the
record; in the Go style, a poller receives a resource from one channel and, when done, sends it to
another channel, and the bookkeeping fields and the locking logic disappear together. A resource
belongs to one goroutine at any moment: sending hands it over, and receiving takes it. By the rule
of [10.6.1](./lockfree.md), writes made before the send are visible to the receiver, so the handoff
of ownership itself performs the synchronization.

In the entry "What operations are atomic? What about mutexes?", the Go FAQ says that the `sync` and
`sync/atomic` packages suit simple tasks such as incrementing reference counts or guaranteeing
small-scale mutual exclusion; for higher-level operations such as coordinating concurrent servers,
goroutines and channels often make a better program, for example by letting one goroutine be
responsible for a piece of data at any time. The FAQ also notes: "Large concurrent programs are
likely to borrow from both these toolkits." [[Go Authors, 2026a](#ref-go-authors-2026a)]

The Go Wiki page "Use a sync.Mutex or a channel?" is more direct: use whichever is most expressive
and most simple [[Go Authors, 2026c](#ref-go-authors-2026c)]. It points out that a common mistake of
newcomers is to overuse channels and goroutines just because it is possible, or because it is fun,
and it gives a comparison: channels suit passing ownership of data, distributing units of work, and
communicating asynchronous results, while mutexes suit caches and state. Conversely, if the locking
rules of a mutex become too complicated, consider whether a channel would be simpler.

In sum, channels govern the flow of data and the transfer of ownership, and mutexes govern in-place
protection of state. The queue in 10.7.1 looks like it uses channels to protect state, but what it
passes is the state itself: the goroutine that has taken the slice thereby has taken ownership of
the queue.

## 10.7.4 errgroup

When a group of tasks must all finish and, if any task fails, the rest should be cancelled and the
error returned to the caller, `golang.org/x/sync/errgroup` can be used. It belongs to the extended
library `x/sync`, not the standard library, and was added by Mills in 2016
[[Mills, 2016](#ref-mills-2016)]:

```go
func fetchAll(ctx context.Context, urls []string) error {
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(8) // at most 8 requests in flight at once
	for _, url := range urls {
		g.Go(func() error {
			return fetch(ctx, url) // if any request fails, ctx is cancelled
		})
	}
	return g.Wait() // wait for all to finish and return the first error
}
```

The implementation of `Group` is short:

```go
type Group struct {
	cancel func(error)

	wg sync.WaitGroup

	sem chan token

	errOnce sync.Once
	err     error
}
```

`Go` runs the function in a new goroutine, counted by `wg` ([11.5](../ch11sync/waitgroup.md)). The
first non-nil error is recorded by `errOnce`; if the `Group` was created by `WithContext`, `cancel`
is also called to cancel the derived context, and the cause of the cancellation (`context.Cause`) is
that error; the other goroutines learn of the cancellation through the context's `Done` channel
([11.8](../ch11sync/context.md)). `Wait` cancels the context after all goroutines have finished and
returns the recorded error. The whole process needs no `select`: errors are collected by
`sync.Once`, and cancellation is propagated by the context.

`SetLimit` and `TryGo`, added in 2022 [[Ou, 2022a](#ref-ou-2022a)], implement the concurrency limit
using exactly Mills's semaphore of 10.7.1: `sem` is a channel whose capacity equals the limit, `Go`
sends to it before starting the goroutine, and the goroutine receives from it when it ends. `TryGo`
puts this send in a `select` with a `default` branch and returns false immediately when the slots
are full, taking the fast path of the non-blocking send ([10.3.5](./sendrecv.md)).

`Wait` returns only the first error. Someone proposed letting it return all errors, and Mills
objected: the storage of an errgroup would then grow linearly with the number of tasks instead of
being constant; and, in his words, "In typical `errgroup` usage, all errors after the first will be
caused by the cancellation triggered by the first error, and thus
unreliable" [[Mills, 2025](#ref-mills-2025)].

## 10.7.5 Comparison Across Languages

Explaining why concurrency is built on CSP [[Hoare, 1978](#ref-hoare-1978)], the Go FAQ says: "Occam
and Erlang are two well known languages that stem from CSP. Go's concurrency primitives derive from
a different part of the family tree whose main contribution is the powerful notion of channels as
first class objects." [[Go Authors, 2026a](#ref-go-authors-2026a)] The origin of this branch is in
[1.3.4](../../part1overview/ch01intro/csp.md), and the difference between CSP and the Actor model is
in [1.3.6](../../part1overview/ch01intro/csp.md). Here we compare only how several kinds of channels
differ in use:

| | Default capacity | Parties | Multiway choice | When several branches are ready | Close |
| --- | --- | --- | --- | --- | --- |
| Go | 0, i.e. rendezvous | many to many | `select`, branches fixed at compile time | uniformly random | by the sender with `close`; closing twice and sending on a closed channel both panic |
| occam | rendezvous only | one to one | `ALT`, can wait only for input | not specified by the language; `PRI ALT` follows source order | none |
| Erlang | unbounded mailbox | to a process | `receive`, by pattern matching | the earliest message in the mailbox that matches | no channels; sending to a process never fails |
| Clojure core.async | 0, i.e. rendezvous | many to many | `alts!`, the number of operations can be decided at run time | random; priority order can be requested | `close!`; later puts are ignored, closing again has no effect |
| Rust `std::sync::mpsc` | `channel()` unbounded; `sync_channel(n)` has capacity n | many to one | not provided by the standard library | not applicable | no explicit close; the channel disconnects when all of one end is dropped, and operations on the other end return errors |
| Kotlin `Channel` | 0, i.e. rendezvous | many to many | `select` expression | favors the first branch; `selectUnbiased` is random | `close`; later sends throw, closing again returns false |

On default capacity, Go, occam, core.async and Kotlin all default to rendezvous, while Erlang's
mailbox and Rust's `channel()` are unbounded and a send never waits. Rich Hickey explained in the
core.async announcement why unbounded buffering is discouraged: bounded buffers plus blocking are an
important tool for coordinating rates and applying back-pressure, and they ensure that the system
does not take on more work than it can handle [[Hickey, 2013](#ref-hickey-2013)]. An unbounded
mailbox has another cost: Erlang's `receive` matches messages one by one from the head of the
mailbox, so its time is proportional to the number of messages before the matching one, and when the
mailbox is long and the pattern matches only particular messages, one receive can be very expensive
[[Erlang/OTP, 2026](#ref-erlang-otp-2026)].

On multiway choice, Hoare's 1978 paper does not specify which guard is chosen when several hold at
once ([1.3.2](../../part1overview/ch01intro/csp.md)); occam kept this, and added `PRI ALT` to give
priority by source order; occam's `ALT`, like the original paper, can wait only for input
[[SGS-THOMSON, 1995](#ref-sgs-thomson-1995)], whereas Go's `select` can also wait for a send
([10.5.6](./select.md)). Go specifies the choice as uniformly random and offers no priority
([10.5.3](./select.md)); core.async is random by default and can be asked to try in order; Kotlin
favors the first branch by default and uses `selectUnbiased` when randomness is needed
[[JetBrains, 2026](#ref-jetbrains-2026)]. Two of the four differences between core.async and Go that
Hickey lists are here: `alts!` is a function, so the number of operations can be decided at run
time, whereas the branches of Go's `select` are fixed at compile time, and a choice that varies at
run time needs `reflect.Select` ([10.5.5](./select.md)); and `alt` supports priority, which Go's
`select` does not.

Closing is where the languages differ most. Go's `close` lets the sender declare "no more data", and
the receivers end accordingly ([10.4.2](./close.md)); in the other direction, a sender cannot tell
when all receivers have left, and a goroutine blocked on a send waits forever, a common source of
goroutine leaks ([10.4.5](./close.md), [9.3.4](../ch09sched/mpg.md)). Rust has no explicit close and
makes disconnection two-way instead: after all senders are dropped, a receive returns an error once
it has drained the remaining messages; after the receiver is dropped, a send returns an error
[[Rust Project, 2026](#ref-rust-project-2026)]. core.async and Kotlin both allow closing more than
once without error [[Clojure, 2026](#ref-clojure-2026)] [[JetBrains, 2026](#ref-jetbrains-2026)],
whereas Go panics on closing twice and on sending on a closed channel ([10.4.4](./close.md)).

On types, the channels of Go, occam (which declares the data passed on a channel with a protocol),
Rust and Kotlin are statically typed, while Erlang and Clojure are dynamically typed languages.
Erlang represents the Actor model, and messages go to processes, not channels. Hickey explained in
the announcement why core.async does not adopt actors: "I remain unenthusiastic about actors. They
still couple the producer with the consumer. ... since any actor mechanism already incorporates a
queue, it seems evident that queues are more primitive." [[Hickey, 2013](#ref-hickey-2013)]

## 10.7.6 Structured Concurrency

[3.6.5](../../part1overview/ch03life/main.md) introduced Nathaniel J. Smith's 2018 article and the
meaning of structured concurrency [[Smith, 2018a](#ref-smith-2018a)], and
[11.8.5](../ch11sync/context.md) compared the approaches of various languages; here we add only the
discussion in the Go community. In the same year, Matthias Urlichs, citing Smith's article, proposed
that in Go 2 the `go` statement return a value that must be assigned to a variable, and that when
the variable goes out of scope the runtime wait for the corresponding goroutine to finish
[[Urlichs, 2018](#ref-urlichs-2018)]. Ian Lance Taylor promptly pointed out that this would break
almost all existing Go code [[Taylor, 2018a](#ref-taylor-2018a)]. Mills reminded that stopping a
goroutine is usually done with `context`, and that errgroup already coordinates errors and
cancellation, and asked whether it should be moved into the standard library
[[Mills, 2018b](#ref-mills-2018b)]. Smith joined the discussion, saying that the article had been
taken by some as a harsh attack on Go, which had never been the intent; if structured concurrency
were to be added to Go, Smith would try to make errgroup, with its cancellation and error
propagation, as short to write and as widely used as possible [[Smith, 2018b](#ref-smith-2018b)].
Less than three weeks later, Taylor closed the proposal: structured concurrency may have areas worth
improving, but this proposal offered only one technique, simplifying the wait for goroutines to
finish, and it was unclear whether the language should be changed for that one case regardless of
the others [[Taylor, 2018b](#ref-taylor-2018b)].

Progress since then has been at the level of libraries and tools. The 2022 proposal #57534 suggested
moving errgroup into the standard library [[Ou, 2022b](#ref-ou-2022b)] and has no conclusion yet;
`sync.WaitGroup.Go`, added in Go 1.25, makes "register at start" the simplest way to write it (used
in [10.6.3](./lockfree.md)); Go 1.26 provides experimental goroutine leak profiling, which can find
goroutines blocked forever after the fact ([9.3.4](../ch09sched/mpg.md)). The `go` statement itself
has not changed, and the lifetime of a goroutine is still constrained by convention and tools.

## Further Reading

- <a id="ref-burke-2022"></a>[Burke, 2022] Kevin Burke. sync: add more notes about Cond behavior. Go
  commit d42a48828f, 2022. https://go.dev/cl/412237 Shipped with Go 1.19; since then the
  documentation of `sync.Cond` has recommended channels for simple use cases and links the slides of
  [Mills, 2018a].
- <a id="ref-clojure-2026"></a>[Clojure, 2026] Clojure. *clojure.core.async API
  Reference* (`alts!`, `close!`). https://clojure.github.io/core.async/clojure.core.async.html
- <a id="ref-cox-2023a"></a>[Cox, 2023a] Russ Cox. Comment on golang/go#21165, 2023.
  https://github.com/golang/go/issues/21165#issuecomment-1611825240
  June 28, 2023: holds that even in a v2 of sync `Cond` would not be removed.
- <a id="ref-cox-2023b"></a>[Cox, 2023b] Russ Cox. Comment on golang/go#21165, 2023.
  https://github.com/golang/go/issues/21165#issuecomment-1622392204 July 5, 2023: attaches a work
  queue written with `sync.Cond`. The proposal was declined on July 12.
- <a id="ref-erlang-otp-2026"></a>[Erlang/OTP, 2026] Erlang/OTP. *Erlang System Documentation:
  Expressions* (sections "Send" and "Receive"). https://www.erlang.org/doc/system/expressions.html
- <a id="ref-fitzpatrick-2016"></a>[Fitzpatrick, 2016] Brad Fitzpatrick. Go issue #16620. *proposal:
  sync: mechanism to select on condition variables.* 2016. https://github.com/golang/go/issues/16620
  Still open as of 2026.
- <a id="ref-gerrand-2010"></a>[Gerrand, 2010] Andrew Gerrand. "Share Memory By Communicating."
  *The Go Blog*, 2010. https://go.dev/blog/codelab-share
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Frequently Asked Questions
  (FAQ)*: "Why build concurrency on the ideas of CSP?", "What operations are atomic? What about
  mutexes?", "Why doesn't my program run faster with more CPUs?" https://go.dev/doc/faq
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  *src/internal/sync/mutex.go* (the fast paths of `Lock` and `Unlock`).
  https://github.com/golang/go/blob/release-branch.go1.26/src/internal/sync/mutex.go
  Since Go 1.24, the implementation of `sync.Mutex` lives in `internal/sync`.
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Go Wiki: Use a sync.Mutex or
  a channel?* https://go.dev/wiki/MutexOrChannel
- <a id="ref-hickey-2013"></a>[Hickey, 2013] Rich Hickey. "Clojure core.async
  Channels." *clojure.org news*, 2013.
  https://clojure.org/news/2013/06/28/clojure-clore-async-channels The announcement post for
  core.async; it discusses bounded buffers, `alts!`, the differences from Go channels, and the
  reasons for not adopting actors.
- <a id="ref-hoare-1978"></a>[Hoare, 1978] C. A. R. Hoare. "Communicating Sequential
  Processes." *Communications of the ACM*, 21(8), 1978. https://doi.org/10.1145/359576.359585 The
  original CSP paper; processes name their communication partners, and the alternative command
  descends from Dijkstra's guarded commands (see 1.3.2).
- <a id="ref-jetbrains-2026"></a>[JetBrains, 2026] JetBrains. *kotlinx.coroutines API Reference*
  (`Channel`, `SendChannel.close`, `select`).
  https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.channels/-channel/
  Several coroutines sending and receiving on the same channel: see the "Channels" section of the
  Kotlin documentation: https://kotlinlang.org/docs/channels.html
- <a id="ref-mills-2016"></a>[Mills, 2016] Bryan C. Mills. errgroup: add package. golang.org/x/sync
  commit 457c582840, 2016. https://go.dev/cl/24894 The current source is at
  https://github.com/golang/sync/blob/master/errgroup/errgroup.go .
- <a id="ref-mills-2017a"></a>[Mills, 2017a] Bryan C. Mills. Comment on golang/go#16620, 2017.
  https://github.com/golang/go/issues/16620#issuecomment-318192471 July 26, 2017: `sync.Cond` itself
  does not wake spuriously; useless wakeups come from using one condition variable for several
  conditions.
- <a id="ref-mills-2017b"></a>[Mills, 2017b] Bryan C. Mills. Go issue #21165. *proposal: sync:
  remove the Cond type.* 2017. https://github.com/golang/go/issues/21165 Declined in 2023; see [Cox,
  2023a] and [Cox, 2023b].
- <a id="ref-mills-2018a"></a>[Mills, 2018a] Bryan C. Mills. "Rethinking Classical Concurrency
  Patterns." *GopherCon 2018.* https://www.youtube.com/watch?v=5zXAHh5tJqQ A re-examination of
  condition variables, worker pools and other patterns. The slides come with a script:
  https://drive.google.com/file/d/1nPdvhB0PutEJzdCq5ms6UI58dp50fcAN/view
- <a id="ref-mills-2018b"></a>[Mills, 2018b] Bryan C. Mills. Comment on golang/go#29011, 2018.
  https://github.com/golang/go/issues/29011#issuecomment-443023764
- <a id="ref-mills-2025"></a>[Mills, 2025] Bryan C. Mills. Comment on golang/go#57534, 2025.
  https://github.com/golang/go/issues/57534#issuecomment-2568403633
  January 2, 2025: objects to letting errgroup return all errors.
- <a id="ref-ou-2022a"></a>[Ou, 2022a] Changkun Ou. x/sync/errgroup: add TryGo and SetLimit to
  control concurrency. golang.org/x/sync commit 0976fa681c, 2022. https://go.dev/cl/405174
  Implements issue #27837, filed by Toby Burress in 2018; the commit message gives benchmarks of the
  two implementations.
- <a id="ref-ou-2022b"></a>[Ou, 2022b] Changkun Ou. Go issue #57534. *proposal: sync: add
  golang.org/x/sync/errgroup.* 2022. https://github.com/golang/go/issues/57534
  Still open as of 2026.
- <a id="ref-rust-project-2026"></a>[Rust Project, 2026] The Rust Project. *Module
  `std::sync::mpsc`.* https://doc.rust-lang.org/std/sync/mpsc/ The asynchronous unbounded `channel`
  versus the rendezvous-style `sync_channel`.
- <a id="ref-sgs-thomson-1995"></a>[SGS-THOMSON, 1995] SGS-THOMSON Microelectronics. *occam 2.1
  Reference Manual.* 1995. http://www.wotug.org/occam/documentation/oc21refman.pdf The first edition
  was the occam 2 Reference Manual of 1988; section 2.6 discusses `ALT` and section 2.6.2 discusses
  `PRI ALT`.
- <a id="ref-smith-2018a"></a>[Smith, 2018a] Nathaniel J. Smith. "Notes on structured concurrency,
  or: Go statement considered harmful." 2018.
  https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/ The
  original exposition of nurseries and structured concurrency.
- <a id="ref-smith-2018b"></a>[Smith, 2018b] Nathaniel J. Smith. Comment on golang/go#29011, 2018.
  https://github.com/golang/go/issues/29011#issuecomment-443138892
- <a id="ref-taylor-2018a"></a>[Taylor, 2018a] Ian Lance Taylor. Comment on golang/go#29011, 2018.
  https://github.com/golang/go/issues/29011#issuecomment-443023264
- <a id="ref-taylor-2018b"></a>[Taylor, 2018b] Ian Lance Taylor. Comment on golang/go#29011, 2018.
  https://github.com/golang/go/issues/29011#issuecomment-448387797
  December 18, 2018: the explanation given when closing the proposal.
- <a id="ref-urlichs-2018"></a>[Urlichs, 2018] Matthias Urlichs. Go issue #29011. *proposal: Go 2:
  use structured concurrency.* 2018. https://github.com/golang/go/issues/29011
- This book: [11.2 Mutex](../ch11sync/mutex.md), [11.3 Atomic Operations](../ch11sync/atomic.md),
  [11.5 Wait Groups](../ch11sync/waitgroup.md), [11.8 Context](../ch11sync/context.md).
