# Go under the hood

目前基于 `go1.11`

## 致潜在读者

此仓库的内容可能勾起你的兴趣，如果你想要关注本仓库的更新情况，可以点击仓库的 Watch。
此仓库才刚刚开始，笔者因各方面事情都很忙，并仅刚开始尝试阅读 Go 源码，由于各种不可抗力和一时兴起，
更新可能会很慢（也会很乱，不一定顺序更新内容）。

如果你也希望参与贡献，欢迎提交 issue 或 pr。

## 为什么要研究源码？

研究 Go 源码有几个初衷：

1. 出于对技术的纯粹兴趣；
2. 工作需要，需要了解更多关于 Go 运行时 GC、cgo 等细节以优化性能。

已经有很多讨论 Go 源码的文章了，为什么不直接看？

1. 别人的是二手资料，自己的是一手资料，理解别人理解代码的思路，增加了额外的成本，不如直接理解代码。
2. 比较完整的资料已经存在一定程度上的过时，Go 运行时的开发是相当活跃的，本仓库目前基于 1.11。

当然，站在巨人的肩膀上，至少本仓库有很多内容受到参考文献 12 的影响，但 12 内容已相对陈旧，
部分内容在 1.11 不再适用。

## 那关注什么？

本仓库主要关注与运行时相关的代码，例如 `runtime`/`cgo`/`sync`/`net`/`wasm` 等。
在极少数的情况下，会讨论不同平台下的差异，代码实验以 darwin 为基础，linux 为辅助关注点，其他平台几乎不关注。
作为 Go 1.11 起引入的 `wasm` 特性，我们特别给 WebAssembly 平台以特别关注。

所以，诸如 `crypto/database/regexp/strings/strconv/sort/container/unicode` 等一些运行时无关的标准库
可能不在研究范围。

## 目录

1. [引导](content/1-boot.md)
2. [初始化概览](content/2-init.md)
3. [主 goroutine 生命周期](content/3-main.md)
4. [内存分配器](content/4-mem.md)
5. [调度器](content/5-scheduler.md)
6. [垃圾回收器](content/6-gc.md)
7. 语言特性
    - [`go`](content/7-lang/go.md)
    - [`chan`](content/7-lang/chan.md)
    - [`defer`](content/7-lang/defer.md)
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
    - `atomic`
    - `net`
    - ...
12. 编译前端
13. 编译后端
14. WebAssembly

## 环境

```
→ go version
go version go1.11 darwin/amd64
→ uname -a
Darwin changkun-pro 18.0.0 Darwin Kernel Version 18.0.0: Wed Aug 22 20:13:40 PDT 2018; root:xnu-4903.201.2~1/RELEASE_X86_64 x86_64
```

## 参考文献

1. [A Quick Guide to Go's Assembler](https://golang.org/doc/asm)
2. [A Manual for the Plan 9 assembler](https://9p.io/sys/doc/asm.html)
3. [The Go Memory Model](https://golang.org/ref/mem)
4. [Scalable Go Scheduler Design Doc](https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/edit#heading=h.mmq8lm48qfcw)
5. [Go Preemptive Scheduler Design Doc](https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit#heading=h.3pilqarbrc9h)
6. [NUMA-aware scheduler for Go](https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub)
7. [Scheduling Multithreaded Computations by Work Stealing](papers/steal.pdf)
8. [Command cgo](https://golang.org/cmd/cgo/)
9. [Command compile](https://golang.org/cmd/compile/)
10. [LINUX SYSTEM CALL TABLE FOR X86 64](http://blog.rchapman.org/posts/Linux_System_Call_Table_for_x86_64/)
11. [Getting to Go: The Journey of Go's Garbage Collector](https://blog.golang.org/ismmkeynote)
12. [Go 1.5 源码剖析](https://github.com/qyuhen/book/blob/master/Go%201.5%20%E6%BA%90%E7%A0%81%E5%89%96%E6%9E%90%20%EF%BC%88%E4%B9%A6%E7%AD%BE%E7%89%88%EF%BC%89.pdf)
13. [Go WebAssembly](https://github.com/golang/go/wiki/WebAssembly)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | MIT &copy; [changkun](https://changkun.de)