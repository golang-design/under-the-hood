---
weight: 1509
title: "5.9 内存一致模型"
---

# 5.9 内存一致模型

> 本节内容对标 Go 1.26。Go 的内存模型在 2022 年随 Go 1.19 经历过一次重要修订，
> 本节在讨论当前模型的同时，会交代这次修订的来龙去脉（见 [5.9.7](#597-设计的演进)）。

两个 Goroutine 同时读写同一个变量时，一个 Goroutine 的写入能否被另一个观察到，
由一份横跨「程序语言、操作系统、硬件」三方的契约决定。这份契约称为
**内存模型（Memory Model）**。源代码中语句的先后并不足以决定结果。第 5 章介绍的
各类同步原语，其正确性都建立在内存一致性之上，本节把这条主线补全。

## 5.9.1 问题的提出

这段程序在并发教材中常见。两个 Goroutine 共享 `data` 与 `done`，一个生产，一个消费：

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

源代码中 (1) 写在 (2) 之前，直觉上 `consumer` 观察到 `done == true` 时就能读到
`data == 42`。这段程序不保证打印 42，也可能不退出循环。原因在于，从源代码到 CPU 执行，
内存访问经过三层**重排序**。

{{< mermaid >}}
flowchart LR
    SRC["源代码顺序<br/>(1) data=42<br/>(2) done=true"] -->|"编译器优化<br/>指令重排"| C["编译后顺序"]
    C -->|"CPU 乱序执行<br/>out-of-order"| P["流水线提交顺序"]
    P -->|"存储缓冲 / 缓存<br/>store buffer"| M["其他核心可见顺序"]
    M --> OBS["consumer 观察到的顺序<br/>可能先看到 done<br/>再看到旧的 data"]
{{< /mermaid >}}

编译器在保持单 Goroutine 语义的前提下重排无依赖的读写。它可能把对 `done` 的写入排到
`data` 之前，也可能把循环中对 `done` 的读取提升（hoist）到循环外，使循环不再终止。
CPU 以乱序方式发射指令，只维持单核视角下的数据依赖。一个核心的写入先停留在它私有的
store buffer 或缓存中，对其他核心可见的时机由缓存一致性协议决定，与写入的先后未必一致。

这三层优化保持单线程程序的可观测行为不变，它们的合法性建立在这一前提上。引入第二个
Goroutine 后，可观测行为需要一份跨线程规则界定。内存模型给出这份规则，规定一个 Goroutine
的写入在何种条件下能被另一个 Goroutine 的读取观察到。

内存模型的强弱带来不同的工程后果。强模型贴近源代码顺序，便于推理，同时压缩编译器与硬件的
优化空间，降低性能上限。弱模型留出优化空间，提高性能潜力，也加重正确性推理的负担。
兼容性的约束更刚性：选择强模型的硬件体系结构，无法在保持既有程序不变的前提下退回弱模型。
内存模型的设计因此仍是活跃的研究课题。

## 5.9.2 一致性模型的谱系

并行系统的一致性模型构成一条从强到弱的谱系。Go 在这条谱系上的位置决定了它对用户的承诺。

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

**线性一致性（Linearizability）**又称强一致性或原子一致性。它要求每次读返回该变量最近一次
写入的值，并要求所有操作存在一个与真实物理时间（全局时钟）一致的全序。全局时钟在分布式与
多核场景下代价高、难以实现，这推动了对更弱一致性的研究。

**顺序一致性（Sequential Consistency, SC）**由 Lamport 于 1979 年提出，是本节的核心概念。
它不要求全局物理时钟，只要求存在一个把所有线程操作交错起来的全序，满足两个条件：
每个线程内部的操作在该全序中保持程序顺序；每次读返回该全序中最近一次写入的值。
一个等价的理解是，运行时把全部 Goroutine 复用到一颗单核处理器上轮流执行。
这个全序与真实时间无关。

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

**因果一致性（Causal Consistency）**放松要求：有因果依赖的操作保持顺序，没有因果关系的
并发操作，不同观察者可以看到不同顺序。

**最终一致性（Eventual Consistency）**位于谱系最弱的一端，只保证写入终将对其他节点可见，
不约束时间。分布式存储常用这一模型，可加上有界延迟等约束加以增强，超出本节范围。

谱系的两端对应同一个权衡的两面。强端简化推理、限制优化，弱端释放优化、加重推理负担。
语言的内存模型在这条线上选定一个位置，并配套规则，说明在何种前提下用户能获得更强的保证。

## 5.9.3 弱序与免数据竞争

多数现代硬件不提供顺序一致性，其代价超出收益。硬件提供**弱序（Weak Ordering）**：
普通读写默认允许重排，程序显式使用同步操作（内存屏障、原子指令）时，硬件保证这些同步点
之间的顺序。Adve 与 Hill（1990）给出弱序的经典定义：当硬件对遵守同步约定的软件都表现为
顺序一致时，称该硬件相对于这套同步模型为弱序。

现代内存模型据此在软硬件与程序员之间分配责任：

> 硬件与编译器承诺：只要程序**没有数据竞争**，就让它表现得**如同顺序一致**。
> 作为交换，对于**存在**数据竞争的程序，不做承诺，或只做有限承诺。

这是 **DRF-SC（Data-Race-Free ⇒ Sequential Consistency）**契约。它依赖对数据竞争的
精确定义：

> **数据竞争**指对同一内存位置存在两个并发访问，其中至少一个是写，
> 且它们之间没有通过同步操作建立顺序。

程序员的义务由此确定：消除数据竞争。做到这一点后，可以忽略编译器与 CPU 的重排序，
按单核顺序推理程序。这是多数程序员需要掌握的心智模型。DRF-SC 把理解弱内存模型的难题，
转化为避免数据竞争的问题，后者可由工具检测。

## 5.9.4 Go 的内存模型：发生序

Go 站在 DRF-SC 一侧。它的内存模型在形式化上紧随 Boehm 与 Adve 在 PLDI 2008 提出的 C++
并发内存模型框架，「无数据竞争程序保证顺序一致」的结论与该工作等价。Go 1.26 模型的骨架
如下。

模型把程序执行看作若干 **Goroutine 执行**的集合，每个 Goroutine 执行是一组**内存操作**。
内存操作分为读型（普通读、原子读、加锁、通道接收）、写型（普通写、原子写、解锁、
通道发送与关闭）、读写型（如原子 CAS）。模型在这些操作上定义三个偏序关系。

{{< mermaid >}}
flowchart TD
    SB["sequenced before（程序序）<br/>同一 Goroutine 内由语言规范<br/>规定的控制流与求值顺序"] --> HB
    SYB["synchronized before（同步序）<br/>由映射 W 导出：若同步读 r 观察到<br/>同步写 w，则 w 同步先于 r"] --> HB
    HB["happens before（发生序）<br/>= (sequenced before ∪ synchronized before) 的传递闭包"]
{{< /mermaid >}}

**sequenced before（程序序）**指同一个 Goroutine 内部由 Go 语言规范为控制流结构与表达式
求值规定的偏序，作用范围限于单个 Goroutine。**synchronized before（同步序）**借助一个映射
`W`，为每个读型操作指定它读自哪个写型操作；同步读 `r` 观察到同步写 `w`（即 `W(r) = w`）时，
`w` 同步先于 `r`。模型要求这些同步操作能由某个隐含的全序解释，顺序一致性从这里进入模型。
**happens before（发生序）**取前两者并集的**传递闭包**，跨 Goroutine 推理可见性以它为依据。

可见性判定（模型中的 Requirement 3）随之确定。普通读 `r`（读位置 `x`）能读到的写 `w` 须对
`r` 可见，满足两条：

1. `w` happens before `r`；
2. 不存在另一个对 `x` 的写 `w'`，使得 `w` happens before `w'` happens before `r`。

`r` 读到的是发生序上最近、且未被更晚的写覆盖的那个写入。对 `x` 没有数据竞争时，这样的 `w`
唯一确定。进一步可以证明（证明同 Boehm-Adve 论文第 7 节），无数据竞争的 Go 程序，
其结果都能由某个顺序一致的交错执行解释。这是 Go 对用户的根本承诺，即 DRF-SC。

> 形式上，happens before 是严格偏序，满足反自反（事件不发生于自身之前）、反对称、
> 传递三条性质。互不发生于对方之前的两个事件称为**并发（concurrent）**。这套偏序框架
> 可追溯到 Lamport 于 1978 年关于分布式系统事件时序的工作。

## 5.9.5 同步如何建立发生序

发生序由同步操作建立。下表汇总 Go 1.26 中各同步原语提供的 synchronized before 保证
（记 `A ⤳ B` 表示 A 同步先于 B）。这些规则是用户需要记住的内容。

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

几条规则值得留意。

**Goroutine 创建与销毁不对称。** `go` 语句同步先于新 Goroutine 启动，子 Goroutine 能观察到
父 Goroutine 在 `go` 之前的写入。反向不成立，Goroutine 退出不建立同步序。下面的代码中，
对 `a` 的写入之后没有同步事件，`main` 不保证观察到它，编译器在此规则下可以删除整个
`go` 语句：

```go
func hello() {
	go func() { a = "hello" }() // 无同步序回到 main
	print(a)                    // 不保证看到 "hello"
}
```

**通道是 Go 推荐的主同步手段。** 把 5.9.1 的标志位轮询换成通道收发，发生序随即建立。

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

缓冲通道的「第 k 次接收 ⤳ 第 k+C 次发送」规则可以把容量为 C 的缓冲通道用作
**计数信号量**：发送获取，接收释放，用于限制并发度。

**原子操作是顺序一致的。** 这是 5.9.7 讨论的 2022 年修订的重点。Go 把 `sync/atomic`
的操作定义为**顺序一致原子**：操作存在一个统一的全序，语义等同 C++ 的 SC 原子与 Java 的
`volatile`。Go 不提供 C++ 那样的弱序（relaxed/acquire/release）原子，这是一处简化，
见 [5.9.8](#598-工程权衡与忠告)。

## 5.9.6 当竞争发生：实现的边界

DRF-SC 只对无竞争程序承诺顺序一致。含竞争的程序落在 Go 与 C/C++ 分歧之处，
也体现 Go 让出错程序仍可调试的取向。

C/C++ 把数据竞争定为**未定义行为（UB）**，编译器不受约束。Go 不采用这一立场，
它对含竞争的程序施加实现层面的约束，使行为接近 Java 与 JavaScript：

- 实现可以在检测到竞争时报告并终止程序（`go build -race` 下的 ThreadSanitizer 如此）；
- 对不大于机器字长的内存位置的读，返回某个先于或并发于它、且未被覆盖的真实写入值，
  不产生从未写入的值（**禁止 out-of-thin-air**）。

大于机器字长的多字结构（接口、切片、字符串、map 等内部的 (指针, 长度) 或 (指针, 类型) 对），
实现可以把读写拆成若干机器字、以未定义顺序进行。这类数据上的竞争可能撕裂出不自洽的值，
例如不对应单次写入的 (指针, 类型) 组合，进而引发内存损坏。对接口、切片、map 的竞争比对
`int` 的竞争危险。

下面的例子说明，竞争发生后，看到较新的值不能推出也看到较早的值。`g` 可能先打印 `2`
再打印 `0`：

```go
var a, b int
func f() { a = 1; b = 2 }
func g() { print(b); print(a) } // 可能输出 2 然后 0
```

这一事实否定若干看似聪明的写法，例如**双重检查锁定（double-checked locking）**，
以及用普通 `bool` 标志位代替同步。它们在弱内存模型下不成立。

## 5.9.7 设计的演进

Go 的内存模型经过演进。它如何走到今天，与今天的条文同样值得了解。

**2009 至 2012 年的初版。** 最早的 Go 内存模型文档与语言规范同期，只有单一的 happens before
关系，配 init、goroutine、channel、mutex、once 等规则。它方向正确，也简单，留下三个缺口。
第一，原子操作语义未定义。`sync/atomic` 长期没有正式的内存序承诺，早期文档建议不要用
atomic 做同步，需要无锁数据结构的库作者只能依赖一份没有写明的契约。第二，形式化不足。
单一 happens before 关系难以刻画竞争下的行为，也难以对齐硬件与编译器的实际行为，
文档出现过可见性方面的缺陷。第三，双重检查锁定等写法是否合法缺乏判断依据。

**2021 年的理论盘点。** Russ Cox 发表三篇《Memory Models》系列长文，分别是
《Hardware Memory Models》《Programming Language Memory Models》
《Updating the Go Memory Model》，梳理硬件与 C/C++、Java 内存模型的历史与教训，
讨论 Go 的修订方向。配套提案为 golang/go#50590。

**2022 年（Go 1.19）的正式修订。** 这是 Go 内存模型的一次重大更新，文档版本标注
「Version of June 6, 2022」，随 Go 1.19 发布。

{{< mermaid >}}
flowchart LR
    OLD["初版模型 (2009-2012)<br/>单一 happens-before<br/>原子语义未定义<br/>形式化薄弱"]
    OLD -->|"Russ Cox《Memory Models》<br/>三部曲 + 提案 #50590"| NEW
    NEW["修订模型 (Go 1.19, 2022)<br/>sequenced/synchronized before<br/>+ 映射 W<br/>形式化对齐 Boehm-Adve<br/>原子 = 顺序一致<br/>新增类型化原子 API"]
{{< /mermaid >}}

修订包含三部分。第一，重构词汇与形式化：把单一的 happens before 拆为
*sequenced before*（程序序）与 *synchronized before*（同步序），happens before 取二者并集的
传递闭包；形式化对齐 Boehm-Adve 的 C++ 框架，以 DRF-SC 为目标，并声明与 C、C++、Java、
JavaScript、Rust、Swift 的 DRF-SC 保证一致。第二，定义原子操作的内存序：`sync/atomic` 为
顺序一致原子，语义等同 C++ SC 原子与 Java 的 `volatile`，库作者获得明确契约。第三，
新增类型化原子 API（Go 1.19，提案 #50860），即 `atomic.Int32/Int64/Uint32/Uint64/Bool/
Pointer[T]/Uintptr/Value`。类型化把「该字段需要原子访问」编码进类型，减少裸用
`atomic.AddInt64(&x, …)` 时在某处遗漏普通访问的隐患，并保证内存对齐。这是 API 设计与
内存模型协同演进的一个例子。

这次修订保持 Go 程序的可观测行为不变，对用户的承诺不变。它把长期隐含遵守的契约写成严谨、
可验证的条文。实现会变，写明的设计原理留存，这正契合本书的取向。

## 5.9.8 工程权衡与忠告

Go 内存模型体现设计哲学的一处取舍，是只暴露顺序一致原子，不暴露弱序原子。C++ 提供
`memory_order_relaxed/acquire/release/seq_cst` 一整套档位，能榨取硬件性能，也把理解弱内存
模型的难题交给应用开发者，容易出错。Go 的判断是，SC 原子对多数程序的性能足够，
它带来的可推理性高于那一点峰值性能。这与 Go 在调度、垃圾回收等处的取向一致：
让渡可控的性能，换取语义的简单与正确。复杂度随性能而来，Go 把这份复杂度挡在语言之外。

Go 对用户的忠告浓缩为内存模型文档开篇的一句话：

> 如果你必须读完这份文档才能理解你的程序的行为，那么你就太自作聪明了。别自作聪明。

落到实践只有一条：用同步原语消除数据竞争。优先用通道，需要共享内存时用 `sync` 与
`sync/atomic`，用 `-race` 持续检测。做到这一点，就能用顺序一致的心智模型推理并发程序，
把重排序的复杂性留给编译器与硬件。

### 重排序沙盒（交互演示）

下面这个可交互演示呈现 5.9.1 中另一个核心为何先读到 `done=true`、再读到旧的 `data`。
它模拟内存模型允许的结果。JavaScript 顺序一致且单线程，不触发硬件重排序，此处为示意。
运行环境不支持脚本时，可阅读上文的静态说明。

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
