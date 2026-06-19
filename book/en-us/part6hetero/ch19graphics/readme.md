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

Graphics is the oldest heterogeneous workload: long before "general-purpose GPU compute"
became a slogan, the graphics card was already doing parallel arithmetic for every pixel on
the screen. This chapter spreads the rendering pipeline open to see exactly where Go's code
sits on the CPU side, and how a single draw call crosses the boundary of the driver; then it
looks at why a graphics context is nailed to one particular system thread, where
`LockOSThread` is not a trick but a necessity; it then turns to software rendering, which
needs no GPU, to see how goroutines and SIMD lay down pixels in parallel on the CPU; and
finally it steps into the browser, to see where the rendering boundary falls once Go is
compiled to WebAssembly.
