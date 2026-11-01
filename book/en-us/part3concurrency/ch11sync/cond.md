---
weight: 3304
title: "11.4 Condition Variables"
---

# 11.4 Condition Variables

A mutex ([11.2](./mutex.md)) decides who may enter a critical section, but it cannot express "I
entered and found that the condition does not hold, so I need to wait". The **condition variable**
supplies this: a goroutine that finds the condition false while holding the lock waits on the
condition variable and gives up the lock at the same time; after another goroutine changes the
state, it notifies the waiters to check again. The documentation of `sync.Cond` describes it as a
rendezvous point for goroutines waiting for or announcing the occurrence of an event
[[Go Authors, 2026a](#ref-go-authors-2026a)].

Condition variables are part of the monitor proposed by Brinch Hansen and Hoare in 1973 and 1974
([11.1.1](./basic.md))
[[Brinch Hansen, 1972](#ref-brinch-hansen-1972)][[Hoare, 1974](#ref-hoare-1974)]; alongside
CSP-style channels [[Hoare, 1978](#ref-hoare-1978)], Go also provides monitor-style locks and
condition variables. This section discusses the two wakeup semantics, Hoare's and Mesa's, and why Go
belongs to the latter; it then describes how the implementation of `sync.Cond` evolved into today's
ticket-based notify list, and what the standard library uses it for. When to use a condition
variable and when a channel is covered in [10.7.1](../ch10chan/pattern.md).

## 11.4.1 Waiting and Notifying

Hoare illustrated monitors with a bounded buffer [[Hoare, 1974](#ref-hoare-1974)]: consumers wait
when the buffer is empty, and producers wait when it is full. Written with `sync.Cond`, it looks
like this:

```go
type Buffer struct {
	mu       sync.Mutex
	nonEmpty sync.Cond // notified when the buffer becomes non-empty
	nonFull  sync.Cond // notified when the buffer becomes not full
	items    []int
	size     int
}

func NewBuffer(size int) *Buffer {
	b := &Buffer{size: size}
	b.nonEmpty.L = &b.mu
	b.nonFull.L = &b.mu
	return b
}

func (b *Buffer) Put(x int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for len(b.items) == b.size {
		b.nonFull.Wait()
	}
	b.items = append(b.items, x)
	b.nonEmpty.Signal()
}

func (b *Buffer) Get() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	for len(b.items) == 0 {
		b.nonEmpty.Wait()
	}
	x := b.items[0]
	b.items = b.items[1:]
	b.nonFull.Signal()
	return x
}
```

The two condition variables share one lock. Hoare recommends declaring one condition variable for
each reason to wait; here there are two reasons, buffer empty and buffer full. A condition variable
stores no value itself: the state is represented entirely by the data the lock protects, and the
condition variable is only a wait queue.

`Wait` does three things: it releases `c.L`, suspends the current goroutine, and, once woken,
reacquires `c.L` before returning. The first two steps must form a unit. If the lock were released
first and the goroutine suspended afterwards, then between the two steps another goroutine could
change the state and call `Signal`; a waiter that has not yet suspended cannot receive that
notification, and after suspending it would never be woken. 11.4.4 shows how the implementation
closes this window.

`Signal` wakes one waiter and `Broadcast` wakes all of them. They may be called with or without
holding `c.L` [[Go Authors, 2026a](#ref-go-authors-2026a)]; but the data the condition depends on
must be modified while holding the lock, otherwise there is a data race.

The code above checks the condition with `for` rather than `if`: when `Wait` returns, the condition
does not necessarily hold. This rule comes from the two wakeup semantics of monitors.

## 11.4.2 Hoare and Mesa

The problem arises at the moment of the wakeup. Process A executes signal inside the monitor and
wakes waiter B; the monitor requires that only one process execute inside at a time, so one of A and
B must yield.

Hoare's rule is that A yields [[Hoare, 1974](#ref-hoare-1974)]:

> However, we decree that a signal operation be followed immediately by
> resumption of a waiting program, without possibility of an intervening
> procedure call from yet a third program. It is only in this way that a
> waiting program has an absolute guarantee that it can acquire the resource
> just released by the signalling program without any danger that a third
> program will interpose a monitor entry and seize the resource instead.

So in Hoare's single-resource monitor, `acquire` need not recheck whether the resource is free after
`wait` returns: `release` has already guaranteed it, and between the signal and the continuation of
the awakened program no other program can intervene. When there are several waiters, signal resumes
the one that has waited longest. This semantics is also reflected in the proof rules Hoare gives:
let $I$ be the monitor invariant and $B$ the assertion represented by condition `b`; then the rule
for wait is $\{I\}\ b.\mathrm{wait}\ \{I \land B\}$ and the rule for signal is
$\{I \land B\}\ b.\mathrm{signal}\ \{I\}$. A waiter that wakes up may assume $B$, because the
signaler had to make it true before signaling and control passed directly to the waiter.

The price is paid in the implementation. After the signaler yields, it must be resumed with priority
when the waiter leaves the monitor; for this Hoare adds to each monitor a semaphore named `urgent`
on which signalers are suspended. Hoare also notes that if every signal is the last operation of a
monitor procedure, this machinery can be dispensed with; Dahl even suggested making this a rule.

Lampson and Redell, designing the concurrency facilities of the Pilot operating system at Xerox,
chose a different approach [[Lampson and Redell, 1980](#ref-lampson-redell-1980)]. They observe that
Hoare's definition requires several extra process switches when a process continues after WAIT, and
that it requires the notification mechanism to be absolutely reliable. Mesa treats NOTIFY as a hint
to the waiter: it causes some waiter to resume at some convenient time in the future; the waiter
must reacquire the monitor lock when it resumes, and before that other processes may well enter the
monitor first. All that can be assumed after WAIT is therefore the monitor invariant, and a waiter
must reevaluate the situation each time it resumes. The waiting code changes from the

```
IF NOT <OK to proceed> THEN WAIT c
```

of the Hoare monitor to

```
WHILE NOT <OK to proceed> DO WAIT c ENDLOOP
```

The benefit is that there are no extra process switches and no constraint on when the waiter runs
after NOTIFY. The paper even says that letting a waiter run without any NOTIFY would still be
perfectly correct. The verification rule therefore becomes simpler and more local: establish the
invariant before returning from an entry procedure and before WAIT, and assume it at the start of an
entry procedure and after WAIT. With this rule, it is easy to add three more ways to resume a
waiter: timeouts, aborts, and BROADCAST, which wakes all waiters. Since NOTIFY is only a hint,
replacing it with BROADCAST is always correct.

Hoare's semantics is called signal-and-wait, and Mesa's is called signal-and-continue. `sync.Cond`
belongs to the latter: after `Signal`, the signaler keeps holding the lock and may continue to
modify state; the awakened goroutine must compete for the lock again, and the documentation of
`Signal` states that it does not affect goroutine scheduling priority, so other goroutines trying to
acquire `c.L` may be woken before the waiter [[Go Authors, 2026a](#ref-go-authors-2026a)]. In the
following program, the signaler, after `Signal` and before releasing the lock, consumes the
condition it has just made true; the waiter checks the condition once with `if` and once with `for`:

```go {run=true}
package main

import (
	"fmt"
	"runtime"
	"sync"
)

// run lets a waiter proceed when items > 0; loop selects whether it checks
// the condition with for or with if.
func run(loop bool) string {
	var mu sync.Mutex
	cond := sync.NewCond(&mu)
	items, waits := 0, 0
	done := make(chan string)

	go func() { // waiter
		mu.Lock()
		defer mu.Unlock()
		if loop {
			for items == 0 {
				waits++
				cond.Wait()
			}
		} else if items == 0 {
			waits++
			cond.Wait()
		}
		done <- fmt.Sprintf("%d Wait call(s), items = %d after return", waits, items)
	}()

	// waitFor returns with the lock held, once the waiter has entered Wait for the n-th time.
	waitFor := func(n int) {
		mu.Lock()
		for waits < n {
			mu.Unlock()
			runtime.Gosched()
			mu.Lock()
		}
	}

	waitFor(1)
	items = 1
	cond.Signal() // only makes the waiter runnable; the signaler keeps the lock
	items = 0     // the condition is consumed again before the waiter reacquires the lock
	mu.Unlock()

	if loop {
		waitFor(2) // the waiter rechecks the condition and calls Wait again
		items = 1
		cond.Signal()
		mu.Unlock()
	}
	return <-done
}

func main() {
	fmt.Printf("checking with if: %s\n", run(false))
	fmt.Printf("checking with for: %s\n", run(true))
}
```

The output is:

```
checking with if: 1 Wait call(s), items = 0 after return
checking with for: 2 Wait call(s), items = 1 after return
```

`waitFor` returns with the lock held only when `waits` has reached n, and the waiter registers
itself before releasing the lock (11.4.4), so every `Signal` is guaranteed to be delivered and the
result is deterministic. Under Hoare's semantics, `Signal` would hand control to the waiter
immediately, and even the `if` version would see `items = 1`; under Mesa's semantics, the waiter
using `if` proceeds with a condition that no longer holds.

The Mesa paper also mentions one usage: instead of determining whether the exact condition a waiter
needs holds, notify a condition variable that covers all cases whenever anything changes, and let
the waiters decide for themselves whether to continue. The paper considers this workable because
waking a process is cheap. The criticism of `sync.Cond` by Mills in [10.7.1](../ch10chan/pattern.md)
targets precisely the useless wakeups this usage causes.

## 11.4.3 Condition Variables in Different Systems

Condition variables since then have all adopted Mesa's semantics, but each specifies differently
when `Wait` returns.

POSIX allows **spurious wakeups**: `pthread_cond_wait` may return without a corresponding
notification [[IEEE and The Open Group, 2024](#ref-ieee-open-group-2024)]. The rationale section of
the specification explains that on a multiprocessor, an implementation of `pthread_cond_signal` may
be unable to avoid waking more than one thread; eliminating this would reduce the concurrency of
this basic building block, and paying that price for a rare edge case is unacceptable, especially as
callers must check the condition anyway. The specification also mentions a side benefit: allowing
spurious wakeups forces applications to write a loop that checks the condition around the wait, and
so to tolerate superfluous notifications from elsewhere in the program, which makes the program more
robust. Java's `Object.wait` likewise allows spurious wakeups, and its documentation requires
applications to check the condition in a loop [[Oracle, 2023](#ref-oracle-2023)].

Go's `Wait` does not wake spuriously. The documentation states that, unlike in other systems, `Wait`
cannot return unless awoken by `Broadcast` or `Signal` [[Go Authors, 2026a](#ref-go-authors-2026a)].
The loop is still necessary, for the reason given in the previous section, signal-and-continue, not
spurious wakeups.

| System | Wakeup semantics | Spurious wakeup | Checking the condition |
| --- | --- | --- | --- |
| Hoare monitor (1974) | signal-and-wait | none | `if` suffices |
| Mesa (1980) | signal-and-continue | allowed (timeout, abort, etc.) | `WHILE` loop |
| POSIX `pthread_cond_wait` | signal-and-continue | allowed | loop |
| Java `Object.wait` | signal-and-continue | allowed | loop |
| Go `sync.Cond.Wait` | signal-and-continue | none | loop |

## 11.4.4 How the Implementation Evolved

`sync.Cond` was added by Gustavo Niemeyer in 2011 [[Niemeyer, 2011](#ref-niemeyer-2011)]. The
original implementation used an internal mutex to protect a waiter count and a semaphore: `Wait`
first increments the count, then releases `c.L`, then waits on the semaphore; `Signal` releases the
semaphore once if the count is greater than zero. Registering first and releasing the lock
afterwards closes the window described in 11.4.1. `Broadcast` releases the semaphore as many times
as the count and then switches to a new semaphore, so that waiters arriving later do not consume the
wakeups issued by this broadcast.

In 2013, Vyukov switched to an atomic counter and the runtime's synchronization semaphore,
eliminating memory allocation; the commit message reports a speedup of 30% to 50%. The change also
added detection of copying, and shipped with Go 1.2 [[Vyukov, 2013](#ref-vyukov-2013)]. This version
no longer replaced the semaphore on every broadcast. In 2016, Ian Lance Taylor turned a report by
Wedson Almeida Filho on golang-nuts into an issue: a waiter has already incremented the count and
released the lock but has not yet started waiting on the semaphore; another goroutine then calls
`Broadcast`, and a third goroutine enters `Wait` afterwards, and its wait on the semaphore is
satisfied immediately, consuming the wakeup that belonged to the earlier waiter. The earlier waiter
then suspends and never receives the broadcast [[Taylor, 2016](#ref-taylor-2016)].

The same year, Almeida Filho provided a new implementation, shipped with Go 1.7
[[Almeida Filho, 2016](#ref-almeida-filho-2016)]: a waiter first registers and takes a ticket
number, then releases the lock, and finally waits by ticket; a signaler never needs to suspend. The
ticket ties each notification to a definite waiter, which later arrivals cannot take away. `Wait` is
still these steps today [[Go Authors, 2026a](#ref-go-authors-2026a)]:

```go
func (c *Cond) Wait() {
	c.checker.check()
	t := runtime_notifyListAdd(&c.notify)
	c.L.Unlock()
	runtime_notifyListWait(&c.notify, t)
	c.L.Lock()
}
```

The notify list is implemented in the runtime [[Go Authors, 2026b](#ref-go-authors-2026b)]:

```go
type notifyList struct {
	// wait is the ticket number of the next waiter. It is atomically
	// incremented outside the lock.
	wait atomic.Uint32

	// notify is the ticket number of the next waiter to be notified. It can
	// be read outside the lock, but is only written to with lock held.
	// ……
	notify uint32

	// List of parked waiters.
	lock mutex
	head *sudog
	tail *sudog
}
```

`notifyListAdd` atomically increments `wait` and returns the value before the increment as the
ticket, without taking a lock; `Wait` may also call it concurrently while holding a read lock.
`notifyListWait` takes the lock and first compares the ticket with `notify`: a ticket smaller than
`notify` means someone has already notified it between registration and suspension, so it returns
immediately; otherwise it links itself into the list and suspends
([9.4.3](../ch09sched/schedule.md)). `notifyListNotifyOne` increments `notify`, finds the waiter
holding the original ticket in the list, and wakes it; if that waiter has not yet had time to enter
the list, it will see the new `notify` in `notifyListWait` and will not suspend.
`notifyListNotifyAll` sets `notify` directly to `wait` and wakes all waiters in the list. Both have
a lock-free fast path: if `wait` and `notify` are equal, no new waiter has arrived since the last
notification, and they return directly.

There are two details. First, `Signal` wakes the waiter with the smallest ticket, that is, the one
that registered earliest, which matches Hoare's resuming the program that has waited longest; but
the awakened waiter still has to compete for the lock again, so the order is not thereby guaranteed.
Second, both counters are 32 bits and wrap around. The runtime compares tickets with
`int32(a-b) < 0`, which is correct as long as the actual difference is less than $2^{31}$; the
comment points out that this would require more than $2^{31}$ goroutines blocked on the same
condition variable, which is currently impossible.

Registering first and releasing the lock afterwards plays the role of the "wakeup-waiting switch" in
the Mesa paper. Mesa used this switch to handle notifications from devices: a device does not
acquire the monitor lock, so its NOTIFY could fall between a process checking the condition and
starting its WAIT, and be lost [[Lampson and Redell, 1980](#ref-lampson-redell-1980)]. `sync.Cond`
allows `Signal` to be called without holding the lock, and faces the same situation; the ticket is
taken before the lock is released, so no later notification can miss it.

Finally, copy detection. A `Cond` must not be copied after first use: the notify list in the copy is
unrelated to the original, and notifications would go to the wrong queue. The `noCopy` field lets
the copylocks check of `go vet` find copies before compilation; `copyChecker` detects them at run
time by storing its own address:

```go
func (c *copyChecker) check() {
	// ……
	if uintptr(*c) != uintptr(unsafe.Pointer(c)) &&
		!atomic.CompareAndSwapUintptr((*uintptr)(c), 0, uintptr(unsafe.Pointer(c))) &&
		uintptr(*c) != uintptr(unsafe.Pointer(c)) {
		panic("sync.Cond is copied")
	}
}
```

On first use, CAS writes the checker's own address; on every later check, the stored address should
equal the current address. After a copy, the copy still holds the original's address, which differs
from its own; the CAS fails because the value is non-zero, and a panic results.

## 11.4.5 Synchronized Before

For condition variables, `Map`, `Pool` and `WaitGroup`, the Go memory model says only that the
guarantees they provide are given in their respective documentation
[[Go Authors, 2022](#ref-go-authors-2022)]. The documentation of `Cond` states that a call to
`Broadcast` or `Signal` is synchronized before the `Wait` call that it wakes
[[Go Authors, 2026a](#ref-go-authors-2026a)]. This sentence was added by Cox in 2022 when he revised
the memory model, and shipped with Go 1.19 [[Cox, 2022](#ref-cox-2022)].

From it the happens-before relation follows ([11.9](./mem.md)): writes the signaler made before
calling `Signal` are visible to the awakened goroutine after `Wait` returns. In real programs,
however, visibility usually comes from the lock itself: `c.L` is held while the condition is
modified, and `Wait` reacquires `c.L` before returning. Nor does this guarantee mean that the
condition holds: writes the signaler makes after `Signal`, and writes by other goroutines that
acquired the lock first, are equally visible to the waiter. Visibility is guaranteed by the memory
model; whether the condition holds must be checked by the loop.

## 11.4.6 Condition Variables in the Standard Library

The history of `io.Pipe` shows the relationship between condition variables and channels. It was
first implemented with channels and a long-running goroutine; less than three weeks after
`sync.Cond` was added, Cox rewrote it with two condition variables [[Cox, 2011](#ref-cox-2011)]. In
2017, Joe Tsai changed it back to channels, shipped with Go 1.10 [[Tsai, 2017](#ref-tsai-2017)]. The
commit message explains that in the condition-variable implementation, `p.data` was always set
before `Signal`, and the two together were effectively one channel-style operation, yet explicit
locking was still needed around `p.data`; the data plus the reader's condition variable could be
replaced by a `chan []byte`, and the data plus the writer's condition variable by a `chan int`. The
advice in the `Cond` documentation that "`Signal` corresponds to sending on a channel and
`Broadcast` to closing a channel" addresses exactly this case. Note that a channel can be closed
only once, and closing it again panics ([10.4](../ch10chan/close.md)), so a broadcast expressed by
closing can happen only once; `Broadcast` can be called repeatedly.

In the Go 1.26 source tree, apart from tests, `sync.Cond` is used in only a few places:

- The `connReader` of the `net/http` server. `abortPendingRead` sets the read deadline while holding
  `cr.mu`, then waits for the background read to finish with `for cr.inRead { cr.cond.Wait() }`.
- `Work` in `cmd/internal/par`, which the `go` command uses to process a set of work items in
  parallel. When there are no pending work items, executors wait on the condition variable.
- The HTTP/2 implementation built into `net/http`: its `pipe` uses a condition variable to wait for
  data, and the client connection uses it to notify waiters when the flow-control window or the
  connection state changes.

What they have in common is that what is waited on is a state predicate already protected by a mutex
that changes repeatedly. In this situation, the condition variable directly expresses "hold this
lock, wait for this condition", which is the reason Cox gave when he declined to remove `sync.Cond`
([10.7.1](../ch10chan/pattern.md)).

## Further Reading

- <a id="ref-almeida-filho-2016"></a>[Almeida Filho, 2016] Wedson Almeida Filho. sync: new Cond
  implementation. Go commit 8e7072ca83, 2016. https://go.dev/cl/18892
  Fixes issue #14064; shipped with Go 1.7.
- <a id="ref-brinch-hansen-1972"></a>[Brinch Hansen, 1972] Per Brinch Hansen. "Structured
  Multiprogramming." *Communications of the ACM*, 15(7): 574–578, 1972.
  https://doi.org/10.1145/361454.361473
  The monitor idea, contemporary with Hoare's.
- <a id="ref-cox-2011"></a>[Cox, 2011] Russ Cox. io: reimplement Pipe. Go commit 6d6f3381ff, 2011.
  https://github.com/golang/go/commit/6d6f3381ffa470e879cceec7ef926445ed86bc27
  Rewrites `io.Pipe` with two condition variables.
- <a id="ref-cox-2022"></a>[Cox, 2022] Russ Cox. runtime, sync, sync/atomic: document happens-before
  guarantees. Go commit a71ca3dfbd, 2022. https://go.dev/cl/381316
  Shipped with Go 1.19.
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *The Go Memory Model* (Version
  of June 6, 2022). https://go.dev/ref/mem The "Additional Mechanisms" section points to the
  documentation of each type, including Cond.
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *sync.Cond documentation and
  source* (`src/sync/cond.go`). https://pkg.go.dev/sync#Cond
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. src/runtime/sema.go. Go 1.26
  source. https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/sema.go The
  implementation of `notifyList`.
- <a id="ref-hoare-1974"></a>[Hoare, 1974] C. A. R. Hoare. "Monitors: An Operating System
  Structuring Concept." *Communications of the ACM*, 17(10): 549–557, 1974.
  https://doi.org/10.1145/355620.361161 The original proposal of monitors and the signal-and-wait
  semantics.
- <a id="ref-hoare-1978"></a>[Hoare, 1978] C. A. R. Hoare. "Communicating Sequential Processes."
  *Communications of the ACM*, 21(8): 666–677, 1978. https://doi.org/10.1145/359576.359585
  The theoretical source of Go's channel orientation.
- <a id="ref-ieee-open-group-2024"></a>[IEEE and The Open Group, 2024] IEEE, The Open Group.
  pthread_cond_broadcast, pthread_cond_signal. *The Open Group Base Specifications Issue 8*, IEEE
  Std 1003.1-2024.
  https://pubs.opengroup.org/onlinepubs/9799919799/functions/pthread_cond_signal.html The rationale
  section explains why spurious wakeups are allowed.
- <a id="ref-lampson-redell-1980"></a>[Lampson and Redell, 1980] Butler W. Lampson, David D.
  Redell. "Experience with Processes and Monitors in Mesa." *Communications of the ACM*, 23(2):
  105–117, 1980. https://doi.org/10.1145/358818.358824 The source of the signal-and-continue
  semantics and the "recheck in a loop" rule.
- <a id="ref-niemeyer-2011"></a>[Niemeyer, 2011] Gustavo Niemeyer. sync: add Cond. Go commit
  05b1dbd0a6,
  2011. https://github.com/golang/go/commit/05b1dbd0a6994f6ba9ab3505fce1abff93606d9e
  Shipped with Go 1.
- <a id="ref-oracle-2023"></a>[Oracle, 2023] Oracle. Object.wait. *Java SE 21 & JDK 21 API
  Specification*,
  2023. https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html
- <a id="ref-taylor-2016"></a>[Taylor, 2016] Ian Lance Taylor. Go issue #14064. *sync: potential
  race when using cond.Broadcast.* 2016. https://github.com/golang/go/issues/14064 Relays a report
  by Wedson Almeida Filho on golang-nuts.
- <a id="ref-tsai-2017"></a>[Tsai, 2017] Joe Tsai. io: simplify pipe implementation. Go commit
  371eda4558,
  2017. https://go.dev/cl/65330
  Shipped with Go 1.10.
- <a id="ref-vyukov-2013"></a>[Vyukov, 2013] Dmitriy Vyukov. sync: faster Cond. Go commit
  5a20b4a6a9,
  2013. https://github.com/golang/go/commit/5a20b4a6a9dcf26a402edfe352aa1e8564f2fb01
  Shipped with Go 1.2.
- This book: [11.2 Mutex](./mutex.md), [11.9 Memory Consistency Models](./mem.md),
  [10.7 Engineering Practice and Cross-Language Comparison](../ch10chan/pattern.md),
  [12.2 Components](../../part4memory/ch12alloc/component.md).
