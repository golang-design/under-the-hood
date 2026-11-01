---
weight: 6204
title: "19.4 浏览器中的渲染"
---

# 19.4 浏览器中的渲染

前三节的渲染要么经过 FFI 边界交给本机 GPU（19.1、19.2），要么留在 CPU
上做软件渲染（[19.3](./software.md)）。本节把运行环境换成浏览器。Go 程序可以编译为 WebAssembly（简称
Wasm）在浏览器中执行，渲染因此要跨越一道新的边界：Wasm 与 JavaScript 之间的边界。
这道边界的成本结构与应对办法，与第 18 章讨论的 FFI 边界基本一致；不同的是，浏览器中的 Go
运行时只有一个线程，19.3 的两层并行在这里只剩下一层。

## 19.4.1 Go 进入浏览器：WebAssembly 与 syscall/js

自 Go 1.11 起，设置 `GOOS=js GOARCH=wasm` 即可把程序编译为一个 `.wasm` 模块。网页通过 Go 发行版附带的
`wasm_exec.js` 加载并启动这个模块；Go Wiki 特别提醒，`wasm_exec.js` 必须与编译模块所用的 Go
属于同一主版本（同为 1.N）[[Go Authors, n.d.a](#ref-go-authors-nda)]。

Wasm 模块运行在沙箱中，只能做纯计算，DOM、画布与 GPU 都属于浏览器的 JavaScript 环境。Go 代码要使用它们，
就要经过标准库的 `syscall/js`：`js.Global()` 返回 JavaScript 的全局对象，`js.Value` 的 `Get`、`Set` 与
`Call` 读写 JavaScript 属性、调用 JavaScript 函数 [[Go Authors, n.d.b](#ref-go-authors-ndb)]：

```go
doc := js.Global().Get("document")
canvas := doc.Call("getElementById", "screen")
ctx := canvas.Call("getContext", "2d")
// 每一次 Get 与 Call 都要从 Wasm 进入 JavaScript 再返回
```

`syscall/js` 的实现很直接：这些操作都是经 `//go:wasmimport gojs ...` 声明、由 `wasm_exec.js`
提供的导入函数。JavaScript 的值本身不能传入 Wasm，Go 一侧持有的 `js.Value` 只是一个 64 位的引用：
除 0 与 NaN 之外的数值直接按 IEEE 754 编码，其他值编码为一个 NaN，低 32 位是 JavaScript 一侧对象表中的编号
[[Go Authors, 2026a](#ref-go-authors-2026a)]。字符串与参数在每次调用时都要在两侧之间转换。

由此可见，`syscall/js` 之于 Wasm 与 JavaScript，正如 cgo 之于 Go 与 C：它是又一条 FFI 边界，
每次穿越都有固定开销。[18.1](../ch18gpu/boundary.md) 的结论在这里同样适用：要尽量减少穿越的次数。

Go 的 Wasm 支持并不限于浏览器。Go 1.21 增加了面向 WASI 预览版 1 系统调用接口的 `GOOS=wasip1`，Go 1.24
又增加了 `go:wasmexport` 指令，可以把 Go 函数导出给 Wasm 宿主调用 [[Mui, 2025](#ref-mui-2025)]。`wasip1`
运行在浏览器之外，不提供 `syscall/js`；本节只讨论浏览器中的 `js/wasm`。

## 19.4.2 渲染的边界落在哪里

Go 代码无法直接访问画布，无论是 Canvas 2D，还是 WebGL、WebGPU，最终都要经 `js.Value` 调用浏览器的图形
API。因此，浏览器中渲染的边界就落在 `syscall/js` 上。

这立即带来与 19.1 中减少绘制调用相同的要求。最朴素的画法是逐像素调用一次
`ctx.Call("fillRect", x, y, 1, 1)`，每个像素都要穿越一次边界，一帧数十万乃至数百万像素，
就是同样多次的穿越。这正是 18.1 所说的在紧密循环中反复跨越边界的反模式。

正确的做法同样是在一次穿越中完成更多工作。最典型的办法是把 19.3 的软件渲染接进来：在 Wasm 内部用纯 Go
计算整帧像素，再通过一次批量复制把整帧交给画布。

```go
// 在 Go 内渲染整帧（不穿越边界），再一次性提交（两三次穿越）
img := image.NewNRGBA(image.Rect(0, 0, w, h)) // 非预乘的 RGBA，逐像素 4 字节
imgData := ctx.Call("createImageData", w, h)
data := imgData.Get("data") // Uint8ClampedArray，长度为 w*h*4

renderFrame(img)                       // 纯 Go 计算，见 19.3
js.CopyBytesToJS(data, img.Pix)        // 一次批量复制
ctx.Call("putImageData", imgData, 0, 0) // 一次提交
```

`ImageData` 的 `data` 是一个按 RGBA 顺序排列的 `Uint8ClampedArray` [[MDN, n.d.a](#ref-mdn-nda)]，`js.CopyBytesToJS`
恰好要求目标是 `Uint8Array` 或 `Uint8ClampedArray`，否则会 panic，
复制的字节数取两者长度的较小值 [[Go Authors, n.d.b](#ref-go-authors-ndb)]。由 `image.NewNRGBA`
创建的图像，`Pix` 按行连续存放，长度恰为 `w*h*4`，与 `ImageData` 的布局一致。这里选用 `NRGBA` 而不是
`RGBA`，是因为 `color.RGBA` 表示预乘 alpha 的颜色，`color.NRGBA` 才是非预乘的
[[Go Authors, 2026a](#ref-go-authors-2026a)]；HTML 规范指出，画布内部以预乘 alpha 存储，经 `putImageData`
写入的非完全不透明像素要经过转换 [[WHATWG, n.d.](#ref-whatwg-nd)]，可见 `ImageData` 中的数据是非预乘的。
若所有像素都完全不透明，两种表示没有区别。

这样，每帧数十万次穿越被压缩为两三次。19.3 的软件渲染在这里不只是没有 GPU 时的备选方案，也是绕开
`syscall/js` 边界开销的常用手段：计算全部留在边界的 Go 一侧，最后只提交一次。

## 19.4.3 浏览器中的 GPU：WebGL 与 WebGPU

需要 GPU 加速时，浏览器提供 WebGL 与 WebGPU。WebGL 1.0 派生自 OpenGL ES 2.0
[[Khronos, n.d.](#ref-khronos-nd)]，与本机 OpenGL 不同的是，`js/wasm` 中只有一个线程，19.2
讨论的线程亲和问题在这里不会出现。WebGPU 的规范则明确说明它与 WebGL 无关，其 API
从设计之初就力求高效地映射到 2014 年以后的原生 GPU API [[W3C, n.d.a](#ref-w3c-nda)]，也就是 19.1.3
讨论的显式 API。从 Go 一侧看，两者都是经 `syscall/js` 调用的 JavaScript API。

WebGPU 的概念与第 18 章和 19.1 的内容一一对应：

- `GPUBuffer` 由 GPU 内存支撑，需要显式创建与写入，不再需要时可以调用 `destroy()` 提前释放，
  而不必等待垃圾回收，对应 18.3 讨论的内存分界。
- 命令编码器把一串命令录制为 `GPUCommandBuffer`，再经 `GPUQueue.submit()` 批量提交，对应 19.1.3
  的命令缓冲与 18.1 的批量提交。
- 计算管线运行计算着色器，可以做通用 GPU 计算，对应第 18 章的 GPGPU；着色器用 WGSL 编写
  [[W3C, n.d.b](#ref-w3c-ndb)]。

于是，浏览器中的 GPU 渲染要跨越两道边界：Go 先经 `syscall/js` 进入 JavaScript，JavaScript 再经浏览器的
WebGPU 实现进入 GPU。命令缓冲合并的是第二道边界上的提交；在第一道边界上，每一条编码命令（设置管线、
绑定资源、绘制）仍是一次 `js.Value` 调用。要同时减少第一道边界的穿越，可以把每帧不变的绘制命令录成渲染包
`GPURenderBundle`，每帧只调用一次 `executeBundles` [[W3C, n.d.a](#ref-w3c-nda)]，
并把每帧变化的数据集中写入少数几个缓冲。两道边界遵守的是同一条原则：减少穿越的次数，
把工作合并到少数几次调用中。

## 19.4.4 单线程的 js/wasm

19.3 的外层并行依赖多个核。在浏览器的 `js/wasm` 中，这一层并不存在。运行时的源码写明了这一点：`lock_js.go`
开头的注释是「js/wasm has no support for threads yet. There is no preemption.」，即 js/wasm
尚不支持线程，也没有抢占；`os_wasm.go` 中创建新线程的 `newosproc` 直接抛出「not implemented」，`getCPUCount`
固定返回 1；`haveSysmon` 定义为 `GOARCH != "wasm"`，Wasm 上不启动 sysmon
[[Go Authors, 2026a](#ref-go-authors-2026a)]。下面的程序在本书页面中以 `js/wasm` 运行：

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

以 Go 1.26.10 编译为 `js/wasm` 并在 Node.js 中运行，输出为：

```text
js wasm
NumCPU: 1
GOMAXPROCS: 1
```

运行时照样可以调度成千上万个 goroutine，但它们都在同一个线程上交替执行，是并发而不是并行。19.3 中 N
个核各自渲染一条行带的结构，在这里退化为一个核依次渲染所有行带。内层的 SIMD 仍然可用：Go 1.27 的
`simd/archsimd` 增加了对 WebAssembly 128 位 SIMD 的支持，可移植的 `simd` 包在 wasm 上同样使用 128 位向量
[[Go Authors, 2026b](#ref-go-authors-2026b)]，不过它们都还是实验特性。

没有抢占带来另一项约束。Go 代码运行在浏览器的 JavaScript 线程上（在主页面中即主线程），只有当所有
goroutine 都进入等待时，运行时才把控制权交还 JavaScript 的事件循环
[[Go Authors, 2026a](#ref-go-authors-2026a)]。一帧的计算若持续数百毫秒，这段时间内页面既不能响应输入，
也不能重绘。`js.FuncOf` 的文档也提醒，从 JavaScript 调用被包装的 Go 函数会暂停事件循环并启动一个新的
goroutine，如果该函数阻塞，事件循环就一直阻塞到它返回；需要阻塞的函数应显式启动新的 goroutine
[[Go Authors, n.d.b](#ref-go-authors-ndb)]。因此，浏览器中的帧循环通常由 `requestAnimationFrame` 驱动：
浏览器在下一次重绘之前调用回调 [[MDN, n.d.c](#ref-mdn-ndc)]，回调中的 Go 代码渲染一帧后返回，
并为下一帧再次登记回调。每帧的计算必须在帧的时间预算之内完成。

要在浏览器中取得真正的并行，只能在 Go 运行时之外安排。Web Worker 让脚本在独立于主线程的后台线程中运行
[[MDN, n.d.b](#ref-mdn-ndb)]，每个 Worker 可以各自加载一个 Go 的 Wasm 实例，各算一部分像素，
再通过消息传递汇总；若要共享内存，可以使用 `SharedArrayBuffer`，但它要求页面处于安全上下文并启用跨源隔离，
即服务器需返回 `Cross-Origin-Opener-Policy` 与 `Cross-Origin-Embedder-Policy` 响应头
[[MDN, n.d.d](#ref-mdn-ndd)]。每个实例都有自己的运行时与堆，goroutine 不能跨实例调度，
这种并行更接近多进程。Wasm 层面的线程提案（共享内存与原子操作）目前处于第 4 阶段
[[WebAssembly CG, n.d.](#ref-webassembly-cg-nd)]，而 Go 为 Wasm 增加线程支持的 issue #28631 至今仍未关闭，
被标记为 Unplanned [[Go Authors, 2018](#ref-go-authors-2018)]。在浏览器中，「多开 goroutine 即可获得并行」
的经验并不成立。

## 小结

把 Go 搬进浏览器，渲染要跨越一道新的 FFI 边界：Wasm 与 JavaScript 之间的 `syscall/js`。它与 cgo 同构，18.1
的原则照样适用：减少穿越的次数，合并提交。最典型的做法是在 Wasm 内用 19.3 的软件渲染算好整帧，再用
`CopyBytesToJS` 与 `putImageData` 一次提交，软件渲染由此成为绕开边界开销的常用手段。需要 GPU
加速时可以使用 WebGL 或 WebGPU，WebGPU 把显存、命令缓冲与计算着色器这套概念带进浏览器，但叠加了两道边界，
渲染包可以同时减少两道边界的穿越。`js/wasm` 的运行时只有一个线程且没有抢占：19.3 的外层并行不复存在，
内层的 SIMD 仍可使用；长时间的计算会阻塞事件循环，帧循环应交给 `requestAnimationFrame` 驱动；
真正的并行只能借助多个 Web Worker 在运行时之外安排。

本章讨论了图形的三种去处：本机 GPU、本机 CPU 与浏览器。三者形式各异，取舍的依据却是同一个：
跨越边界的代价。[第 20 章](../ch20inference/readme.md) 转向 AI 推理与服务；Go 接入本地大模型运行时，
同样要跨越第 18 章讨论的 FFI 边界。

## 延伸阅读

- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *WebAssembly（Go Wiki）.*
  https://go.dev/wiki/WebAssembly
  `GOOS=js GOARCH=wasm` 的编译与加载、`wasm_exec.js` 的版本要求，以及 `GOOS=wasip1`。
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *Package syscall/js.*
  https://pkg.go.dev/syscall/js
  `js.Value`、`Get`/`Set`/`Call`、`CopyBytesToJS` 与 `FuncOf`，以及 Wasm 与 JavaScript 之间的边界。
- <a id="ref-go-authors-2018"></a>[Go Authors, 2018] The Go Authors. cmd/compile: thread support for
  webassembly. Go issue #28631, 2018. https://go.dev/issue/28631
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Go 1.26 source code:*
  `src/runtime/lock_js.go`、`src/runtime/os_wasm.go`、`src/runtime/proc.go`、`src/syscall/js/js.go`、`src/image/color/color.go`.
  https://github.com/golang/go/tree/release-branch.go1.26/src
  js/wasm 的单线程运行时、事件处理与 `js.Value` 的引用编码。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Go 1.27 Release Notes.* 2026.
  https://go.dev/doc/go1.27
  实验性的 `simd` 包，以及 `simd/archsimd` 对 WebAssembly 128 位 SIMD 的支持。
- <a id="ref-khronos-nd"></a>[Khronos, n.d.] The Khronos Group. *WebGL Specification.*
  https://registry.khronos.org/webgl/specs/latest/1.0/
  面向 Web 的三维渲染 API；WebGL 1.0 派生自 OpenGL ES 2.0。
- <a id="ref-mdn-nda"></a>[MDN, n.d.a] MDN Web Docs. *ImageData: data property.*
  https://developer.mozilla.org/en-US/docs/Web/API/ImageData/data
- <a id="ref-mdn-ndb"></a>[MDN, n.d.b] MDN Web Docs. *Using Web Workers / SharedArrayBuffer.*
  https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
  在浏览器中取得真正并行的途径，超出 js/wasm 的单线程模型。
- <a id="ref-mdn-ndc"></a>[MDN, n.d.c] MDN Web Docs. *Window: requestAnimationFrame() method.*
  https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- <a id="ref-mdn-ndd"></a>[MDN, n.d.d] MDN Web Docs. *SharedArrayBuffer.*
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
  共享内存要求安全上下文与跨源隔离。
- <a id="ref-mui-2025"></a>[Mui, 2025] Cherry Mui. *Extensible Wasm Applications with Go.* The Go Blog,
  2025-02-13. https://go.dev/blog/wasmexport
- <a id="ref-w3c-nda"></a>[W3C, n.d.a] W3C GPU for the Web Working Group. *WebGPU.*
  https://www.w3.org/TR/webgpu/
  浏览器中的显式 GPU API：`GPUBuffer`、命令编码器、渲染包与计算管线。
- <a id="ref-w3c-ndb"></a>[W3C, n.d.b] W3C GPU for the Web Working Group. *WebGPU Shading Language
  (WGSL).* https://www.w3.org/TR/WGSL/
- <a id="ref-webassembly-cg-nd"></a>[WebAssembly CG, n.d.] WebAssembly Community Group.
  *WebAssembly Proposals.* https://github.com/WebAssembly/proposals
  各提案所处的阶段；线程提案位于第 4 阶段。
- <a id="ref-whatwg-nd"></a>[WHATWG, n.d.] WHATWG. *HTML Living Standard: The canvas element.*
  https://html.spec.whatwg.org/multipage/canvas.html
  画布以预乘 alpha 存储；`putImageData` 写入时的转换。
- 本书 [18.1 跨越 FFI 边界](../ch18gpu/boundary.md)、[18.3 显存与垃圾回收的分界](../ch18gpu/memory.md)、[19.1
  渲染管线与 Go 的位置](./pipeline.md)、[19.3 软件渲染与并行](./software.md)、[20.1
  推理运行时与 FFI](../ch20inference/runtime.md)。
