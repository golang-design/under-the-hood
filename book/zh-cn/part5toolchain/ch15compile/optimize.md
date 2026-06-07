---
weight: 5103
title: "15.3 优化器"
---

# 15.3 优化器

在 SSA（[15.2](./ssa.md)）这层中间表示上，编译器跑一系列优化遍，把代码变快、变小。Go 的优化器
有一个鲜明取向：**它不追求极致优化，而追求"足够好的优化 + 极快的编译"**。这一节看它做哪些
关键优化，以及 Go 1.21 引入的、改变游戏规则的**性能制导优化**（PGO）。

## 15.3.1 几项关键优化

Go 编译器在 SSA 上做的优化，覆盖了性价比最高的那些：

- **内联**（inlining）：把小函数的函数体直接展开到调用处，省去调用开销、并为后续优化创造条件
  （内联后常量能传播过去、死代码能被消除）。内联是最重要的优化之一,但 Go 对它有**预算限制**
  （函数太大不内联），以控制代码膨胀与编译时间。
- **逃逸分析**（[15.5](./escape.md)）：决定变量分配在栈还是堆,这是 Go 特有的、与 GC 紧密相关的
  关键优化。
- **边界检查消除**（BCE）：Go 对每次切片/数组访问都插入边界检查（安全）,优化器在能证明"索引
  必然合法"时把检查去掉，省去运行时开销。
- **常量折叠、死代码消除、公共子表达式消除**：经典的标准优化，在 SSA 上做起来直接。
- **去虚化**（devirtualization）：把能在编译期确定具体类型的接口调用（[4.2](../../part2lang/ch04type/interface.md)）
  转成直接调用，甚至进而内联。

## 15.3.2 PGO：用运行画像指导优化

Go 1.21 正式引入**性能制导优化**（Profile-Guided Optimization, PGO）,这是近年编译器最重要的
进展之一。思路是：先在真实负载下用 `pprof`（[16 工具与可观测性](../ch16tools)）采集一份 CPU
**画像**（profile），编译时把它喂给编译器;编译器据此知道**哪些函数、哪些调用是热点**，从而做出
更聪明的决策,最典型的是**更激进地内联热点路径上的调用**，以及优化热点函数的去虚化。实测
PGO 常能带来个位数百分比的性能提升，且只需把 `default.pgo` 放进包目录、`go build` 自动启用，
几乎零成本。

PGO 体现了一个深刻的转变：**静态地猜"什么重要"是有上限的，用真实运行数据来指导优化能突破
这个上限**。编译器不再只靠源码结构猜测，而是拿着"这个程序实际怎么跑"的证据去优化。这与
[9 调度器](../../part3concurrency/ch09sched)、[13 GC](../../part4memory/ch13gc) 里"用运行时反馈
调节行为"的思路一脉相承,都是"让系统根据真实情况自适应"。

## 15.3.3 编译速度这条红线

Go 优化器最该记住的特点，是它**不做的事**：它不做那些耗时巨大、收益边际的激进优化。原因还是
那条贯穿始终的红线,**编译速度**（[1.1](../../part1overview/ch01intro/history.md)）。GCC、LLVM
能做到的某些极致优化，Go 有意不追,因为那会让编译慢下来，而 Go 把"快速编译、快速迭代"看得
比"榨干最后几个百分点的运行性能"更重。这是一个清醒的取舍：对绝大多数服务端程序，编译快带来的
开发效率，比那几个百分点更有价值。需要极致性能的热点，则交给 PGO（用数据精准发力）与
程序员的手工优化。理解了这条红线，就理解了 Go 编译器为何"优化得克制",这不是能力不足，
而是价值排序的结果。

## 延伸阅读的文献

1. The Go Authors. *Profile-Guided Optimization in Go 1.21.* https://go.dev/doc/pgo ；
   https://go.dev/blog/pgo
2. The Go Authors. *cmd/compile/internal/inline、ssa（内联、BCE、去虚化）.*
   https://github.com/golang/go/tree/master/src/cmd/compile/internal
3. The Go Authors. *Go 1.21 Release Notes（PGO 转正）.* https://go.dev/doc/go1.21
4. 本书 [15.2 中间表示](./ssa.md)、[15.5 逃逸分析](./escape.md)、
   [16 工具与可观测性](../ch16tools).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
