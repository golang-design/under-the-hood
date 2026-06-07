---
weight: 5202
title: "16.2 竞争检查"
---

# 16.2 竞争检查

数据竞争（data race）是并发程序里最隐蔽、最难复现的 bug,两个 goroutine 并发访问同一内存、
至少一个是写、且没有同步，结果未定义（[11.9](../../part3concurrency/ch11sync/mem.md)）。Go 的
**竞态检测器**（`-race`）是对付它的利器。这一节讲清它的原理、能力与边界。

## 16.2.1 基于 happens-before 的动态检测

`go test -race` / `go run -race` 启用竞态检测。它的内核是 Google 的 **ThreadSanitizer**（TSan），
原理是**动态的 happens-before 检测**：程序运行时，检测器**插桩**每一次内存访问与每一个同步事件
（加锁、channel 收发、原子操作等），在内部维护一张 happens-before 关系图
（[11.9](../../part3concurrency/ch11sync/mem.md) 的次序）。当它发现两个 goroutine 访问了同一内存、
至少一个是写、而二者之间**不存在 happens-before 关系**（即没有任何同步把它们排序），就报告一个
数据竞争,并打印两次冲突访问的栈。这把内存模型那条抽象的"无 happens-before 即竞争"规则，
变成了一个能实际抓现行的工具。

## 16.2.2 它的能力边界

竞态检测器极其有用，但有两条必须记住的边界。其一，它是**动态**的：只能检测**实际发生了**的竞争,
那条触发竞争的代码路径必须在检测运行中真的被执行到。没被跑到的竞争，它发现不了。这意味着
竞态检测的效果**取决于测试覆盖**,要在尽量真实、并发充分的负载下跑 `-race`，才能撞出竞争。
其二，它**有成本**：插桩使程序变慢约 5~10 倍、内存占用大增。所以 `-race` 适合在**测试与预发布**
环境用，不适合常开在生产。

正因为它"只报实际发生的竞争"，竞态检测器的报告有一个宝贵性质：**几乎没有误报**。它报出来的，
基本都是真实的数据竞争,这与许多静态分析工具"一堆可能误报"截然不同。所以一旦 `-race` 报警，
就该当真、立刻修。

## 16.2.3 与内存模型的呼应

竞态检测器是 [11.9 内存一致模型](../../part3concurrency/ch11sync/mem.md) 那套理论的**实践落地**。
内存模型说"有数据竞争的程序行为未定义、不可依赖",听起来抽象;竞态检测器把它变成"运行一下、
它会告诉你哪里有竞争"的具体工具。Go 把竞态检测**内建进工具链**（一个 `-race` 标志即可，无需
额外安装），是它"让正确的并发更容易写对"的承诺的一部分,语言给了你 channel 与锁来正确同步
（[11 同步](../../part3concurrency/ch11sync)），又给了你竞态检测器来抓出你没同步好的地方。
养成"并发代码必过 `-race` 测试"的习惯，是写可靠 Go 并发程序的基本功,内存模型负责定义对错，
竞态检测器负责帮你发现错。

## 延伸阅读的文献

1. The Go Authors. *Data Race Detector.* https://go.dev/doc/articles/race_detector
2. Konstantin Serebryany, Timur Iskhodzhanov. "ThreadSanitizer: data race detection in
   practice." *WBIA 2009*. https://doi.org/10.1145/1791194.1791203
3. The Go Authors. *The Go Memory Model.* https://go.dev/ref/mem
4. 本书 [11.9 内存一致模型](../../part3concurrency/ch11sync/mem.md)、
   [11 并发同步](../../part3concurrency/ch11sync).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
