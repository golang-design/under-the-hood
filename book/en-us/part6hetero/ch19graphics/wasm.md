---
weight: 6204
title: "19.4 Rendering in the Browser"
---

# 19.4 Rendering in the Browser

Rendering in the previous three sections either pushed the work across the FFI boundary to the local GPU (19.1, 19.2) or kept it on the CPU as software rendering ([19.3](./software.md)). This section changes the scene to a special runtime environment: the **browser**. Go can be compiled to WebAssembly (WASM) and run in the browser, and once inside the browser, rendering meets a brand-new boundary. What is interesting is that the shape of this boundary, its cost, and the way to deal with it correspond almost one to one with the heterogeneous computing of the previous two chapters, only lifted up one level. Understanding this section reveals that "the FFI boundary" is a motif far broader than cgo.

## 19.4.1 Go Enters the Browser: WASM and syscall/js

With `GOOS=js GOARCH=wasm`, Go can compile a program into a `.wasm` module, load it into a web page, and execute it in the browser's WebAssembly virtual machine. But the WASM module itself is a **sandbox**: it can do pure computation, yet it **cannot touch the world outside**, with no DOM, no canvas, no GPU, all of which belong to the browser's JavaScript environment.

Between WASM and JS lies a membrane, and the bridge that crosses it is the standard library's `syscall/js`. Go code obtains the JS global object through `js.Global()`, and uses `js.Value`'s `Get`/`Set`/`Call` to read and write JS properties and call JS functions:

```go
import "syscall/js"

doc := js.Global().Get("document")
canvas := doc.Call("getElementById", "screen")
ctx := canvas.Call("getContext", "2d")
// Every Get / Call is one crossing from WASM into JS
```

Recognize this membrane for what it is: it is **another FFI boundary**. `syscall/js` is to WASM/JS what cgo is to Go/C. Every `js.Value` call must marshal arguments out of WASM's linear memory, cross the membrane, and enter JS, isomorphic to the crossing described in [18.1](../ch18gpu/boundary.md). And so 18.1's core admonition applies unchanged: **this boundary crossing has a fixed cost, so cross it as little as possible.**

## 19.4.2 Where the Rendering Boundary Lands

Since Go-WASM cannot touch the canvas itself, rendering must necessarily cross the `syscall/js` membrane: whether drawing to a Canvas 2D, or driving WebGL or WebGPU, it ultimately calls the browser's graphics API through `js.Value`. **The boundary of rendering lands on `syscall/js`.**

This immediately brings a discipline identical to 19.1's "reduce draw calls." Imagine the most naive way to draw: call `ctx.Call("fillRect", x, y, 1, 1)` once per pixel. This crosses the membrane once per pixel, and a few million pixels per frame is a few million crossings, unbearably slow. This is the antipattern of "crossing the boundary over and over in a tight loop" from 18.1, in its browser incarnation.

The right approach is again to **pack more work into a single crossing**. The most typical move happens to splice in the software rendering of the previous section:

> Compute a whole frame of pixels in pure Go inside Go-WASM (the software rendering of 19.3), store them into a Go `[]byte`, and then **cross the membrane just once**, blitting the whole frame onto the canvas via `ImageData` and `putImageData`.

```go
// Software-render the whole frame inside WASM (zero crossings),
// then submit once (one crossing)
renderFrame(framebuffer) // pure Go: tiling + SIMD from 19.3, never touches js
imgData := ctx.Call("createImageData", w, h)
js.CopyBytesToJS(imgData.Get("data"), framebuffer) // one bulk copy across the membrane
ctx.Call("putImageData", imgData, 0, 0)            // one submission
```

Millions of crossings are compressed into one or two. The software rendering of 19.3 is here not merely "the fallback when there is no GPU," it becomes a positive means of **routing around the `syscall/js` boundary cost**: keep the computation entirely on the Go side of the membrane, and submit only once at the end.

## 19.4.3 Heterogeneous Computing in the Browser: WebGL and WebGPU

If what you want is genuinely GPU-accelerated rendering, the browser also offers WebGL and the newer-generation **WebGPU**. From Go's side, both are JS APIs called through `syscall/js`. And once you go deep into WebGPU, you find the whole story of Chapters 18 and 19 **re-enacted in full** inside the browser:

- WebGPU has `GPUBuffer`, corresponding to video memory, which must be explicitly created, written, and destroyed, the memory divide of 18.3.
- WebGPU has a **command encoder** and a command queue: you record a string of commands and then `submit` the batch, the explicit-API command buffer of 19.1.3, and also 18.1's "submit in batches to amortize the boundary cost."
- WebGPU has **compute shaders**, capable of general-purpose GPU computation, the GPGPU of Chapter 18, except the shaders are written in WGSL and run atop the browser's GPU abstraction.

GPU rendering in the browser thus stacks **two boundaries**: Go first crosses `syscall/js` into JS, and JS then enters the GPU through the browser's graphics stack. Each obeys the same "cross less, batch" discipline. Command-buffer-style batch submission is especially valuable here, because it amortizes the cost of both boundaries at once. The intuitions built in Chapters 18 and 19 still work in the browser, which is exactly the proof that they grasp principles rather than any particular API.

## 19.4.4 A Constraint That Must Be Faced: Concurrency in WASM

Finally, a cold splash of water, to correct a common misconception. Section 19.3 said software rendering can use goroutines to tile and fill multiple cores for linear speedup. **That dividend is largely unattainable in the classic browser WASM.**

The reason lies in the execution model of the `js/wasm` port: it is **single-threaded**. The Go runtime can still schedule tens of thousands of goroutines, but they are all **multiplexed onto the same JS thread**, with no real multi-core parallelism. In other words, on the browser's main thread, Go-WASM has `GOMAXPROCS` effectively equal to 1: goroutines are concurrent (interleaved) but not parallel (simultaneous). The "N cores each running a goroutine" picture from 19.3 collapses to a single line here.

To get real parallelism in the browser, you must take one of two other roads, both outside the classic port. One is **Web Workers**, each of which is an independent JS thread that can load its own WASM instance and share memory through `SharedArrayBuffer`, but this is browser-level multithreading, not something the Go runtime gives you transparently. The other is the still-evolving **WASM threads** proposal, which lets a single WASM instance use multiple threads. Whichever you take, be clear-eyed: **Go's "open a goroutine and you get parallelism" intuition does not hold in the browser**. To speed up software rendering in the browser, you must explicitly enlist Workers rather than simply spawn more goroutines. This gap in the parallelism model is the place most easily missed when porting Go graphics code to the browser.

## Summary

Moving Go into the browser, rendering meets a new FFI boundary: `syscall/js`, the membrane between WASM and JS. It is isomorphic to cgo, so 18.1's discipline carries over directly: cross less, submit in batches. The most typical move is to software-render a whole frame in pure Go inside WASM (19.3) and cross the membrane just once to blit it onto the canvas, which promotes software rendering from "fallback" to "a positive means of routing around the boundary cost." For GPU acceleration, use WebGL/WebGPU, and WebGPU re-enacts the whole Chapter 18/19 story of video memory, command buffers, and compute shaders inside the browser, only stacking two boundaries. But there is one stern constraint: the classic `js/wasm` is single-threaded, `GOMAXPROCS` is effectively 1, and 19.3's goroutine multi-core parallelism collapses in the browser; real parallelism must enlist Web Workers or WASM threads.

With this, Chapter 19 has walked through the three destinations of graphics: the local GPU, local software, and the browser. The shape differs in each, but underneath is the same boundary manifesting again and again. The next chapter turns the lens to the hottest workload of the moment: [Chapter 20](../ch20inference) looks at how Go stands at the layer of AI inference and serving, and we will see that the FFI boundary of Chapter 18 is the very same door through which Go connects to a local large model runtime.

## Further Reading

1. The Go Authors. *WebAssembly, Go Wiki.* https://go.dev/wiki/WebAssembly
   (Compiling and loading with `GOOS=js GOARCH=wasm`, and the execution model.)
2. The Go Authors. *Package syscall/js.* https://pkg.go.dev/syscall/js
   (`js.Value`, `Get`/`Set`/`Call`, `CopyBytesToJS`, and the WASM/JS boundary.)
3. W3C. *WebGPU* and *WebGPU Shading Language (WGSL).*
   https://www.w3.org/TR/webgpu/ , https://www.w3.org/TR/WGSL/
   (The modern GPU API in the browser: GPUBuffer, command encoder, compute shaders.)
4. MDN. *Using Web Workers / SharedArrayBuffer.*
   https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
   (Ways to get real parallelism in the browser, beyond the single-threaded classic js/wasm model.)
5. This book: [18.1 Crossing the FFI Boundary](../ch18gpu/boundary.md),
   [19.1 The Rendering Pipeline and Where Go Sits](./pipeline.md), [19.3 Software Rendering and Parallelism](./software.md),
   [20.1 The Inference Runtime and FFI](../ch20inference/runtime.md).
