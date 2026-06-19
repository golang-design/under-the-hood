---
weight: 6300
title: "Chapter 20 AI Inference and Serving"
bookCollapseSection: true
---

# Chapter 20 AI Inference and Serving

- [20.1 The Inference Runtime and FFI](./runtime.md)
- [20.2 Tokenization and Tensors](./tokenize.md)
- [20.3 Serving, Batching, and Streaming](./serving.md)

Training belongs to Python and CUDA, but at the inference and serving layer Go finds its
footing. Once a model is frozen, what remains is a systems problem: load the weights into
memory, feed requests to the device efficiently, and stream the generated tokens back to
the client steadily. This chapter first looks at how a local inference runtime is wired in
through cgo, and how tensor memory ownership is divided between Go and native libraries like
llama.cpp and ONNX Runtime; then at tokenization, a thing that looks trivial yet is full of
pitfalls, how byte-pair encoding cuts bytes into tokens, and why the mechanics of strings
and bytes from Chapter 5 matter so much here; and finally it comes down to serving itself,
how batching amortizes the cost of the device, and how streaming output and backpressure
lean on channels and context. Ollama, an inference service written in Go, runs as the
empirical thread through the chapter.
