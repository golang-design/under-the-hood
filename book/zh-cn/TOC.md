## 目录

### [引言](preface.md)

### [第一部分: 基础篇](part1basic/readme.md)

#### [第 1 章 程序基础](part1basic/ch01proc/readme.md)

- [1.1 Go 语言综述](./part1basic/ch01proc/go.md)
- [1.2 传统程序堆栈](./part1basic/ch01proc/stack.md)
- [1.3 系统内核与系统调用](./part1basic/ch01proc/os.md)
- [1.4 Plan 9 汇编语言](./part1basic/ch01proc/asm.md)
- [1.5 CPU 设计与架构](./part1basic/ch01proc/cpu.md)
- [1.6 编译与链接原理](./part1basic/ch01proc/compile.md)

#### [第 2 章 并行、并发与分布式计算](part1basic/ch02parallel/readme.md)

- [2.1 并行与并发的基本概念](part1basic/ch02parallel/define.md)
- [2.2 缓存技术](part1basic/ch02parallel/cache.md)
- [2.3 性能模型](part1basic/ch02parallel/perfs.md)
- [2.4 分布式计算的基本概念](part1basic/ch02parallel/distributed.md)
- [2.5 共识技术](part1basic/ch02parallel/consensus.md)
- [2.6 顺序进程通讯](part1basic/ch02parallel/csp.md)
- [2.7 同步锁](part1basic/ch02parallel/locks.md)

#### [第 3 章 排队与调度理论](part1basic/ch03scheduling/readme.md)

- [3.1 排队理论](part1basic/ch03scheduling/queue.md)
- [3.2 单机调度模型](part1basic/ch03scheduling/single.md)
- [3.3 随机调度模型](part1basic/ch03scheduling/stochastic.md)
- [3.4 工作窃取调度理论](part1basic/ch03scheduling/theory.md)
- [3.5 中断与抢占](part1basic/ch03scheduling/interrupt.md)

#### [第 4 章 内存管理工程](part1basic/ch04memory/readme.md)

- [4.1 内存分配器](part1basic/ch04memory/alloc.md)
- [4.2 标记清扫法与三色抽象](part1basic/ch04memory/cms.md)
- [4.3 屏障技术](part1basic/ch04memory/barrier.md)
- [4.4 垃圾回收统一理论](part1basic/ch04memory/unifiedgc.md)

#### [第 5 章 Go 程序生命周期](part1basic/ch05life/readme.md)

- [5.1 Go 程序编译流程](part1basic/ch05life/compile.md)
- [5.2 Go 程序启动引导](part1basic/ch05life/boot.md)
- [5.3 主 goroutine 的生与死](part1basic/ch05life/main.md)

### [第二部分：运行时篇](part2runtime/readme.md)

#### [第 6 章 调度器](part2runtime/ch06sched/readme.md)

- [6.1 设计原则](part2runtime/ch06sched/basic.md)
- [6.2 调度器初始化](part2runtime/ch06sched/init.md)
- [6.3 调度循环](part2runtime/ch06sched/exec.md)
- [6.4 线程管理](part2runtime/ch06sched/thread.md)
- [6.5 信号处理机制](part2runtime/ch06sched/signal.md)
- [6.6 执行栈管理](part2runtime/ch06sched/stack.md)
- [6.7 协作与抢占](part2runtime/ch06sched/preemption.md)
- [6.8 运行时同步原语](part2runtime/ch06sched/sync.md)
- [6.9 系统监控](part2runtime/ch06sched/sysmon.md)
- [6.10 网络轮询器](part2runtime/ch06sched/poller.md)
- [6.11 计时器](part2runtime/ch06sched/timer.md)
- [6.12 用户层 APIs](part2runtime/ch06sched/calls.md)
- [6.13 过去、现在与未来](part2runtime/ch06sched/history.md)

#### [第 7 章 内存分配](part2runtime/ch07alloc/readme.md)

- [7.1 设计原则](part2runtime/ch07alloc/basic.md)
- [7.2 组件](part2runtime/ch07alloc/component.md)
- [7.3 初始化](part2runtime/ch07alloc/init.md)
- [7.4 大对象分配](part2runtime/ch07alloc/largealloc.md)
- [7.5 小对象分配](part2runtime/ch07alloc/smallalloc.md)
- [7.6 微对象分配](part2runtime/ch07alloc/tinyalloc.md)
- [7.7 内存统计](part2runtime/ch07alloc/mstats.md)
- [7.8 过去、现在与未来](part2runtime/ch07alloc/history.md)

#### [第 8 章 垃圾回收](part2runtime/ch08GC/readme.md)

- [8.1 设计原则](part2runtime/ch08GC/basic.md)
- [8.2 混合写屏障](part2runtime/ch08GC/barrier.md)
- [8.3 初始化](part2runtime/ch08GC/init.md)
- [8.4 触发机制及其调步算法](part2runtime/ch08GC/pacing.md)
- [8.5 GC 周期概述](part2runtime/ch08GC/cycle.md)
- [8.6 扫描标记与标记辅助](part2runtime/ch08GC/mark.md)
- [8.7 标记终止阶段](part2runtime/ch08GC/termination.md)
- [8.8 内存清扫阶段](part2runtime/ch08GC/sweep.md)
- [8.9 清道夫及其调步算法](part2runtime/ch08GC/scavenge.md)
- [8.10 用户层 APIs](part2runtime/ch08GC/finalizer.md)
- [8.11 过去、现在与未来](part2runtime/ch08GC/history.md)

#### [第 9 章 语言核心](part2runtime/ch09lang/readme.md)

- [9.1 for 语句](part2runtime/ch09lang/for.md)
- [9.2 defer 语句](part2runtime/ch09lang/defer.md)
- [9.3 panic 与 recover 语句](part2runtime/ch09lang/panic.md)
- [9.4 channel 与 select](part2runtime/ch09lang/chan.md)
- [9.5 运行时类型系统](part2runtime/ch09lang/type.md)
- [9.6 数组、切片与字符串](part2runtime/ch09lang/slice.md)
- [9.7 散列表](part2runtime/ch09lang/map.md)
- [9.8 接口](part2runtime/ch09lang/interface.md)

#### [第 10 章 兼容与契约](part2runtime/ch10abi/readme.md)

- [10.1 运行时系统调用](part2runtime/ch10abi/syscallrt.md)
- [10.2 用户态系统调用](part2runtime/ch10abi/syscallpkg.md)
- [10.3 调用规范](part2runtime/ch10abi/callconv.md)
- [10.4 Cgo](part2runtime/ch10abi/cgo.md)
- [10.5 WebAssembly](part2runtime/ch10abi/wasm.md)

### [第三部分：工具篇](part3tools/readme.md)

#### [第 11 章 调试组件](part3tools/ch11debug/readme.md)

- [11.1 竞争检测](part3tools/ch11debug/race.md)
- [11.2 死锁检测](part3tools/ch11debug/deadlock.md)
- [11.3 性能追踪](part3tools/ch11debug/trace.md)

#### [第 12 章 依赖管理](part3tools/ch12deps/readme.md)

- [12.1 依赖管理的难点](part3tools/ch12deps/challenges.md)
- [12.2 语义化版本管理](part3tools/ch12deps/semantics.md)
- [12.3 最小版本选择算法](part3tools/ch12deps/minimum.md)
- [12.4 vgo 与 dep 之争](part3tools/ch12deps/fight.md)

#### [第 13 章 编译器](part3tools/ch13gc/readme.md)

- [13.1 指针检查器](part3tools/ch13gc/unsafe.md)
- [13.2 逃逸分析](part3tools/ch13gc/escape.md)
- [13.3 词法与文法](part3tools/ch13gc/parse.md)
- [13.4 编译后端 SSA](part3tools/ch13gc/ssa.md)
- [13.5 语言的自举](part3tools/ch13gc/bootstrap.md)
- [13.6 过去、现在与未来](part3tools/ch13gc/future.md)

#### [第 14 章 链接器](part3tools/ch14linker/readme.md)

- [14.1 初始化](part3tools/ch14linker/init.md)
- [14.2 模块链接](part3tools/ch14linker/link.md)
- [14.3 目标文件](part3tools/ch14linker/obj.md)
- [14.4 plugin 包](part3tools/ch14linker/plugin.md)

### [第四部分：标准库篇](part4lib/readme.md)

#### [第 15 章 同步原语](part4lib/ch15sync/readme.md)

- [15.1 缓存池](part4lib/ch15sync/pool.md)
- [15.2 `sync.Once`](part4lib/ch15sync/once.md)
- [15.3 并发安全散列表](part4lib/ch15sync/map.md)
- [15.4 同步组](part4lib/ch15sync/waitgroup.md)
- [15.5 互斥锁](part4lib/ch15sync/mutex.md)
- [15.6 条件变量](part4lib/ch15sync/cond.md)
- [15.7 原子操作](part4lib/ch15sync/atomic.md)

### [第 16 章 网络操作](part4lib/ch16net/readme.md)

- [16.1 文件描述符抽象](part4lib/ch16net/fd.md)
- [16.2 路由管理](part4lib/ch16net/routers.md)

#### [第 17 章 错误处理](part4lib/ch17errors/readme.md)

- [17.1 错误处理的历史及其演化](part4lib/ch17errors/history.md)
- [17.2 错误检查 与 errors 包](part4lib/ch17errors/errors.md)
- [17.3 错误处理的未来](part4lib/ch17errors/future.md)

#### [第 18 章 泛型与合约](part4lib/ch18generics/readme.md)

- [18.1 泛型的历史及其演化](part4lib/ch18generics/history.md)
- [18.2 泛型的实现与 contracts 包](part4lib/ch18generics/contracts.md)
- [18.3 泛型的未来](part4lib/ch18generics/future.md)

### [结束语：Go 去向何方？](finalwords.md)
### [参考文献](bib.md)
### [附录A: 源码索引](all.md)
### [附录B: 术语表](glossary.md)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
