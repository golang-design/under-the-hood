---
weight: 6200
title: "第 19 章 图形"
bookCollapseSection: true
---

# 第 19 章 图形

- [19.1 渲染管线与 Go 的位置](./pipeline.md)
- [19.2 图形绑定与线程亲和](./bindings.md)
- [19.3 软件渲染与并行](./software.md)
- [19.4 浏览器中的渲染](./wasm.md)

图形是 GPU 最早承担的负载。第 18 章把 GPU 当作通用的并行计算设备，本章回到它的本来用途，讨论 Go
程序在渲染中所处的位置，以及它要跨越的边界。

19.1 讨论渲染管线的结构：固定功能阶段与可编程的着色器阶段如何组成一条数据流，Go 代码为何只位于 CPU
一侧的应用阶段，图形程序因此面对的 FFI 与着色语言两道边界，以及绘制调用的开销如何推动了 Vulkan、WebGPU
等显式 API 的命令缓冲设计；19.2 讨论线程亲和：OpenGL 上下文按线程生效，窗口系统要求在主线程上处理事件，Go
程序如何借助 `runtime.LockOSThread` 安排渲染 goroutine 与主线程，以及 Ebitengine、Gio、Fyne 与 mainthread
包的做法；19.3 讨论不经过 GPU 的软件渲染：用 goroutine 把画面切成互不重叠的区域并行渲染，用 Go 1.27
实验性的 `simd` 包向量化内循环，以及软件渲染与 GPU 渲染的分工；19.4 讨论浏览器中的渲染：Go 编译为
WebAssembly 后，`syscall/js` 成为新的 FFI 边界，整帧软件渲染后一次提交如何减少穿越，WebGPU
叠加的两道边界，以及单线程、无抢占的 `js/wasm` 运行时对并行与帧循环的约束。
