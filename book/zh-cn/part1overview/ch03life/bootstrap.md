---
weight: 1303
title: "3.3 语言的自举"
---

# 3.3 语言的自举

一个问题听起来像悖论：Go 编译器本身是用 Go 写的,那第一个 Go 编译器是怎么来的？这就是**自举**
（bootstrapping）。理解它，既能澄清这个先有鸡还是先有蛋的困惑，也能看到 Go 工具链演化的一段
有趣历史。

## 3.3.1 先有蛋：从 C 到 Go

Go 工具链最初（到 **Go 1.4**）是用 **C** 写的,那是"蛋"。从 **Go 1.5（2015）**起，Go 完成了一次
里程碑式的转变：**用 Go 重写了整个编译器与运行时**，实现了**自举**,从此 Go 是用 Go 写的。
这次转变意义重大：它让编译器开发者能用 Go 这门更安全、更现代的语言来维护工具链，也证明了 Go
有能力胜任系统级软件。Go 1.4 因此成为一个特殊的历史节点,很长一段时间，它是构建后续版本所
需的"C 写的起点"。

## 3.3.2 自举链：用旧 Go 编译新 Go

自举之后，构建一个新版 Go 不再需要 C，而是需要一个**较旧的、已能运行的 Go 工具链**作为
"引导编译器"（`cmd/dist` 里的 `buildtool` 负责这件事）：用旧 Go 把新 Go 的编译器源码编译出来，
再用这个新编译器去编译完整的新工具链与标准库。这是一条**自举链**：每个版本踩在前一个（或前
几个）版本的肩膀上。

随着 Go 用上越来越新的语言特性来写自己，引导所需的最低 Go 版本也**逐步抬升**：曾经只需 Go 1.4，
后来要求 Go 1.17.13、再到 Go 1.20.x、Go 1.22.x……每次抬升，都是因为新版工具链的源码用到了
某个更新版本才有的特性（如泛型）。这条不断上移的引导版本线，本身就是 Go 语言自我演化的一份
侧写。

## 3.3.3 自举为何重要

自举不只是一个技术趣闻，它有实在的工程意义。**它是语言成熟的标志**:一门语言能用自己实现自己，
说明它足以胜任严肃的系统编程。**它统一了开发体验**:工具链开发者和普通用户用的是同一门语言、
同一套工具，编译器的 bug 能用 Go 的调试与测试手段去查。**它也带来一个责任**:工具链必须保持
可被合理旧版本引导，不能随意依赖太新的特性，否则会让"从源码构建 Go"变得困难,这是一种对
下游构建者的体贴。从用 C 写的"蛋"，到用 Go 写的、不断自我引导的工具链，这段自举史是 Go
"用自己证明自己"的最佳注脚。

## 延伸阅读的文献

1. The Go Authors. *Go 1.5 Release Notes*（编译器/运行时用 Go 重写，实现自举）.
   https://go.dev/doc/go1.5
2. Russ Cox. *Go 1.3+ Compiler Overhaul / Go 1.5 bootstrap plan.*
   https://go.googlesource.com/proposal/+/master/design/go13compiler.md
3. The Go Authors. *Installing Go from source / Bootstrap toolchain.*
   https://go.dev/doc/install/source
4. The Go Authors. *cmd/dist/buildtool.go*（引导构建逻辑）.
   https://github.com/golang/go/blob/master/src/cmd/dist/buildtool.go

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
