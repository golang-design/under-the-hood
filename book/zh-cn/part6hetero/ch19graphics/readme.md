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

图形是最古老的异构负载：早在「GPU 通用计算」成为口号之前，
显卡就已在为屏幕上的每一个像素做并行运算。本章把渲染管线摊开，
看 Go 的代码究竟坐在 CPU 一侧的哪个位置，一次绘制调用如何越过驱动这道边界；
再看图形上下文为何被钉死在某一个系统线程上，`LockOSThread` 在这里不是技巧而是必需；
然后转向不依赖 GPU 的软件渲染，看 goroutine 与 SIMD 如何在 CPU 上并行地铺像素；
最后走进浏览器，看 Go 编译到 WebAssembly 之后，渲染的边界又落在了哪里。
