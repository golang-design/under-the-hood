---
weight: 6303
title: "20.3 Serving, Batching, and Streaming"
---

# 20.3 Serving, Batching, and Streaming

The previous two sections laid the underpinnings of a single inference: [20.1](./runtime.md)
wired in the runtime through cgo and settled the weights and tensors,
[20.2](./tokenize.md) made clear how tokens go in and come out. But a real service must serve
thousands upon thousands of such requests at once, each continuously spitting tokens. How to
organize them efficiently and stably is a thoroughly **concurrency and scheduling** problem,
and this is Go's home ground. This section brings Chapter 10's channels and Chapter 7's
context down to large-model serving.

## 20.3.1 The Life of a Request: One Token Stream

First see clearly the shape of a generation. A large model is **autoregressive**: it generates
one token at a time, feeds that token back into the input, computes the next, round and round,
until it generates an end token or reaches a length cap. So on the time axis, **a request is
not one request-response, but one token stream flowing out over time**.

This shape is made for Go's concurrency model: one goroutine runs the generation loop, and
each time a token is computed it sends it into a channel, with the downstream receiving from
the channel, the standard idiom of Chapter 10's "share memory by communicating."

```go
// one request = one generation goroutine, sending tokens one by one into a channel
func generate(ctx context.Context, req Request, out chan<- Token) {
    defer close(out)
    for {
        tok := runtime.NextToken(req.state) // one cgo call, compute one token
        select {
        case out <- tok:                    // hand to the downstream (the HTTP handler)
        case <-ctx.Done():                  // the client left, stop at once
            return
        }
        if tok.IsEOS() {
            return
        }
    }
}
```

This skeleton already plants the seeds of the section's three themes: the `out` channel is
**streaming**, `ctx.Done()` is **cancellation**, and when `out` is full and `out <- tok`
blocks, that is **backpressure**. Each is unfolded below.

## 20.3.2 Batching: Amortizing the Device Cost

The single-request generation loop is clear but wasteful: the GPU computes only one sequence's
one token at a time, leaving its vast parallel power idle. The device's most efficient use is
to **feed it a batch at a time**, gathering the current tokens of many sequences into one
batch and going forward together, so that 18.4's SIMT is truly fed full.

The difficulty is that requests are **independent and arrive at random**, of differing lengths
and finishing at differing times. Forcing them into a fixed batch means either waiting idle to
fill it (latency explodes) or frequently waiting for the slowest one in the batch to finish
(throughput collapses). The solution of modern inference services is called **continuous
batching** (also iteration-level scheduling): no longer taking "a whole batch from start to
finish" as the unit, but **at each generation step dynamically adding newly arrived requests to
the batch and removing finished ones**. The batch is like a flowing pool, with entries and
exits at any time, and the device kept as full as possible at every step.

This is in essence a **scheduling** problem, and scheduling is just what Go is good at. A
batching goroutine gathers in-flight requests off a request channel, forms the current step's
batch, makes one runtime forward call, then dispatches each sequence's newly generated token
of this step back to its own channel:

```go
// the batching scheduler: gather many in-flight requests into a batch, adding and removing each step
func batchLoop(incoming <-chan *Seq) {
    batch := map[ID]*Seq{}
    for {
        drainNewArrivals(incoming, batch) // add new requests to the batch (non-blocking gather)
        if len(batch) == 0 {
            seq := <-incoming             // batch empty, block for the first one
            batch[seq.ID] = seq
            continue
        }
        toks := runtime.Step(batch)        // one forward, compute this step's token for each
        for id, tok := range toks {
            batch[id].out <- tok           // dispatch back to each request's channel
            if tok.IsEOS() {
                delete(batch, id)          // remove the finished ones from the batch
            }
        }
    }
}
```

The trade-off between latency and throughput sits on the knob "whether to wait for new
requests, and how long": wait longer, the batch is bigger and throughput higher, but the
early arrivals are delayed; do not wait, latency is low, but the batch is small and device
utilization low. Chapter 10's `select` plus Chapter 9's P-unbound timer (`time.After`) is
exactly the tool to express "wait at most N milliseconds to fill the batch."

## 20.3.3 Streaming: Spitting Tokens Back One by One

Once a token is computed, it should reach the user as fast as possible; no one wants to stare
at a blank waiting for the whole answer to finish generating. So services widely use
**streaming transport**: Server-Sent Events, gRPC streams, or HTTP chunked, pushing tokens to
the client as they are generated.

In Go, this path is a relay of a few channels: generation goroutine -> batching dispatch ->
the request's `out` channel -> the HTTP handler writing into the response stream. And that
`utf8Streamer` of [20.2](./tokenize.md) sits right at the handler end: what it receives from
the channel are a token's bytes, possibly half a character, which must be accumulated into
complete UTF-8 code points before writing to the client, or the user sees a string of `�`.
Streaming and correct decoding combine here.

## 20.3.4 Backpressure and Cancellation: Do Not Let One Slow Client Drag the Service Down

Last is the hard bone of reliability, and the thing this section most wants you to remember.

Imagine a **slow client**: poor network, receiving tokens very slowly. Yet tokens keep being
generated. If the channel between generation and sending is **unbounded**, the backlog of
tokens piles ever higher, and one slow client eats memory through. If instead it is a
**bounded** channel, then when the channel is full the generation goroutine's `out <- tok`
blocks, which is **backpressure**, the slow consumer's speed pushing back on the producer.
Backpressure is itself good, as Chapter 10 taught that a bounded channel is a natural
backpressure valve. But in inference it has a fatal side effect:

> The moment the generation goroutine blocks on backpressure, it **still holds this request's
> KV cache and its slot in the batch**.

[20.1](./runtime.md) said the KV cache is a large per-request block of native memory. A slow
client holding the generation goroutine up means holding precious device resources in hand
and not letting go, and a few slow clients can collapse device utilization. So an inference
service's backpressure cannot be merely "block and wait"; it needs a more active strategy:
leave a reasonable buffer on the send channel, judge the client to have fallen behind if it
still cannot send after a timeout, then **cancel** the request and release its resources.

The mechanism of cancellation is exactly Chapter 7's `context`. The most crucial line: **when
the client disconnects, cancel generation at once and return the KV cache**. In Go's HTTP
service, `http.Request.Context()` is automatically `Done` when the client disconnects, threaded
all the way into the generation goroutine (the `ctx.Done()` in 20.3.1's skeleton), and the
generation loop stops on the spot:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context() // automatically cancelled when the client disconnects
    out := make(chan Token, 32) // bounded buffer: absorbs jitter, yet does not pile up unboundedly
    go generate(ctx, parse(r), out)

    stream := &utf8Streamer{}
    for tok := range out {
        if _, err := writeChunk(w, stream.Push(tok.Bytes)); err != nil {
            return // a failed write means the client left; ctx is cancelled too, generate exits on its own
        }
        flush(w)
    }
}
```

This snippet stitches the section's four things together: `out` is the streaming channel, the
`cap=32` buffer provides bounded backpressure, `ctx` cancels generation and releases the KV
cache when the client disconnects, and `utf8Streamer` guarantees only complete characters are
ever spat out. What a production LLM service must get right at the concurrency layer is
basically these few things, and not one of them is anything but the machinery Chapters 7, 9,
and 10 already taught through, only that this time what is served is a device occupied by a
gigabyte-scale model.

## Summary

A large-model request is a token stream flowing out over time, naturally matching Go's "one
goroutine sends into a channel" idiom. To feed the device full, use continuous batching to
gather many in-flight requests into a batch dynamically at each step, a scheduling problem
that `select` plus a timer expresses as the "how long to wait to fill the batch" latency /
throughput trade-off. Tokens stream back as generated, with 20.2's `utf8Streamer` at the
handler guaranteeing no half-character is spat out. And the thing most to remember is
backpressure and cancellation: a slow client makes the blocked generation goroutine hold the
KV cache and drag down device utilization, so use a bounded buffer plus a timeout to judge it
fallen behind, and above all use Chapter 7's context to cancel generation and return resources
the instant the client disconnects. The reliability of the Go serving layer lands entirely on
the concurrency machinery of Chapters 7, 9, and 10.

Chapter 20 has now finished "Go serving a model." But today's systems often go further: letting
the model call tools itself and chain into a multi-step autonomous flow, which is an **agent**.
The next chapter, [Chapter 21](../ch21agent), sets the model's intelligence aside and looks
only at the runtime side, finding that an agent, in Go's eyes, is no more than yet another
control loop and concurrency problem.

## Further Reading

1. Woosuk Kwon et al. *Efficient Memory Management for Large Language Model Serving with
   PagedAttention (vLLM).* SOSP, 2023. https://arxiv.org/abs/2309.06180
   (continuous batching and paged management of the KV cache, the representative work on
   inference-serving scheduling)
2. Gyeong-In Yu et al. *Orca: A Distributed Serving System for Transformer-Based Generative
   Models.* OSDI, 2022.
   (the proposal of iteration-level scheduling / continuous batching)
3. The Go Authors. *Package context.* https://pkg.go.dev/context
   (cancellation signals propagating down the call chain; `http.Request.Context` cancelling on
   client disconnect)
4. The Go Authors. *Server-Sent Events and streaming responses with net/http (Flusher).*
   https://pkg.go.dev/net/http#Flusher
   (pushing tokens to the client as they are generated)
5. This book: [7 Error Handling and context](../../part2lang/ch07errors),
   [10 Channels and select](../../part3concurrency/ch10chan),
   [18.4 The Asynchronous Programming Model](../ch18gpu/model.md),
   [20.1 The Inference Runtime and FFI](./runtime.md),
   [20.2 Tokenization and Tensors](./tokenize.md).
