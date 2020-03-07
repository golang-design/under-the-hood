---
weight: 4108
title: "15.8 内存模型"
---

# 15.8 内存模型

TODO: 请不要阅读，本节内容编排中

读者可能注意到了，无论是在谈论 Go 的运行时还是编译器，直到目前为止我们都有意无意的
尝试去回避 Go 语言的「内存模型」这个话题。

这有非常多的原因，作为本章的收尾（也是全书对 Go 同步原语与同步模式的一个总结），
我们最后来详细展开内存模型这个话题，解答读者心中的疑惑。
对为什么到目前为止我们都刻意的回避有关内存模型的话题作出一个相对完整的解释。
但是在开始之前，我们需要先了解已经定义的 Go 内存模型的规则。

## 15.8.1 内存模型

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
10. once:  f() 在 once.Do(f) 中的调用 < once.Do(f) 的返回

## 15.8.2 历史实践

TODO: 谈及内存模型与实现的 barrier 之间的关系

## 15.8.3 启示

## 进一步阅读的参考文献

<!-- - [Pike and Cox, 2009] Rob Pike and Russ Cox. The Go Memory Model. February 21, 2009. https://golang.org/ref/mem
- [Vyukov, 2013] Dmitry Vyukov. cmd/cc: atomic intrinsics. Mar 1, 2013. https://github.com/golang/go/issues/4947
- [Cox, 2013] Russ Cox. doc: define how sync/atomic interacts with memory model. Mar 13, 2013. https://github.com/golang/go/issues/5045
- [Cox, 2014] Russ Cox. doc: allow buffered channel as semaphore without initialization. March 03, 2014. https://codereview.appspot.com/75130045
- [Vyukov, 2014a] Dmitry Vyukov. doc: define how sync interacts with memory model. May 7, 2014. https://github.com/golang/go/issues/7948
- [Vyukov, 2014b] Dmitry Vyukov. doc: define how finalizers interact with memory model. Dec 25, 2014. https://github.com/golang/go/issues/9442
- [Cox, 2016] Russ Cox. Go's Memory Model. February 25, 2016. http://nil.csail.mit.edu/6.824/2016/notes/gomem.pdf 
- Fannie Zhang. Specify the memory order guarantee provided by atomic Load/Store. July 15, 2019. https://groups.google.com/forum/#!msg/golang-dev/vVkH_9fl1D8/azJa10lkAwAJ -->

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)