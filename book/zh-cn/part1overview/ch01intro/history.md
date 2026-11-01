---
weight: 1101
title: "1.1 编程语言的发展"
---

# 1.1 编程语言的发展

2007 年，Google 的构建工程师对一个大型 C++ 程序的编译过程做了测量：它由约 2000 个源文件组成，简单
拼接起来共 4.2 MB；而展开全部 `#include` 之后，送入编译器的文本超过 8 GB，源码中的每个字节平均膨胀
为约 2000 字节。这个程序在当时的分布式构建系统上需要 45 分钟才能构建完成。Rob Pike 在 2012 年的
文章《Go at Google》中引用了这组数据 [[Pike, 2012a](#ref-pike-2012a)]。

膨胀的原因在于 `#include` 的工作方式：预处理器把头文件的全文原样插入，头文件又包含其他头文件，层层
嵌套。每个 `.cc` 文件都要把这些内容重新读入并解析一遍，一个常用的头文件在一次构建中会被处理成千上万次。

Go 正是在等待这类构建的过程中开始的。2007 年 9 月，Robert Griesemer、Rob Pike 与 Ken Thompson
在白板上写下了一门新语言的目标；2009 年 11 月，Go 开源 [[Cox et al., 2022](#ref-cox-et-al-2022)]；2012 年
3 月，Go 1 发布。本节讨论三个问题：他们当时试图解决哪些问题，三位设计者各自带来了哪些经验，以及贯穿 Go
设计的一项原则：语言的特性应当尽量少，每增加一项都必须证明其价值。

## 1.1.1 Go 要解决的问题

Pike 在《Go at Google》中明确指出，Go 是为解决 Google 在软件开发中遇到的问题而设计的；
其目的不是研究程序设计语言，而是改善设计者及其同事的工作环境，用 Pike 的话说，是「服务于软件工程的语言设
计」[[Pike, 2012a](#ref-pike-2012a)]。这些问题主要有三个。

**构建缓慢。** 原因如上所述。Go 的做法是：编译一个包时，编译器把该包对外公开的内容（类型、函数签名、
常量等）整理为一份摘要，写入编译结果；其他包导入它时只读取这份摘要，无须再次解析其源码
（[3.2](../ch03life/compile.md)）。此外，导入而未使用的包会导致编译错误，包之间也不允许循环导入，
依赖关系因而始终保持清晰，不会无节制地累积。

**并发编程困难。** Google 的服务程序运行在多核机器上，需要同时处理大量请求。用 C++ 编写这类程序只能
依靠线程与锁，代码冗长且容易出错。Go 把并发纳入了语言本身：`go` 语句启动一个 goroutine，channel 在
goroutine 之间传递数据（[1.3](./csp.md)）。

**语言过于复杂。** C++ 的特性众多且相互牵连，各个团队通常只使用其中的一个子集，而不同团队选用的子集又各不
相同。据 Pike 回忆，2007 年 9 月前后，自己手头一个大型 C++ 程序每次编译约需 45 分钟，其间去听了一场由 C++
标准委员会中的几位 Google 员工所作的报告，介绍当时称为 C++0x（即后来的 C++11）的新标准，一小时内讲到了约
35 项新特性。令 Pike（以及在 Pike 看来，Thompson 与 Griesemer）尤为不安的是其中带有原子类型的新内存模型：
在本已负担沉重的类型系统中规定如此细微的细节，并使语言与当时的硬件绑定过紧（Go 自己的内存模型见
[11.9](../../part3concurrency/ch11sync/mem.md)）。回到办公室后，Pike 开始了另一次编译，转身向 Griesemer
提出了一连串问题；编译尚未结束，他们已把 Thompson 拉了进来，决定着手设计一门新的语言
[[Pike, 2012b](#ref-pike-2012b)]。Thompson 也谈到，阅读 C++0x 的标准草案坚定了自己的决心（见本章首页的引
语）。

## 1.1.2 三位设计者

Ken Thompson 与 Dennis Ritchie 共同开发了 Unix [[Kernighan, 2019](#ref-kernighan-2019)]，C 语言的前身 B
语言也由 Thompson 设计。Rob Pike 在贝尔实验室参与了 Unix 的后继研究系统 Plan 9 的开发。1992 年，Thompson
与 Pike 共同设计了 UTF-8，它如今是网页上使用最广泛的字符编码。Pike 还参与设计了数种以 channel
为核心的语言 [[Pike, 1990](#ref-pike-1990)]（[1.3](./csp.md)）。Robert Griesemer
在苏黎世联邦理工学院（ETH Zürich）获得博士学位，Niklaus Wirth 正是在那里设计了 Pascal、Modula-2 与
Oberon；此后 Griesemer 参与过 Java 的 HotSpot 虚拟机与 Chrome 的 V8 JavaScript 引擎的开发。

Go 的官方 FAQ 这样概括 Go 的渊源：基本语法属于 C 语言一族；声明与包的设计大量借鉴了 Pascal、Modula、Oberon
一族；并发的思想则来自受 Hoare 的 CSP 启发的语言，如 Newsqueak 与 Limbo
[[Go Authors, 2026](#ref-go-authors-2026)]。这三个来源与三位设计者的经历大致对应
[[Donovan and Kernighan, 2015](#ref-donovan-kernighan-2015)]：

| 来源 | 在 Go 中的体现 |
| --- | --- |
| C | 花括号、表达式与运算符、指针（但不允许指针运算） |
| Pascal、Modula-2、Oberon | 名称在前、类型在后的声明；以包为单位编译；在声明处标明是否导出 |
| Newsqueak、Limbo 等 | `go` 语句、channel、`select` |

声明的写法最能体现 Oberon 一族的影响。C 的声明需要从名称出发，向左右两侧交替阅读。例如一个函数指针，
其所指函数的第一个参数又是一个函数指针，在 C 中写作：

```c
int (*fp)(int (*)(int, int), int);
```

在 Go 中，同样的声明可以从左到右顺序阅读：

```go
var fp func(func(int, int) int, int) int
```

Pike 2010 年的文章《Go's Declaration Syntax》专门讨论了这一选择 [[Pike, 2010](#ref-pike-2010)]。
导出规则体现了同样的思路：Oberon 在名称后加 `*` 表示导出，Go 改为以名称的首字母是否大写来区分。
二者都在声明处一目了然，无须另行维护一份导出清单。

## 1.1.3 少即是多

Pike 在 2012 年的演讲《Less is exponentially more》中阐述了 Go 的设计取向
[[Pike, 2012b](#ref-pike-2012b)]。标题中的「指数级」可以从特性之间的相互作用来理解：
语言的特性并非彼此独立，任意两项特性相遇，都可能需要一条专门的规则来规定其行为。以下三例，Go
程序员大多遇到过：

- **for 循环与闭包。** Go 1.22 之前，整个循环只有一个循环变量，循环体中的闭包与 goroutine 捕获的都是
  这同一个变量，往往只能观察到它的最后一个值。Go 1.22 改为每轮迭代创建一个新变量。
- **接口与 nil。** 当接口变量中存放的是一个值为 nil 的指针时，该接口变量本身并不等于 nil。
- **defer 与 panic。** 发生 panic 之后，已经注册的 defer 函数仍会执行；`recover` 只有在被 defer 的
  函数中直接调用时才起作用。

简单的计数即可说明特性为何应当少。12 项特性两两组合有 66 对，再增加 1 项，就多出 12 对；若把三项、
四项特性同时相互作用的情形也计算在内，组合的数目每增加一项特性便翻一倍。规范需要说明每一种组合，
编译器需要实现每一种组合，阅读代码的人需要记住每一种组合。因此，去掉一项特性，节省的远不止这项特性
本身。

下图把 12 项常见的 Go 特性画作圆周上的点，每两点之间连一条线。可以增减特性，观察连线数目的变化，
也可以逐一查看几对确实存在专门规则的特性组合。

<div class="viz" data-viz="lang-interactions"></div>

这一思想在 Go 之前已有人阐述。Fred Brooks 在 1986 年提出、1987 年发表的《没有银弹》（No Silver Bullet）
中，把软件开发的困难分为根本问题（essence）与次要问题（accident）两类：前者源于问题本身，
后者由工具与表达方式带来；高级语言等以往的进步所消除的都是后者 [[Brooks, 1987](#ref-brooks-1987)]。
特性之间的规则正属于次要问题，而且要由每一个使用这门语言的人承担。Tony Hoare 在 1980 年的图灵奖演讲中说
[[Hoare, 1981](#ref-hoare-1981)]：「构建软件设计的方法有两种：一种是把软件做得很简单，
以至于明显找不到缺陷；另一种是把它做得很复杂，以至于找不到明显的缺陷。第一种方法要难得多。」Wirth 在
1995 年的《A Plea for Lean Software》中援引 Martin Reiser 的观察：软件变慢的速度快于硬件变快的速度；Wirth
以自己与 Jürg Gutknecht 开发的 Oberon 系统作为反例：一个完整的操作系统连同编译器，
规模小到可以在一本书（《Project Oberon》）中从头到尾讲解清楚 [[Wirth, 1995](#ref-wirth-1995)]。

## 1.1.4 新特性必须证明其价值

泛型是最典型的例子。Russ Cox 在 2009 年的《The Generic Dilemma》中把当时的做法归纳为三条路线：不提供
泛型，由程序员编写重复的代码，C 即如此；为每种类型分别生成一份代码，代价是编译变慢、程序变大，C++
即如此；把所有值隐式地装箱，代价是运行变慢，Java 即如此。换言之，要在慢的程序员、慢的编译器与臃肿的
程序、慢的执行三者之间做出选择 [[Cox, 2009](#ref-cox-2009)]。

Go 1 没有泛型。直到 2022 年 3 月发布的 Go 1.18，泛型才加入语言，其实现采取了折中方案：底层表示相同的
类型（例如所有指针类型）共用一份代码，其余差异由调用时额外传入的一张字典补足
（[8.1](../../part2lang/ch08generics/history.md)）。从 2009 年开源算起，这一决定等待了十三年。

Go 刻意没有提供的特性还有：异常（错误是普通的返回值，[第 7 章](../../part2lang/ch07errors/readme.md)）、
类的继承（以接口与结构体嵌入代替）、运算符重载、数值类型之间的隐式转换。每一项都有其用处，也都会与
其他特性相互纠缠。

这一原则在后续章节中反复出现：goroutine 不能设置优先级
（[第 9 章](../../part3concurrency/ch09sched/readme.md)）；原子操作只提供一种语义，也是最易于推理的
一种（[11.9](../../part3concurrency/ch11sync/mem.md)）；垃圾回收器只有 `GOGC` 与 `GOMEMLIMIT` 两个
可调参数（[第 13 章](../../part4memory/ch13gc/readme.md)）。下一节介绍 Go 由哪几个部分组成。

## 延伸阅读

- <a id="ref-pike-2012a"></a>[Pike, 2012a] Rob Pike. "Go at Google: Language Design in the Service of
  Software Engineering." 2012. https://go.dev/talks/2012/splash.article
  Go 的工程动机；头文件膨胀的数据出自此处。
- <a id="ref-pike-2012b"></a>[Pike, 2012b] Rob Pike. "Less is exponentially more." 2012.
  https://commandcenter.blogspot.com/2012/06/less-is-exponentially-more.html
  「少即是多」这一说法在 Go 社区的出处，也记述了 Go 起步时的那场 C++0x 报告。
- <a id="ref-cox-et-al-2022"></a>[Cox et al., 2022] Russ Cox, Robert Griesemer, Rob Pike, Ian Lance
  Taylor, Ken Thompson. "The Go Programming Language and Environment." *Communications of the ACM*, 65(5):
  70–78, 2022. https://doi.org/10.1145/3488716
  Go 的设计者回顾哪些决定最终被证明是正确的。
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Frequently Asked Questions (FAQ)*,
  "Origins" 与 "Design" 两部分. https://go.dev/doc/faq
  Go 的渊源，以及若干「不做」的理由。
- <a id="ref-pike-2010"></a>[Pike, 2010] Rob Pike. "Go's Declaration Syntax." The Go Blog, 2010.
  https://go.dev/blog/declaration-syntax
  类型为何写在名称之后。
- <a id="ref-cox-2009"></a>[Cox, 2009] Russ Cox. "The Generic Dilemma." 2009.
  https://research.swtch.com/generic
  泛型的三条路线，以及每条路线的代价。
- <a id="ref-brooks-1987"></a>[Brooks, 1987] Frederick P. Brooks, Jr. "No Silver Bullet: Essence and
  Accidents of Software Engineering." *IEEE Computer*, 20(4): 10–19, 1987. 把软件开发的困难分为根本问题与
  次要问题两类。
- <a id="ref-hoare-1981"></a>[Hoare, 1981] C. A. R. Hoare. "The Emperor's Old Clothes." *Communications
  of the ACM*, 24(2): 75–83, 1981. Hoare 的图灵奖演讲，讲述语言设计中过度复杂的教训。
- <a id="ref-wirth-1995"></a>[Wirth, 1995] Niklaus Wirth. "A Plea for Lean Software." *IEEE Computer*,
  28(2): 64–68, 1995. 主张软件应当精简，以 Oberon 系统为例。
- <a id="ref-pike-1990"></a>[Pike, 1990] Rob Pike. "The Implementation of Newsqueak." *Software: Practice
  and Experience*, 20(7): 649–659, 1990. Pike 早年以 channel 为核心的语言，Go 的并发设计由此而来。
- <a id="ref-kernighan-2019"></a>[Kernighan, 2019] Brian W. Kernighan. *UNIX: A History and a Memoir*.
  Kindle Direct Publishing, 2019. 贝尔实验室与 Unix 的历史，Thompson 与 Pike 均在其中。
- <a id="ref-donovan-kernighan-2015"></a>[Donovan and Kernighan, 2015] Alan A. A. Donovan, Brian W.
  Kernighan. *The Go Programming Language*. Addison-Wesley, 2015. 前言中有一幅 Go 的源流图，
  与本节的表格相对应。

