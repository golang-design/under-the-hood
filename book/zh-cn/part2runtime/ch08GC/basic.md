---
weight: 2301
title: "8.1 设计原则"
---

# 8.1 设计原则

[TOC]

Go 实现的垃圾回收器是无分代（对象没有代际之分）、
不整理（回收过程中不对对象进行移动与整理）、并发（与用户代码并发执行）的三色标记清扫算法。
从宏观的角度来看，Go 运行时的垃圾回收器主要包含五个阶段：

| 阶段 | 说明 | 赋值器状态 | 写屏障状态 |
|:--:|:--|:--:|:--:|
| 清扫终止 | 为下一个阶段的并发标记做准备工作，启动写屏障 | STW | 启动 |
| 标记 | 与赋值器并发执行，写屏障开启 | 并发 | 启动 |
| 标记终止 | 保证一个周期内标记任务完成，停止写屏障 | STW | 关闭 |
| 内存清扫 | 将需要回收的内存归还到堆中，写屏障关闭 | 并发 | 关闭 |
| 内存归还 | 将过多的内存归还给操作系统，写屏障关闭 | 并发 | 关闭 |

- 对象整理的优势是解决内存碎片问题以及“允许”使用顺序内存分配器。但 Go 运行时的分配算法基于 tcmalloc，基本上没有碎片问题。 并且顺序内存分配器在多线程的场景下并不适用。Go 使用的是基于 tcmalloc 的现代内存分配算法，对对象进行整理不会带来实质性的性能提升。
- 分代 GC 依赖分代假设，即 GC 将主要的回收目标放在新创建的对象上（存活时间短，更倾向于被回收），而非频繁检查所有对象。但 Go 的编译器会通过逃逸分析将大部分新生对象存储在栈上（栈直接被回收），只有那些需要长期存在的对象才会被分配到需要进行垃圾回收的堆中。也就是说，分代 GC 回收的那些存活时间短的对象在 Go 中是直接被分配到栈上，当 goroutine 死亡后栈也会被直接回收，不需要 GC 的参与，进而分代假设并没有带来直接优势。并且 Go 的垃圾回收器与用户代码并发执行，使得 STW 的时间与对象的代际、对象的 size 没有关系。Go 团队更关注于如何更好地让 GC 与用户代码并发执行（使用适当的 CPU 来执行垃圾回收），而非减少停顿时间这一单一目标上。

## 内存模型

语言的内存模型定义了并行状态下拥有确定读取和写入的时序的条件。
Go 的 goroutine 采取并发的形式运行在多个并行的线程上，
而其内存模型就明确了 **对于一个 goroutine 而言，一个变量被写入后一定能够被读取到的条件**。
在 Go 的内存模型中有事件时序的概念，并定义了 **happens before** ，即表示了在 Go 程序中执行内存操作的一个偏序关系。

我们不妨用 < 表示 happens before，则如果事件 _e1_ < _e2_，则 _e2_ > _e1_。
同样，如果 _e1_ ≥ _e2_ 且 _e1 ≤ _e2_，则 _e1_ 与 _e2_ _happen concurrently_ (e1 = e2)。
在单个 goroutine 中，happens-before 顺序即程序定义的顺序。

我们稍微学院派的描述一下偏序的概念。
（严格）偏序在数学上是一个二元关系，它满足自反、反对称和传递性。happens before（<）被称之为偏序，如果满足这三个性质：

1. （反自反性）对于 ∀_e1_∈{事件}，有：非 e1 < e1；
2. （非对称性）对于∀_e1_, _e2_∈{事件}，如果 e1 ≤ e2，e2 ≤ e1 则 e1 = e2，也称 happens concurrently；
3. （传递性）对于∀_e1_, _e2_, _e3_ ∈{事件}，如果 e1 < e2，e2 < e3，则 e1 < e3。

可能我们会认为这种事件的发生时序的偏序关系仅仅只是在探讨并发模型，跟内存无关。
但实际上，它们既然被称之为内存模型，就是因为它们与内存有着密切关系。
并发操作时间偏序的条件，本质上来说，是定义了内存操作的可见性。

编译器和 CPU 通常会产生各种优化来影响程序原本定义的执行顺序，这包括：编译器的指令重排、 CPU 的乱序执行。
除此之外，由于缓存的关系，多核 CPU 下，一个 CPU 核心的写结果仅发生在该核心最近的缓存下，
要想被另一个 CPU 读到则必须等待内存被置换回低级缓存再置换到另一个核心后才能被读到。

Go 中的 happens before 有以下保证：

1. 初始化：`main.init` < `main.main`
2. goroutine 创建: `go` < `goroutine 开始执行`
3. goroutine 销毁: `goroutine 退出 ` = ∀ `e`
4. channel: 如果 ch 是一个 buffered channel，则 `ch<-val` < `val <- ch`
5. channel: 如果 ch 是一个 buffered channel 则 `close(ch)` < `val <- ch & val == isZero(val)`
6. channel: 如果 ch 是一个 unbuffered channel 则，`ch<-val` > `val <- ch`
7. channel: 如果 ch 是一个 unbuffered channel 则，`len(ch) == C` => `从 channel 中收到第 k 个值` < `k+C 个值得发送完成`
8. mutex: 如果对于 sync.Mutex/sync.RWMutex 的锁 l 有 n < m, 则第 n 次调用 `l.Unlock()` < 第 m 次调用 l.Lock() 的返回
9. mutex: 任何发生在 sync.RWMutex 上的调用 `l.RLock`, 存在一个 n 使得 `l.RLock` > 第 n 次调用 `l.Unlock`，且与之匹配的 `l.RUnlock` < 第 n+1 次调用 l.Lock
10. once:  f() 在 once.Do(f) 中的调用 < once.Do(f) 的返回.

TODO: 谈及内存模型与实现的 barrier 之间的关系

## 编译标志 `go:nowritebarrier`、`go:nowritebarrierrec` 和 `go:yeswritebarrierrec`

如果一个函数包含写屏障，则被 `go:nowritebarrier` 修饰的函数触发一个编译器错误，但它不会抑制写屏障的产生，只是一个断言。
`go:nowritebarrier` 主要适用于在没有写屏障会获得更好的性能，且没有正确性要求的情况。
我们通常希望使用 `go:nowritebarrierrec`。

如果声明的函数或任何它递归调用的函数甚至于 `go:yeswritebarrierrec` 包含写屏障，则 `go:nowritebarrierrec` 触发编译器错误。

逻辑上，编译器为每个函数调用添加 `go:nowritebarrierrec` 且当遭遇包含写屏障函数的时候产生一个错误。
`go:yeswritebarrierrec` 则反之。`go:nowritebarrierrec` 用于防止写屏障实现中的无限循环。

两个标志都在调度器中使用。写屏障需要一个活跃的 P （`getg().m.p != nil`）且调度器代码通常在没有活跃 P 的情况下运行。
在这种情况下，`go:nowritebarrierrec` 用于释放 P 的函数上，或者可以在没有 P 的情况下运行。
而且`go:nowritebarrierrec` 还被用于当代码重新要求一个活跃的 P 时。
由于这些都是函数级标注，因此释放或获取 P 的代码可能需要分为两个函数。

这两个指令都在调度程序中使用。
写屏障需要一个活跃的P（ `getg().mp != nil`）并且调度程序代码通常在没有活动 P 的情况下运行。
在这种情况下，`go:nowritebarrierrec` 用于释放P的函数或者可以在没有P的情况下运行并且去：
当代码重新获取活动P时使用 `go:yeswritebarrierrec`。
由于这些是功能级注释，因此释放或获取P的代码可能需要分为两个函数。

## 进一步阅读的参考文献

- [The Go Memory Model](https://golang.org/ref/mem)
- [Hiltner 2017] [Rhys Hiltner, An Introduction to go tool trace, July 13, 2017](https://about.sourcegraph.com/go/an-introduction-to-go-tool-trace-rhys-hiltner)
- [Simplify mark termination and eliminate mark 2](https://github.com/golang/go/issues/26903)
- [Runtime: error message: P has cached GC work at end of mark termination](https://github.com/golang/go/issues/27993)
- [Request Oriented Collector (ROC) Algorithm](golang.org/s/gctoc)
- [Proposal: Separate soft and hard heap size goal](https://github.com/golang/proposal/blob/master/design/14951-soft-heap-limit.md)
- [Go 1.5 concurrent garbage collector pacing](https://docs.google.com/document/d/1wmjrocXIWTr1JxU-3EQBI6BK6KgtiFArkG47XK73xIQ/edit#)
- [runtime/debug: add SetMaxHeap API](https://go-review.googlesource.com/c/go/+/46751/)
- [runtime: mechanism for monitoring heap size](https://github.com/golang/go/issues/16843)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)