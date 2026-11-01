---
weight: 3201
title: "10.1 Channels and the Engineering of CSP"
---

# 10.1 Channels and the Engineering of CSP

> This section has an accompanying online talk:
> [YouTube](https://www.youtube.com/watch?v=d7fFCGGn0Wc),
> [Google Slides](https://changkun.de/s/chansrc/).

[1.3 Communicating Sequential Processes](../../part1overview/ch01intro/csp.md) traced the origin of
the channel: from Hoare's 1978 CSP, in which processes communicate by name
[[Hoare, 1978](#ref-hoare-1978)], through the freely passable channels of Newsqueak, to Go. That
section also demonstrated the difference between rendezvous and buffering, the prime sieve, and the
random choice of `select`. This section does not repeat them. It gives the exact semantics of the
channel at the language level: its type and direction, how it reacts to each operation in each of
its states, the synchronization it guarantees, and the evaluation rules of `select`. The runtime
code in the following sections implements exactly these rules. The section closes with a look at how
the rules were settled before Go 1.

## 10.1.1 Types and Direction

The Go specification defines a **channel** as a mechanism for concurrently executing functions to
communicate by sending and receiving values of a specified element type
[[Go Authors, 2026a](#ref-go-authors-2026a)]. A channel is an ordinary value: it can be stored in a
variable, passed as an argument or result, and even sent over another channel. The value of an
uninitialized channel is `nil`; channels are created with `make`:

```go
ch := make(chan int)     // unbuffered: communication completes only when both sides are ready
buf := make(chan int, 8) // buffered: send does not block while not full, receive while not empty
```

A channel type may carry a direction. `chan<- T` can only send and `<-chan T` can only receive. A
bidirectional channel can be narrowed to a unidirectional one by assignment or explicit conversion,
but not the other way around. The usual idiom creates a bidirectional channel with `make` in one
place and hands the send-only and receive-only views to the producer and the consumer:

```go
func produce(out chan<- int) { // out can only send
	for i := range 10 {
		out <- i
	}
	close(out)
}

func consume(in <-chan int) { // in can only receive
	for v := range in {
		use(v)
	}
}
```

Direction does not change runtime behavior; it is a compile-time constraint. Receiving from `out` or
sending to `in` does not compile. Calling `close` on a receive-only channel is also a compile error,
so only the party holding the sending end can close a channel, which matches the convention that the
sender closes ([10.4 The Semantics of Closing](./close.md)).

The specification states two more properties that are easy to overlook. Any number of goroutines may
send to, receive from, and call `len` and `cap` on the same channel without further synchronization.
And a channel is a first-in-first-out queue: values sent by one goroutine are received by another in
the order they were sent.

## 10.1.2 Operations in the Three States

A channel is in one of three states: `nil`, created and not closed, or closed. The table shows the
result of each operation in each state:

| Operation | `nil` | Not closed | Closed |
| --- | --- | --- | --- |
| Send `ch <- v` | blocks forever | completes if it can, otherwise blocks | panics |
| Receive `<-ch` | blocks forever | completes if it can, otherwise blocks | first drains the values left in the buffer, then returns the zero value immediately |
| `v, ok := <-ch` | blocks forever | `ok` is `true` | `ok` is `true` while draining the remaining values, `false` afterwards |
| `close(ch)` | panics | succeeds | panics |
| `len(ch)`, `cap(ch)` | 0 | number of elements in the buffer, buffer capacity | same |
| `for v := range ch` | blocks forever | receives one by one | ends after the remaining values are drained |

In the two-value form of receive, `ok` reports whether the received value came from a successful
send; when it is `false`, the value is the zero value produced because the channel is closed and
drained. A `range` loop receives repeatedly until the channel is closed and drained, the usual way
to consume a stream of data. Where the three panics arise in the runtime, and their messages, are
covered in [10.4 The Semantics of Closing](./close.md).

## 10.1.3 Synchronization Guarantees

A channel does not only transfer data; it also synchronizes the two sides. The Go memory model gives
four rules for channels. The first three: a send is synchronized before the completion of the
corresponding receive; the closing of a channel is synchronized before a receive that returns
because the channel is closed; and for an unbuffered channel, a receive is synchronized before the
completion of the corresponding send [[Go Authors, 2022](#ref-go-authors-2022)]. The first rule
guarantees that data written by the sender before the send is visible to the receiver after the
receive; the third says that when a send on an unbuffered channel returns, the value has already
been taken by the other side. The fourth rule concerns buffered channels and makes it possible to
use one as a counting semaphore. What these rules mean and how the runtime realizes them is
discussed in [10.6 The Memory Model and the Lock-Free Evolution](./lockfree.md).

Choosing a capacity is therefore first a choice of semantics. When an acknowledgment such as "the
other side has received it" is needed, use an unbuffered channel; the rendezvous is the
acknowledgment. To decouple producer and consumer in time, or to bound the amount of unprocessed
data, use a buffered channel, whose capacity is that bound; `make(chan struct{}, k)` combined
with "acquire on send, release on receive" limits the number of tasks in flight to $k$
[[Go Authors, 2026b](#ref-go-authors-2026b)]. A buffer can only reduce the waiting of the faster
side; it cannot make the slower side faster (the demonstration in
[1.3.5](../../part1overview/ch01intro/csp.md)). A very large capacity usually just postpones the
moment of blocking while making the backlog harder to notice. The capacity is a design parameter
that needs justification, not a knob that speeds things up when turned up.

## 10.1.4 select and nil Channels

The specification divides the execution of a `select` statement into several steps
[[Go Authors, 2026a](#ref-go-authors-2026a)]. First, the channel operands of all receive operations
and the channels and values to be sent of all send statements in the cases are evaluated exactly
once, in source order; the side effects of this evaluation happen regardless of which case is
eventually chosen. Then, if one or more communications can proceed, one of them is chosen by a
uniform pseudo-random selection; if none can proceed and there is a `default`, the `default` runs;
otherwise the statement blocks until some communication can proceed. The effect of the random choice
is shown in [1.3.5](../../part1overview/ch01intro/csp.md), and its implementation in the runtime in
[10.5 The Implementation of select](./select.md).

Send and receive on a nil channel can never proceed, so `select` never chooses a case on a nil
channel. Setting the channel variable used by a case to `nil` therefore disables that case at run
time without changing the structure of the `select` [[Ajmani, 2013](#ref-ajmani-2013)]. The
following program merges two inputs, the fan-in pattern that Pike introduced
[[Pike, 2012a](#ref-pike-2012a)]; when one input is closed, its variable is set to `nil`:

```go {run=true}
package main

import "fmt"

// gen starts a goroutine that sends n values in turn and then closes the channel.
func gen(n int) <-chan int {
	ch := make(chan int)
	go func() {
		for i := range n {
			ch <- i
		}
		close(ch)
	}()
	return ch
}

func main() {
	a, b := gen(3), gen(5)
	values, closes := 0, 0
	for a != nil || b != nil {
		select {
		case _, ok := <-a:
			if !ok {
				a = nil // a is closed and drained: this branch is never chosen again
				closes++
				continue
			}
			values++
		case _, ok := <-b:
			if !ok {
				b = nil
				closes++
				continue
			}
			values++
		}
	}
	fmt.Println("values received:", values, " closes seen:", closes)
}
```

```
values received: 8  closes seen: 2
```

The loop runs exactly 10 times: 8 times it receives a value and 2 times it observes a close. Without
setting the variable to `nil` after the close, a closed channel returns a zero value immediately
every time, so `select` would choose it again and again, and the loop would neither end nor block.

The rule that all cases are evaluated on entering `select` has a pitfall too. In Ajmani's example, a
goroutine wants to send the first element of the queue `pending` and writes
`case out <- pending[0]`; when the queue is empty, `pending[0]` is evaluated on entering `select`
even though the case would not be chosen, causing an index-out-of-range panic. The fix is again a
nil channel: when there is nothing to send, the case uses a channel variable that is `nil`
[[Ajmani, 2013](#ref-ajmani-2013)].

```go {run=true}
package main

import "fmt"

// naive evaluates pending[0] even when pending is empty, even though the select has a default.
func naive(out chan<- int, pending []int) (sent bool) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Println("naive:", r)
		}
	}()
	select {
	case out <- pending[0]:
		return true
	default:
		return false
	}
}

// guarded sets the channel to nil when there is nothing to send, disabling the send branch.
func guarded(out chan<- int, pending []int) bool {
	var first int
	var send chan<- int // nil
	if len(pending) > 0 {
		first, send = pending[0], out
	}
	select {
	case send <- first:
		return true
	default:
		return false
	}
}

func main() {
	out := make(chan int, 1)
	naive(out, nil)
	fmt.Println("guarded:", guarded(out, nil))
	fmt.Println("guarded:", guarded(out, []int{42}), <-out)
}
```

```
naive: runtime error: index out of range [0] with length 0
guarded: false
guarded: true 42
```

## 10.1.5 The Evolution Before Go 1

Most of these rules were settled between 2010 and 2012, after Go was open-sourced and before Go 1
was released. The revision history of the specification shows the considerations behind them.

The earliest specification said that values sent to a closed channel would be ignored. The runtime,
however, counted the operations on a closed channel and, after about 500 of them, terminated the
program with "too many operations on a closed channel", an error that `recover` could not catch.
Nigel Tao pointed out that such a program works fine under light load and crashes mysteriously under
heavy load; a send on a closed channel should either fail immediately or be allowed forever
[[Tao, 2011](#ref-tao-2011)]. In January 2011 Russ Cox chose the former: sending to a closed channel
and closing twice both panic immediately, while receiving from a closed channel never panics, no
matter how many times [[Cox, 2011a](#ref-cox-2011a)].

At that time, whether a channel was closed was tested with the built-in function `closed(c)`, which,
according to the specification, returned `true` only after at least one zero value produced by the
close had been received. Receiving and testing were therefore two steps: first `v := <-c`, then a
check of `closed(c)`. The form `v, ok := <-c` then had a different meaning, a non-blocking receive,
and `ok := c <- v` was a non-blocking send. At the end of January 2011 both non-blocking forms were
removed, because the same effect could always be written with a `select` containing a `default`; the
release notes of that week state that the removal prepared for redefining the two-value form of
receive [[Cox, 2011b](#ref-cox-2011b)]. In March 2011 `closed` was removed, and `v, ok := <-c` was
changed to deliver, in a single operation, both the received value and whether it came from a real
send [[Cox, 2011c](#ref-cox-2011c)].

The semantics of the nil channel also changed once. In July 2010 Rob Pike changed the specification
[[Pike, 2010](#ref-pike-2010)] so that send and receive on a nil channel outside `select` panic, a
`select` with no usable case blocks forever, and the choice among several ready cases
is "pseudo-random and fair". In May 2011 Robert Griesemer changed this to "a nil channel is never
ready", so send and receive on a nil channel block forever; the same change made a nil map behave
like an empty map when read [[Griesemer, 2011](#ref-griesemer-2011)]. Inside and outside `select`
the same rule now applies, which is what makes the technique of the previous subsection work.

The remaining changes are listed in the table below.

| Date | Change |
| --- | --- |
| October 2011 | Calling `close` on a receive-only channel becomes a compile error [[Cox, 2011d](#ref-cox-2011d)] |
| January 2012 | The wording of the selection rule changes from "pseudo-random and fair" to "uniform pseudo-random" [[Pike, 2012b](#ref-pike-2012b)] |
| February 2012 | A send on a closed channel counts as "can proceed", so `select` may choose it and panic as a result [[Cox, 2012](#ref-cox-2012)] |
| July 2013 | The specification states that a channel is first-in-first-out and may be used concurrently by multiple goroutines without synchronization [[Pike, 2013](#ref-pike-2013)] |

In the commit message of the 2012 change, Pike wrote that the careful wording was meant to "placate
the theoretically inclined". The 2013 change wrote into the specification two properties that
practice had always relied on. Since then the core semantics of channels have not changed; the
channel-related changes to the specification have been clarifications of wording, or rules about
type parameters after the introduction of generics.

## Further Reading

- <a id="ref-ajmani-2013"></a>[Ajmani, 2013] Sameer Ajmani. *Advanced Go Concurrency Patterns.*
  Google I/O
  2013. https://go.dev/talks/2013/advconc.slide (the technique of disabling a select branch with a
        nil channel)
- <a id="ref-cox-2011a"></a>[Cox, 2011a] Russ Cox. spec, runtime, tests: send on closed channel
  panics. Go commit 27c74d3499, 2011. https://github.com/golang/go/commit/27c74d3499 Fixes issues
  #1349 and #1419.
- <a id="ref-cox-2011b"></a>[Cox, 2011b] Russ Cox. spec: remove non-blocking channel operators. Go
  commit 19d9a40845, 2011. https://github.com/golang/go/commit/19d9a40845 See also the release notes
  of that week: https://go.dev/doc/devel/weekly#2011-02-01
- <a id="ref-cox-2011c"></a>[Cox, 2011c] Russ Cox. spec: remove closed from language, replaced by x,
  ok =
  <-c. Go commit 9f2cb86fe2, 2011. https://github.com/golang/go/commit/9f2cb86fe2
  See also the release notes of that week: https://go.dev/doc/devel/weekly#2011-03-15
- <a id="ref-cox-2011d"></a>[Cox, 2011d] Russ Cox. gc: disallow close on receive-only channels. Go
  commit f58ed4e641, 2011. https://github.com/golang/go/commit/f58ed4e641
- <a id="ref-cox-2012"></a>[Cox, 2012] Russ Cox. spec: send on closed channel counts
  as "proceeding". Go commit e7a138b856, 2012. https://github.com/golang/go/commit/e7a138b856
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *The Go Memory Model.* Version
  of June 6, 2022. https://go.dev/ref/mem
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *The Go Programming Language
  Specification: Channel types, Send statements, Receive operator, Close.*
  https://go.dev/ref/spec#Channel_types
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Effective Go: Channels.*
  https://go.dev/doc/effective_go#channels
- <a id="ref-griesemer-2011"></a>[Griesemer, 2011] Robert Griesemer. go spec: clarify semantics of
  range clause. Go commit 5473103666, 2011. https://github.com/golang/go/commit/5473103666 A nil
  channel is never ready; a nil map is equivalent to a read-only empty map.
- <a id="ref-hoare-1978"></a>[Hoare, 1978] C. A. R. Hoare. "Communicating Sequential Processes."
  *Communications of the ACM*, 21(8), 1978. https://doi.org/10.1145/359576.359585
- <a id="ref-pike-2010"></a>[Pike, 2010] Rob Pike. Go specification: Lock down some details about
  channels and select. Go commit 041d11623f, 2010. https://github.com/golang/go/commit/041d11623f
- <a id="ref-pike-2012a"></a>[Pike, 2012a] Rob Pike. *Go Concurrency Patterns.* Google I/O 2012.
  https://go.dev/talks/2012/concurrency.slide
- <a id="ref-pike-2012b"></a>[Pike, 2012b] Rob Pike. spec: change the wording regarding select
  statement choice. Go commit 5f7337769c, 2012. https://github.com/golang/go/commit/5f7337769c
- <a id="ref-pike-2013"></a>[Pike, 2013] Rob Pike. spec: clarify a couple of issues about channels.
  Go commit bd65404eef, 2013. https://github.com/golang/go/commit/bd65404eef Fixes issue #5911.
- <a id="ref-tao-2011"></a>[Tao, 2011] Nigel Tao. golang/go#1419. *Sending on a closed channel
  should fail after 0 or ∞ times, not a finite N > 0.* 2011.
  https://github.com/golang/go/issues/1419
- This book: [1.3 Communicating Sequential Processes](../../part1overview/ch01intro/csp.md),
  [10.6 The Memory Model and the Lock-Free Evolution](./lockfree.md),
  [11.9 Memory Consistency Models](../ch11sync/mem.md), [10.4 The Semantics of Closing](./close.md),
  [10.5 The Implementation of select](./select.md).
