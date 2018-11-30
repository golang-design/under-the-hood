<img src="images/cover.png" alt="logo" height="550" align="right" />

# Go under the hood

目前基于 `go1.11.2`

## 致读者

此仓库的内容可能勾起你的兴趣，如果你想要关注本仓库的更新情况，可以点击仓库的 `Watch`。
此仓库目前还在早期更新阶段，笔者因诸事繁忙，仅刚开始尝试阅读 Go 源码，可能由于各种不可抗力或一时兴起，
本仓库的内容更新可能会很慢（也会很乱，不一定顺序更新内容，也可能大幅调整相关内容）。

如果你也希望参与贡献，欢迎提交 issue 或 pr，请参考[如何参与贡献](CONTRIBUTING.md)。

### 为什么要研究源码？

研究 Go 源码有几个初衷：

1. 出于对技术的纯粹兴趣；
2. 工作需要，需要了解更多关于 Go 运行时 GC、cgo 等细节以优化性能。
3. For fun.

### 为什么不读现有的源码分析？

确实已经有很多很多讨论 Go 源码的文章了，不读他们的文章有几个原因：

1. 别人的是二手资料，自己的是一手资料，通过理解别人理解代码的思路来理解代码，增加了额外的成本，不如直接理解代码。
2. 已经存在的资料大多已经存在一定程度上的过时，Go 运行时的开发是相当活跃的，本仓库目前基于 1.11.2。

### 那关注什么？

本仓库主要关注与运行时相关的代码，例如 `runtime`/`cgo`/`sync`/`net`/`syscall` 等。
在极少数的情况下，会讨论不同平台下的差异，代码实验以 darwin 为基础，linux 为辅助关注点，其他平台几乎不关注。
作为 Go 1.11 起引入的 `wasm` 特性，我们特别给 WebAssembly 平台以特别关注。

所以，诸如 `crypto/database/regexp/strings/strconv/sort/container/unicode` 等一些运行时无关的标准库
可能不在研究范围。

### 组织说明

本仓库组织了一下几部分内容：

- [`content`](content): 源码的研究；
- [`demo`](demo): 研究源码产生的相关的实例代码；
- [`gosrc`](gosrc): 无修改的、正式发布的 go 源码，与最新发布的 go 版本同步，在[这里](https://github.com/changkun/go/tree/go-under-the-hood)追踪官方的更新；
- [`images`](images): 仓库中依赖的相关图片；
- [`papers`](papers): 学术论文

## 目录

[引言](content/preface.md)

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
    - [调度理论](content/5-sched/theory.md)
6. 垃圾回收器
    - [基本知识](content/6-gc/basic.md)
    - [初始化](content/6-gc/init.md)
    - [三色标记法](content/6-gc/mark.md)
7. 关键字
    - [`go`](content/7-lang/go.md)
    - [`defer`](content/7-lang/defer.md)
    - [`panic` 与 `recover`](content/7-lang/panic.md)
    - [`map`](content/7-lang/map.md)
    - [`select`](content/7-lang/select.md)
    - [`chan`](content/7-lang/chan.md)
8. 运行时杂项
    - [`runtime.GOMAXPROCS`](content/8-runtime/gomaxprocs.md)
    - [`runtime.SetFinalizer` 与 `runtime.KeepAlive`](content/8-runtime/finalizer.md)
    - [`runtime.LockOSThread` 与 `runtime.UnlockOSThread`](content/8-runtime/lockosthread.md)
9. [`unsafe`](content/9-unsafe.md)
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
13. 附录
    - [基于工作窃取的多线程计算调度](papers/sched/work-steal-sched.md)
    - [Go 运行时编程](gosrc/1.11.2/runtime/README.md)

[结束语](content/finalwords.md)

## 环境

```bash
→ go version
go version go1.11.2 darwin/amd64
→ uname -a
Darwin changkun-mini 18.2.0 Darwin Kernel Version 18.2.0: Fri Oct  5 19:41:49 PDT 2018; root:xnu-4903.221.2~2/RELEASE_X86_64 x86_64
```

## Acknowledgement

The author would like to thank [@egonelbre](https://github.com/egonelbre/gophers) for his charming gopher design.

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
