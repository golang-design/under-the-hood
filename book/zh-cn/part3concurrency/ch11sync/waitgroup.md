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

## 11.5.1 计数器加信号量

WaitGroup 的内部很轻：一个计数器，外加一个用于阻塞 `Wait` 的信号量。`Add` 原子地增减计数；
当计数降到 0 时，唤醒所有阻塞在 `Wait` 上的 goroutine。这里有两条容易踩的规矩。其一，`Add`
必须在对应的 goroutine **启动之前**调用，常见写法是在 `go` 之前 `wg.Add(1)`，若把 `Add` 放进
goroutine 内部，`Wait` 可能在它还没来得及加计数时就看到计数为 0 而提前返回。其二，计数器
不能变成负数，`Done` 多于 `Add` 会直接 panic，这是为了把「配对错误」尽早暴露出来。

## 11.5.2 Go 1.25 的 WaitGroup.Go

「`Add(1)` + `go` + `defer Done()`」这套样板写多了既啰嗦又容易写错（忘了 `Add`、忘了 `Done`、
闭包变量捕获出错）。Go 1.25 为此加了一个 `WaitGroup.Go` 方法，把这套样板收进库里：

```go
var wg sync.WaitGroup
for _, task := range tasks {
    wg.Go(func() { task.run() }) // 自动 Add(1)，结束时自动 Done()
}
wg.Wait()
```

`wg.Go(f)` 内部就是「`Add(1)`，起一个 goroutine 跑 `f`，结束时 `Done`」。它消除了最常见的几类
误用，是一处小而实在的人体工学改进。配合 Go 1.22 修正的循环变量语义（每轮迭代独立的变量，
见 [6 函数](../../part2lang/ch06func)），过去那个「循环里起 goroutine 捕获错变量」的经典陷阱
也一并消失了。

## 延伸阅读的文献

1. The Go Authors. *sync.WaitGroup 文档.* https://pkg.go.dev/sync#WaitGroup
2. Go 1.25 Release Notes（WaitGroup.Go）. https://go.dev/doc/go1.25
3. The Go Memory Model：*WaitGroup 的同步保证.* https://go.dev/ref/mem

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
