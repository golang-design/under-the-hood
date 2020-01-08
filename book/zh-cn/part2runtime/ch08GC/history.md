---
weight: 2311
title: "8.11 过去、现在与未来"
---

# 8.11 过去、现在与未来

[TOC]

## 被采纳的方案

我们来现在来详细回顾一下 Go 中 GC 在各个版本上的演进历史。

### Go 1

在 Go 1 的时代，尽管所有的用户代码都是并发执行的，但是一旦垃圾回收器开始进行垃圾回收工作时，所有的用户代码都会停止执行，而且垃圾回收器仅在一个线程上执行，这时是最原始的垃圾回收器的实现，即单线程版的三色标记清扫。

### Go 1.3

在 Go 1.3 时候，官方成功将三色标记清扫算法的垃圾回收的代码得以并行，从而成功缩短了用户代码的停止时间，但是这仍然会造成大量的空隙，如果用户代码是一个 Web 应用，且正在处理一个非常重要的请求时，则会对请求延迟造成巨大的影响。

![](../../../assets/gc1.png)

### Go 1.5

为了解决这一问题，在 Go 1.5 时开始使用写屏障技术开始让垃圾回收与用户代码得以并行执行。
从而只有在执行写屏障和很短一段时间内需要进行 STW。

### Go 1.6

TODO:

### Go 1.7: Dijkstra 插入屏障

Go 1.7 使用了纯 Dijkstra 插入屏障技术 [Dijkstra et al. 1978]。
早期的 Go 选择了在 STW 期间，重新对栈进行扫描。垃圾收集器首先在 GC 循环开始时扫描所有栈从而收集根。
但是如果没有栈的写屏障，我们便无法确保堆栈以后不会包含对白色对象的引用，因此扫描栈只有黑色，直到其 goroutine 再次执行，
因此它保守地恢复为灰色。从而在循环结束时，垃圾回收器必须重新扫描灰色堆栈以使其变黑并完成标记任何剩余堆指针。
由于必须保证栈在此期间不会继续更改，因此重新扫描过程在 STW 时发生。实践表明，栈的重扫需要消耗 10 - 100 毫秒的时间。

### Go 1.8, 1.9

最后在 1.8 时，通过引入混合屏障，Go 团队成功将 STW 进一步缩短，几乎解决了 STW 的问题。

![](../../../assets/gc2.png)

### Go 1.10, 1.11

### Go 1.12

### Go 1.13

### Go 1.14

到了 Go 1.14，由于页分配器的引入，向操作系统归还内存的操作页完全得到并发。

![](../../../assets/gc3.png)

## 被抛弃的方案

### 并发栈重扫

正如我们前面所说，允许灰色赋值器存在的垃圾回收器需要引入重扫过程来保证算法的正确性，除了引入混合屏障来消除重扫这一过程外，有另一种做法可以提高重扫过程的性能，那就是将重扫的过程并发执行。然而这一方案[11]并没有得以实现，原因很简单：实现过程相比引入混合屏障而言十分复杂，而且引入混合屏障能够消除重扫这一过程，将简化垃圾回收的步骤。

### ROC

ROC 的全称是面向请求的回收器（Request Oriented Collector）[12]，它其实也是分代 GC 的一种重新叙述。它提出了一个请求假设（Request Hypothesis）：与一个完整请求、休眠 goroutine 所关联的对象比其他对象更容易死亡。这个假设听起来非常符合直觉，但在实现上，由于垃圾回收器必须确保是否有 goroutine 私有指针被写入公共对象，因此写屏障必须一直打开，这也就产生了该方法的致命缺点：昂贵的写屏障及其带来的缓存未命中，这也是这一设计最终没有被采用的主要原因。

### 传统分代 GC

在发现 ROC 性能不行之后，作为备选方案，Go 团队还尝试了实现传统的分代式 GC [13]。但最终同样发现分代假设并不适用于 Go 的运行栈机制，年轻代对象在栈上就已经死亡，扫描本就该回收的执行栈并没有为由于分代假设带来明显的性能提升。这也是这一设计最终没有被采用的主要原因。

## 已知的问题

### 标记辅助时间过长

### 清扫时间过长

### 大规模场景下性能低下

### 对齐导致的内存浪费

## 未来的演进方向

## 进一步阅读的参考文献

- [Hudson, 2015] [Go GC: Latency Problem Solved](https://talks.golang.org/2015/go-gc.pdf) go1.5
- [Clements, 2015a] [Concurrent garbage collector pacing & Final implementation](https://docs.google.com/document/d/1wmjrocXIWTr1JxU-3EQBI6BK6KgtiFArkG47XK73xIQ/edit#heading=h.xy314pvxblbm), [Proposal: Garbage collector pacing](https://groups.google.com/forum/#!topic/golang-dev/YjoG9yJktg4) released in go1.5
- [Clements, 2015b] [Proposal: Decentralized GC coordination](https://go.googlesource.com/proposal/+/master/design/11970-decentralized-gc.md), [Discussion #11970](https://golang.org/issue/11970) released in go1.6
- [Clements, 2015c] [Proposal: Dense mark bits and sweep-free allocation](https://go.googlesource.com/proposal/+/master/design/12800-sweep-free-alloc.md), [Discussion #12800](https://golang.org/issue/12800) released in go1.6
- [Clements, 2016] [Proposal: Separate soft and hard heap size goal](https://go.googlesource.com/proposal/+/master/design/14951-soft-heap-limit.md), [Discussion #14951](https://golang.org/issue/14951) released in go1.10
- [Clements and Hudson, 2016a] [Proposal: Eliminate STW stack re-scanning](https://go.googlesource.com/proposal/+/master/design/17503-eliminate-rescan.md) [Discussion #17503](https://golang.org/issue/17503) released in go1.8 (hybrid barrier), go1.9 (remove re-scan), go1.12 (fix mark termination race)
- [Clements and Hudson, 2016b] [Proposal: Concurrent stack re-scanning](https://go.googlesource.com/proposal/+/master/design/17505-concurrent-rescan.md), [Discussion #17505](https://golang.org/issue/17505), unreleased.
- [Hudson and Clements, 2016] [Request Oriented Collector (ROC) Algorithm](https://docs.google.com/document/d/1gCsFxXamW8RRvOe5hECz98Ftk-tcRRJcDFANj2VwCB0/edit), unreleased.
- [Clements, 2018] [Proposal: Simplify mark termination and eliminate mark 2](https://go.googlesource.com/proposal/+/master/design/26903-simplify-mark-termination.md), [Discussion #26903](https://golang.org/issue/26903), released go1.12
- [Hudson, 2018] [Richard L. Hudson. Getting to Go: The Journey of Go's Garbage Collector, in International Symposium on Memory Management (ISMM), June 18, 2018](https://blog.golang.org/ismmkeynote)
- [Knyszek, 2019] [Proposal: Smarter Scavenging](https://go.googlesource.com/proposal/+/master/design/30333-smarter-scavenging.md), [Discussion #30333](https://golang.org/issue/30333)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
