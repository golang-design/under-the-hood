---
weight: 6300
title: "Chapter 20 AI Inference and Serving"
bookCollapseSection: true
---

# Chapter 20 AI Inference and Serving

- [20.1 The Inference Runtime and FFI](./runtime.md)
- [20.2 Tokenization and Tensors](./tokenize.md)
- [20.3 Serving, Batching, and Streaming](./serving.md)

Training large models relies mainly on Python and CUDA; inference and serving are a different kind
of work. Once a model's weights are frozen, what remains are systems problems: loading several
gigabytes of weights into memory, handing a large number of concurrent requests to the device
efficiently, and streaming the generated tokens back to clients reliably. These problems overlap
heavily with what Go does well, and the Ollama server process is written in Go. This chapter takes
Ollama, llama.cpp, vLLM and a few early projects written in Go as examples and examines the work Go
does at this layer.

Section 20.1 covers how Go reaches a native inference runtime: crossing the FFI boundary through
cgo, a subprocess or purego, why weights and the KV cache stay outside the Go heap, how native
memory is released deterministically, and how the placement of the process boundary determines the
topology of the system. Section 20.2 covers tokenization and tensors: how BPE evolved from a
compression algorithm into subword segmentation, why byte-level tokenization is consistent with the
string model of [5.2](../../part2lang/ch05data/string.md) and why streaming decoding must handle
UTF-8 encoding boundaries, followed by tensor memory layout, the cgo pointer rules and quantization
formats. Section 20.3 covers the service itself: prefill and decode, continuous batching and the
paged KV cache, cache reservation at admission, flushing of streamed output, and how channels and
context handle backpressure, cancellation and overload.
