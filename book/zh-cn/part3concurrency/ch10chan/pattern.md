---
weight: 3207
title: "10.7 工程实践与跨语言对照"
---

# 10.7 工程实践与跨语言对照

前面几节把 channel 的内部结构、收发路径与 select 的实现讲透了。读懂了机制，
随之而来的是一个更难、也更工程的问题：什么时候该用 channel，什么时候不该用。
Go 的宣传语「Do not communicate by sharing memory; instead, share memory by communicating」
容易被读成「凡共享状态皆应走 channel」，但这并非作者的本意。这一节把这句话还原成一条
可操作的判别规则，对照同步原语章（[第 11 章](../ch11sync/readme.md)）里更轻的工具，
再把 Go 的选择放进 CSP 家族的谱系里看，理解它在设计空间中的具体坐标。

## 10.7.1 channel 不是万能锤

2018 年 GopherCon 上，Go 团队的 Bryan C. Mills 做了一场题为「Rethinking Classical
Concurrency Patterns」的演讲。他逐个检视了教科书里常见的并发范式，结论是：其中相当一部分
若用 channel 实现，反而比用 `sync` 包里的原语更难写对、更慢。

第一个例子是「用 channel 模拟条件变量」。一个常见的写法是用一个带缓冲的 channel 当作
「信号槽」，发送代表通知、接收代表等待：

```go
// 反例：用 channel 当条件变量，看似优雅，边界全是坑
type Cond struct {
    ch chan struct{}
}

func (c *Cond) Wait()   { <-c.ch }
func (c *Cond) Signal() { c.ch <- struct{}{} } // 没有等待者时会阻塞
```

它在「恰好一个等待者、恰好一个通知者」时能工作，可一旦等待者数目不定，问题就来了：
`Signal` 在无人等待时会阻塞或丢失信号，`Broadcast`（唤醒全部等待者）无法表达，
而条件谓词的重新检查（被唤醒后必须重新判断条件是否真的满足）也没有着落。
正确的工具是 `sync.Cond`（[11.4](../ch11sync/cond.md)），它的 `Wait` 在唤醒后让调用者
回到循环里复查谓词，`Broadcast` 一次唤醒所有等待者，这些语义 channel 都不天然具备。

第二个例子是「worker pool 做错」。教科书常给出一个用 channel 分发任务、再用 channel 收集
结果的池子，但很多实现忘了处理「某个 worker 出错后如何取消其余 worker」「主协程提前返回
时如何避免 worker 永久阻塞在发送上」这两件事，于是埋下泄漏与死锁。Mills 的建议是：
当所有要做的事就是「等一组并发任务全部结束」时，`sync.WaitGroup`（[11.5](../ch11sync/waitgroup.md)）
配合 `context`（[11.8](../ch11sync/context.md)）取消，比手搓 channel 的池子清晰得多：

```go
// 正路：等一组任务结束，用 WaitGroup，不用 channel 拼装
var wg sync.WaitGroup
for _, task := range tasks {
    wg.Add(1)
    go func(t Task) {
        defer wg.Done()
        t.Run(ctx)
    }(task)
}
wg.Wait()
```

## 10.7.2 一点机制层面的解释

「channel 比 mutex 慢」是 Go 社区里流传很广的经验之谈。它不是空穴来风，但也常被夸大，
值得把其中那一点真实的内核交代清楚。

回到 [10.2](./impl.md) 看过的实现：每一次 channel 的收发，无论缓冲是否命中，
都要先抓住 `hchan.lock` 这把互斥锁，再操作环形缓冲或等待队列；当对端正好阻塞时，
还要把对端的 `sudog` 摘下、唤醒，触发一次调度器交接（[第 9 章](../ch09sched/schedule.md)）。
也就是说，channel 的快路径里本就嵌着一把锁，它没有「无锁快路径」可言。
反观 `sync.Mutex`（[11.2](../ch11sync/mutex.md)）与 `sync/atomic`（[11.3](../ch11sync/atomic.md)），
在无争用时一条 CAS 指令即可完成加解锁，连进入运行时都不必。

于是机制层面的差距就清楚了：若目的只是「保护一小块就地共享的状态」，
用 channel 等于为这块状态额外套了一层锁加一次可能的调度交接，开销自然高于直接上 atomic 或
mutex。需要强调的是，这条结论只在「守护小状态」这个场景成立，不应推广成「channel 总是慢」。
官方 FAQ 对这个问题的措辞很克制，没有给单一基准数字，而是建议按表达力取舍：
哪种写法把意图表达得更直接、更简单，就用哪种，把性能留给真正的热点去衡量。

## 10.7.3 判别规则

把上面的讨论收敛成一条便于记忆的规则：

- **用 channel**，当问题的本质是**通信**：在协程间传递数据的所有权（把一份数据交出去，
  此后不再触碰）、串起流水线（pipeline）的各级、广播信号或传播取消、表达「多路事件中
  谁先到」的选择（select）。
- **用 mutex / atomic**，当问题的本质是**就地守护一小块共享状态**：一个计数器、一张被多个
  协程读写的 map、一段需要原子更新的配置。这类场景 channel 帮不上忙，还更慢。

一句话：channel 管「数据的流动与所有权的转移」，mutex 管「状态的就地保护」。两者不是竞争
关系，而是各司其职。把这条线划清，绝大多数「该用谁」的犹豫都会消失。

## 10.7.4 两个站得住脚的 channel 惯用法

划清边界之后，channel 真正擅长的几个惯用法反而更值得记住。

**带缓冲 channel 当信号量。** 容量为 $n$ 的带缓冲 channel 天然是一个计数信号量：
发送占用一个名额，接收归还一个名额，缓冲满时发送方阻塞，于是并发度被限制在 $n$。
这个手法在 [10.6](./lockfree.md) 讲缓冲语义时已经出现过，这里给出它最常见的形态，
用来给一组协程限流：

```go
sem := make(chan struct{}, maxConcurrency) // 容量即并发上限
for _, job := range jobs {
    sem <- struct{}{}        // 占名额，满则阻塞
    go func(j Job) {
        defer func() { <-sem }() // 干完归还名额
        j.Do()
    }(job)
}
```

**errgroup + context 做结构化并发。** 当一组协程不只是「都要结束」，还要求「任一出错则
取消全体，并把第一个错误带回」时，`golang.org/x/sync/errgroup`（属于扩展库 `x/sync`，
不在标准库内）把 `WaitGroup`、错误传播与 `context` 取消缝在了一起，这正是「structured
concurrency」（结构化并发）在 Go 里的落地形态：子协程的生命周期被约束在一次 `Wait` 的
词法范围内，不会逃逸成无主的泄漏。

```go
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    g.Go(func() error {
        return fetch(ctx, url) // 任一返回非 nil，ctx 被取消，其余据此提前退出
    })
}
if err := g.Wait(); err != nil { // 返回第一个非 nil 错误
    return err
}
```

注意这里 channel 退到了幕后：`context` 的取消信号本身就由一个 `done` channel
（[11.8](../ch11sync/context.md)）承载，而 errgroup 把「谁先出错」的 select 逻辑封装好，
使用者只面对 `g.Go` 与 `g.Wait` 两个动作。这正是判别规则的体现，通信交给 channel，
聚合与守护交给 sync 原语，各取所长。

## 10.7.5 跨语言对照

Go 的 channel 并非凭空而来。它的直系祖先是 Hoare 1978 年的 CSP，而把 CSP 的通信原语
做进通用语言、并辅以一个选择（choice）构造，是一条被反复走过的路。把同辈系统并排来看，
Go 在设计空间里的坐标会清楚许多。几个关注维度是：默认是否同步（无缓冲时收发是否汇合）、
有没有内建的多路选择构造、channel 是否带静态类型、以及通信拓扑（点对点还是邮箱）。

| 系统 | 默认同步性 | 选择构造 | 类型化 | 拓扑 |
| --- | --- | --- | --- | --- |
| Go `chan` | 无缓冲时同步（rendezvous） | `select` | 是（`chan T`） | 点对点，多收多发 |
| occam（CSP） | 全同步，无缓冲 | `ALT` | 是 | 点对点 |
| Erlang | 异步邮箱（mailbox） | `receive` 模式匹配 | 否（动态） | 进程绑定邮箱 |
| Rust `std::sync::mpsc` | 默认异步（`channel()` 无界）；`sync_channel(0)` 才汇合 | 标准库无；需 `crossbeam` 的 `select!` 或 tokio | 是 | 多发单收（MPSC） |
| Clojure core.async | 默认无缓冲（同步） | `alt!` / `alts!` | 否（动态） | 点对点 |
| Kotlin `Channel` | 默认 `RENDEZVOUS`（容量 0，同步） | `select` 表达式 | 是 | 点对点 |

几点值得展开。occam 是最纯粹的 CSP 后裔，通信一律同步、无缓冲，Go 的无缓冲 channel
正是这一脉。Erlang 走的是另一条路，进程间靠异步邮箱通信，发送从不阻塞，
这与 Go「无缓冲即汇合」的默认恰成对照，反映了 actor 模型与 CSP 模型在「同步谁」上的分野。
Rust 标准库的 `mpsc` 默认异步且只允许单接收者，更关键的是它**不内建选择构造**：
要在多个 channel 上做多路等待，得借助 `crossbeam-channel` 的 `select!` 或异步运行时，
这与 Go 把 `select` 作为语言关键字内建形成鲜明区别。Clojure 的 core.async 由 Rich Hickey
在 2013 年引入，明确以 Go 为蓝本，连 `go` 宏与 `alt!` 的命名都带着致敬的痕迹，
区别在于它建在 JVM 上、靠宏做协程变换，且 channel 不带静态类型。Kotlin 的 `Channel`
默认即 rendezvous，与 Go 一致，并提供 `select` 表达式，可以看作 Go 设计在协程语言里的
一次再实现。

把这张表读完会发现一个规律：内建的、带静态类型的、默认同步的、且把选择作为一等构造的
组合，正是 Go 的取舍。它牺牲了 Erlang 邮箱那种「发送永不阻塞」的解耦，
换来的是收发双方在汇合点上的明确同步语义与编译期类型检查。性能的权衡从不白来，
设计的取舍同样如此。

## 10.7.6 一个尚未收口的问题：结构化并发

把视野放到设计前沿，会看到一处 Go 至今没有完全收口的地方。errgroup 提供的是「库层面」
的结构化并发，它靠约定而非语言强制：程序员仍可以在 `g.Go` 之外随手 `go f()`，
启动一个不受任何 `Wait` 约束的协程，运行时不会拦阻，编译器也不会报警。换言之，Go 的
`go` 关键字本身是「非结构化」的，一个协程的生命周期可以任意逃逸出启动它的函数。

这正是 Nathaniel J. Smith 在 2018 年那篇广为流传的文章里批评的对象。他借 Python 的
Trio 库提出「nursery」概念：所有子任务必须在一个词法块内启动，块结束前父任务阻塞等待全部
子任务收束，于是协程的生命周期与代码的词法结构严格对齐，泄漏在语言层面被堵死。
这一思路此后影响了 Kotlin 的 `coroutineScope`、Swift 的 `async let` 与 Java 21 的
`StructuredTaskScope`（JEP 453/480）。Go 社区也反复讨论过是否要给 `go` 加上类似的结构化
约束，但因其会改变这门语言最招牌的轻量协程模型，至今仍是一个开放的取舍，没有定论。
对今天写 Go 的人来说，结论是务实的：把 errgroup 当默认，把裸 `go` 留给确有理由「即发即忘」
的少数场景，用纪律弥补语言尚未提供的强制。

## 延伸阅读的文献

1. Bryan C. Mills. "Rethinking Classical Concurrency Patterns." *GopherCon 2018.*
   https://www.youtube.com/watch?v=5zXAHh5tJqQ （条件变量、worker pool 等范式的再审视）
2. The Go Authors. *Frequently Asked Questions (FAQ): "Why are there no untagged
   unions...", "Should I define methods on values or pointers?", 以及关于 mutex 与
   channel 取舍的条目.* https://go.dev/doc/faq
3. Andrew Gerrand. "Share Memory By Communicating." *The Go Blog*, 2010.
   https://go.dev/blog/codelab-share
4. Rich Hickey. "Clojure core.async Channels." *clojure.org news*, 2013.
   https://clojure.org/news/2013/06/28/clojure-core-async-channels （core.async 公告博文，
   明言以 Go 为蓝本）
5. The Rust Project. *Module `std::sync::mpsc`.*
   https://doc.rust-lang.org/std/sync/mpsc/ （`channel` 异步无界 vs `sync_channel` 汇合）
6. C. A. R. Hoare. "Communicating Sequential Processes." *Communications of the ACM*,
   21(8), 1978. https://doi.org/10.1145/359576.359585 （channel 与 ALT 的理论源头）
7. Nathaniel J. Smith. "Notes on structured concurrency, or: Go statement considered
   harmful." 2018. https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/
   （nursery 与结构化并发的源头论述）
8. 本书 [11.2 互斥锁](../ch11sync/mutex.md)、[11.3 原子操作](../ch11sync/atomic.md)、
   [11.5 同步组](../ch11sync/waitgroup.md)、[11.8 上下文](../ch11sync/context.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
