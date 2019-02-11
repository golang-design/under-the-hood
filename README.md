<img src="book/images/cover.png" alt="logo" height="550" align="right" />

# Go under the hood

Go 源码研究 | 当前基于 `go1.12beta2`

[TOC]

## 目录

### [引言](book/preface.md)

### [第一部分: 基础](book/part1basic/)

#### [第一章 程序基础](book/part1basic/ch01proc)

<!-- 内存布局？ -->

#### [第二章 并行与并发计算](book/part1basic/ch02parallel)

<!-- - [3.1 并发] -->

#### [第三章 排队与调度理论](book/part1basic/ch03scheduling)

<!-- - [2.1 排队理论引导]()
- [2.2 工作窃取调度](papers/sched/work-steal-sched.md)
- [调度理论](book/4-sched/theory.md) -->

#### [第四章 内存管理工程](book/part1basic/ch04memory)

- [垃圾回收统一理论](book/part1basic/ch04memory/unifiedgc.md)

<!-- CPU 架构与操作系统? -->

<!-- - [Linux 系统调用]
- [Plan 9 汇编](book/appendix/asm.md) -->

#### [第五章 Go 程序生命周期](book/part1basic/ch05boot)

- [程序引导](book/part1basic/ch05boot/boot.md)
- [初始化概览](book/part1basic/ch05boot/init.md)
- [主 goroutine](book/part1basic/ch05boot/main.md)

### [第二部分：运行时机制](book/part2runtime)

#### [第六章 调度器](book/part2runtime/ch06sched)

- [基本结构](book/part2runtime/ch06sched/basic.md)
- [调度器初始化](book/part2runtime/ch06sched/init.md)
- [调度循环](book/part2runtime/ch06sched/exec.md)
- [系统监控](book/part2runtime/ch06sched/sysmon.md)
- [线程管理](book/part2runtime/ch06sched/thread.md)
- [信号处理与 `os/signal`](book/part2runtime/ch06sched/signal.md)
- [执行栈管理](book/part2runtime/ch06sched/stack.md)
- [协作与抢占](book/part2runtime/ch06sched/preemptive.md)
- [`note` 与 `mutex`](book/part2runtime/ch06sched/note.md)
- [过去、现在与未来](book/part2runtime/ch06sched/history.md)

#### [第七章 内存分配器](book/part2runtime/ch07alloc)

- [基本知识](book/part2runtime/ch07alloc/basic.md)
- [组件](book/part2runtime/ch07alloc/component.md)
- [初始化](book/part2runtime/ch07alloc/init.md)
- [大对象分配](book/part2runtime/ch07alloc/largealloc.md)
- [小对象分配](book/part2runtime/ch07alloc/smallalloc.md)
- [微对象分配](book/part2runtime/ch07alloc/tinyalloc.md)
- [内存统计](book/part2runtime/ch07alloc/mstats.md)
- [过去、现在与未来](book/part2runtime/ch07alloc/history.md)

#### [第八章 垃圾回收器](book/part2runtime/ch08GC)

- [基本知识](book/part2runtime/ch08GC/basic.md)
- [初始化](book/part2runtime/ch08GC/init.md)
- [屏障](book/part2runtime/ch08GC/barrier.md)
- [三色标记](book/part2runtime/ch08GC/tricolor.md)
- [并发回收](book/part2runtime/ch08GC/concurrent.md)
- [标记过程](book/part2runtime/ch08GC/mark.md)
- [清扫过程](book/part2runtime/ch08GC/sweep.md)
- [存活与终结](book/part2runtime/ch08GC/finalizer.md)
- [过去、现在与未来](book/part2runtime/ch08GC/history.md)

#### 第九章 调试

- [race 竞争检测](book/part2runtime/ch09debug/race.md)
- [trace 运行时调试](book/part2runtime/ch09debug/trace.md)

#### 第十章 兼容与契约

<!-- - [运行时编程综述](gosrc/runtime/README.md) -->

- [参与运行时的系统调用: Linux](book/part2runtime/ch10abi/syscall-linux.md)
- [参与运行时的系统调用: Darwin](book/part2runtime/ch10abi/syscall-darwin.md)
- [cgo](book/part2runtime/ch10abi/cgo.md)
- [WebAssembly](book/part2runtime/ch10abi/wasm.md)

### [第三部分：编译系统](book/part3compile)

#### 第十一章 关键字

- [`go`](book/part3compile/ch11keyword/go.md)
- [`defer`](book/part3compile/ch11keyword/defer.md)
- [`panic` 与 `recover`](book/part3compile/ch11keyword/panic.md)
- [`map`](book/part3compile/ch11keyword/map.md)
- [`chan` 与 `select`](book/part3compile/ch11keyword/chan.md)
- [`interface`](book/part3compile/ch11keyword/interface.md)

#### 第十二章 模块链接器

- [初始化](book/part3compile/ch12link/init.md)
- [模块链接](book/part3compile/ch12link/link.md)

#### 第十三章 编译器

- [`unsafe`](book/part3compile/ch13gc/9-unsafe.md)
- [词法与文法](book/part3compile/ch13gc/parse.md)
- [类型系统](book/part3compile/ch13gc/type.md)
- [编译后端 SSA](book/part3compile/ch13gc/ssa.md)
- [过去、现在与未来]

### [第四部分：标准库](book/part4lib)

#### [第十四章 sync 与 atomic 包]()

- [信号量 sema 机制](book/part4lib/ch14sync/sema.md)
- [`sync.Pool`](book/part4lib/ch14sync/pool.md)
- [`sync.Once`](book/part4lib/ch14sync/once.md)
- [`sync.Map`](book/part4lib/ch14sync/map.md)
- [`sync.WaitGroup`](book/part4lib/ch14sync/waitgroup.md)
- [`sync.Mutex`](book/part4lib/ch14sync/mutex.md)
- [`sync.Cond`](book/part4lib/ch14sync/cond.md)
- [`sync/atomic.*`](book/part4lib/ch14sync/atomic.md)

#### 第十五章 其他

- [`syscall.*`](book/part4lib/ch15other/syscall.md)
- [`reflect`](book/part4lib/ch15other/reflect.md)
- [`net`](book/part4lib/ch15other/net.md)
- [`time`](book/part4lib/ch15other/time.md)

### [结束语](book/finalwords.md)

### [参考文献](book/bibliography.md)

### 附录

- [附录A: 源码索引](book/appendix/index.md)
- [附录B: 术语表](book/appendix/glossary.md)

## 捐助

您的捐助将用于帮助我购买一台 [MacBook Pro](https://www.apple.com/de/macbook-pro/)：

[![](https://img.shields.io/badge/%E6%8D%90%E5%8A%A9-PayPal-104098.svg?style=popout-square&logo=PayPal)](https://www.paypal.me/ouchangkun/4.99eur)

## Acknowledgement

The author would like to thank [@egonelbre](https://github.com/egonelbre/gophers) for his charming gopher design.

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
