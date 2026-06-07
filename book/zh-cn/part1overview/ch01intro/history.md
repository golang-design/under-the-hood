---
weight: 1101
title: "1.1 编程语言的发展"
---

# 1.1 编程语言的发展

要理解 Go 为什么长成今天这样，得先看它诞生时面对的是怎样一片语言版图，以及它想解决的是
谁的痛。Go 不是凭空设计的，它是一群经验丰富的系统程序员，对当时主流语言的不满与取舍的回应。

## 1.1.1 语言演化的几条主线

编程语言半个多世纪的演化，可粗略看作几股力量的拉锯。**抽象层级**不断抬升：从汇编到 C 的
过程抽象，到 C++/Java 的对象抽象，到函数式语言的高阶抽象。**安全性**不断增强：从 C 的手工
内存管理，到带垃圾回收的托管语言，消除了一大类内存错误。**并发模型**几经更替：从手工线程加锁，
到各种更高层的并发抽象。**类型系统**在"静态安全"与"灵活动态"之间反复摆动。每一门成功的语言，
都是在这些维度上做了一组**特定的取舍**,没有哪门语言能在所有维度上同时最优，这一点对理解 Go
尤其重要。

## 1.1.2 Go 诞生时的不满

Go 始于 2007 年 Google 内部，由 Robert Griesemer、Rob Pike、Ken Thompson 发起,这几位的
履历本身就说明了 Go 的基因（Unix、Plan 9、UTF-8、C 的源头）。促使他们动手的，是大规模 C++
服务端开发的几桩具体痛苦：

- **编译慢得令人发指**：庞大的 C++ 代码库因头文件的传递依赖，一次构建动辄数十分钟,开发的
  反馈循环被拖垮。Go 后来对编译速度近乎偏执的重视，根源就在这里。
- **依赖管理混乱**：`#include` 的文本包含模型让依赖关系不清不楚、重复编译。Go 的包模型与
  "未使用的导入即报错"正是反其道而行。
- **并发难写**：C++ 的并发要靠线程库加手工锁，既危险又啰嗦,而 Google 的服务端程序本质上
  高度并发。Go 把并发做成语言的一等公民（`go`、channel）。
- **语言过于庞杂**：C++ 特性繁多、相互交织，团队成员对"该用语言的哪个子集"都难有共识。Go
  刻意求简。

## 1.1.3 一种"少即是多"的回应

Go 的回应，可以概括为一种刻意的**克制**。它选择了：编译为本地码、带垃圾回收、静态类型;
一套极简的语法（关键字少到能背下来）;以 CSP（[1.3](./csp.md)）为蓝本的并发;以组合而非继承
为骨架的类型系统（[4.2](../../part2lang/ch04type/interface.md)）;以及对工具链与构建速度的高度
重视。它**有意不要**的东西同样醒目：很长时间没有泛型（直到 2022，见
[8 泛型](../../part2lang/ch08generics)）、没有异常（[7 错误处理](../../part2lang/ch07errors)）、
没有继承、没有运算符重载。

这种"用减法做设计"的取向，是贯穿全书的主线。Go 反复在"特性的表达力"与"语言的简单、可读、
可维护、编译快"之间，选择后者。理解了它诞生时的不满，就理解了它为何如此克制,本书后面对
调度器、内存模型、泛型等的剖析，都是这种取舍在各个角落的具体展开。

## 延伸阅读的文献

1. Rob Pike. *Go at Google: Language Design in the Service of Software Engineering.* 2012.
   https://go.dev/talks/2012/splash.article
2. The Go Authors. *Frequently Asked Questions (FAQ)：Origins / Design.*
   https://go.dev/doc/faq
3. Andrew Gerrand, Rob Pike, et al. *The Go Programming Language*（设计动机的多处自述）.
4. Brian W. Kernighan. *Unix: A History and a Memoir.* 2019（Go 设计者的 Unix/Plan 9 渊源背景）.

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
