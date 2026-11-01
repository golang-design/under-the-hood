---
weight: 6204
title: "19.4 Rendering in the Browser"
---

# 19.4 Rendering in the Browser

The rendering of the first three sections either crosses the FFI boundary to the local GPU (19.1,
19.2) or stays on the CPU as software rendering ([19.3](./software.md)). This section changes the
environment to the browser. A Go program can be compiled to WebAssembly (Wasm) and run in the
browser, so rendering has to cross a new boundary: the one between Wasm and JavaScript. The cost
structure of this boundary and the ways of dealing with it are essentially those of the FFI boundary
discussed in Chapter 18. The difference is that the Go runtime in the browser has only one thread,
so of the two layers of parallelism in 19.3 only one remains.

## 19.4.1 Go Enters the Browser: WebAssembly and syscall/js

Since Go 1.11, setting `GOOS=js GOARCH=wasm` compiles a program into a `.wasm` module. A web page
loads and starts the module through the `wasm_exec.js` shipped with the Go distribution; the Go Wiki
specifically warns that `wasm_exec.js` must come from the same Go release (the same 1.N) as the one
used to compile the module [[Go Authors, n.d.a](#ref-go-authors-nda)].

A Wasm module runs in a sandbox and can only compute; the DOM, canvas and GPU all belong to the
browser's JavaScript environment. Go code reaches them through the standard library's `syscall/js`:
`js.Global()` returns the JavaScript global object, and the `Get`, `Set` and `Call` methods of
`js.Value` read and write JavaScript properties and call JavaScript functions
[[Go Authors, n.d.b](#ref-go-authors-ndb)]:

```go
doc := js.Global().Get("document")
canvas := doc.Call("getElementById", "screen")
ctx := canvas.Call("getContext", "2d")
// every Get and Call enters JavaScript from Wasm and returns
```

The implementation of `syscall/js` is direct: these operations are import functions declared with
`//go:wasmimport gojs ...` and provided by `wasm_exec.js`. A JavaScript value itself cannot be
passed into Wasm; the `js.Value` held on the Go side is only a 64-bit reference. Numbers other than
0 and NaN are encoded directly as IEEE 754 values, and every other value is encoded as a NaN whose
low 32 bits are an index into the object table on the JavaScript side
[[Go Authors, 2026a](#ref-go-authors-2026a)]. Strings and arguments must be converted between the
two sides on every call.

So `syscall/js` is to Wasm and JavaScript what cgo is to Go and C: another FFI boundary, with a
fixed cost for every crossing. The conclusion of [18.1](../ch18gpu/boundary.md) applies here as
well: cross as few times as possible.

Go's Wasm support is not limited to the browser. Go 1.21 added `GOOS=wasip1`, targeting the WASI
preview 1 system-call interface, and Go 1.24 added the `go:wasmexport` directive, which exports Go
functions for a Wasm host to call [[Mui, 2025](#ref-mui-2025)]. `wasip1` runs outside the browser
and does not provide `syscall/js`; this section discusses only `js/wasm` in the browser.

## 19.4.2 Where the Rendering Boundary Lies

Go code cannot access the canvas directly. Whether it is Canvas 2D, WebGL or WebGPU, Go must in the
end call the browser's graphics API through `js.Value`. The rendering boundary in the browser
therefore lies at `syscall/js`.

This immediately brings the same requirement as reducing draw calls in 19.1. The naive way to draw
is to call `ctx.Call("fillRect", x, y, 1, 1)` once per pixel, so every pixel crosses the boundary
once; with hundreds of thousands or millions of pixels per frame, that is as many crossings. This is
exactly the anti-pattern of crossing the boundary repeatedly in a tight loop described in 18.1.

The correct approach is again to do more work per crossing. The most typical way is to bring in the
software rendering of 19.3: compute the whole frame of pixels in pure Go inside Wasm, then hand the
whole frame to the canvas with one bulk copy.

```go
// render the whole frame inside Go (no boundary crossing), then submit it at once (two or three crossings)
img := image.NewNRGBA(image.Rect(0, 0, w, h)) // non-premultiplied RGBA, 4 bytes per pixel
imgData := ctx.Call("createImageData", w, h)
data := imgData.Get("data") // Uint8ClampedArray of length w*h*4

renderFrame(img)                       // pure Go computation, see 19.3
js.CopyBytesToJS(data, img.Pix)        // one bulk copy
ctx.Call("putImageData", imgData, 0, 0) // one submission
```

The `data` of an `ImageData` is a `Uint8ClampedArray` in RGBA order [[MDN, n.d.a](#ref-mdn-nda)].
`js.CopyBytesToJS` requires its destination to be a `Uint8Array` or `Uint8ClampedArray` and panics
otherwise, and the number of bytes copied is the smaller of the two lengths
[[Go Authors, n.d.b](#ref-go-authors-ndb)]. For an image created by `image.NewNRGBA`, `Pix` is
stored contiguously by row with length exactly `w*h*4`, matching the layout of `ImageData`. `NRGBA`
is chosen rather than `RGBA` because `color.RGBA` represents colors with premultiplied alpha, while
`color.NRGBA` is non-premultiplied [[Go Authors, 2026a](#ref-go-authors-2026a)]. The HTML
specification points out that the canvas stores pixels internally with premultiplied alpha, and
pixels that are not fully opaque are converted when written through `putImageData`
[[WHATWG, n.d.](#ref-whatwg-nd)], which shows that the data in `ImageData` is non-premultiplied. If
all pixels are fully opaque, the two representations are identical.

This compresses hundreds of thousands of crossings per frame into two or three. The software
rendering of 19.3 is thus more than a fallback for machines without a GPU here: it is a common way
to avoid the `syscall/js` boundary cost, with all the computation kept on the Go side of the
boundary and a single submission at the end.

## 19.4.3 The GPU in the Browser: WebGL and WebGPU

When GPU acceleration is needed, the browser offers WebGL and WebGPU. WebGL 1.0 is derived from
OpenGL ES 2.0 [[Khronos, n.d.](#ref-khronos-nd)]. Unlike native OpenGL, `js/wasm` has only one
thread, so the thread-affinity problem of 19.2 does not arise here. The WebGPU specification states
explicitly that it is unrelated to WebGL, and its API was designed from the start to map efficiently
onto native GPU APIs from 2014 onward [[W3C, n.d.a](#ref-w3c-nda)], that is, the explicit APIs of
19.1.3. From the Go side, both are JavaScript APIs called through `syscall/js`.

The concepts of WebGPU correspond one to one with the content of Chapter 18 and 19.1:

- A `GPUBuffer` is backed by GPU memory and must be created and written explicitly. When no longer
  needed it can be released early with `destroy()` instead of waiting for garbage collection, which
  corresponds to the memory divide discussed in 18.3.
- A command encoder records a sequence of commands into a `GPUCommandBuffer`, which is submitted in
  bulk through `GPUQueue.submit()`; this corresponds to the command buffers of 19.1.3 and the
  batched submission of 18.1.
- A compute pipeline runs compute shaders and can do general-purpose GPU computing, which
  corresponds to the GPGPU of Chapter 18; shaders are written in WGSL [[W3C, n.d.b](#ref-w3c-ndb)].

GPU rendering in the browser therefore crosses two boundaries: Go first enters JavaScript through
`syscall/js`, and JavaScript then enters the GPU through the browser's WebGPU implementation.
Command buffers merge the submissions on the second boundary; on the first boundary, every encoded
command (set the pipeline, bind resources, draw) is still one `js.Value` call. To reduce crossings
of the first boundary as well, record the draw commands that do not change from frame to frame into
a render bundle, `GPURenderBundle`, and call `executeBundles` once per frame
[[W3C, n.d.a](#ref-w3c-nda)], and write the data that changes every frame into a few buffers in one
place. Both boundaries obey the same principle: reduce the number of crossings and merge work into a
few calls.

## 19.4.4 The Single-Threaded js/wasm

The outer layer of parallelism in 19.3 depends on multiple cores. In `js/wasm` in the browser, this
layer does not exist. The runtime source says so: the comment at the top of `lock_js.go`
reads "js/wasm has no support for threads yet. There is no preemption."; `newosproc`, which creates
new threads, in `os_wasm.go` simply throws "not implemented", and `getCPUCount` always returns 1;
`haveSysmon` is defined as `GOARCH != "wasm"`, so no sysmon is started on Wasm
[[Go Authors, 2026a](#ref-go-authors-2026a)]. The following program runs as `js/wasm` on this book's
pages:

```go {run=true}
package main

import (
	"fmt"
	"runtime"
)

func main() {
	fmt.Println(runtime.GOOS, runtime.GOARCH)
	fmt.Println("NumCPU:", runtime.NumCPU())
	fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
}
```

Compiled to `js/wasm` with Go 1.26.10 and run under Node.js, the output is:

```text
js wasm
NumCPU: 1
GOMAXPROCS: 1
```

The runtime can still schedule thousands of goroutines, but they all take turns on one thread: this
is concurrency, not parallelism. The structure of 19.3 in which N cores each render one band of rows
degenerates here into one core rendering all the bands in turn. The inner layer, SIMD, is still
available: Go 1.27's `simd/archsimd` adds support for WebAssembly's 128-bit SIMD, and the portable
`simd` package also uses 128-bit vectors on wasm [[Go Authors, 2026b](#ref-go-authors-2026b)],
though both are still experimental.

The absence of preemption brings another constraint. Go code runs on the browser's JavaScript thread
(the main thread in the main page), and the runtime returns control to the JavaScript event loop
only when all goroutines are waiting [[Go Authors, 2026a](#ref-go-authors-2026a)]. If the
computation of one frame lasts hundreds of milliseconds, the page can neither respond to input nor
repaint during that time. The documentation of `js.FuncOf` also warns that calling a wrapped Go
function from JavaScript pauses the event loop and starts a new goroutine, and if the function
blocks, the event loop stays blocked until it returns; a function that needs to block should
explicitly start a new goroutine [[Go Authors, n.d.b](#ref-go-authors-ndb)]. The frame loop in the
browser is therefore usually driven by `requestAnimationFrame`: the browser calls the callback
before the next repaint [[MDN, n.d.c](#ref-mdn-ndc)], the Go code in the callback renders one frame
and returns, and registers the callback again for the next frame. Each frame's computation must
finish within the frame's time budget.

Real parallelism in the browser can only be arranged outside the Go runtime. A Web Worker runs a
script in a background thread separate from the main thread [[MDN, n.d.b](#ref-mdn-ndb)]. Each
Worker can load its own Go Wasm instance, compute a part of the pixels, and aggregate the results
through message passing. To share memory, `SharedArrayBuffer` can be used, but it requires the page
to be in a secure context with cross-origin isolation enabled, that is, the server must return the
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response headers
[[MDN, n.d.d](#ref-mdn-ndd)]. Each instance has its own runtime and heap, and goroutines cannot be
scheduled across instances, so this parallelism is closer to multiple processes. The Wasm-level
threads proposal (shared memory and atomic operations) is currently at phase 4
[[WebAssembly CG, n.d.](#ref-webassembly-cg-nd)], while Go issue #28631, which asks for thread
support for Wasm, is still open and labeled Unplanned [[Go Authors, 2018](#ref-go-authors-2018)]. In
the browser, the experience that "spawning more goroutines yields parallelism" does not hold.

## Summary

When Go moves into the browser, rendering has to cross a new FFI boundary: `syscall/js` between Wasm
and JavaScript. It has the same shape as cgo, and the principles of 18.1 still apply: cross fewer
times and merge submissions. The most typical practice is to compute the whole frame with the
software rendering of 19.3 inside Wasm and then submit it once with `CopyBytesToJS` and
`putImageData`, which makes software rendering a common way to avoid the boundary cost. When GPU
acceleration is needed, WebGL or WebGPU can be used. WebGPU brings the concepts of GPU memory,
command buffers and compute shaders into the browser but stacks two boundaries, and render bundles
can reduce the crossings of both. The `js/wasm` runtime has a single thread and no preemption: the
outer parallelism of 19.3 is gone, the inner SIMD remains usable, long computations block the event
loop, the frame loop should be driven by `requestAnimationFrame`, and real parallelism can only be
arranged outside the runtime with multiple Web Workers.

This chapter covered three destinations for graphics: the local GPU, the local CPU and the browser.
They differ in form, but the basis for choosing among them is the same: the cost of crossing a
boundary. [Chapter 20](../ch20inference/readme.md) turns to AI inference and serving; when Go
connects to a local large-model runtime, it likewise has to cross the FFI boundary discussed in
Chapter 18.

## Further Reading

- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *WebAssembly (Go Wiki).*
  https://go.dev/wiki/WebAssembly Compiling and loading with `GOOS=js GOARCH=wasm`, the version
  requirement for `wasm_exec.js`, and `GOOS=wasip1`.
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *Package syscall/js.*
  https://pkg.go.dev/syscall/js `js.Value`, `Get`/`Set`/`Call`, `CopyBytesToJS` and `FuncOf`, and
  the boundary between Wasm and JavaScript.
- <a id="ref-go-authors-2018"></a>[Go Authors, 2018] The Go Authors. cmd/compile: thread support for
  webassembly. Go issue #28631, 2018. https://go.dev/issue/28631
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Go 1.26 source code:*
  `src/runtime/lock_js.go`, `src/runtime/os_wasm.go`, `src/runtime/proc.go`, `src/syscall/js/js.go`,
  `src/image/color/color.go`. https://github.com/golang/go/tree/release-branch.go1.26/src The
  single-threaded js/wasm runtime, event handling, and the reference encoding of `js.Value`.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Go 1.27 Release
  Notes.* 2026. https://go.dev/doc/go1.27 The experimental `simd` package, and `simd/archsimd`
  support for WebAssembly 128-bit SIMD.
- <a id="ref-khronos-nd"></a>[Khronos, n.d.] The Khronos Group. *WebGL Specification.*
  https://registry.khronos.org/webgl/specs/latest/1.0/
  The 3D rendering API for the Web; WebGL 1.0 is derived from OpenGL ES 2.0.
- <a id="ref-mdn-nda"></a>[MDN, n.d.a] MDN Web Docs. *ImageData: data property.*
  https://developer.mozilla.org/en-US/docs/Web/API/ImageData/data
- <a id="ref-mdn-ndb"></a>[MDN, n.d.b] MDN Web Docs. *Using Web Workers / SharedArrayBuffer.*
  https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
  The route to real parallelism in the browser, beyond the single-threaded js/wasm model.
- <a id="ref-mdn-ndc"></a>[MDN, n.d.c] MDN Web Docs. *Window: requestAnimationFrame() method.*
  https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- <a id="ref-mdn-ndd"></a>[MDN, n.d.d] MDN Web Docs. *SharedArrayBuffer.*
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
  Shared memory requires a secure context and cross-origin isolation.
- <a id="ref-mui-2025"></a>[Mui, 2025] Cherry Mui. *Extensible Wasm Applications with Go.* The Go
  Blog, 2025-02-13. https://go.dev/blog/wasmexport
- <a id="ref-w3c-nda"></a>[W3C, n.d.a] W3C GPU for the Web Working Group. *WebGPU.*
  https://www.w3.org/TR/webgpu/ The explicit GPU API in the browser: `GPUBuffer`, command encoders,
  render bundles and compute pipelines.
- <a id="ref-w3c-ndb"></a>[W3C, n.d.b] W3C GPU for the Web Working Group. *WebGPU Shading Language
  (WGSL).* https://www.w3.org/TR/WGSL/
- <a id="ref-webassembly-cg-nd"></a>[WebAssembly CG, n.d.] WebAssembly Community Group.
  *WebAssembly Proposals.* https://github.com/WebAssembly/proposals
  The phase of each proposal; the threads proposal is at phase 4.
- <a id="ref-whatwg-nd"></a>[WHATWG, n.d.] WHATWG. *HTML Living Standard: The canvas element.*
  https://html.spec.whatwg.org/multipage/canvas.html The canvas stores pixels with premultiplied
  alpha; the conversion when writing through `putImageData`.
- This book: [18.1 Crossing the FFI Boundary](../ch18gpu/boundary.md), [18.3 The Divide Between
  Device Memory and the Garbage Collector](../ch18gpu/memory.md),
  [19.1 The Rendering Pipeline and Where Go Sits](./pipeline.md),
  [19.3 Software Rendering and Parallelism](./software.md),
  [20.1 The Inference Runtime and FFI](../ch20inference/runtime.md).
