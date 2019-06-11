## 目录

### [引言](preface.md)

### 第一部分: 基础

#### 第一章 程序基础

<!-- 内存布局？ -->

#### 第二章 并发与分布式计算

<!-- - [3.1 并发] -->

#### 第三章 排队与调度理论

<!-- - [2.1 排队理论引导]()
- [2.2 工作窃取调度](papers/sched/work-steal-sched.md)
- [调度理论](4-sched/theory.md) -->

#### 第四章 内存管理工程

<!-- - 垃圾回收统一理论 -->

<!-- CPU 架构与操作系统? -->

<!-- - [Linux 系统调用]
- [Plan 9 汇编](appendix/asm.md) -->

#### [第五章 Go 程序生命周期](part1basic/ch05boot/readme.md)

- [5.1 程序引导](part1basic/ch05boot/boot.md)
- [5.2 初始化概览](part1basic/ch05boot/init.md)
- [5.3 主 goroutine](part1basic/ch05boot/main.md)

### [第二部分：运行时机制](part2runtime/readme.md)

#### [第六章 调度器](part2runtime/ch06sched/readme.md)

- [6.1 基本结构](part2runtime/ch06sched/basic.md)
- [6.2 调度器初始化](part2runtime/ch06sched/init.md)
- [6.3 调度循环](part2runtime/ch06sched/exec.md)
- [6.4 系统监控](part2runtime/ch06sched/sysmon.md)
- [6.5 线程管理](part2runtime/ch06sched/thread.md)
- [6.6 信号处理机制](part2runtime/ch06sched/signal.md)
- [6.7 执行栈管理](part2runtime/ch06sched/stack.md)
- [6.8 协作与抢占](part2runtime/ch06sched/preemptive.md)
- [6.9 同步机制](part2runtime/ch06sched/sync.md)
- [6.10 过去、现在与未来](part2runtime/ch06sched/history.md)

#### [第七章 内存分配器](part2runtime/ch07alloc/readme.md)

- [基本知识](part2runtime/ch07alloc/basic.md)
- [组件](part2runtime/ch07alloc/component.md)
- [初始化](part2runtime/ch07alloc/init.md)
- [大对象分配](part2runtime/ch07alloc/largealloc.md)
- [小对象分配](part2runtime/ch07alloc/smallalloc.md)
- [微对象分配](part2runtime/ch07alloc/tinyalloc.md)
- [内存统计](part2runtime/ch07alloc/mstats.md)
- [过去、现在与未来](part2runtime/ch07alloc/history.md)

#### [第八章 垃圾回收器](part2runtime/ch08GC/readme.md)

- [8.1 基本知识](part2runtime/ch08GC/basic.md)
- [8.2 初始化](part2runtime/ch08GC/init.md)
- [8.3 标记清扫思想](part2runtime/ch08GC/vanilla.md)
- [8.4 屏障技术](part2runtime/ch08GC/barrier.md)
- [8.5 并发标记清扫](part2runtime/ch08GC/concurrent.md)
- [8.6 标记过程](part2runtime/ch08GC/mark.md)
- [8.7 清扫过程](part2runtime/ch08GC/sweep.md)
- [8.8 存活与终结](part2runtime/ch08GC/finalizer.md)
- [8.9 过去、现在与未来](part2runtime/ch08GC/history.md)

#### 第九章 调试

- [race 竞争检测](part2runtime/ch09debug/race.md)
- [trace 运行时调试](part2runtime/ch09debug/trace.md)

#### 第十章 兼容与契约

- [参与运行时的系统调用: Linux 篇](part2runtime/ch10abi/syscall-linux.md)
- [参与运行时的系统调用: Darwin 篇](part2runtime/ch10abi/syscall-darwin.md)
- [WebAssembly](part2runtime/ch10abi/syscall-wasm.md)
- [cgo](part2runtime/ch10abi/cgo.md)

### [第三部分：编译系统](part3compile/readme.md)

#### 第十一章 关键字

- [`go`](part3compile/ch11keyword/go.md)
- [`defer`](part3compile/ch11keyword/defer.md)
- [`panic` 与 `recover`](part3compile/ch11keyword/panic.md)
- [`map`](part3compile/ch11keyword/map.md)
- [`chan` 与 `select`](part3compile/ch11keyword/chan.md)
- [`interface`](part3compile/ch11keyword/interface.md)

#### 第十二章 模块链接器

- [初始化](part3compile/ch12link/init.md)
- [模块链接](part3compile/ch12link/link.md)

#### 第十三章 编译器

- [`unsafe`](part3compile/ch13gc/9-unsafe.md)
- [词法与文法](part3compile/ch13gc/parse.md)
- [类型系统](part3compile/ch13gc/type.md)
- [编译后端 SSA](part3compile/ch13gc/ssa.md)
- [过去、现在与未来]

### [第四部分：标准库](part4lib/readme.md)

#### [第十四章 sync 与 atomic 包](part4lib/ch14sync/readme.md)

- [信号量 sema 机制](part4lib/ch14sync/sema.md)
- [`sync.Pool`](part4lib/ch14sync/pool.md)
- [`sync.Once`](part4lib/ch14sync/once.md)
- [`sync.Map`](part4lib/ch14sync/map.md)
- [`sync.WaitGroup`](part4lib/ch14sync/waitgroup.md)
- [`sync.Mutex`](part4lib/ch14sync/mutex.md)
- [`sync.Cond`](part4lib/ch14sync/cond.md)
- [`sync/atomic.*`](part4lib/ch14sync/atomic.md)

#### [第十五章 其他](part4lib/ch15other/readme.md)

- [`syscall.*`](part4lib/ch15other/syscall.md)
- [`os/signal.*`](part4lib/ch15other/signal.md)
- [`reflect.*`](part4lib/ch15other/reflect.md)
- [`net.*`](part4lib/ch15other/net.md)
- [`time.*`](part4lib/ch15other/time.md)

### [结束语](finalwords.md)

### [参考文献](bibliography/list.md)

### 附录

- [附录A: 源码索引](appendix/index.md)
- [附录B: 术语表](appendix/glossary.md)