# 垃圾回收器: 过去、现在与未来

[TOC]

## Go 1

## Go 1.3

## Go 1.5

## Go 1.6

## Go 1.7: Dijkstra 插入屏障

Go 1.7 使用了纯 Dijkstra 插入屏障技术 [Dijkstra et al. 1978]。
早期的 Go 选择了在 STW 期间，重新对栈进行扫描。垃圾收集器首先在 GC 循环开始时扫描所有栈从而收集根。
但是如果没有栈的写屏障，我们便无法确保堆栈以后不会包含对白色对象的引用，因此扫描栈只有黑色，直到其 goroutine 再次执行，
因此它保守地恢复为灰色。从而在循环结束时，垃圾回收器必须重新扫描灰色堆栈以使其变黑并完成标记任何剩余堆指针。
由于必须保证栈在此期间不会继续更改，因此重新扫描过程在 STW 时发生。实践表明，栈的重扫需要消耗 10 - 100 毫秒的时间。

## Go 1.8, 1.9

## Go 1.12

## Go 1.13


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
