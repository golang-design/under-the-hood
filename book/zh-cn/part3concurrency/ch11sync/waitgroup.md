---
weight: 3305
title: "11.5 同步组"
---

# 11.5 同步组

`sync.WaitGroup` 解决一个常见需求：等一组 goroutine 全部干完，再继续往下走。它的接口只有三个
方法：`Add` 加计数、`Done` 减一、`Wait` 阻塞到计数归零。

```go
var wg sync.WaitGroup
for _, task := range tasks {
    wg.Add(1)
    go func(t Task) {
        defer wg.Done()  // 等价于 wg.Add(-1)
        t.run()
    }(task)
}
wg.Wait() // 阻塞，直到所有 task 完成
```

## 11.5.1 它在同步原语谱系里是什么

`WaitGroup` 是经典的**栅栏 / 计数闩**（barrier / latch）一族的成员。这一族里：**倒计数闩**
（Java 的 `CountDownLatch`）是一次性的,计数到零后不可复用，用于"等若干事件都发生";**循环栅栏**
（`CyclicBarrier`）可复用,让 N 个线程在同一点会合后再一起出发;**Phaser** 则是可动态增减参与方的
更灵活栅栏。`WaitGroup` 介于其间：计数可增可减、`Wait` 可被多个 goroutine 同时等待，且
`Wait` 返回后可以再次 `Add` 复用（但有严格时序约束，见下）。它实现的，正是并行计算里最基本的
**fork-join**：派生一组任务，再在汇合点等它们全部结束。

## 11.5.2 计数器加信号量

WaitGroup 的内部很轻：一个计数器，外加一个用于阻塞 `Wait` 的信号量。`Add` 原子地增减计数；
当计数降到 0 时，唤醒所有阻塞在 `Wait` 上的 goroutine。这里有两条容易踩的规矩。其一，`Add`
必须在对应的 goroutine **启动之前**调用,常见写法是在 `go` 之前 `wg.Add(1)`;若把 `Add` 放进
goroutine 内部，`Wait` 可能在它还没来得及加计数时就看到计数为 0 而提前返回，这是一种竞态。
其二，计数器不能变成负数,`Done` 多于 `Add` 会直接 panic，这是为了把"配对错误"尽早暴露
（与 [10.4](../ch10chan)、mutex 的"宁可崩溃也不沉默"是同一种价值观）。其内存语义也有保证：
`Wait` 返回 happens-after 所有 `Done`（[11.9](./mem.md)），所以汇合之后能安全读取各任务写下的
结果。

## 11.5.3 Go 1.25 的 WaitGroup.Go

"`Add(1)` + `go` + `defer Done()`"这套样板写多了既啰嗦又易错（忘了 `Add`、忘了 `Done`、闭包
捕获出错）。Go 1.25 为此加了 `WaitGroup.Go` 方法，把样板收进库里：

```go
var wg sync.WaitGroup
for _, task := range tasks {
    wg.Go(func() { task.run() }) // 自动 Add(1)，结束时自动 Done()
}
wg.Wait()
```

`wg.Go(f)` 内部就是"`Add(1)`，起一个 goroutine 跑 `f`，结束时 `Done`"。它消除了最常见的几类
误用，是一处小而实在的人体工学改进。配合 Go 1.22 修正的循环变量语义（每轮迭代独立的变量，
见 [6 函数](../../part2lang/ch06func)），过去那个"循环里起 goroutine 捕获错变量"的经典陷阱也
一并消失。

## 11.5.4 与结构化并发

`WaitGroup` 只管"等所有任务结束"，不管错误传播与取消。需要这些时，`golang.org/x/sync/errgroup`
是它的增强版：一个会传播首个错误、并能与 `context` 取消联动的 WaitGroup（[11.8](./context.md)）。
errgroup + context，正是 Go 目前对**结构化并发**（让并发任务有明确、嵌套的生命周期）的惯用
近似。从 `WaitGroup` 到 errgroup 再到结构化并发的讨论，可以看到 Go 并发原语沿着"让并发的
生命周期更可控"这条线持续演进。

## 延伸阅读的文献

1. The Go Authors. *sync.WaitGroup 文档.* https://pkg.go.dev/sync#WaitGroup ；
   Go 1.25 Release Notes（WaitGroup.Go）. https://go.dev/doc/go1.25
2. The Go Authors. *The Go Memory Model：WaitGroup 的同步保证.* https://go.dev/ref/mem
3. Doug Lea. *java.util.concurrent（CountDownLatch / CyclicBarrier / Phaser）.*
   https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/package-summary.html
4. The Go Authors. *golang.org/x/sync/errgroup.* https://pkg.go.dev/golang.org/x/sync/errgroup

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
