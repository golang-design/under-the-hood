---
weight: 1509
title: "5.9 内存一致模型"
---

# 5.9 内存一致模型

> 本节内容对标 Go 1.26。Go 的内存模型在 2022 年随 Go 1.19 做过一次重要修订，
> 我们会在讲清当前模型之后，回过头来交代这次修订的来龙去脉（见 [5.9.7](#597-设计的演进)）。

读者或许已经注意到，前面无论是谈论 Go 的运行时还是编译器，我们都在有意无意地绕开一个话题：
Go 的「内存模型」。绕开它是有原因的，要把这个话题讲清楚，得先有并发、同步原语乃至硬件层面的
诸多铺垫。如今铺垫已经备齐，作为第 5 章的收尾，也是全书对 Go 同步原语与同步模式的一次小结，
我们在这里把它展开，回答读者心里那个一直悬着的问题：当两个 Goroutine 同时读写同一个变量，
一个 Goroutine 的写入，究竟在什么条件下才保证被另一个看到？

这个问题的答案，并不写在源代码的语句顺序里。决定它的是一份横跨「程序语言、操作系统、硬件」
三方的契约，我们称之为**内存模型（Memory Model）**。第 5 章介绍的各类同步原语，
其正确性都立足于此。

## 5.9.1 问题的提出

先看一段并发教材里的常客。两个 Goroutine 共享 `data` 与 `done`，一个负责生产，一个负责消费：

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

源代码里 (1) 写在 (2) 前面，于是读者大概会和大多数人一样判断：只要 `consumer` 看到
`done == true`，它读到的 `data` 就该是 42。遗憾的是，这段程序并不保证打印 42，
有时甚至会卡在循环里出不来。问题出在哪？从我们写下的源代码到 CPU 真正执行，
内存访问要穿过三层会把顺序打乱的优化。

{{< mermaid >}}
flowchart LR
    SRC["源代码顺序<br/>(1) data=42<br/>(2) done=true"] -->|"编译器优化<br/>指令重排"| C["编译后顺序"]
    C -->|"CPU 乱序执行<br/>out-of-order"| P["流水线提交顺序"]
    P -->|"存储缓冲 / 缓存<br/>store buffer"| M["其他核心可见顺序"]
    M --> OBS["consumer 观察到的顺序<br/>可能先看到 done<br/>再看到旧的 data"]
{{< /mermaid >}}

第一层是编译器。只要不改变单个 Goroutine 自己看到的行为，编译器就有权重排没有依赖关系的
读写。它可以把对 `done` 的写入挪到 `data` 之前，也可以把循环里对 `done` 的读取提到循环外
（即所谓的提升，hoist），后者会让 `consumer` 永远读着同一个寄存器里的旧值，循环不再终止。
第二层是 CPU 的乱序执行，处理器按乱序发射指令，只为单个核心维持它自己看得见的数据依赖。
第三层来自存储缓冲与缓存，一个核心写出的值会先躺在它私有的 store buffer 里，
什么时候让别的核心看见，由缓存一致性协议说了算，和写入的先后并不一一对应。

这三层优化有一个共同的底线：它们都保证单线程程序的可观测行为不变，全部把戏都建立在这条底线上。
可一旦来了第二个 Goroutine，「可观测行为」该怎么算，就得有一份跨线程的规则来说清楚。
内存模型正是这份规则，它规定了一个 Goroutine 的写入，在什么条件下保证被另一个 Goroutine
的读取看到。

这份规则的松紧，关乎的不只是对错，还有性能与可移植性。规则定得紧，贴近源代码顺序，
程序员推理起来省心，可留给编译器和硬件的腾挪空间也随之收窄，性能的天花板被压低；
规则定得松，性能潜力释放出来，正确推理的担子却压回到程序员肩上。更麻烦的是兼容性：
一种硬件体系结构一旦选了紧的模型，就很难在不弄坏已有程序的前提下退回到松的模型。
正因如此，内存模型怎么设计，至今仍是学界与工业界都在琢磨的开放问题。

## 5.9.2 一致性模型的谱系

在看 Go 怎么选之前，我们先把可供选择的坐标系铺开。并行系统的一致性模型从强到弱排成一条谱系，
看清这条谱系，才好理解 Go 把自己安放在哪里，以及为什么这么放。

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

谱系最强的一端是**线性一致性（Linearizability）**，也叫强一致性或原子一致性。它要求每次读都
返回该变量最近一次写入的值，并且所有操作能排进一个与真实物理时间（全局时钟）吻合的全序。
它最贴合直觉，代价却是那个全局时钟，在分布式与多核场景下，实现它的开销高得让人却步，
有时根本无从实现。人们研究更弱的一致性，动力多半就来自这里。

往下一格是**顺序一致性（Sequential Consistency, SC）**，由 Lamport 在 1979 年提出，
也是我们这一节真正要倚重的概念。它松开了全局物理时钟这条绳子，只要求存在某一个把各线程操作
交错起来的全序，并满足两点：一是每个线程内部的操作在这个全序里仍按程序顺序排列，
二是每次读都返回这个全序里最近一次写入的值。换个更亲切的说法，顺序一致就好比所有 Goroutine
被运行时塞进一颗单核 CPU 里轮流跑。要紧的是，这个全序和真实时间没有关系。

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

再松一格是**因果一致性（Causal Consistency）**，它只为有因果依赖的操作保序；至于互不相干的
并发操作，不同观察者看到不同顺序也无妨。谱系最弱的一端是**最终一致性（Eventual Consistency）**，
它只承诺写入终究会被看到，却不许诺什么时候。分布式存储常落在这一档，工程上还能给它加一道
有界延迟之类的约束，不过那已经离我们的话题有些远了。

整条谱系，说到底是同一笔权衡的两面：越往强端走，推理越轻松，优化越受限；越往弱端走，
则反过来。任何一门语言的内存模型，都是在这条线上挑一个点站定，再配一套规则，
告诉用户在什么前提下能享受到更强的保证。

## 5.9.3 弱序与免数据竞争

现实里的多数硬件并不直接交付顺序一致，因为太贵。它们交付的是**弱序（Weak Ordering）**：
普通读写默认可以随意重排，只有当程序明确用上同步操作（内存屏障、原子指令），硬件才保证
这些同步点之间的先后。Adve 与 Hill 在 1990 年给过弱序一个经典定义：当硬件对所有守规矩、
按约定使用同步的软件都表现得顺序一致时，就称这套硬件相对于该同步约定是弱序的。

这个定义点破了现代内存模型的核心思路，把「保证顺序一致」这件苦差事，在软硬件与程序员之间
做了一笔交易：

> 硬件与编译器许诺：只要你的程序**没有数据竞争**，我就让它跑得**如同顺序一致**。
> 作为交换，对于**存在**数据竞争的程序，我什么都不保证，或只给有限的保证。

这就是大名鼎鼎的 **DRF-SC（Data-Race-Free ⇒ Sequential Consistency）**契约。这笔交易能否
谈拢，全看「数据竞争」这个词定义得够不够死：

> **数据竞争**指对同一内存位置存在两个并发访问，其中至少一个是写，
> 且二者之间没有靠同步操作建立起先后。

交易一旦成立，程序员要做的事就清爽了：消除数据竞争。做到了，你就可以把编译器和 CPU 的种种
重排序统统抛到脑后，安心按「单核顺序执行」来推理自己的程序。这正是绝大多数程序员唯一需要
随身携带的心智模型。DRF-SC 的高明之处，是把「读懂复杂的弱内存模型」这桩难事，
换成了「别写出数据竞争」这桩相对容易、而且能交给工具去查的事。

## 5.9.4 Go 的内存模型：发生序

Go 站在 DRF-SC 这一边。它的内存模型在形式化上紧贴 Boehm 与 Adve 在 PLDI 2008 提出的 C++
并发内存模型框架，「无数据竞争的程序保证顺序一致」这一结论，与那篇工作是等价的。
我们把 Go 1.26 模型的骨架拆开来看。

模型把一次程序执行看作若干 **Goroutine 执行**的集合，每个 Goroutine 执行又是一串**内存操作**。
内存操作分三类：读型（普通读、原子读、加锁、通道接收）、写型（普通写、原子写、解锁、
通道发送与关闭），以及又读又写型（例如原子 CAS）。模型在这些操作之上立了三个偏序关系，
这是整套理论的脚手架：

{{< mermaid >}}
flowchart TD
    SB["sequenced before（程序序）<br/>同一 Goroutine 内由语言规范<br/>规定的控制流与求值顺序"] --> HB
    SYB["synchronized before（同步序）<br/>由映射 W 导出：若同步读 r 观察到<br/>同步写 w，则 w 同步先于 r"] --> HB
    HB["happens before（发生序）<br/>= (sequenced before ∪ synchronized before) 的传递闭包"]
{{< /mermaid >}}

**sequenced before（程序序）**说的是同一个 Goroutine 内部，由 Go 语言规范为控制流和表达式求值
定下的那个偏序，它只管单个 Goroutine 自己。**synchronized before（同步序）**则要先引入一个映射
`W`，它为每个读型操作指明：你究竟读自哪一个写型操作。当一个同步读 `r` 读到了某个同步写 `w`
（也就是 `W(r) = w`），我们就说 `w` 同步先于 `r`。模型还要求这些同步操作能被某个隐含的全序
解释得通，顺序一致性就是从这道门进来的。**happens before（发生序）**则是前两者并集的
**传递闭包**，我们跨 Goroutine 推理「谁能看见谁」，靠的就是它。

可见性的判定（模型里的 Requirement 3）顺着发生序就出来了。一个普通读 `r`（读位置 `x`）
能读到的写 `w`，必须对 `r` 可见，这要同时满足两条：

1. `w` happens before `r`；
2. 找不到另一个对 `x` 的写 `w'`，使得 `w` happens before `w'` happens before `r`。

说白了，`r` 读到的，就是发生序上离它最近、又没被更晚的写盖掉的那一个写入。
当 `x` 上没有数据竞争时，这样的 `w` 唯一确定。再往前推一步还能证明（证明与 Boehm-Adve
论文第 7 节相同）：一个无数据竞争的 Go 程序，它所有可能的结果，都能用某个顺序一致的交错执行
解释出来。这便是 Go 给用户的根本承诺，DRF-SC。

> 顺带把偏序这个词说得学院派一点。happens before 是一个严格偏序，满足反自反（没有事件发生在
> 它自己之前）、反对称、传递三条性质。两个互不发生在对方之前的事件，称为**并发（concurrent）**。
> 这套偏序的思路，可以一直追到 Lamport 1978 年那篇讨论分布式系统里事件先后的奠基之作。

## 5.9.5 同步如何建立发生序

发生序不会自己冒出来，它只能靠同步操作一点点搭起来。下表把 Go 1.26 里各个同步原语提供的
synchronized before 保证收在一处（记 `A ⤳ B` 表示 A 同步先于 B）。读者真正要记住的，
也就是这张表：

| 同步机制 | 建立的同步序 |
| --- | --- |
| 包初始化 | 被导入包 `q` 的 `init` 完成 ⤳ 导入方 `p` 的 `init` 开始；所有 `init` 完成 ⤳ `main.main` 开始 |
| Goroutine 创建 | `go` 语句 ⤳ 新 Goroutine 开始执行 |
| Goroutine 退出 | 不提供任何同步序（退出这件事本身靠不住） |
| 通道发送与接收 | 一次发送 ⤳ 对应接收的**完成** |
| 通道关闭 | `close(ch)` ⤳ 因关闭而返回零值的接收 |
| 无缓冲通道接收 | 一次接收 ⤳ 对应发送的**完成** |
| 容量为 C 的缓冲通道 | 第 k 次接收 ⤳ 第 k+C 次发送的完成 |
| 互斥锁 | 第 n 次 `Unlock` ⤳ 第 m 次 `Lock` 返回（n < m） |
| `sync.Once` | `once.Do(f)` 中 `f()` 的完成 ⤳ 任意 `once.Do(f)` 的返回 |
| 原子操作 | 若原子操作 A 的效果被 B 看到，则 A ⤳ B；且所有原子操作存在一个顺序一致的全序 |

其中有几条，值得我们多看两眼。

**Goroutine 的创建和销毁并不对称。** `go` 语句同步先于新 Goroutine 启动，所以子 Goroutine
能稳稳看到父 Goroutine 在 `go` 之前写下的一切。可反过来就不成立了，Goroutine 退出并不建立
任何同步序。看下面这段，对 `a` 的写入之后再没有同步事件接住它，`main` 就不保证能看到这次写入，
一个够激进的编译器甚至可以把整条 `go` 语句直接删掉：

```go
func hello() {
	go func() { a = "hello" }() // 没有同步序回到 main
	print(a)                    // 不保证看到 "hello"
}
```

**通道是 Go 最推荐的同步手段。** 回到 5.9.1 那个会出错的例子，只要把「轮询标志位」改成
「一收一发」，发生序立刻就接上了：

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
	<-c             // 接收：和上面的写入接成了 happens-before
	print(data)     // 保证打印 42
}
```

缓冲通道那条「第 k 次接收 ⤳ 第 k+C 次发送」的规则，还能顺手把一个容量为 C 的缓冲通道
当成**计数信号量**用：发送即获取，接收即释放，是限制并发度的常见写法。

**原子操作是顺序一致的。** 这一条正是 5.9.7 要讲的 2022 年修订的重头戏。Go 把 `sync/atomic`
里的操作都定为**顺序一致原子**：它们共享一个统一的全序，语义对齐 C++ 的 SC 原子和 Java 的
`volatile`。也就是说，Go 没有把 C++ 那套弱序（relaxed/acquire/release）原子端上桌，
这是一处有意的简化，缘由放到 [5.9.8](#598-工程权衡与忠告) 再说。

## 5.9.6 当竞争发生：实现的边界

DRF-SC 只对无竞争的程序承诺顺序一致。那有竞争的程序呢？这一问，恰好把 Go 和 C/C++ 的分歧
亮了出来，也照见 Go 的一层心思：哪怕程序写错了，也尽量让它还能被调试。

在 C/C++ 里，数据竞争是**未定义行为（UB）**，编译器对它不负任何责任。Go 不肯走到这一步。
它对含竞争的程序仍旧划下实现层面的底线，让它的行为更靠近 Java 与 JavaScript：

- 实现可以一发现竞争就报告并终止程序，`go build -race` 下的 ThreadSanitizer 干的正是这件事；
- 否则，对一个不超过机器字长的内存位置的读，得返回某个先于它或与它并发、且尚未被盖掉的真实
  写入值，不会凭空变出一个从没被写过的值（这就是所谓禁止 out-of-thin-air）。

但对超过机器字长的多字结构（接口、切片、字符串、map 等，内部都是 (指针, 长度) 或
(指针, 类型) 这样的组合），实现可以把读写拆成几个机器字、以未定义的顺序分别进行。
于是这类数据上的竞争就可能撕出一个不自洽的值，比如一个对不上任何一次完整写入的
(指针, 类型) 组合，再往下就是内存损坏。这也是为什么对接口、切片、map 的竞争，
要比对一个 `int` 的竞争凶险得多。

下面这个经典反例提醒我们：竞争一旦发生，连「既然看到了较新的值，那较早的值也该看到」这种
朴素推断都会失灵。`g` 完全可能先打印 `2`，再打印 `0`：

```go
var a, b int
func f() { a = 1; b = 2 }
func g() { print(b); print(a) } // 可能输出 2 然后 0
```

这一下也就否掉了好几种自以为聪明的写法，最有名的是**双重检查锁定（double-checked locking）**，
以及拿一个普通 `bool` 标志位去顶替真正的同步。它们在弱内存模型下都站不住脚。

## 5.9.7 设计的演进

Go 的内存模型不是一锤子定下来的。它怎么一步步走到今天，和今天的条文本身一样耐读。

**2009 到 2012 年的初版。** 最早那份 Go 内存模型文档和语言规范同期问世，只立了单独一个
happens before 关系，配上 init、goroutine、channel、mutex、once 等几条规则。它方向是对的，
也够简单，却留下三道口子。其一，原子操作的语义悬而未定，`sync/atomic` 长期没拿到一句正式的
内存序承诺，早年的文档甚至劝人别拿 atomic 来做同步，可需要无锁数据结构的库作者，
事实上一直在依赖一份没写进文档的契约过日子。其二，形式化不够，单靠一个 happens before 关系，
既难严谨地刻画「有竞争时到底会怎样」，也难和硬件、编译器的真实行为对得上号，
文档里一度还留有可见性方面的瑕疵。其三，像双重检查锁定这样的自然写法到底合不合法，
读者找不到一个能据以判断的明确说法。

**2021 年的一次理论盘点。** Russ Cox 写了三篇《Memory Models》长文，依次是
《Hardware Memory Models》《Programming Language Memory Models》
《Updating the Go Memory Model》，把硬件和 C/C++、Java 各家内存模型的来路与教训梳了一遍，
也摆开了 Go 该如何修订的讨论。与之配套的，是提案 golang/go#50590。

**2022 年（Go 1.19）的正式修订。** 这是 Go 内存模型分量最重的一次更新，文档版本就标着
「Version of June 6, 2022」，随 Go 1.19 一同发布。

{{< mermaid >}}
flowchart LR
    OLD["初版模型 (2009-2012)<br/>单一 happens-before<br/>原子语义未定义<br/>形式化薄弱"]
    OLD -->|"Russ Cox《Memory Models》<br/>三部曲 + 提案 #50590"| NEW
    NEW["修订模型 (Go 1.19, 2022)<br/>sequenced/synchronized before<br/>+ 映射 W<br/>形式化对齐 Boehm-Adve<br/>原子 = 顺序一致<br/>新增类型化原子 API"]
{{< /mermaid >}}

这次修订动了三处。第一，重整词汇与形式化，把原先单独一个 happens before 拆成
*sequenced before*（程序序）和 *synchronized before*（同步序），happens before 退居为二者并集
的传递闭包；整套形式化对齐 Boehm-Adve 的 C++ 框架，旗帜鲜明地以 DRF-SC 为目标，
还白纸黑字声明要与 C、C++、Java、JavaScript、Rust、Swift 的 DRF-SC 保证看齐。第二，
正式定下原子操作的内存序，把 `sync/atomic` 钉为顺序一致原子，语义对齐 C++ SC 原子与 Java 的
`volatile`，库作者总算拿到了一份写明的契约。第三，添了类型化原子 API（Go 1.19，提案 #50860），
即 `atomic.Int32/Int64/Uint32/Uint64/Bool/Pointer[T]/Uintptr/Value`。类型化把「这个字段得用
原子方式访问」这件事编进了类型里，既省去了裸用 `atomic.AddInt64(&x, …)` 时一不小心在别处
漏掉原子访问的隐患，也顺带保证了内存对齐，是 API 设计与内存模型一起往前走的一个好例子。

要紧的是，这次修订并没有改动 Go 程序的可观测行为，也没给用户的承诺松绑或加码。
它做的，是把一份大家一直在默默遵守的契约，写成了严谨又可验证的条文。实现会变，
被写明的设计原理却能留下来，这也正是本书一以贯之想说的那件事。

## 5.9.8 工程权衡与忠告

Go 内存模型里最见设计性格的一笔取舍，是只把顺序一致原子端出来，而把弱序原子收着不给。
C++ 备了 `memory_order_relaxed/acquire/release/seq_cst` 一整套档位，能把硬件性能压榨到极致，
代价却是把「读懂弱内存模型」这桩难事，原封不动甩给了应用开发者，一不留神就写错。
Go 的判断是：对绝大多数程序，SC 原子的性能已经够用，而它换来的那份「容易推理」，
比那一点点峰值性能要值钱得多。这和 Go 在调度、垃圾回收等处的取向是一脉相承的，
都是拿一份可控的性能让渡，去换语义上的简单与稳妥。性能的提升从不白来，
它总伴着复杂度的抬升，而 Go 选择把这份复杂度挡在语言门外。

于是 Go 对用户的忠告，浓缩成内存模型文档开篇那句话也就够了：

> 如果你非得读完这份文档才能搞懂自己的程序在干什么，那只能说你太自作聪明了。别自作聪明。

落到手上的，其实只有一条：用同步原语把数据竞争消干净。能用通道就用通道，要共享内存就用
`sync` 和 `sync/atomic`，再让 `-race` 一路替你盯着。把这一条做到位，你就能始终用那个最省心的
「顺序一致」模型去推理并发程序，把重排序的全部曲折，安心地丢回给编译器和硬件。

### 重排序沙盒（交互演示）

下面这个可交互的小演示，是想让读者亲手感受一下 5.9.1 里那一幕：store buffer 是怎么让
`done=true` 抢在 `data=42` 前头，被另一个核心先看到的。它模拟的是内存模型所允许的结果。
要说明的是，JavaScript 本身顺序一致、又是单线程，触发不了真正的硬件重排序，所以这里仅作示意。
若你的环境不跑脚本，直接读上文的文字说明即可。

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
      "核心1: 把 done=true 先刷出 store buffer（与 data 写入无依赖）。",
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
