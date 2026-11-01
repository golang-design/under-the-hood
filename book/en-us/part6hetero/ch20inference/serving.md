---
weight: 6303
title: "20.3 Serving, Batching, and Streaming"
---

# 20.3 Serving, Batching, and Streaming

The previous two sections examined the foundations of a single inference: [20.1](./runtime.md)
covered how to attach the runtime and how to place weights and tensors, and [20.2](./tokenize.md)
covered how tokens go in and out of the model. A real service must handle thousands of requests at
once, each continuously generating tokens. Organizing them efficiently and reliably is a concurrency
and scheduling problem. This section applies the channels of
[Chapter 10](../../part3concurrency/ch10chan/readme.md) and the context of
[11.8](../../part3concurrency/ch11sync/context.md) to LLM serving.

## 20.3.1 The Life of a Request

An LLM is **autoregressive**: it generates one token at a time, feeds it back into the input,
computes the next, and continues until it generates an end-of-sequence token or reaches a length
limit. A request therefore has two phases. **Prefill** processes the complete prompt in one pass and
computes the keys and values needed for later generation; **decode** then generates one token per
step on top of that, reusing the cached keys and values. The Orca paper describes this property:
processing an inference request requires running the model multiple times, with each iteration
generating one output token for the request [[Yu et al., 2022](#ref-yu-et-al-2022)]. On the time
axis, a request is not a single request-response but a stream of tokens flowing out over time. The
latency the user perceives splits in two accordingly: time to first token (TTFT) is determined
mainly by prefill, and the interval between later tokens is determined by decode.

This shape fits Go's concurrency model well: one goroutine runs the generation loop, sends each
token into a channel as soon as it is computed, and the downstream receives from the channel. Here
is a sketch, where `engine` stands for the inference runtime discussed in 20.1:

```go
// One generation goroutine per request, sending tokens one by one into a channel
func generate(ctx context.Context, req Request, out chan<- Token) {
	defer close(out)
	for {
		tok := engine.Next(req.state) // one boundary-crossing call, one token generated
		select {
		case out <- tok: // hand to the downstream (HTTP handler)
		case <-ctx.Done(): // the client has left, stop generating
			return
		}
		if tok.IsEOS() {
			return
		}
	}
}
```

This sketch already contains three themes of this section: the `out` channel corresponds to
**streaming**, `ctx.Done()` to **cancellation**, and when `out` is full and `out <- tok` blocks,
**backpressure** appears. But it lacks the most important piece: a request that has a forward pass
to itself leaves most of the device's compute idle.

## 20.3.2 Batching

Every token generated in the decode phase requires reading all the weights once. Forma's batching
implementation gives an accounting: when two sequences decode together, the weights are read once
but two tokens are produced; with batch size $B$, the cost of one step is about
$(W + B \cdot A)/\beta$, where $W$ is the number of bytes of weights, $A$ is the memory traffic of
each sequence itself and $\beta$ is the bandwidth. Until $B \cdot A$ approaches $W$, throughput
grows almost linearly with $B$ [[Ou, 2026](#ref-ou-2026)]. Decode is memory-bandwidth-bound
computation, and that is the point of batching.

The difficulty is that requests are independent, arrive at random, differ in length and finish at
different times. Forming batches per request produces the problem Orca identified: a request in a
batch that finishes early cannot be returned to the client immediately, and a newly arrived request
must wait until the whole current batch completes. Orca proposed **iteration-level scheduling**: the
unit of scheduling is one iteration of the model rather than one request, and the scheduler lets the
execution engine run only one iteration on the current batch at a time, so new requests can join and
finished requests can leave at every step. Because the attention computations of different requests
have different shapes, Orca also proposed **selective batching**, which batches only some of the
operators. On GPT-3 175B, Orca's throughput at the same latency was 36.9 times that of NVIDIA
FasterTransformer [[Yu et al., 2022](#ref-yu-et-al-2022)]. This idea is now usually called
**continuous batching**. The llama.cpp server enables it by default; the option description
reads "continuous batching (a.k.a dynamic batching)", and the number of requests processed in
parallel is determined by the number of slots given with `-np`
[[ggml-org, 2026](#ref-ggml-org-2026)].

Batching is also constrained by memory. The KV cache of each request grows during generation, and
reserving a contiguous region sized for the maximum length for every request produces a great deal
of fragmentation. vLLM's analysis showed that in the systems of the time only 20.4% to 38.2% of KV
cache memory was actually used to hold token state. PagedAttention borrows virtual memory and paging
from operating systems, splitting the KV cache into fixed-size blocks allocated on demand; on that
basis vLLM achieved nearly zero waste of KV cache memory and raised throughput to 2 to 4 times that
of FasterTransformer and Orca at the same latency [[Kwon et al., 2023](#ref-kwon-et-al-2023)]. Batch
size and the KV cache budget are therefore tied together. When Ollama starts `llama-server`, it sets
the context length to the per-request context length multiplied by the number of parallel requests
[[Ollama, 2026c](#ref-ollama-2026c)], and its FAQ also warns that the required memory grows with the
product of `OLLAMA_NUM_PARALLEL` and `OLLAMA_CONTEXT_LENGTH` [[Ollama, 2026b](#ref-ollama-2026b)].

The admission policy must be adjusted accordingly. Forma's batching mode has all slots share one
chunked KV cache pool, and a comment explains an easily overlooked deadlock: if a request is
admitted whenever a slot is free, it can happen that all slots are occupied, the cache pool is
exhausted, and no sequence can grow further, so no request can finish and nothing can be released.
At admission it therefore reserves cache blocks not only for the prompt but also for part of the
answer, which guarantees that an admitted request can complete [[Ou, 2026](#ref-ou-2026)]. The
composition of each step is also part of the scheduling policy: Forma puts prefill chunks and decode
into the same computation, schedules the prefill chunks that have not yet produced a first token
first, to shorten TTFT, and then schedules one row for each decoding sequence; a sequence that does
not fit waits for the next step rather than being evicted.

Expressing such a scheduling loop in Go is not hard. The following sketch is again schematic:

```go
// Batch scheduling: in-flight requests are added and removed dynamically at each step
func batchLoop(incoming <-chan *Seq) {
	batch := map[ID]*Seq{}
	for {
		drainNewArrivals(incoming, batch) // collect new requests without blocking
		if len(batch) == 0 {
			seq := <-incoming // block while the batch is empty, waiting for the first request
			batch[seq.ID] = seq
			continue
		}
		toks := engine.Step(batch) // one forward pass, one token per sequence
		for id, tok := range toks {
			deliver(batch[id], tok) // distribute to the requests, see 20.3.4
			if tok.IsEOS() {
				delete(batch, id) // finished requests leave the batch
			}
		}
	}
}
```

Under iteration-level scheduling, a new request can join at the next step and does not wait for a
batch to fill. The trade-off between latency and throughput moves elsewhere: the number of slots
determines the concurrency and the KV cache budget, and the chunk size of prefill determines how
much a long prompt slows down decoding in the same batch. Forma separates these policies from the
execution mechanism into two types: `Scheduler` decides whom to admit and what to compute at each
step, and `Batch` performs the execution; the comment gives the reason that, built together, defects
in batching and defects in admission would be indistinguishable [[Ou, 2026](#ref-ou-2026)].

## 20.3.3 Streaming

Once a token is generated, it should reach the user as soon as possible. Inference services
generally use streaming transmission, for example Server-Sent Events (SSE) over HTTP, pushing output
as it is generated. In Go this path is a relay of several channels: the generation loop, the batch
distribution, the output channel of each request, and finally the HTTP handler writing to the
response. The UTF-8 buffered decoding of [20.2](./tokenize.md) sits on this path, ensuring that what
is written to the client is always complete characters.

Two things on the handler side go wrong most easily. The first is that the output buffer must be
flushed after every event; otherwise `net/http` buffers the response and the client finally receives
the whole answer at once. Such an implementation passes every test that checks only content yet
loses the point of streaming. The second is how to flush. Forma does it as follows:

```go
// NewResponseController rather than a w.(http.Flusher) assertion: it
// unwraps middleware, so a wrapper added later cannot silently turn
// flushing off while the content tests stay green.
rc := http.NewResponseController(w)
flush := func() { _ = rc.Flush() }
```

The comment explains that `NewResponseController` is used rather than a type assertion of `w` to
`http.Flusher`, because the former sees through the wrappers of middleware, so a wrapper layer added
later cannot quietly turn flushing off while the content tests keep passing
[[Ou, 2026](#ref-ou-2026)]. `http.ResponseController` was introduced in Go 1.20. Its `Flush` method
checks in turn whether the current layer implements `FlushError` or `Flush`; if neither is
implemented and the layer has an `Unwrap` method, it takes the wrapped `ResponseWriter` and keeps
checking, until it finds an implementation or returns `ErrNotSupported` (as of Go 1.26)
[[Go Authors, n.d.b](#ref-go-authors-ndb)]. With a direct type assertion, a wrapper layer that does
not implement `Flush` makes the assertion fail. Forma also requires that the last event of a stream
carry the stop reason and usage statistics; otherwise a stream that ended normally cannot be told
apart from a connection that dropped midway.

## 20.3.4 Backpressure and Cancellation

Picture a **slow client**: the network is poor and it receives tokens slowly, while tokens keep
being generated. If the channel between generation and sending is unbounded, the backlog of tokens
grows without limit, and a single slow client can exhaust memory. If the channel is bounded, the
sender blocks when the channel is full, and the slow consumer's speed pushes back on the producer;
this is **backpressure**. Chapter 10 discussed how a bounded channel is itself a backpressure
mechanism. But in an inference service, blocking has a serious side effect:

> A generation loop blocked by backpressure still holds this request's KV cache and a slot in the
> batch.

In a batching architecture the situation is worse. If the scheduling loop of 20.3.2 handed tokens to
each request with blocking sends, one slow client would stall the entire batch, and every request
would wait along with it. Distribution must therefore be non-blocking: each request has a bounded
buffer, and when the buffer is full the client is judged to have fallen behind, so the request is
cancelled and its resources are released. The following program simulates this policy:

```go {run=true}
package main

import "fmt"

type stream struct {
	name string
	out  chan int // bounded buffer: at most 2 tokens pending per request
	read bool     // simulates whether the client reads in time
}

func main() {
	streams := []*stream{
		{name: "fast", out: make(chan int, 2), read: true},
		{name: "slow", out: make(chan int, 2), read: false},
	}
	for step := 1; step <= 4; step++ {
		// After a forward pass, deliver this step's token to every request in the batch.
		live := streams[:0]
		for _, s := range streams {
			select {
			case s.out <- step: // non-blocking send: one request must not stall the batch
				live = append(live, s)
			default: // buffer full: the client has fallen behind, drop it from the batch
				fmt.Printf("step %d: the %s client has %d tokens pending, cancelling the request\n", step, s.name, len(s.out))
			}
		}
		streams = live
		for _, s := range streams {
			if s.read {
				<-s.out
			}
		}
		fmt.Printf("step %d: batch size is now %d\n", step, len(streams))
	}
}
```

```
step 1: batch size is now 2
step 2: batch size is now 2
step 3: the slow client has 2 tokens pending, cancelling the request
step 3: batch size is now 1
step 4: batch size is now 1
```

The slow client's buffer is full after step 2, so the non-blocking send of step 3 falls into the
`default` branch and the request is removed from the batch; the fast client is unaffected. The
buffer capacity determines how much network jitter is tolerated, and the `default` branch of
`select` guarantees that the scheduling loop never stops because of a single request.

Cancellation relies on context. The most important rule is this: **when a client disconnects,
generation must stop immediately and the KV cache must be returned.** `net/http` provides a
ready-made signal for this. The documentation of `Request.Context` states that for an incoming
server request, the context is canceled when the client's connection closes, the request is canceled
(with HTTP/2), or the `ServeHTTP` method returns (as of Go 1.26). Passing it all the way into the
generation loop lets the loop exit promptly on `ctx.Done()`
[[Go Authors, n.d.a](#ref-go-authors-nda)]. A comment in Forma's handler points out that a loop that
does not read this context keeps holding the session and the KV cache reserved for it until
generation reaches `max_tokens`; it even passes the context to the step that waits for a free
session, since a client that leaves while queued should no longer occupy a session it will never
read from. This case is recorded with status code 499, following nginx's convention for "client
closed request", and is not counted as a server failure [[Ou, 2026](#ref-ou-2026)].

The other end of backpressure is at the entrance: when there are too many requests, they should be
rejected early rather than queued without limit. Ollama's scheduler uses a buffered channel as the
pending queue, with the capacity set by `OLLAMA_MAX_QUEUE` (512 by default), and new requests are
enqueued without blocking [[Ollama, 2026a](#ref-ollama-2026a)]:

```go
select {
case s.pendingReqCh <- req:
default:
	req.errCh <- ErrMaxQueue
}
```

When the queue is full, `select` falls into the `default` branch and the request immediately gets
a "server busy" error; the FAQ says the server returns 503 in this case
[[Ollama, 2026b](#ref-ollama-2026b)]. A bounded buffered channel plus the `default` branch of
`select` is the simplest overload protection in Go.

Forma's admission queue goes further. It is also bounded, with a default depth of 8 waiters per
slot, and a request that waits longer than 30 seconds or arrives when the queue is full is rejected
with 429 and a `Retry-After` header; a comment states that an unbounded queue merely trades
rejection for unbounded latency. It deliberately makes "wait timeout" and "client cancellation" two
distinct errors, because the former corresponds to 429 and the latter to 499, and if a context
derived from the waiting budget represented the timeout, the two would be conflated
[[Ou, 2026](#ref-ou-2026)]. Waiters are woken as follows. Each time the scheduler frees a slot or a
batch of cache blocks, it emits a signal:

```go
// signal offers one capacity event and drops it if one is already pending.
func (s *Scheduler) signal() {
	select {
	case s.capacity <- struct{}{}:
	default:
	}
}
```

`capacity` is a channel with capacity 1, and the send is non-blocking: when one signal is already
pending, a new one is dropped. A burst of releases thus triggers only one re-evaluation, and waiters
wait on events rather than timers. A single goroutine drives all waiters in the queue, because rules
such as first-come-first-served and the number of times the head of the queue may be overtaken are
global state; the comment also points out that if N readers each waited on this channel, wakeups
would be lost: the reader that grabs the signal might be one the rules do not allow to be admitted,
and the others would sleep until the next release [[Ou, 2026](#ref-ou-2026)].

## Summary

An LLM request has two phases, prefill and decode, and appears as a stream of tokens flowing out
over time, which corresponds to the Go idiom of one goroutine sending into a channel. Decode is
memory-bandwidth-bound, and batching lets several sequences share one read of the weights;
iteration-level scheduling (continuous batching) lets requests join or leave the batch at every
step, and a paged KV cache reduces fragmentation so batches can be larger. Admission must reserve
cache for the answer as well as the prompt, to avoid deadlock. Streaming output requires a flush
after every event, and `http.ResponseController` can flush through middleware. Backpressure and
cancellation determine a service's reliability: distribution in a batch must be non-blocking and
clients that fall behind must be cancelled; `Request.Context` is canceled when the client
disconnects and the generation loop must respond to it; the queue at the entrance must be bounded,
and a buffered channel with the `default` branch of `select` gives overload protection. All of these
mechanisms come from the concurrency primitives discussed in Chapter 10 and Section 11.8; this time,
they protect a device occupied by a gigabyte-scale model.

This concludes Chapter 20's account of serving a model with Go. Today's systems often go a step
further, letting the model call tools and chaining calls into multi-step autonomous flows, which is
the agent. [Chapter 21](../ch21agent/readme.md) sets aside the intelligence of the model and looks
only at the runtime side: to Go, an agent is likewise a control loop and a concurrency problem.

## Further Reading

- <a id="ref-ggml-org-2026"></a>[ggml-org, 2026] ggml-org. *llama.cpp b11963* (commit 39febd2adb):
  `tools/server/README.md`. 2026.
  https://github.com/ggml-org/llama.cpp/blob/b11963/tools/server/README.md Options such as `-cb`
  (continuous batching, enabled by default) and `-np` (number of slots).
- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *Package context.*
  https://pkg.go.dev/context Cancellation signals propagate down the call chain;
  `http.Request.Context` is canceled when the client disconnects.
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *Server-Sent Events and
  streaming responses with net/http (Flusher).* https://pkg.go.dev/net/http#Flusher Pushing tokens
  to the client as they are generated; see also https://pkg.go.dev/net/http#ResponseController,
  introduced in Go 1.20.
- <a id="ref-kwon-et-al-2023"></a>[Kwon et al., 2023] Woosuk Kwon et al. *Efficient Memory
  Management for Large Language Model Serving with PagedAttention (vLLM).* SOSP, 2023.
  https://arxiv.org/abs/2309.06180 Paged management of the KV cache, the representative work on
  inference-serving scheduling.
- <a id="ref-ollama-2026a"></a>[Ollama, 2026a] Ollama. *server/sched.go.* v0.40.13 (commit
  04088e7c9d),
  2026. https://github.com/ollama/ollama/blob/v0.40.13/server/sched.go
  The pending queue implemented as a buffered channel, and `ErrMaxQueue`.
- <a id="ref-ollama-2026b"></a>[Ollama, 2026b] Ollama. *FAQ.* v0.40.13 (commit 04088e7c9d), 2026.
  https://github.com/ollama/ollama/blob/v0.40.13/docs/faq.mdx
  `OLLAMA_NUM_PARALLEL`, `OLLAMA_MAX_QUEUE` and the 503 on overload.
- <a id="ref-ollama-2026c"></a>[Ollama, 2026c] Ollama. *llm/llama_server.go.* v0.40.13 (commit
  04088e7c9d), 2026. https://github.com/ollama/ollama/blob/v0.40.13/llm/llama_server.go
  The `-np` and `-c` arguments when starting `llama-server`.
- <a id="ref-ou-2026"></a>[Ou, 2026] Changkun Ou. *Forma: Run open-weight LLMs from Go.*
  https://github.com/latere-ai/forma, 2026. As of commit 5af707fbe6; see `batch.go`, `scheduler.go`,
  `schedule.go`, `queue.go`, `server/generate.go` and `docs/serving.md`.
- <a id="ref-yu-et-al-2022"></a>[Yu et al., 2022] Gyeong-In Yu et al. *Orca: A Distributed Serving
  System for Transformer-Based Generative Models.* OSDI, 2022.
  https://www.usenix.org/conference/osdi22/presentation/yu Iteration-level scheduling and selective
  batching, the origin of the continuous batching idea.
- This book: [11.8 Context](../../part3concurrency/ch11sync/context.md), [Chapter
  10 Channels and select](../../part3concurrency/ch10chan/readme.md), [18.4
  The Asynchronous Programming Model](../ch18gpu/model.md), [20.1
  The Inference Runtime and FFI](./runtime.md), [20.2 Tokenization and Tensors](./tokenize.md).
