# 垃圾回收器：基础知识

TODO:

## 内存模型

语言的内存模型定义了并行状态下拥有确定读取和写入的时序的条件。
Go 的 goroutine 采取并发的形式运行在多个并行的线程上，
Go 的内存模型就明确了 goroutine 在一个变量被写入后一定能够被读取到的条件。
在 Go 的内存模型中有事件时序的概念，并定义了 happens before：表示了在 Go 程序中执行内存操作的偏序关系。
如果事件 e1 happens before 事件 e2，则 e2 happens after e1。
同样，如果 e1 没有 happen before e2 且没有 happen after e2，则 e1 与 e2 happen concurrently。
在单个 goroutine 中，happens-before 顺序即程序定义的顺序。

我们稍微学院派的描述一下偏序的概念。（非严格）偏序在数学上是一个二元关系，它满足自反、反对称和传递性。
happens before 既然被称之为偏序，那么自然也就满足这三个性质：

1. 对于任意的事件 e1，有 e1 happens before e1 的；
2. 对于任意的事件 e1 和 e2，如果 e1 happens before e2，e2 happens before e1 则 e1 e2 happens concurrently；
3. 对于任意的事件 e1 e2 和 e3，如果 e1 happens before e2，e2 happens before e3，则 e1 happens before e3。

可能我们会认为这种事件的发生时序的偏序关系仅仅只是在探讨并发模型，跟内存无关。
但实际上，它们既然被称之为内存模型，就是因为它们与内存有着密切关系。
并发时序的条件，本质上来说，是定义了内存操作的可见性。

编译器和 CPU 通常会产生各种优化来影响程序原本定义的执行顺序，这包括：编译器的指令重排、 CPU 的乱序执行。
除此之外，由于缓存的关系，多核 CPU 下，一个 CPU 核心的写结果仅发生在该核心最近的缓存下，
要想被另一个 CPU 读到则必须等待内存被置换回低级缓存再置换到另一个核心后才能被读到。

Go 中的 happens before 有以下保证：

1. 初始化：`main.main` happens after `main.init`
2. goroutine 创建：`go` statement happens before `goroutine's execution begins`
3. goroutine 销毁: `goroutine's exit` happens concurrently of any event `e`
4. channel: `send on a channel` happens before `receive from that channel complete`
5. channel: `close of a channel` happens before `receive that returns a zero value`
6. channel: `receive from an unbuffered channel` happens before `send on that channel complete`
7. channel: `k-th receive on a channel with capacity C` happens before `k+C-th send from that channel complete`
8. mutex: `sync.Mutex/sync.RWMutex variable l and n < m`, `call n of l.Unlock()` happens before `call m of l.Lock() returns`
9. mutex: `any call to l.RLock on a sync.RWMutex variable l, there is an n such that the l.RLock` happens (returns) after `call n to l.Unlock and the matching l.RUnlock happens before call n+1 to l.Lock.`
10. once: `A single call of f() from once.Do(f)` happens (returns) before `any call of once.Do(f) returns`.

## 编译标志 `go:nowritebarrier`

如果函数包含 write barrier，则 `go:nowritebarrier` 触发一个编译器错误（它不会抑制 write barrier 的产生，只是一个断言）。

你通常希望 `go:nowritebarrierrec`。`go:nowritebarrier` 主要适用于没有 write barrier 会更好的情况，但没有要求正确性。

## 编译标志 `go:nowritebarrierrec` 和 `go:yeswritebarrierrec`

如果声明的函数或任何它递归调用的函数甚至于 `go:yeswritebarrierrec` 包含 write barrier，则 `go:nowritebarrierrec` 触发编译器错误。

逻辑上，编译器为每个函数调用补充 `go:nowritebarrierrec` 且当遭遇包含 write barrier 函数的时候产生一个错误。这种补充在 `go:yeswritebarrierrec` 函数上停止。

`go:nowritebarrierrec` 用于防止 write barrier 实现中的无限循环。

两个标志都在调度器中使用。write barrier 需要一个活跃的 P （`getg().m.p != nil`）且调度器代码通常在没有活跃 P 的情况下运行。在这种情况下，`go:nowritebarrierrec` 用于释放 P 的函数上，或者可以在没有 P 的情况下运行。而且`go:nowritebarrierrec` 还被用于当代码重新要求一个活跃的 P 时。由于这些都是函数级标注，因此释放或获取 P 的代码可能需要分为两个函数。

这两个指令都在调度程序中使用。 write barrier 需要一个活跃的P（ `getg().mp != nil`）并且调度程序代码通常在没有活动 P 的情况下运行。在这种情况下，`go:nowritebarrierrec` 用于释放P的函数或者可以在没有P的情况下运行并且去 ：当代码重新获取活动P时使用 `go:yeswritebarrierrec`。由于这些是功能级注释，因此释放或获取P的代码可能需要分为两个函数。

## 进一步阅读的参考文献

1. [The Go Memory Model](https://golang.org/ref/mem)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)