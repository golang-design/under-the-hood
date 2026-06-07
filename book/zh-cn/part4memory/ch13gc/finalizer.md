---
weight: 4210
title: "13.10 终结器"
---

# 13.10 终结器

有时一个对象在被回收前需要做点收尾,关闭文件描述符、释放 C 分配的内存。**终结器**（finalizer）
让你给对象注册一个"临终回调"。它好用，却也是 Go 里最容易被误用的特性之一。这一节讲清它的
机制、陷阱，以及 Go 1.24 给出的更好替代 `AddCleanup`。

## 13.10.1 SetFinalizer 的机制

`runtime.SetFinalizer(obj, fn)` 给 `obj` 注册一个终结函数 `fn`。当 GC 发现 `obj` **不再可达**时，
不立即回收它，而是：把它交给一个专门的**终结器 goroutine** 去运行 `fn`,运行完，`obj` 才在
**下一轮** GC 真正被回收。这意味着带终结器的对象要**多活一个 GC 周期**：第一轮发现它不可达、
跑终结器，第二轮才回收。机制本身不复杂，复杂的是它的语义后果。

## 13.10.2 为什么充满陷阱

终结器看着方便，实则地雷遍布：

- **时机不确定**：`fn` 何时运行，取决于 GC 何时发现对象不可达、何时调度终结器 goroutine,
  完全不可预测，甚至**程序退出前可能根本不运行**。所以**绝不能用终结器来做必须发生的释放**
  （如刷新缓冲、提交事务）。
- **延迟回收**：带终结器的对象多活一轮 GC，增加了内存压力。
- **复活问题**：终结器 `fn` 里若不小心又让 `obj` 变回可达（"复活"），语义会变得极其微妙。
- **顺序问题**：一组相互引用、都带终结器的对象，终结顺序没有保证。

正因如此，社区的共识是：**终结器只该作为"忘记显式释放时的最后兜底/告警"，而非正常的资源管理
手段**。正常的资源释放应当用 `defer`（[6.2](../../part2lang/ch06func/defer.md)）显式地做。

## 13.10.3 Go 1.24 的 AddCleanup

终结器的 API（`SetFinalizer`）设计上还有更深的毛病：它的回调直接拿到对象本身，容易引发复活;
且一个对象只能有一个终结器;它与对象生命周期的耦合也容易出错。Go 1.24 引入了更好的替代,
`runtime.AddCleanup[T, S](ptr, cleanup, arg)`：它把"清理动作"与"被清理对象"解耦,清理函数
拿到的是你预先给的 `arg`（而非对象本身，杜绝复活），一个对象可注册**多个**清理，且语义更清晰、
更不易误用。新代码应优先用 `AddCleanup` 而非 `SetFinalizer`。这次 API 更替是一个典型的"吸取
旧设计教训、给出更安全替代"的例子,它没有移除 `SetFinalizer`（向后兼容），而是提供了一条更
稳妥的新路。

终结器的故事再次印证了 Go 的资源管理哲学：**确定性的清理用显式的 `defer`，不确定的终结器只作
兜底**。把"必须发生的事"交给不确定的 GC 时机，是危险的,这与 [11.8](../../part3concurrency/ch11sync/context.md)
强调显式、[6.2](../../part2lang/ch06func/defer.md) 推崇 `defer` 的取向完全一致。

## 延伸阅读的文献

1. The Go Authors. *runtime.SetFinalizer / runtime.AddCleanup 文档.*
   https://pkg.go.dev/runtime#SetFinalizer ，https://pkg.go.dev/runtime#AddCleanup
2. Go 1.24 Release Notes（AddCleanup）. https://go.dev/doc/go1.24
3. The Go Authors. *runtime/mfinal.go、runtime/mcleanup.go.*
   https://github.com/golang/go/blob/master/src/runtime/mcleanup.go
4. 本书 [6.2 延迟语句](../../part2lang/ch06func/defer.md)（确定性清理）.

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
