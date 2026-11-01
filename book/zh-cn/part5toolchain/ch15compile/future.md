---
weight: 5107
title: "15.7 过去、现在与未来"
---

# 15.7 过去、现在与未来

前面六节沿着编译流水线考察了 Go 1.26 的编译器：词法与文法分析（[15.1](./parse.md)）、
中间表示（[15.2](./ssa.md)）、优化器（[15.3](./optimize.md)）、指针检查器（[15.4](./unsafe.md)）、
逃逸分析（[15.5](./escape.md)）与 cgo（[15.6](./cgo.md)）。本节把它们放回时间轴上。
编译器的演变大致分为三个阶段：Go 1.4 及以前，它是一个用 C 写成、继承自 Plan 9 的编译器；Go 1.5 至 1.8，
它被翻译为 Go，并换上了基于 SSA 的后端；此后的改进集中在调用约定、泛型与依据剖析数据的优化上。另外，
编译器的名字 gc 是「Go compiler」的缩写，`cmd/compile` 的说明文档特意澄清，它与大写的 GC（垃圾回收）
几乎无关 [[Go Authors, 2026a](#ref-go-authors-2026a)]。

## 15.7.1 继承自 Plan 9：Go 1.4 及以前

2008 年 3 月，Ken Thompson 提交了最初的编译器 [[Thompson, 2008](#ref-thompson-2008)]。它用 C 写成，文法由
yacc 文件 `go.y` 描述，结构与命名都沿袭 Plan 9 的 C 编译器：每个目标架构对应一个独立的程序，`6g` 面向
amd64，`8g` 面向 386，配套的汇编器与链接器也是如此（[2.1](../../part1overview/ch02asm/asm.md)）。
编译器以语法树为中间表示。

Go 1（2012 年 3 月）发布之前，编译器已经加入了逃逸分析（[15.5](./escape.md)）与内联：内联于 2011 年
12 月实现，2012 年 1 月默认启用 [[van Dijk, 2011](#ref-van-dijk-2011)] [[Cox, 2012](#ref-cox-2012)]。
语法树却不便于数据流分析，许多优化难以实现。Keith Randall 在 2015 年的 SSA 后端提案中指出，基于 SSA
的中间表示能够实现许多在当时的编译器中难以实现的优化 [[Randall, 2015](#ref-randall-2015)]。

## 15.7.2 从 C 到 Go：Go 1.5

Go 1.5（2015 年 8 月）的编译器与链接器由原先的 C 代码自动翻译为 Go，`6g`、`8g` 等程序合并为一个由 `GOOS`
与 `GOARCH` 选择目标的 `go tool compile` [[Go Authors, 2015](#ref-go-authors-2015)]。
翻译器是专为这批代码编写的，并不是通用的 C 到 Go 翻译工具 [[Pike, 2015](#ref-pike-2015)]。发布说明强调，
这是一次真正的翻译而非重写，新程序本质上就是旧程序，翻译几乎不会引入新的缺陷，
反而发现并修复了一些此前未知的缺陷。转换的动机与自举的后果见
[3.3](../../part1overview/ch03life/bootstrap.md)。

翻译的代价是速度。自动翻译所得的代码保留着 C 的写法，性能不如手写的 Go，Go 1.5 的构建因此慢了约一倍
[[Go Authors, 2015](#ref-go-authors-2015)]。此后数个版本的一项持续工作，就是把这些代码逐步改写为惯用的
Go。前端也在此后重写：Go 1.6 用手写的递归下降分析器取代了 yacc 生成的分析器（[15.1](./parse.md)），Go 1.8
换上了新的前端 [[Go Authors, 2017](#ref-go-authors-2017)]。

## 15.7.3 SSA 后端：Go 1.7 与 1.8

翻译完成之前，Randall 就提出了下一步：「把当前基于语法树的中间表示改为更现代的、基于 SSA 的中间表示」，
并主张分阶段转换，先替换后端 [[Randall, 2015](#ref-randall-2015)]。新后端从 walk 之后的中间表示接手，
此时的代码已相当低级，但大体与机器无关；此后的降级为机器相关的操作、指令调度、寄存器分配与代码生成都在 SSA
形式上进行。提案原本以 Go 1.6 为目标。

新后端在 Go 1.7（2016 年 8 月）中首先用于 64 位 x86，基准程序的 CPU 时间减少了 5% 到 35%，
发布说明特别提到它为边界检查消除等优化提供了更好的平台 [[Go Authors, 2016](#ref-go-authors-2016)]。Go
1.8（2017 年 2 月）把它推广到所有架构：32 位 ARM 上的基准程序提速 20% 到 30%，已在使用新后端的 64 位 x86
上则为 0 到 10%；Go 1.7 中用于关闭新后端的临时选项 `-ssa=0` 随之删除
[[Go Authors, 2017](#ref-go-authors-2017)]。SSA 后端的结构、重写规则与各趟处理见 [15.2](./ssa.md)。

## 15.7.4 调用约定与泛型：Go 1.17 至 1.20

Go 1.17（2021 年 8 月）在 Linux、macOS 与 Windows 的 64 位 x86
上改用寄存器传递函数的参数与结果，代表性的程序与包的性能提升约 5%，二进制文件通常缩小约 2%
[[Go Authors, 2021](#ref-go-authors-2021)]。Go 1.18 把它推广到 64 位 ARM、64 位 PowerPC
以及所有操作系统上的 64 位 x86，64 位 ARM 与 PowerPC 上的典型提升达到 10% 以上
[[Go Authors, 2022](#ref-go-authors-2022)]。这项改动的难点在于兼容：它不能改变任何安全的 Go 代码的行为，
也要尽量不影响既有的汇编代码。设计见 [[Clements, 2020](#ref-clements-2020)]，两套约定及其转换见
[2.3](../../part1overview/ch02asm/callconv.md)。

同一版本加入了泛型。前端的类型检查改由 `types2` 完成（[8.3](../../part2lang/ch08generics/checker.md)），
泛型代码采用形状模板化加字典的实现（[8.1](../../part2lang/ch08generics/history.md)）。发布说明坦言，
支持泛型的改动使 Go 1.18 的编译速度比 Go 1.17 慢了约 15%，生成代码的执行时间不受影响
[[Go Authors, 2022](#ref-go-authors-2022)]。Go 1.20 默认启用统一中间表示（Unified IR），
它在功能上已与旧的前端持平 [[Dempsky, 2022](#ref-dempsky-2022)]；发布说明的描述是，
前端改用了一种新的方式处理编译器的内部数据，修复了若干泛型问题，并允许在泛型函数与方法中声明类型
[[Go Authors, 2023a](#ref-go-authors-2023a)]。今天，Unified IR 同时负责构造中间表示、包的导入导出与内联
[[Go Authors, 2026a](#ref-go-authors-2026a)]。

## 15.7.5 性能制导优化：Go 1.20 起

此前，编译器的内联与去虚化都只能依据静态启发式规则判断。性能制导优化（profile-guided optimization，PGO）
把程序运行时采集的 CPU 剖析数据交给编译器，使它在热点处作出不同的决策
[[Go Authors, n.d.a](#ref-go-authors-nda)]。Go 1.20 以预览形式加入 PGO，
用剖析数据在热点调用处更积极地内联，代表性的程序提速约 3% 至 4%
[[Go Authors, 2023a](#ref-go-authors-2023a)]。Go 1.21 宣布 PGO 可以正式使用：主包目录下的 `default.pgo`
默认启用，多数程序提速 2% 至 7%；PGO 还开始对部分接口方法调用去虚化，为最常见的被调用者加上一次直接调用。
同一版本的编译器本身也用 PGO 构建，构建速度因此最多提高 6% [[Go Authors, 2023b](#ref-go-authors-2023b)]。
Go 1.22 使去虚化覆盖更多的调用，并让去虚化与内联交替进行，多数程序的提升达到 2% 至 14%
[[Go Authors, 2024](#ref-go-authors-2024)]。编译器中的实现见 [15.3](./optimize.md)。

不依赖剖析数据的优化同样在推进。逃逸分析在 Go 1.13 重写之后，Go 1.25 与 1.26 又先后把大小可变的 `make` 与
`append` 的底层存储放到栈上（[15.5](./escape.md)）。Go 1.22 还以预览形式加入了新的内联启发式规则：
在循环等「重要」的调用处更积极地内联，在 panic 路径等「不重要」的调用处则加以抑制，以
`GOEXPERIMENT=newinliner` 启用 [[Go Authors, 2024](#ref-go-authors-2024)]。直到 Go 1.26，
它仍是一个默认关闭的实验。

## 15.7.6 展望

本书以 Go 1.26 为准。写作时，Go 1.27 已于 2026 年 8 月发布 [[Go Authors, 2026c](#ref-go-authors-2026c)]，
其中与编译器有关的变化有：语言允许方法声明自己的类型参数，即泛型方法
（[8.4](../../part2lang/ch08generics/future.md)）；对部分小于 80 字节的分配，
编译器改为生成对按大小特化的分配函数的调用，这类分配的开销最多降低 30%，代价是二进制文件增大约 60 KB；
新的实验性 `simd` 包提供可移植、与向量宽度无关的 SIMD 支持，Go 1.26 引入的 `simd/archsimd` 包则在 amd64
之外增加了 arm64 与 WebAssembly 的 128 位 SIMD。Go 1.26 的发布说明已经预告了这个可移植的高层 SIMD 包
[[Go Authors, 2026b](#ref-go-authors-2026b)]。

主分支上的下一个版本 Go 1.28 预计在 2027 年 2 月发布，截至 2026 年 11 月，
其发布说明草稿的编译器一节尚无内容；自举方面，Go 1.28 要求以 Go 1.26.0 或更高版本构建
[[Go Authors, 2026d](#ref-go-authors-2026d)]。主分支上与编译器有关的实验包括 `NewInliner`、`SIMD`、
需要编译器配合的 `RuntimeFreegc`，以及 2026 年 10 月新加入的、以 Go 类型描述 cgo 绑定的 `CgoBindings`
[[Go Authors, 2026e](#ref-go-authors-2026e)]。实验能否成为默认行为，要由此后的版本回答。

## 15.7.7 小结

编译器的两次重大重构方向不同：Go 1.5 更换了实现语言，Go 1.7 与 1.8 更换了后端的中间表示。
前者以机械翻译保证新旧程序的等价，付出的是一段时间的构建速度；后者分阶段推进，先在一个架构上启用，
再推广到全部架构。此后的寄存器调用约定、Unified IR 与 PGO 都建立在这两次重构之上。
每一项改动都以不改变程序的行为为前提，代价与收益则写在各版本的发布说明里
[[Go Authors, n.d.b](#ref-go-authors-ndb)]：Go 1.5 的构建慢了约一倍，Go 1.18 的编译慢了约 15%，PGO
则为提供了剖析数据的多数程序换来 2% 至 14% 的提升（Go 1.22）。

## 延伸阅读

- <a id="ref-clements-2020"></a>[Clements, 2020] Austin Clements. "Proposal: Register-based Go calling
  convention." Go proposal 40724, 2020.
  https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md
  栈 ABI 改为寄存器 ABI 的兼容性约束与设计。
- <a id="ref-cox-2012"></a>[Cox, 2012] Russ Cox. gc: enable inlining by default. Go commit 4a6b07f235,
  2012. https://golang.org/cl/5531058
  随 Go 1 发布。
- <a id="ref-dempsky-2022"></a>[Dempsky, 2022] Matthew Dempsky. internal/buildcfg: enable unified IR by
  default. Go commit 833367e98a, 2022. https://go.dev/cl/422235
  随 Go 1.20 发布。
- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *Profile-guided optimization.*
  https://go.dev/doc/pgo
  PGO 用户文档：采集剖析数据、`default.pgo` 约定与当前能利用剖析数据的优化。
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *Release History.*
  https://go.dev/doc/devel/release
  各版本发布说明的索引，自举、SSA 后端、寄存器 ABI 与 PGO 的逐版本落地记录。
- <a id="ref-go-authors-2015"></a>[Go Authors, 2015] The Go Authors. *Go 1.5 Release Notes.* 2015.
  https://go.dev/doc/go1.5
- <a id="ref-go-authors-2016"></a>[Go Authors, 2016] The Go Authors. *Go 1.7 Release Notes: Compiler
  Toolchain.* 2016. https://go.dev/doc/go1.7
- <a id="ref-go-authors-2017"></a>[Go Authors, 2017] The Go Authors. *Go 1.8 Release Notes: Compiler
  Toolchain.* 2017. https://go.dev/doc/go1.8
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.17 Release Notes: Compiler.*
  2021. https://go.dev/doc/go1.17
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *Go 1.18 Release Notes.* 2022.
  https://go.dev/doc/go1.18
- <a id="ref-go-authors-2023a"></a>[Go Authors, 2023a] The Go Authors. *Go 1.20 Release Notes: Compiler.*
  2023. https://go.dev/doc/go1.20
- <a id="ref-go-authors-2023b"></a>[Go Authors, 2023b] The Go Authors. *Go 1.21 Release Notes: Compiler.*
  2023. https://go.dev/doc/go1.21
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. *Go 1.22 Release Notes: Compiler.*
  2024. https://go.dev/doc/go1.22
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. cmd/compile/README.md: Introduction
  to the Go compiler. Go 1.26 源码.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/README.md
  编译器各阶段的划分、`gc` 名称的含义与 Unified IR。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Go 1.26 Release Notes.* 2026.
  https://go.dev/doc/go1.26
  其中实验性 `simd/archsimd` 包一节。
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Go 1.27 Release Notes.* 2026.
  https://go.dev/doc/go1.27
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. doc/next. Go 主分支源码.
  https://github.com/golang/go/tree/master/doc/next
  Go 1.28 发布说明草稿，以 2026 年 11 月 1 日的主分支为准。
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors. internal/goexperiment/flags.go. Go
  主分支源码. https://github.com/golang/go/blob/master/src/internal/goexperiment/flags.go
  `GOEXPERIMENT` 实验的列表与说明，以 2026 年 11 月 1 日的主分支为准。
- <a id="ref-pike-2015"></a>[Pike, 2015] Rob Pike. "Go in Go." Gopherfest, 2015.
  https://go.dev/talks/2015/gogo.slide
  编译器由 C 自动翻译为 Go 的动机与过程。
- <a id="ref-randall-2015"></a>[Randall, 2015] Keith Randall. "New SSA Backend for the Go Compiler." 2015.
  https://go.dev/s/go17ssa
  SSA 后端的提案：分阶段转换，先替换后端。
- <a id="ref-thompson-2008"></a>[Thompson, 2008] Ken Thompson. SVN=114202. Go commit cb87526ce3, 2008.
  https://github.com/golang/go/commit/cb87526ce3
  最初的 gc 编译器源码，位于 `src/c`。
- <a id="ref-van-dijk-2011"></a>[van Dijk, 2011] Luuk van Dijk. gc: inlining (disabled without -l). Go
  commit a62722bba4, 2011. https://golang.org/cl/5400043
  随 Go 1 发布。
- 本书 [2.3 调用约定与寄存器 ABI](../../part1overview/ch02asm/callconv.md)、
  [3.3 语言的自举](../../part1overview/ch03life/bootstrap.md)、
  [第 8 章 泛型](../../part2lang/ch08generics/readme.md)
  （[8.1 泛型设计的演进](../../part2lang/ch08generics/history.md)、
  [8.3 类型检查技术](../../part2lang/ch08generics/checker.md)、
  [8.4 泛型的未来](../../part2lang/ch08generics/future.md)）、[15.2 中间表示](./ssa.md)、
  [15.3 优化器](./optimize.md)。
