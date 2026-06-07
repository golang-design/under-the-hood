---
weight: 4204
title: "13.4 扫描标记与标记辅助"
---

# 13.4 扫描标记与标记辅助

标记是 GC 的主体工作：从根出发，沿指针把所有可达对象置黑（[13.1](./basic.md) 的三色）。Go 把这
件事做成**并发**且**可被分摊**的。这一节看标记如何并行推进、如何知道对象里哪里是指针、以及
"标记辅助"如何防止用户程序甩开标记。

## 13.4.1 标记的工作分发

标记由后台的 **GC worker** goroutine 执行,数量与 `GOMAXPROCS` 挂钩，约占用 25% 的 CPU。
工作以**灰色对象队列**（gcWork，每 P 一份本地队列 + 全局队列）组织：worker 不断从队列取一个
灰色对象、扫描它、把新发现的白色对象置灰入队、把自己扫完的转黑。这套"每 P 本地队列 + 全局
队列 + 窃取"的结构，与调度器（[9.2](../../part3concurrency/ch09sched/steal.md)）、分配器
（[12.2](../ch12alloc/component.md)）一脉相承,又是同一个分层减争的模式。标记天然适合并行：
不同 worker 扫描对象图的不同部分，互不干扰。

## 13.4.2 怎么知道哪里是指针

扫描一个对象时，GC 必须知道**它的哪些字是指针**,否则无从沿指针前进，也可能把恰好像地址的
整数误当指针。答案是分配时就备好的**指针位图**：每个对象的类型描述符（[4.1](../../part2lang/ch04type/type.md)）
带一份位图，标明每个字是否为指针;span 也聚合了这些信息。扫描就是"按位图，对每个是指针的字，
取出它指向的对象置灰"。这正是 [12.1](../ch12alloc/basic.md) 说的"分配器与 GC 共生":分配时记下
的指针布局，标记时拿来用。栈的扫描则依赖编译器生成的**栈帧指针图**(stack map),它标明每个
安全点处栈上哪些槽是活指针（[13.7](./safe.md)）。

## 13.4.3 标记辅助：谁分配谁帮忙

[13.3](./pacing.md) 提过的隐患：标记并发进行时用户还在分配，若分配太快会甩开标记。**标记辅助**
（mark assist）是兜底机制：当一个 goroutine 分配内存时，运行时检查"它欠了多少标记债",若 GC
处于标记阶段且这个 goroutine 分配得过多，就**让它自己先做一点标记工作**再继续分配。这把"分配
速度"与"标记速度"强行绑定,你分配得越凶，被罚去标记得越多，从而保证标记总能赶在堆涨满前完成。
这就是为什么在 GC 标记期间，分配密集的业务 goroutine 会观察到延迟升高,它们正被征去帮 GC 干活。

标记辅助是 Go GC"不靠 STW 也能保证标记按时完成"的关键设计之一。它和写屏障（[13.2](./barrier.md)）
是一对：写屏障保证并发标记的**正确性**（不误回收），标记辅助保证并发标记的**及时性**（赶在堆涨满
前完成）。二者合起来，才让"几乎不停顿的并发标记"成为可能。理解了它，也就理解了为什么 Go GC
能把停顿压到亚毫秒、却仍要付出约 25% CPU 加偶发的分配延迟,天下没有免费的 GC，低延迟的代价
就摊在这些地方。

## 延伸阅读的文献

1. Rick Hudson. *Getting to Go: The Journey of Go's Garbage Collector.* ISMM 2018 / GopherCon.
   https://go.dev/blog/ismmkeynote
2. The Go Authors. *runtime/mgcmark.go（标记、gcWork、标记辅助 gcAssistAlloc）.*
   https://github.com/golang/go/blob/master/src/runtime/mgcmark.go
3. The Go Authors. *A Guide to the Go Garbage Collector.* https://go.dev/doc/gc-guide
4. 本书 [13.2 写屏障](./barrier.md)、[13.3 调步算法](./pacing.md)、[13.7 安全点分析](./safe.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
