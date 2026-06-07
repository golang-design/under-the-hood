---
weight: 1509
title: "5.9 内存一致模型"
---

# 5.9 内存一致模型

> 本节内容对标 Go 1.26。Go 的内存模型在 2022 年随 Go 1.19 经历过一次重要修订，
> 本节在讨论当前模型的同时，会专门交代这次修订的来龙去脉（见 [5.9.7](#597-设计的演进)）。

在前面讨论 Go 运行时与编译器的章节里，本书一直回避了一个问题：当两个 Goroutine
同时读写同一个变量时，究竟谁能观察到谁的写入。这个问题的答案并不取决于源代码中语句的
书写顺序，而取决于一份横跨「程序语言、操作系统、硬件」三方的契约。这份契约就是
**内存模型（Memory Model）**。作为第 5 章的收尾，本节把前面各类同步原语背后那条
隐而未言的主线，即内存一致性，补充完整。

## 5.9.1 问题的提出

先看一段几乎出现在所有并发教材中的程序。两个 Goroutine 共享 `data` 与 `done`，
一个负责生产，一个负责消费：

```go
var data int
var done bool

func producer() {
	data = 42      // (1)
	done = true    // (2)
}

func consumer() {
	for !done {    // (3)
	}
	print(data)    // (4)
}
```

按照直觉，只要 `consumer` 观察到 `done == true`，它就应当读到 `data == 42`，
因为在源代码中 (1) 写在 (2) 之前。然而该程序并不保证打印 42，甚至可能永远不退出循环。
其根源在于，从书写源代码到 CPU 真正执行，中间至少经过三层会对内存访问进行**重排序**的优化。

{{< mermaid >}}
flowchart LR
    SRC["源代码顺序<br/>(1) data=42<br/>(2) done=true"] -->|"编译器优化<br/>指令重排"| C["编译后顺序"]
    C -->|"CPU 乱序执行<br/>out-of-order"| P["流水线提交顺序"]
    P -->|"存储缓冲 / 缓存<br/>store buffer"| M["其他核心可见顺序"]
    M --> OBS["consumer 观察到的顺序<br/>可能先看到 done<br/>再看到旧的 data"]
{{< /mermaid >}}

第一层是**编译器**。在不改变单 Goroutine 语义的前提下，编译器可以自由重排没有依赖关系的
读写，既可能把对 `done` 的写入提到 `data` 之前，也可能把循环中对 `done` 的读取提升
（hoist）到循环之外，从而使循环永不终止。第二层是 **CPU 的乱序执行**。现代处理器以乱序
方式发射指令，仅保证单核视角下的数据依赖关系。第三层是**存储缓冲与缓存**。一个核心的写入
会先停留在它私有的 store buffer 或缓存中，对其他核心变得可见的时机由缓存一致性协议决定，
未必与写入发生的先后一致。

需要强调的是，这些优化对**单线程**程序完全透明，它们的全部合法性都建立在「不改变单线程
可观测行为」这一前提之上。一旦引入第二个 Goroutine，「可观测行为」就需要一份跨线程的规则
重新界定。内存模型正是这份规则，它精确回答「一个 Goroutine 的写入在什么条件下保证能被
另一个 Goroutine 的读取观察到」。

内存模型的强弱有着深远的工程后果。模型越强（越接近源代码顺序），程序员越容易推理，
但留给编译器与硬件的优化空间越小，性能上限越低；模型越弱，性能潜力越大，正确性推理
越困难。兼容性的约束则更为刚性：一个选择了强模型的硬件体系结构，无法在不破坏既有程序的
前提下退回更弱的模型。正因如此，内存模型的设计至今仍是活跃的研究课题。

## 5.9.2 一致性模型的谱系

在讨论 Go 的选择之前，需要先建立坐标系。并行系统的一致性模型构成一条从强到弱的谱系，
理解这条谱系，才能理解 Go 把自身定位在何处，以及为什么。

{{< mermaid >}}
flowchart TD
    L["线性一致性 Linearizability<br/>读到最近写入 + 全局实时序"] --> S["顺序一致性 Sequential Consistency<br/>存在某个全局交错顺序<br/>各线程内保持程序序"]
    S --> C["因果一致性 Causal<br/>仅保证有因果关系的操作有序"]
    C --> E["最终一致性 Eventual<br/>仅保证最终可见，不约束时间"]
    L:::strong
    E:::weak
    classDef strong fill:#e8f0fe,stroke:#1a73e8;
    classDef weak fill:#fce8e6,stroke:#d93025;
{{< /mermaid >}}

**线性一致性（Linearizability）**又称强一致性或原子一致性。它要求每次读都能读到该变量
最近一次写入的值，并且所有操作存在一个与真实物理时间（全局时钟）一致的全序。
它最符合直觉，但全局时钟在分布式与多核场景下代价极高甚至不可实现，这正是人们不断研究
更弱一致性的动机。

**顺序一致性（Sequential Consistency, SC）**由 Lamport 于 1979 年提出，是本节的核心概念。
它放松了对全局物理时钟的要求，只要求存在某一个把所有线程操作交错起来的全序，
并满足两个条件：其一，每个线程内部的操作在该全序中保持其程序顺序；其二，每次读返回该全序
中最近一次写入的值。直观上，顺序一致性等价于「所有 Goroutine 像被复用到一颗单核处理器上
轮流执行」。需要注意，它并不要求这个全序与真实时间一致。

{{< mermaid >}}
sequenceDiagram
    participant G1
    participant G2
    Note over G1,G2: 顺序一致：存在一个合法全序解释所有读返回值
    G2->>G2: x = 2
    G1->>G1: x = 1
    G1->>G1: x = 3
    G1->>G1: r = x   (读到 3)
    Note over G1,G2: G2 的 x=2 只需排在 x=3 之前即可<br/>它与 x=1 之间无顺序保证
{{< /mermaid >}}

**因果一致性（Causal Consistency）**进一步放松要求，只有存在**因果依赖**的操作才需要保序，
没有因果关系的并发操作可以被不同观察者看到不同的顺序。

**最终一致性（Eventual Consistency）**是其中最弱的一种，它只保证写入「终将」被观察到，
不约束具体时间。这一模型常见于分布式存储，可进一步加以增强（例如约定有界延迟），
但已超出本节范围。

整条谱系体现的是同一个权衡：越靠近强端，推理越简单，优化越受限；越靠近弱端，则相反。
任何语言的内存模型，本质上都是在这条线上选定一个位置，并配套一组规则，告诉用户在什么前提下
可以享受到更强的保证。

## 5.9.3 弱序与免数据竞争

多数现代硬件并不直接提供顺序一致性，因为代价过高。它们提供的是**弱序（Weak Ordering）**：
默认情况下普通读写可以被自由重排，只有当程序显式使用同步操作（内存屏障、原子指令）时，
硬件才保证这些同步点之间的顺序。Adve 与 Hill（1990）给出了弱序的经典定义：当且仅当硬件
对所有遵守同步约定的软件都表现为顺序一致时，称该硬件相对于这套同步模型是弱序的。

这一定义点出了现代内存模型的核心思想，即把「保证顺序一致」的责任在软硬件与程序员之间
做一次交易：

> 硬件与编译器承诺：只要程序**没有数据竞争**，就让它表现得**如同顺序一致**。
> 作为交换，对于**存在**数据竞争的程序，不做承诺，或只做有限承诺。

这就是 **DRF-SC（Data-Race-Free ⇒ Sequential Consistency）**契约。其关键在于精确定义
「数据竞争」：

> **数据竞争**指对同一内存位置存在两个并发访问，其中至少一个是写，
> 且它们之间没有通过同步操作建立顺序。

由此，程序员的义务变得清晰：消除数据竞争。只要做到这一点，就可以完全忽略编译器与 CPU 的
一切重排序，按「单核顺序执行」来推理程序。这正是绝大多数程序员唯一需要掌握的心智模型。
DRF-SC 把「理解复杂的弱内存模型」这一难题，转化为「避免数据竞争」这一相对容易、
且可被工具检测的问题。

## 5.9.4 Go 的内存模型：发生序

Go 选择站在 DRF-SC 一侧。它的内存模型在形式化上紧随 Boehm 与 Adve 在 PLDI 2008 提出的
C++ 并发内存模型框架，其「无数据竞争程序保证顺序一致」的结论与该工作等价。下面给出
Go 1.26 模型的骨架。

模型把程序执行看作若干 **Goroutine 执行**的集合，每个 Goroutine 执行又是一组**内存操作**。
内存操作分为读型（普通读、原子读、加锁、通道接收）、写型（普通写、原子写、解锁、
通道发送与关闭）以及读写型（如原子 CAS）。模型在这些操作之上定义了三个偏序关系。

{{< mermaid >}}
flowchart TD
    SB["sequenced before（程序序）<br/>同一 Goroutine 内由语言规范<br/>规定的控制流与求值顺序"] --> HB
    SYB["synchronized before（同步序）<br/>由映射 W 导出：若同步读 r 观察到<br/>同步写 w，则 w 同步先于 r"] --> HB
    HB["happens before（发生序）<br/>= (sequenced before ∪ synchronized before) 的传递闭包"]
{{< /mermaid >}}

**sequenced before（程序序）**指同一个 Goroutine 内部，由 Go 语言规范为控制流结构与
表达式求值规定的偏序，它只约束单个 Goroutine。**synchronized before（同步序）**则引入
一个映射 `W`，为每个读型操作指定它实际读自哪个写型操作；当一个同步读 `r` 观察到同步写 `w`
（即 `W(r) = w`）时，称 `w` 同步先于 `r`。模型同时要求这些同步操作能被某个隐含的全序解释，
这正是把顺序一致性注入模型的关键所在。**happens before（发生序）**定义为前两者并集的
**传递闭包**，它是跨 Goroutine 推理可见性的唯一依据。

可见性的判定（模型中的 Requirement 3）由此而来。对一个普通读 `r`（读位置 `x`），
它能读到的写 `w` 必须对 `r` **可见**，即同时满足：

1. `w` happens before `r`；
2. 不存在另一个对 `x` 的写 `w'`，使得 `w` happens before `w'` happens before `r`。

换言之，读到的必须是在发生序上最近、且未被更晚的写覆盖的那个写入。当对 `x` 不存在数据竞争时，
这样的 `w` 唯一确定。可以进一步证明（证明同 Boehm-Adve 论文第 7 节），任何无数据竞争的
Go 程序，其所有可能结果都能由某个顺序一致的交错执行解释。这就是 Go 对用户的根本承诺，
即 DRF-SC。

> 形式上，happens before 是一个严格偏序，满足反自反（任何事件不发生于自身之前）、
> 反对称与传递三条性质。两个互不发生于对方之前的事件称为**并发（concurrent）**。
> 这套偏序框架可追溯到 Lamport 于 1978 年关于分布式系统中事件时序的奠基性工作。

## 5.9.5 同步如何建立发生序

发生序不会凭空出现，它只能由同步操作建立。下表汇总了 Go 1.26 中各同步原语提供的
synchronized before 保证（记 `A ⤳ B` 表示 A 同步先于 B）。这些就是用户真正需要记住的
全部规则。

| 同步机制 | 建立的同步序 |
| --- | --- |
| 包初始化 | 被导入包 `q` 的 `init` 完成 ⤳ 导入方 `p` 的 `init` 开始；所有 `init` 完成 ⤳ `main.main` 开始 |
| Goroutine 创建 | `go` 语句 ⤳ 新 Goroutine 开始执行 |
| Goroutine 退出 | 不提供任何同步序（退出本身不可被依赖） |
| 通道发送与接收 | 一次发送 ⤳ 对应接收的**完成** |
| 通道关闭 | `close(ch)` ⤳ 因关闭而返回零值的接收 |
| 无缓冲通道接收 | 一次接收 ⤳ 对应发送的**完成** |
| 容量为 C 的缓冲通道 | 第 k 次接收 ⤳ 第 k+C 次发送的完成 |
| 互斥锁 | 第 n 次 `Unlock` ⤳ 第 m 次 `Lock` 返回（n < m） |
| `sync.Once` | `once.Do(f)` 中 `f()` 的完成 ⤳ 任意 `once.Do(f)` 的返回 |
| 原子操作 | 若原子操作 A 的效果被 B 观察到，则 A ⤳ B；且所有原子操作存在一个顺序一致的全序 |

其中有几条规则最值得留意。

**Goroutine 创建与销毁的不对称。** `go` 语句同步先于新 Goroutine 启动，因此子 Goroutine
能安全地观察到父 Goroutine 在 `go` 之前写入的一切。但反过来并不成立，Goroutine 的退出
不建立任何同步序。在下面这段代码中，对 `a` 的写入没有任何后续同步事件，因此不保证被 `main`
观察到，一个激进的编译器甚至可以把整个 `go` 语句删除：

```go
func hello() {
	go func() { a = "hello" }() // 无同步序回到 main
	print(a)                    // 不保证看到 "hello"
}
```

**通道是 Go 推荐的主同步手段。** 回到 5.9.1 那个会出错的例子，只要把「标志位轮询」
换成「通道收发」，发生序便立即建立。

{{< mermaid >}}
sequenceDiagram
    participant P as producer Goroutine
    participant C as consumer (main)
    P->>P: data = 42  (sequenced before)
    P->>C: c <- 0     (send ⤳ receive 完成)
    C->>C: <-c        (receive 完成)
    C->>C: print(data)  保证看到 42
    Note over P,C: data=42 ⤳ send ⤳ receive ⤳ print，传递闭包成立
{{< /mermaid >}}

```go
var c = make(chan int)
var data int

func producer() {
	data = 42
	c <- 0          // 发送
}
func main() {
	go producer()
	<-c             // 接收：与上面的写入建立 happens-before
	print(data)     // 保证打印 42
}
```

缓冲通道的「第 k 次接收 ⤳ 第 k+C 次发送」规则还能把一个容量为 C 的缓冲通道当作
**计数信号量**使用，发送获取、接收释放，是限制并发度的常见惯用法。

**原子操作是顺序一致的。** 这是 5.9.7 将讨论的 2022 年修订的重点。Go 把 `sync/atomic`
的全部操作定义为**顺序一致原子**：所有原子操作存在一个统一的全序，其语义等同于 C++ 的
SC 原子与 Java 的 `volatile`。这意味着 Go 并未暴露 C++ 那样的弱序（relaxed/acquire/release）
原子，这是一处刻意的简化，详见 [5.9.8](#598-工程权衡与忠告)。

## 5.9.6 当竞争发生：实现的边界

DRF-SC 只对无竞争程序承诺顺序一致。那么含竞争的程序会怎样？这恰恰是 Go 与 C/C++ 分道扬镳
之处，也体现了 Go「让出错的程序也尽量可调试」的工程价值观。

在 C/C++ 中，数据竞争属于**未定义行为（UB）**，编译器可以做任何事。Go 不接受这一立场。
它对含竞争的程序仍施加实现层面的约束，使其行为更接近 Java 与 JavaScript。具体而言：

- 实现可以在检测到竞争时直接报告并终止程序（`go build -race` 下的 ThreadSanitizer
  正是如此）；
- 否则，对一个不大于机器字长的内存位置的读，必须返回某个先于或并发于它、且未被覆盖的
  真实写入值，不会凭空出现一个从未被写入的值（**禁止 out-of-thin-air**）。

但对大于机器字长的多字结构（接口、切片、字符串、map 等内部的 (指针, 长度) 或
(指针, 类型) 对），实现可以把读写拆成若干机器字、以未定义顺序进行。于是这类数据上的竞争
可能撕裂出不自洽的值，即一个不对应任何单次写入的 (指针, 类型) 组合，进而导致任意的内存损坏。
这就是为什么对接口、切片、map 的竞争远比对 `int` 的竞争危险。

下面这个经典反例说明，竞争一旦发生，连「看到较新的值就能推出也看到更早的值」这种朴素直觉
都会失效。`g` 完全可能先打印 `2` 再打印 `0`：

```go
var a, b int
func f() { a = 1; b = 2 }
func g() { print(b); print(a) } // 可能输出 2 然后 0
```

这也一举否定了若干看似聪明的惯用法，其中最著名的是**双重检查锁定（double-checked locking）**，
以及用一个普通 `bool` 标志位替代真正的同步，它们在弱内存模型下都是错误的。

## 5.9.7 设计的演进

Go 的内存模型并非一蹴而就。理解它如何走到今天，比记住今天的条文更有价值。

**2009 至 2012 年的初版。** 最早的 Go 内存模型文档（与语言规范同期）只引入了单一的
happens before 关系，配以 init、goroutine、channel、mutex、once 等几条规则。它在精神上
是正确的，也足够简单，但留下了几个长期未决的缺口。其一，原子操作的语义未定义，`sync/atomic`
长期处于「文档不愿正式承诺其内存序」的状态，早期文档甚至建议不要依赖 atomic 进行同步，
这让需要无锁数据结构的库作者无所适从，他们事实上依赖着一份没有白纸黑字的契约。其二，
形式化不足，单凭一个 happens before 关系，难以严谨刻画「有竞争时会发生什么」，
也难以与硬件和编译器的实际行为对齐，文档中甚至出现过可见性方面的细节缺陷。其三，
一些自然的写法（如双重检查锁定）究竟是否合法，缺乏可据以判断的明确语义。

**2021 年的理论盘点。** Russ Cox 发表了三篇《Memory Models》系列长文，分别是
《Hardware Memory Models》《Programming Language Memory Models》
《Updating the Go Memory Model》，系统梳理了硬件与各语言（C/C++、Java）内存模型的历史
与教训，并公开讨论了 Go 应当如何修订。与之配套的是提案 golang/go#50590。

**2022 年（Go 1.19）的正式修订。** 这是 Go 内存模型最重要的一次更新，文档版本标注为
「Version of June 6, 2022」，随 Go 1.19 发布。

{{< mermaid >}}
flowchart LR
    OLD["初版模型 (2009-2012)<br/>单一 happens-before<br/>原子语义未定义<br/>形式化薄弱"]
    OLD -->|"Russ Cox《Memory Models》<br/>三部曲 + 提案 #50590"| NEW
    NEW["修订模型 (Go 1.19, 2022)<br/>sequenced/synchronized before<br/>+ 映射 W<br/>形式化对齐 Boehm-Adve<br/>原子 = 顺序一致<br/>新增类型化原子 API"]
{{< /mermaid >}}

修订包含三方面内容。第一，重构词汇与形式化，把单一的 happens before 拆为
*sequenced before*（程序序）与 *synchronized before*（同步序），happens before 成为
二者并集的传递闭包；整体形式化对齐 Boehm-Adve 的 C++ 框架，明确以 DRF-SC 为目标，
并显式声明意图与 C、C++、Java、JavaScript、Rust、Swift 的 DRF-SC 保证一致。第二，
正式定义原子操作的内存序，明确 `sync/atomic` 为顺序一致原子，语义等同 C++ SC 原子与
Java 的 `volatile`，库作者由此获得了可依赖的明确契约。第三，新增类型化原子 API
（Go 1.19，提案 #50860），即 `atomic.Int32/Int64/Uint32/Uint64/Bool/Pointer[T]/
Uintptr/Value`。它们把「该字段需要原子访问」编码进类型，既避免了裸用
`atomic.AddInt64(&x, …)` 时容易在某处遗漏普通访问的隐患，也保证了正确的内存对齐，
是 API 设计与内存模型协同演进的一个范例。

值得强调的是，这次修订并未改变 Go 程序的可观测行为，也没有放宽或收紧对用户的承诺。
它是一次把一直以来隐含遵守的契约写成严谨且可验证条文的工作，这恰好契合本书的主题：
实现会变，但被显式化的设计原理得以沉淀。

## 5.9.8 工程权衡与忠告

Go 内存模型最能体现其设计哲学的一处取舍，是只暴露顺序一致原子，而不暴露弱序原子。
C++ 提供了 `memory_order_relaxed/acquire/release/seq_cst` 一整套精细档位，能榨取硬件性能，
但也把「理解弱内存模型」这一难题直接交给了应用开发者，极易出错。Go 的判断是，对绝大多数
程序，SC 原子的性能已经足够，而它带来的可推理性远比那一点峰值性能重要。这与 Go 在调度、
垃圾回收等处一以贯之的价值观相同：用可控的性能让渡，换取语义的简单与正确。性能提升从不
凭空出现，它总伴随复杂度的上升，Go 选择把这份复杂度挡在语言之外。

因此，Go 对用户的忠告可以浓缩为内存模型文档开篇的那句话：

> 如果你必须读完这份文档才能理解你的程序的行为，那么你就太自作聪明了。别自作聪明。

落到实践上只有一条：用同步原语消除数据竞争。优先使用通道，需要共享内存时使用 `sync` 与
`sync/atomic`，并以 `-race` 持续检测。做到这一点，就可以始终用最简单的「顺序一致」心智模型
推理并发程序，而把重排序的全部复杂性安全地留给编译器与硬件。

### 重排序沙盒（交互演示）

下面是一个可交互的小演示，用于直观感受 5.9.1 中「为什么 store buffer 会让 `done=true`
先于 `data=42` 被另一个核心看到」。它是对内存模型所允许结果的可视化模拟。由于 JavaScript
本身是顺序一致且单线程的，无法真正触发硬件重排序，故此处仅作示意。若运行环境不支持脚本，
可直接阅读上文的静态说明。

<div class="reorder-sandbox" style="border:1px solid #ccc;border-radius:8px;padding:12px;margin:12px 0;font-size:14px;">
  <div style="display:flex;gap:24px;flex-wrap:wrap;">
    <div>
      <strong>核心 1（producer）</strong>
      <pre style="margin:6px 0;">data = 42   进入 store buffer
done = true 尚未刷新到内存</pre>
    </div>
    <div>
      <strong>核心 2（consumer）</strong>
      <pre style="margin:6px 0;">while(!done){}
print(data)</pre>
    </div>
  </div>
  <div style="margin:8px 0;">
    <button type="button" class="rs-step" style="padding:4px 10px;">单步执行</button>
    <button type="button" class="rs-reset" style="padding:4px 10px;">重置</button>
  </div>
  <div class="rs-log" style="font-family:monospace;white-space:pre-wrap;background:#f6f8fa;padding:8px;border-radius:6px;min-height:6em;"></div>
</div>

<script>
(function () {
  document.querySelectorAll(".reorder-sandbox").forEach(function (box) {
    var log = box.querySelector(".rs-log");
    var steps = [
      "初始: 内存 data=0, done=false。",
      "核心1: 把 done=true 先刷出 store buffer（允许：与 data 写入无依赖）。",
      "核心2: 读到 done=true，跳出循环。",
      "核心2: 读 data。此刻 data=42 仍滞留在核心1的 store buffer，读到旧值 0。",
      "核心1: data=42 才刷新到内存，为时已晚。",
      "结论: 没有同步序时，consumer 打印了 0 而非 42。加一次通道收发即可避免。"
    ];
    var i = 0;
    function render() {
      log.textContent = steps.slice(0, i).map(function (s, k) {
        return (k + 1) + ". " + s;
      }).join("\n");
    }
    box.querySelector(".rs-step").addEventListener("click", function () {
      if (i < steps.length) { i++; render(); }
    });
    box.querySelector(".rs-reset").addEventListener("click", function () {
      i = 0; render();
    });
    render();
  });
})();
</script>

## 延伸阅读的文献

1. The Go Authors. *The Go Memory Model* (Version of June 6, 2022).
   https://go.dev/ref/mem
2. Russ Cox. *Memory Models* (series, 2021): *Hardware Memory Models*,
   *Programming Language Memory Models*, *Updating the Go Memory Model*.
   https://research.swtch.com/mm
3. Hans-J. Boehm and Sarita V. Adve. "Foundations of the C++ Concurrency Memory Model."
   *PLDI 2008*.（Go 内存模型形式化所依据的框架）
4. Leslie Lamport. "Time, Clocks, and the Ordering of Events in a Distributed System."
   *Communications of the ACM*, 21(7), 1978.（happens-before 偏序的源头）
5. Leslie Lamport. "How to Make a Multiprocessor Computer That Correctly Executes
   Multiprocess Programs." *IEEE Transactions on Computers*, C-28(9), 1979.
   （顺序一致性的定义）
6. Sarita V. Adve and Kourosh Gharachorloo. "Shared Memory Consistency Models:
   A Tutorial." *IEEE Computer*, 29(12), 1996.（一致性谱系的经典综述）
7. Sarita V. Adve and Mark D. Hill. "Weak Ordering: A New Definition."
   *ISCA 1990*.（弱序与 DRF 的定义）
8. Jeremy Manson, William Pugh, and Sarita V. Adve. "The Java Memory Model."
   *POPL 2005*.（DRF-SC 在主流语言中的奠基性实践）
9. Go proposal #50590: *Go Memory Model clarifications*；
   proposal #50860: *typed atomic types in sync/atomic*。

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
