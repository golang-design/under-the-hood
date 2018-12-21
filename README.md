<img src="images/cover.png" alt="logo" height="550" align="right" />

# Go under the hood

当前基于 `go1.11.4`

## 目录

[引言](content/preface.md)

1. [引导](content/1-boot.md)
2. [初始化概览](content/2-init.md)
3. [主 goroutine 生命周期](content/3-main.md)
4. 内存分配器: alloc
    - [基本知识](content/4-mem/basic.md)
    - [TCMalloc](content/4-mem/tcmalloc.md)
    - [初始化](content/4-mem/init.md)
    - [分配过程](content/4-mem/alloc.md)
5. 调度器: sched
    - [基本知识](content/5-sched/basic.md)
    - [初始化](content/5-sched/init.md)
    - [调度执行](content/5-sched/exec.md)
    - [系统监控](content/5-sched/sysmon.md)
    - [调度理论](content/5-sched/theory.md)
6. 垃圾回收器：GC
    - [基本知识](content/6-GC/basic.md)
    - [初始化](content/6-GC/init.md)
    - [三色标记法](content/6-GC/mark.md)
7. 关键字
    - [`go`](content/7-lang/go.md)
    - [`defer`](content/7-lang/defer.md)
    - [`panic` 与 `recover`](content/7-lang/panic.md)
    - [`map`](content/7-lang/map.md)
    - [`chan` 与 `select`](content/7-lang/chan.md)
8. 运行时杂项
    - [`runtime.GOMAXPROCS`](content/8-runtime/gomaxprocs.md)
    - [`runtime.SetFinalizer` 与 `runtime.KeepAlive`](content/8-runtime/finalizer.md)
    - [`runtime.LockOSThread` 与 `runtime.UnlockOSThread`](content/8-runtime/lockosthread.md)
    - [`runtime.note` 与 `runtime.mutex`](content/8-runtime/note.md)
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
    - [`syscall`](content/11-pkg/syscall/syscall.md)
    - [`reflect`](content/11-pkg/reflect/reflect.md)
    - [`net`](content/11-pkg/net/net.md)
    - [`time`](content/11-pkg/time/time.md)
12. [WebAssembly](content/12-wasm.md)
13. [race 竞争检测](content/13-race.md)
14. [trace 运行追踪](content/14-trace.md)
15. Go 编译器: gc
    - [词法与文法](content/15-compile/parse.md)
    - [类型系统](content/15-compile/type.md)
    - [编译后端 SSA](content/15-compile/ssa.md)
16. 附录
    - [源码索引](content/index.md)
    - [基于工作窃取的多线程计算调度](papers/sched/work-steal-sched.md)
    - [Go 运行时编程](gosrc/1.11.4/runtime/README.md)

[结束语](content/finalwords.md)

## Acknowledgement

The author would like to thank [@egonelbre](https://github.com/egonelbre/gophers) for his charming gopher design.

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
