---
weight: 6200
title: "Chapter 19 Graphics"
bookCollapseSection: true
---

# Chapter 19 Graphics

- [19.1 The Rendering Pipeline and Where Go Sits](./pipeline.md)
- [19.2 Graphics Bindings and Thread Affinity](./bindings.md)
- [19.3 Software Rendering and Parallelism](./software.md)
- [19.4 Rendering in the Browser](./wasm.md)

Graphics was the first workload the GPU took on. Chapter 18 treated the GPU as a general-purpose
parallel device; this chapter returns to its original purpose and asks where a Go program sits in
rendering and which boundaries it has to cross.

19.1 examines the structure of the rendering pipeline: how fixed-function stages and programmable
shader stages form a data flow, why Go code lives only in the application stage on the CPU side, the
two boundaries (FFI and shading languages) that graphics programs therefore face, and how the cost
of draw calls drove the command-buffer design of explicit APIs such as Vulkan and WebGPU. 19.2
covers thread affinity: an OpenGL context is current on one thread, window systems require events to
be handled on the main thread, and Go programs arrange their rendering goroutine and the main thread
with `runtime.LockOSThread`, as Ebitengine, Gio, Fyne and the mainthread package do. 19.3 covers
software rendering without a GPU: splitting the frame into non-overlapping regions rendered in
parallel by goroutines, vectorizing the inner loop with the experimental `simd` package of Go 1.27,
and how work divides between software and GPU rendering. 19.4 covers rendering in the browser: once
Go is compiled to WebAssembly, `syscall/js` becomes the new FFI boundary; rendering a whole frame in
software and submitting it once reduces crossings; WebGPU adds two further boundaries; and the
single-threaded, non-preemptive `js/wasm` runtime constrains parallelism and the frame loop.
