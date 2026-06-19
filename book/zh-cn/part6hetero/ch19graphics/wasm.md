---
weight: 6204
title: "19.4 浏览器中的渲染"
---

# 19.4 浏览器中的渲染

前三节的渲染，要么把活儿推过 FFI 边界交给本机 GPU(19.1、19.2),要么留在 CPU 上软件渲染
（[19.3](./software.md)）。这一节把场景换到一个特别的运行环境:**浏览器**。Go 可以编译成
WebAssembly(WASM)在浏览器里跑，而一旦进了浏览器，渲染会遇到一道全新的边界。有意思的是，
这道边界的形状、它的成本、应对它的办法，与前面整整两章讲的异构计算几乎一一对应,只是搬高了一层。
看懂这一节，就会发现「FFI 边界」是个比 cgo 宽得多的母题。

## 19.4.1 Go 进入浏览器：WASM 与 syscall/js

Go 用 `GOOS=js GOARCH=wasm` 就能把程序编译成一个 `.wasm` 模块，加载进网页，在浏览器的
WebAssembly 虚拟机里执行。但 WASM 模块本身是个**沙盒**:它能做纯计算，却**碰不到外面的世界**,
没有 DOM，没有画布，没有 GPU,这些都属于浏览器的 JavaScript 环境。

WASM 与 JS 之间隔着一道膜，跨越它的桥是标准库的 `syscall/js`。Go 代码通过 `js.Global()` 拿到
JS 的全局对象，用 `js.Value` 的 `Get`/`Set`/`Call` 去读写 JS 属性、调用 JS 函数:

```go
import "syscall/js"

doc := js.Global().Get("document")
canvas := doc.Call("getElementById", "screen")
ctx := canvas.Call("getContext", "2d")
// 每一次 Get / Call，都是一次从 WASM 跨进 JS 的边界穿越
```

请认出这道膜的真面目:它就是又一条 **FFI 边界**。`syscall/js` 之于 WASM/JS,正如 cgo 之于
Go/C。每一次 `js.Value` 的调用，都要把参数从 WASM 的线性内存里编组、跨过膜、进入 JS,
和 [18.1](../ch18gpu/boundary.md) 描述的跨界是同构的。于是 18.1 那条核心告诫原封不动地适用:
**这道边界穿越有固定成本，要尽量少跨。**

## 19.4.2 渲染的边界落在哪里

既然 Go-WASM 自己碰不到画布，渲染就必然要跨过 `syscall/js` 这道膜:无论是往 Canvas 2D 上画，
还是驱动 WebGL、WebGPU,最终都得通过 `js.Value` 调用浏览器的图形 API。**渲染的边界，
就落在 `syscall/js` 上。**

这立刻带来一个和 19.1「减少 draw call」一模一样的纪律。设想最朴素的画法:逐像素地调一次
`ctx.Call("fillRect", x, y, 1, 1)`。这等于每个像素都跨一次膜,一帧几百万像素就是几百万次边界
穿越，慢得无法忍受。这是 18.1 那个「在紧循环里反复跨界」的反模式，在浏览器里的翻版。

正确的做法同样是**把更多的活儿塞进一次跨界**。最典型的一招，恰好把上一节的软件渲染接了进来:

> 在 Go-WASM 内部用纯 Go(19.3 的软件渲染）算好整帧的像素，存进一块 Go 的 `[]byte`,
> 然后**只跨一次膜**,通过 `ImageData` 与 `putImageData` 把整帧一次性贴到画布上。

```go
// 整帧在 WASM 内软件渲染（零跨界），最后一次性提交（一次跨界）
renderFrame(framebuffer) // 纯 Go：19.3 的分块 + SIMD，全程不碰 js
imgData := ctx.Call("createImageData", w, h)
js.CopyBytesToJS(imgData.Get("data"), framebuffer) // 一次批量拷贝过膜
ctx.Call("putImageData", imgData, 0, 0)            // 一次提交
```

百万次跨界被压成了一两次。19.3 的软件渲染在这里不只是「没有 GPU 时的退路」,它成了**绕开
`syscall/js` 边界成本**的正面手段:把计算全留在膜的 Go 这一侧，只在最后提交一次。

## 19.4.3 浏览器里的异构计算：WebGL 与 WebGPU

如果要的是真正的 GPU 加速渲染，浏览器也提供 WebGL 与新一代的 **WebGPU**。从 Go 这侧看，
它们都是经由 `syscall/js` 调用的 JS API。而一旦深入 WebGPU,你会发现第 18、19 章的整套故事
在浏览器里**又完整地重演了一遍**:

- WebGPU 有 `GPUBuffer`,对应显存,要显式创建、写入、销毁,这是 18.3 的内存分界。
- WebGPU 有**命令编码器**(command encoder)与命令队列,你把一串命令录制好再整批 `submit`,
  这是 19.1.3 的显式 API 命令缓冲，也是 18.1 的「批量提交以摊薄边界成本」。
- WebGPU 有**计算着色器**(compute shader),能做通用 GPU 计算,这是 18 章的 GPGPU,
  只不过 shader 用 WGSL 写，跑在浏览器的 GPU 抽象之上。

于是浏览器里的 GPU 渲染叠了**两道边界**:Go 先跨 `syscall/js` 进入 JS,JS 再经浏览器的图形栈
进入 GPU。每一道都遵守同一条「少跨、批量」的纪律。命令缓冲式的批量提交在这里尤其值钱,因为它
同时摊薄了两道边界的成本。第 18、19 章建立的那套直觉,到了浏览器照样管用，这正说明它们抓的是
原理而非某个具体 API。

## 19.4.4 一个必须正视的约束：WASM 里的并发

最后要泼一盆冷水，纠正一个常见的误解。19.3 说软件渲染可以靠 goroutine 分块、铺满多核拿到线性
加速。**这个红利在经典的浏览器 WASM 里基本拿不到。**

原因在于 `js/wasm` 这个移植的执行模型:它**单线程**。Go 的运行时照样能调度成千上万个 goroutine,
但它们全都**多路复用在同一条 JS 线程上**,并没有真正的多核并行。换句话说，浏览器主线程上的
Go-WASM,`GOMAXPROCS` 实际等于 1:goroutine 之间是并发(交替推进），而非并行(同时执行)。
19.3 那张「N 个核各跑一个 goroutine」的图，在这里塌缩成一条线。

要在浏览器里拿到真正的并行,得另走两条路,都在经典移植之外:一是 **Web Worker**,每个 Worker 是
一条独立的 JS 线程,可以各加载一个 WASM 实例，靠 `SharedArrayBuffer` 共享内存,但这是浏览器层面
的多线程，不是 Go 运行时透明给你的。二是仍在演进中的 **WASM 线程**提案，让单个 WASM 实例能用上
多线程。无论哪条，都要清醒:**Go 在浏览器里那套「开 goroutine 就有并行」的直觉是失效的**,
软件渲染要在浏览器提速，得显式地借助 Worker，而非简单地多开 goroutine。这一层并行模型的落差，
是把 Go 图形代码搬上浏览器时最容易踩空的地方。

## 小结

把 Go 搬进浏览器，渲染会遇到一道新的 FFI 边界:`syscall/js`,WASM 与 JS 之间的膜。它与 cgo
同构，于是 18.1 的纪律照搬:少跨界、批量提交。最典型的手法是在 WASM 内用 19.3 的软件渲染算好整帧、
只跨一次膜贴上画布,软件渲染由此从「退路」升格为「绕开边界成本的正面手段」。要 GPU 加速则用
WebGL/WebGPU,而 WebGPU 把第 18、19 章的显存、命令缓冲、计算着色器整套故事在浏览器里重演了一遍，
只是叠了两道边界。但有一条冷峻的约束:经典的 `js/wasm` 是单线程的,`GOMAXPROCS` 实为 1,
19.3 的 goroutine 多核并行在浏览器里塌缩，真正的并行得另借 Web Worker 或 WASM 线程。

至此第 19 章走完了图形的三种归宿:本机 GPU、本机软件、浏览器。三处的形状各异，
底下却是同一道边界在反复显形。下一章把镜头转向当下最热的负载,[第 20 章](../ch20inference)
看 Go 如何站在 AI 推理与服务这一层，而我们会看到，第 18 章那道 FFI 边界，
正是 Go 接入本地大模型运行时的同一道门。

## 延伸阅读的文献

1. The Go Authors. *WebAssembly（Go Wiki）.* https://go.dev/wiki/WebAssembly
   （`GOOS=js GOARCH=wasm` 的编译与加载，执行模型）
2. The Go Authors. *Package syscall/js.* https://pkg.go.dev/syscall/js
   （`js.Value`、`Get`/`Set`/`Call`、`CopyBytesToJS` 与 WASM/JS 边界）
3. W3C. *WebGPU* 与 *WebGPU Shading Language (WGSL).*
   https://www.w3.org/TR/webgpu/ ，https://www.w3.org/TR/WGSL/
   （浏览器里的现代 GPU API：GPUBuffer、命令编码器、计算着色器）
4. MDN. *Using Web Workers / SharedArrayBuffer.*
   https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
   （在浏览器里取得真正并行的途径，超出经典 js/wasm 的单线程模型）
5. 本书 [18.1 跨越 FFI 边界](../ch18gpu/boundary.md)、
   [19.1 渲染管线与 Go 的位置](./pipeline.md)、[19.3 软件渲染与并行](./software.md)、
   [20.1 推理运行时与 FFI](../ch20inference/runtime.md)。
