---
weight: 3200
title: "第 10 章 通道与 select"
---

# 第 10 章 通道与 select

> 本章配有一个线上演讲：[YouTube 在线](https://www.youtube.com/watch?v=d7fFCGGn0Wc)，
> [Google Slides 讲稿](https://changkun.de/s/chansrc/)。

「不要以共享内存的方式通信，而要以通信的方式共享内存。」这句广为流传的格言，是 Go 并发哲学的
浓缩。channel 正是这句话的载体，它把同步与数据传递合二为一。本章从这句话背后的理论传统讲起，
看清 channel 与 select 在思想谱系里的位置，再深入它们在运行时里的实现与取舍。

## 10.1 CSP 的思想与谱系

channel 的思想源自 Hoare 的 **CSP（顺序进程通讯）**：进程之间不共享状态，只通过收发消息来
协调。这里有一处常被讲错、却很要紧的史实。Hoare 1978 年那篇原始论文里**并没有第一类的
channel**,通信是直接以**进程名**寻址的：`cardfile?cardimage` 意为"从名为 cardfile 的进程读入"。
作为独立实体、可以被传递的 channel，是到 1985 年那本《Communicating Sequential Processes》
专著的代数重构、以及 occam 语言里才出现的。这点对理解 Go 很关键：Go 那种匿名、可传递的
channel，更像**后期 CSP 与 π-演算**，而非 Hoare 1978。

谱系往下走：CSP 属于**进程代数**家族，与 Milner 的 CCS（1980）并列;而 Milner、Parrow、Walker
的 **π-演算**（1992）更进一步，让**channel 名本身也能在 channel 上传递**,这种"移动性"
（mobility）正对应 Go 里 `chan chan T` 那种把 channel 当值发送、从而在运行时改变"谁能与谁
通信"的能力（这是结构上的对应，而非有据可考的设计渊源）。**occam**（INMOS transputer，1983）
则是 CSP 的直接落地：它的 `ALT` 守卫选择构造，正是 Go `select` 的祖先。

最后是一组要分清的对照:**CSP / channel** vs **Actor 模型**（Hewitt 1973；Erlang）。二者都摒弃
共享可变状态，但路数不同：

| 维度 | CSP / Go channel | Actor（Erlang） |
| --- | --- | --- |
| 通信对象 | 匿名的 **channel** 值 | 特定 actor 的**身份**（PID / 邮箱） |
| 对称性 | 收发双方都只命名 channel | 发送方命名接收方，反之不然 |
| 同步性 | 默认**同步**（无缓冲会合），缓冲可选 | **异步**发送，每个 actor 有无界邮箱 |
| 多重性 | 多个 goroutine 可共享一个 channel | 一个邮箱一个消费者 |

「以通信共享内存」是 CSP 立场；「一切皆隔离进程、只向地址发消息」是 Actor 立场。

## 10.2 hchan：channel 的内部结构

运行时里一个 channel 就是一个 `hchan`，裁剪成只剩设计相关字段，是这样：

```go
type hchan struct {
    qcount   uint           // 缓冲区中当前元素个数
    dataqsiz uint           // 缓冲区容量 C（无缓冲则为 0）
    buf      unsafe.Pointer // 指向容量为 C 的环形缓冲数组
    sendx    uint           // 下一次发送写入缓冲的位置
    recvx    uint           // 下一次接收读取缓冲的位置
    recvq    waitq          // 等待接收的 goroutine 队列（sudog 链表）
    sendq    waitq          // 等待发送的 goroutine 队列
    closed   uint32         // 是否已关闭
    lock     mutex          // 保护以上所有字段
}
```

一个可选的环形缓冲区（无缓冲 channel 没有它）、两条 FIFO 的等待队列、一把保护整体的锁。
channel 的全部行为，都是围绕这几样东西的状态变化。

## 10.3 发送与接收：那个优雅的直接传递

先看发送 `ch <- v` 的判定，写成伪代码一目了然：

```go
func chansend(c *hchan, v) {
    lock(&c.lock)
    if c.closed { unlock(&c.lock); panic("send on closed channel") }
    if recv := c.recvq.dequeue(); recv != nil {
        sendDirect(recv, v); unlock(&c.lock); return  // 有接收者在等：直接拷给它并唤醒
    }
    if c.qcount < c.dataqsiz {                          // 缓冲有空位：放入环形缓冲
        c.buf[c.sendx] = v; c.sendx = (c.sendx+1)%c.dataqsiz; c.qcount++
        unlock(&c.lock); return
    }
    c.sendq.enqueue(gp); unlock(&c.lock); gopark()      // 否则：挂入 sendq，阻塞
}
```

最值得玩味的是中间那条**直接传递**（`sendDirect`）：若此刻已有接收者在 `recvq` 等着，发送者
不把值放进缓冲再让对方取，而是把值**直接 `memmove` 到那个接收者的栈槽**上，再唤醒它,一次
拷贝搞定，缓冲区根本没参与（即便是缓冲 channel 也走这条捷径）。接收 `<-ch` 完全对称
（`recvDirect`）。这个优化省掉了"先入缓冲、再出缓冲"的一进一出，是 channel 高频收发仍然轻快的
关键。

由此也能理解**无缓冲 channel**（`dataqsiz == 0`）的语义：没有缓冲，发送与接收必须**会合**
（rendezvous），任一方先到都得等另一方，配对成功的瞬间值被直接传递,这正是无缓冲 channel
能用作两个 goroutine"同步点"的原因。**缓冲 channel**则在缓冲未满时允许发送者先行离开，
把同步放松成"最多积压 C 个"。

## 10.4 关闭

`close(ch)`（`closechan`）在锁内把 `closed` 置位，然后**广播唤醒**:它取出 `recvq` 的全部等待者
（每个收到零值、`ok == false`）与 `sendq` 的全部等待者（它们将 panic），收集成一个列表，
放锁后一并 `goready`。这使 close 成为向多个接收者**广播「到此为止」**的惯用法。几条边界由语言
强制、宁可崩溃也不沉默：向已关闭的 channel 发送 panic、重复关闭 panic、关闭 `nil` channel
panic,都是为了让误用尽早暴露。

## 10.5 select 的实现

`select` 让一个 goroutine 同时在多个 channel 操作上等待，哪个先就绪走哪个。它的实现
（`selectgo`）要同时照顾**公平**与**避免死锁**，靠的是两个顺序：

- **`pollorder`（公平）**：扫描各 case 之前，先用 Fisher-Yates 把 case 顺序**随机打乱**
  （`cheaprandn`），避免书写在前的 case 总被优先选中,这就是"多个就绪 case 时均匀随机选一个"的
  来源。
- **`lockorder`（防死锁）**：把涉及的 channel **按地址排序**后再依次加锁，保证所有 goroutine 以
  全局一致的顺序获取多把 channel 锁，从而不会相互死锁。

机制上：`selectgo` 先锁住所有相关 channel，按 `pollorder` 扫一遍找就绪的；若都没就绪且无
`default`，就把当前 goroutine 同时挂到**所有** case 的等待队列上、放锁、阻塞；任一 channel 就绪
唤醒它后，再把它从其余队列摘下，返回选中的 case。带 `default` 的 select 在无人就绪时立刻走
`default`，实现非阻塞收发。

## 10.6 happens-before 与缓冲信号量

channel 不只传数据，还建立内存可见性的次序（[11.9 内存一致模型](../ch11sync/mem.md)）。规范的
原文是：一次发送 synchronized before 对应接收的**完成**;关闭 synchronized before 因关闭而返回
零值的接收;对**无缓冲** channel，一次接收 synchronized before 对应发送的完成（这个反向保证，
正是无缓冲发送能当"确认回执"用的原因）。还有一条精妙的：**容量为 C 的 channel，第 k 次接收
synchronized before 第 k+C 次发送的完成**。这条正是**缓冲 channel 当计数信号量**用的形式化
基础,一个容量 C 的 `chan struct{}`，发送即获取、接收即释放，能把在途并发严格限制在 C 个以内。
这是少数有精确规范背书的惯用法。

## 10.7 有锁的取舍与一段演进

channel 走的是有锁路径，而非无锁，这背后有一段历史。2014 年前后，Vyukov 提出过给 channel
提速的设计，包括一个更激进的**无锁 channel** 方案（#8899，号称约 23% 提升）。但 channel 的
语义实在复杂:收发配对、阻塞唤醒、select 多路等待、关闭广播，要在无锁之下同时把这些做对，
复杂度与正确性风险都很高。最终无锁方案**没有落地**（go1.26 里 channel 仍是 `lock mutex`），
转而在有锁框架内做简化优化。同期还有两处与正确性相关的演进：明确阻塞 channel 上的操作必须
按 **FIFO** 次序（#11506，其落地机制正是 10.3 那个"唤醒即直接完成"的直接传递，从而先来先服务），
以及 select 的公平性几经讨论（#21806）最终以随机化收敛。这又是一处"正确与可维护优先于极致
性能"的取舍，与 [11.9](../ch11sync/mem.md) 里 Go 只暴露顺序一致原子一脉相承。

## 10.8 跨语言对照

把 channel 放进消息传递的谱系：

| 系统 | 默认同步性 | 选择构造 | 备注 |
| --- | --- | --- | --- |
| Go | 同步（无缓冲会合），缓冲可选 | `select`（就绪者中均匀随机） | 匿名、第一类、多对多 |
| Erlang | 异步发送 + 无界邮箱 | `receive` 模式匹配（非 channel 选择） | Actor 家族 |
| Rust `std::sync::mpsc` | `channel()` 异步无界；`sync_channel(0)` 才是会合 | 标准库无 select | MPSC，默认与 Go 相反 |
| Clojure core.async | CSP 式，显式受 Go 启发 | `alt!` / `alts!` | JVM 上的"Go channel" |
| Kotlin Channel | 默认会合（容量 0） | `select { onReceive }` | 协程之上 |
| occam | 同步会合 | `ALT`（select 的祖先） | 命名、点对点 |

Go、core.async、Kotlin、occam 同属 **CSP 家族**（channel 为中心、默认同步、有真正的选择构造）；
Erlang 是 **Actor 家族**;Rust 标准库 `mpsc` 有意思之处恰在它**默认异步无界**，与 Go 的默认相反，
要 `sync_channel(0)` 才找回 Go 的会合语义。core.async 则是最直白的"JVM 上的 Go channel"。

## 10.9 何时不该用 channel

channel 优雅，但并非万灵药。Bryan Mills 在 GopherCon 2018 的《Rethinking Classical Concurrency
Patterns》中系统地指出：不少教科书式的 channel 模式（用 channel 模拟条件变量、worker pool 等）
极易写出微妙的错误，而一把 `sync.Mutex` 配 `sync.WaitGroup`、`context` 往往更清楚也更快。
官方 FAQ 同样明确：保护一小段就地共享状态，用互斥锁是恰当的。一个机制层面的理由（见 10.2）：
每次 channel 操作都要取 `hchan.lock` 并可能触发调度交接，对"一个共享计数器"这种场景，
互斥锁或原子操作（[11.3](../ch11sync/atomic.md)）通常更省。判断标准回到那句老话:你要表达的是
**通信**（转移所有权、编排流水线、发信号）还是**互斥**（就地保护一小块状态）？前者用 channel，
后者用锁。至于"等一组 goroutine 完成"这类结构化并发，目前的惯用法是
`golang.org/x/sync/errgroup` 配合 `context` 的取消传播（[11.8](../ch11sync/context.md)）。

## 进一步阅读的文献

1. C. A. R. Hoare. "Communicating Sequential Processes." *CACM*, 21(8), 1978.
   https://doi.org/10.1145/359576.359585 ；专著：Prentice Hall, 1985.
2. Robin Milner, Joachim Parrow, David Walker. "A Calculus of Mobile Processes, I/II."
   *Information and Computation*, 100(1), 1992. https://doi.org/10.1016/0890-5401(92)90008-4
3. Carl Hewitt, Peter Bishop, Richard Steiger. "A Universal Modular ACTOR Formalism for
   Artificial Intelligence." *IJCAI 1973*.
4. Joe Armstrong. *Making Reliable Distributed Systems in the Presence of Software Errors.*
   PhD thesis, KTH, 2003.（Erlang/Actor）
5. The Go Authors. *The Go Memory Model：Channel communication.* https://go.dev/ref/mem
6. Bryan C. Mills. *Rethinking Classical Concurrency Patterns.* GopherCon 2018.
   https://www.youtube.com/watch?v=5zXAHh5tJqQ
7. Rich Hickey. *clojure.core.async Channels*, 2013.
   https://clojure.org/news/2013/06/28/clojure-core-async-channels
8. Dmitry Vyukov. *runtime: lock-free channels* (#8899), 2014.
   https://github.com/golang/go/issues/8899 ；FIFO 次序 (#11506)；select 公平 (#21806).
9. Go 博客. *Share Memory By Communicating.* https://go.dev/blog/codelab-share

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
