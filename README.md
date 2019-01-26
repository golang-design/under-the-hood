<img src="images/cover.png" alt="logo" height="550" align="right" />

# Go under the hood

当前基于 `go1.11.5`

## 目录

[引言](content/preface.md)

1. [程序引导](content/1-boot.md)
2. [初始化概览](content/2-init.md)
3. [主 goroutine 生命周期](content/3-main.md)
4. 调度器: sched
    - [基本知识](content/4-sched/basic.md)
    - [初始化](content/4-sched/init.md)
    - [调度循环](content/4-sched/exec.md)
    - [系统监控](content/4-sched/sysmon.md)
    - [协作与抢占](content/4-sched/preemptive.md)
    - [调度理论](content/4-sched/theory.md)
5. 内存分配器: alloc
    - [基本知识](content/5-mem/basic.md)
    - [全局分配组件](content/5-mem/galloc.md)
    - [分配器组件](content/5-mem/component.md)
    - [FixAlloc、LinearAlloc 组件](content/5-mem/fixalloc.md)
    - [初始化](content/5-mem/init.md)
    - [分配过程](content/5-mem/alloc.md)
6. 垃圾回收器：GC
    - [基本知识](content/6-GC/basic.md)
    - [初始化](content/6-GC/init.md)
    - [内存屏障](content/6-GC/barrier.md)
    - [三色标记](content/6-GC/mark.md)
    - [并发](content/6-GC/concurrent.md)
7. 关键字
    - [`go`](content/7-lang/go.md)
    - [`defer`](content/7-lang/defer.md)
    - [`panic` 与 `recover`](content/7-lang/panic.md)
    - [`map`](content/7-lang/map.md)
    - [`chan` 与 `select`](content/7-lang/chan.md)
    - [`interface`](content/7-lang/interface.md)
8. 运行时组件
    - [参与运行时的系统调用: darwin](content/8-runtime/syscall-darwin.md)
    - [参与运行时的系统调用: linux](content/8-runtime/syscall-linux.md)
    - [`LockOSThread/UnlockOSThread` 与运行时线程管理](content/8-runtime/lockosthread.md)
    - [`note` 与 `mutex`](content/8-runtime/note.md)
    - [`SetFinalizer` 与 `KeepAlive`](content/8-runtime/finalizer.md)
    - [`Gosched`](content/8-runtime/gosched.md)
    - [信号量 sema 机制](content/8-runtime/sema.md)
    - [系统信号处理](content/8-runtime/signal.md)
9. [`unsafe`](content/9-unsafe.md)
10. [`cgo`](content/10-cgo.md)
11. 依赖运行时的标准库
    - [`sync.Pool`](content/11-pkg/sync/pool.md)
    - [`sync.Once`](content/11-pkg/sync/once.md)
    - [`sync.Map`](content/11-pkg/sync/map.md)
    - [`sync.WaitGroup`](content/11-pkg/sync/waitgroup.md)
    - [`sync.Mutex`](content/11-pkg/sync/mutex.md)
    - [`sync.Cond`](content/11-pkg/sync/cond.md)
    - [`atomic.*`](content/11-pkg/atomic/atomic.md)
    - [`syscall.*`](content/11-pkg/syscall/syscall.md)
    - [`reflect`](content/11-pkg/reflect/reflect.md)
    - [`net`](content/11-pkg/net/net.md)
    - [`time`](content/11-pkg/time/time.md)
12. [WebAssembly](content/12-wasm.md)
13. [race 竞争检测](content/13-race.md)
14. [trace 运行时调试](content/14-trace.md)
15. Go 模块链接器
    - [初始化](content/15-linker/init.md)
    - [模块链接](content/15-linker/link.md)
16. Go 编译器: gc
    - [词法与文法](content/16-compile/parse.md)
    - [类型系统](content/16-compile/type.md)
    - [编译后端 SSA](content/16-compile/ssa.md)
17. 附录
    - [源码索引](content/appendix/index.md)
    - [Plan 9 汇编介绍](content/appendix/asm.md)
    - [基于工作窃取的多线程计算调度](papers/sched/work-steal-sched.md)
    - [Go 运行时编程](gosrc/1.11.5/runtime/README.md)

[结束语](content/finalwords.md)

## 捐助

您的捐助将用于赞助我购买一台 [MacBook Pro](https://www.apple.com/de/macbook-pro/)：

[![](https://img.shields.io/badge/%E6%8D%90%E5%8A%A9-PayPal-104098.svg?style=popout-square&logo=PayPal)](https://www.paypal.me/ouchangkun/4.99eur)

## Acknowledgement

The author would like to thank [@egonelbre](https://github.com/egonelbre/gophers) for his charming gopher design.

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
