---
weight: 5106
title: "15.6 cgo"
---

# 15.6 cgo

Go 程序有时需要调用 C 代码,复用成熟的 C 库、对接系统接口。**cgo** 是这座桥。它能用，却有
可观的成本与诸多约束,以至于社区有句名言"**cgo is not Go**"（Rob Pike）。这一节讲清 cgo 的
机制、它为何昂贵、以及那条容易出事的指针传递规则。

## 15.6.1 跨越两个世界的边界

C 与 Go 是**两个世界**：不同的调用约定（[2.2](../../part1overview/ch02asm/callconv.md) 的
ABIInternal vs C 的平台 ABI）、不同的栈（Go 是可增长的连续栈 [14](../../part4memory/ch14stack)，
C 要固定大栈）、不同的内存管理（Go 有 GC，C 手动）、不同的调度（Go 的 goroutine 调度对 C
不可见）。cgo 调用必须在这两个世界之间做**完整的过渡**：切换调用约定、从 goroutine 的小栈切到
一个足够大的系统栈、并告知运行时"这个线程要进 C 了，调度器别动它的 P"
（[9.5](../../part3concurrency/ch09sched/thread.md) 的 P 移交）。这一整套过渡，正是 cgo 调用
开销的来源。

## 15.6.2 为何昂贵

一次普通的 Go 函数调用是几条指令;一次 cgo 调用要做上面那一连串过渡，开销高出**一两个数量级**。
更深远的影响有几层：**调度**,进入 C 的线程在 C 返回前对 Go 调度器是"黑盒"，若 C 代码阻塞，
会占用一个线程（运行时可能要新建 M 来补，[9.5](../../part3concurrency/ch09sched/thread.md)）;
**栈**,C 不能用 goroutine 的可增长栈，要切到系统栈;**GC**,GC 无法扫描 C 管理的内存。这些
使得 cgo 不适合**高频细粒度**的调用,在热循环里频繁调小 C 函数，过渡开销会吃掉一切。cgo 适合
"少次、粗粒度"的调用（调一个干很多活的大 C 函数）。

它还有**工程**代价：依赖 C 编译器（破坏 Go 纯静态、快速、交叉编译的优势，
[3.4](../../part1overview/ch03life/link.md)）、拖慢构建、让部署复杂化。这就是"cgo is not Go"的
完整含义,用了 cgo，你就部分放弃了 Go 在构建、部署、并发上的诸多好处。

## 15.6.3 指针传递规则

cgo 最危险的陷阱是**指针传递**。Go 的 GC 会移动栈、回收堆;若把一个 Go 指针传给 C，而 C 把它
存起来长期持有，GC 可能在 C 不知情时回收或移动了它指向的对象,留给 C 一个悬垂指针。为此 cgo
定下严格的**指针传递规则**：Go 可以把指向 Go 内存的指针传给 C，但 **C 不得在调用返回后继续持有
它**;Go 内存里也不能含有指向"又指回 Go 内存"的指针。运行时还有 cgocheck（类似
[15.4](./unsafe.md) 的 checkptr）在运行时抽查这些规则的违反。需要让 C 长期持有的内存，应当
**用 C 的 `malloc` 分配**（不受 Go GC 管辖），或用特殊机制（如把 Go 对象固定/句柄化）。这条规则
是 cgo 正确性的命门,违反它导致的 bug 往往诡异且难复现。

cgo 是一座必要却昂贵的桥。理解它的成本与约束，才能明智地决定**何时该用、何时该绕开**,能用
纯 Go 解决的，就别引入 cgo;非用不可时，让调用粗粒度、严守指针规则、用 cgocheck 设防。这又是
Go 务实的一面：它不拒绝与 C 互操作（现实需要），但把代价与风险讲清楚，让你带着清醒去用。

## 延伸阅读的文献

1. The Go Authors. *cgo command documentation（含指针传递规则）.* https://pkg.go.dev/cmd/cgo
2. Rob Pike 等. *"cgo is not Go"*（C? Go? Cgo! 博客）. https://go.dev/blog/cgo
3. The Go Authors. *runtime/cgocall.go（cgo 调用的过渡实现）.*
   https://github.com/golang/go/blob/master/src/runtime/cgocall.go
4. 本书 [2.2 调用规范](../../part1overview/ch02asm/callconv.md)、
   [9.5 线程管理](../../part3concurrency/ch09sched/thread.md)、[15.4 指针检查器](./unsafe.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
