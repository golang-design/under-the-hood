<img src="images/cover.png" alt="logo" height="550" align="right" />

# Go under the hood

[![](https://img.shields.io/badge/chat-telegram-%232CA5E0.svg?logo=telegram&logoColor=white&style=flat-square)](https://t.me/joinchat/FEeulA4zgj2DsBbudBqMcQ)

目前基于 `go1.11.1`

## 致潜在读者

此仓库的内容可能勾起你的兴趣，如果你想要关注本仓库的更新情况，可以点击仓库的 Watch。
此仓库才刚刚开始，笔者因各方面事情都很忙，并仅刚开始尝试阅读 Go 源码，由于各种不可抗力和一时兴起，
更新可能会很慢（也会很乱，不一定顺序更新内容）。

如果你也希望参与贡献，欢迎提交 issue 或 pr。

### 为什么要研究源码？

研究 Go 源码有几个初衷：

1. 出于对技术的纯粹兴趣；
2. 工作需要，需要了解更多关于 Go 运行时 GC、cgo 等细节以优化性能。

### 为什么不读现有的源码分析？

确实已经有很多很多讨论 Go 源码的文章了，不读他们的文章有几个原因：

1. 别人的是二手资料，自己的是一手资料，通过理解别人理解代码的思路来理解代码，增加了额外的成本，不如直接理解代码。
2. 比较完整的资料已经存在一定程度上的过时，Go 运行时的开发是相当活跃的，本仓库目前基于 1.11.1。

### 那关注什么？

本仓库主要关注与运行时相关的代码，例如 `runtime`/`cgo`/`sync`/`net`/`syscall` 等。
在极少数的情况下，会讨论不同平台下的差异，代码实验以 darwin 为基础，linux 为辅助关注点，其他平台几乎不关注。
作为 Go 1.11 起引入的 `wasm` 特性，我们特别给 WebAssembly 平台以特别关注。

所以，诸如 `crypto/database/regexp/strings/strconv/sort/container/unicode` 等一些运行时无关的标准库
可能不在研究范围。

## 目录

1. [引导](content/1-boot.md)
2. [初始化概览](content/2-init.md)
3. [主 goroutine 生命周期](content/3-main.md)
4. 内存分配器
    - [基本知识](content/4-mem/basic.md)
    - [TCMalloc](content/4-mem/tcmalloc.md)
    - [初始化](content/4-mem/init.md)
    - [分配过程](content/4-mem/alloc.md)
5. 调度器
    - [基本知识](content/5-sched/basic.md)
    - [初始化](content/5-sched/init.md)
    - [调度执行](content/5-sched/exec.md)
    - [系统监控](content/5-sched/sysmon.md)
6. 垃圾回收器
    - [基本知识](content/6-gc/basic.md)
    - [初始化](content/6-gc/init.md)
    - [三色标记法](content/6-gc/mark.md)
7. 关键字
    - [`go`](content/7-lang/go.md)
    - [`defer`](content/7-lang/defer.md)
    - [`panic`](content/7-lang/panic.md)
    - [`map`](content/7-lang/map.md)
    - [`select`](content/7-lang/select.md)
    - [`chan`](content/7-lang/chan.md)
8. 运行时杂项
    - [`runtime.Finalizer`](content/8-runtime/finalizer.md)
    - [`runtime.GOMAXPROCS`](content/8-runtime/gomaxprocs.md)
    - [`runtime.LockOSThread/UnlockOSThread`](content/8-runtime/lockosthread.md)
9.  [`unsafe`](content/9-unsafe.md)
10. [`cgo`](content/10-cgo.md)
11. 依赖运行时的标准库
    - [`sync.Pool`](content/11-pkg/sync/pool.md)
    - [`sync.Once`](content/11-pkg/sync/once.md)
    - [`sync.Map`](content/11-pkg/sync/map.md)
    - [`sync.WaitGroup`](content/11-pkg/sync/waitgroup.md)
    - [`sync.Mutex`](content/11-pkg/sync/mutex.md)
    - [`sync.Cond`](content/11-pkg/sync/cond.md)
    - [`atomic`](content/11-pkg/atomic/atomic.md)
    - `net`
12. [WebAssembly](content/12-wasm.md)

## 环境

```
→ go version
go version go1.11.1 darwin/amd64
→ uname -a
Darwin changkun-pro 18.0.0 Darwin Kernel Version 18.0.0: Wed Aug 22 20:13:40 PDT 2018; root:xnu-4903.201.2~1/RELEASE_X86_64 x86_64
```

## Acknowledgement

The author would like to thank [@egonelbre](https://github.com/egonelbre/gophers) for his charming gopher design.

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
