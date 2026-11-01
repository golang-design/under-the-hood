---
weight: 3207
title: "10.7 工程实践与跨语言对照"
---

# 10.7 工程实践与跨语言对照

前六节讨论了 channel 的语义与实现，本节讨论它的使用：哪些问题适合用 channel，哪些问题更适合用锁，channel
的开销从何而来，以及其他语言中的 channel 作了哪些不同的选择。

「不要通过共享内存来通信，而应通过通信来共享内存」这句格言，常被理解为一切共享状态都应改用 channel 传递，
但 Go 团队并不这样主张。下面先看 Go 团队成员对几种经典并发模式的重新审视，再讨论开销与判别规则，最后把 Go
与其他语言作比较。

## 10.7.1 重新审视经典并发模式

2018 年的 GopherCon 上，Go 团队的 Bryan C. Mills 作了题为「Rethinking Classical Concurrency Patterns」
的报告 [[Mills, 2018a](#ref-mills-2018a)]，逐一检视从其他语言沿袭而来的几种模式：异步 API 中的 future
与生产者消费者队列、条件变量，以及 worker pool。报告归结为两条原则：有需要并发执行的工作时才启动
goroutine；通过通信来共享。

条件变量（[11.4](../ch11sync/cond.md)）与一把锁配合使用：等待的一方持有锁检查条件，条件不成立时调用
`Wait`，原子地释放锁并挂起；改变状态的一方调用 `Signal` 唤醒一个等待者，或调用 `Broadcast`
唤醒全部等待者。Mills 以一个无界队列为例。若队列提供 `GetMany(n)`，等攒够 n 个元素后一次取走，那么 `Put`
每放入一个元素，都不知道哪一个等待者因此可以继续，只能调用 `Broadcast`。报告列出了这种写法的四个问题：

- 无效的唤醒。一次 `Put` 唤醒所有 `GetMany`，其中至多一个能够取走元素，其余的检查条件之后重新等待。`sync.Cond`
  本身不会无故唤醒等待者，Mills 在别处特意澄清过：问题在于同一个条件变量代表了许多个不同的条
  件，每个等待者都会被与自己无关的变化唤醒 [[Mills, 2017a](#ref-mills-2017a)]。
- 遗漏的通知。条件变量把通知与数据分开，日后新增一处修改数据的代码，很容易忘记发出通知；
  为减少无效唤醒而删减通知时，又可能删掉必要的一次。
- 饥饿。设一个调用者在等待 `GetMany(3000)`，另一个调用者在循环中反复调用 `GetMany(3)`。
  两者被唤醒的机会大致相同，但后者每次醒来都能取走 3 个元素，队列始终接近于空，前者永远等不到 3000 个。
- 无法响应取消。`Wait` 只能等待与它的锁相关联的事件，不能与 `ctx.Done()` 一起放进 `select`，
  调用者取消之后，等待者仍要等到下一次通知才能察觉。Brad Fitzpatrick 在 2016 年提议让 `select`
  能够等待条件变量 [[Fitzpatrick, 2016](#ref-fitzpatrick-2016)]，这一提案至今悬而未决。

Mills 认为，这些问题的根源在于条件变量本身就是「通过共享内存来通信」：它只通知等待者「有变化」，
至于变化是什么，要由被唤醒者自己去检查共享变量。对策是直接传递那样东西本身：资源、数据，
以及「谁需要哪些数据」这样的元数据。下面的队列按报告中的写法改写，`items` 中存放非空的元素切片，`empty`
中的 `true` 表示队列为空：

```go {run=true}
package main

import (
	"context"
	"fmt"
	"time"
)

type Queue struct {
	items chan []int // 非空的元素切片
	empty chan bool  // 持有 true 时队列为空
}

func NewQueue() *Queue {
	q := &Queue{items: make(chan []int, 1), empty: make(chan bool, 1)}
	q.empty <- true
	return q
}

func (q *Queue) Put(v int) {
	var items []int
	select {
	case items = <-q.items:
	case <-q.empty:
	}
	q.items <- append(items, v)
}

func (q *Queue) Get(ctx context.Context) (int, error) {
	var items []int
	select {
	case items = <-q.items:
	case <-ctx.Done():
		return 0, ctx.Err()
	}
	v := items[0]
	if len(items) == 1 {
		q.empty <- true
	} else {
		q.items <- items[1:]
	}
	return v, nil
}

func main() {
	q := NewQueue()
	q.Put(1)
	q.Put(2)
	ctx := context.Background()
	for range 2 {
		v, err := q.Get(ctx)
		fmt.Println(v, err)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Millisecond)
	defer cancel()
	_, err := q.Get(ctx) // 队列已空，等待至超时
	fmt.Println(err)
}
```

```
1 <nil>
2 <nil>
context deadline exceeded
```

两个 channel 的容量都是 1，合起来至多持有一个值。取出这个值的 goroutine 便独占了队列，直到把值放回，因此
`items` 起到了锁的作用，`empty` 则相当于只有一个名额的信号量。`Get` 等到的就是元素本身，
不会出现醒来之后发现条件并不成立的情形；它与 `ctx.Done()` 放在同一个 `select` 中，取消立即生效。

Mills 对 worker pool 的分析与此类似。worker pool 预先启动固定数目的 goroutine，由它们从一个任务 channel
中领取工作。在以线程为执行单位的语言中，它的好处是复用开销较大的线程；goroutine 的开销很小，这一好处在 Go
中不复存在，剩下的只有限制同时进行的工作量。代价则是要管理这批 goroutine 的生命周期：任务 channel
若未关闭，worker 便永远阻塞，造成泄漏；即使最终正确关闭，它们也可能长时间空等。程序死锁时，空闲的 worker
会充斥 goroutine 转储，掩盖真正卡住的几个。报告展示了一次测试失败时的转储，其中只有一个容纳一百个 worker
的池子，死锁中的一个 goroutine 却出现在第四页的末尾。goroutine 轻量，但并非没有开销：每个空闲的 worker
至少占着一个 2 KB 的栈（[1.2.2](../../part1overview/ch01intro/go.md)）。

Mills 的替代办法是在有任务时才启动 goroutine，用带缓冲 channel 作信号量来限制同时进行的任务数，即
[10.6.3](./lockfree.md) 中的写法。不同之处在于获取名额的位置：Mills 在 `go` 语句之前获取，
这样等待名额的只有分派任务的那一个 goroutine，不会有一批已经启动、却无事可做的 goroutine。

早在 2017 年，Mills 就提议在 Go 2 中删除 `sync.Cond`
[[Mills, 2017b](#ref-mills-2017b)]，理由是在 #16620 的讨论中，人们描述的大多数用例改用 channel
都能正常工作：`Broadcast` 对应关闭 channel（[10.4.3](./close.md)），`Signal` 对应发送。
提案还逐一检查了标准库中为数不多的几处 `sync.Cond`，认为其中多数只用到 `Broadcast`，可以直接换成 channel。Go
1.19 起，`sync.Cond` 的文档写道：「对许多简单的用例，使用 channel 会比使用 Cond 更好（Broadcast
对应关闭 channel，Signal 对应在 channel 上发送）。」文档还附上了 Mills 这次报告的链接
[[Burke, 2022](#ref-burke-2022)]。

删除的提议在 2023 年被拒绝。Russ Cox 写道：「即使在 sync 的第 2 版中，我也很难相信我们会删除 Cond。
条件变量是许多抽象的基本构件。大多数用户确实应当使用更高层的抽象，但 sync 包的存在也正是为了提供这些构件，Cond
和 Mutex 都是。」[[Cox, 2023a](#ref-cox-2023a)] Cox 还附上了自己刚写的一个工作队列：起初尝试用
channel，但在已经持有一把互斥锁的情况下还要考虑 channel 的同步，令人沮丧，而 `sync.Cond`
似乎恰好表达了想要表达的意思 [[Cox, 2023b](#ref-cox-2023b)]。文档的建议与这次拒绝合起来，就是 Go
团队目前的立场：简单的用例用 channel，条件变量作为构件保留。

## 10.7.2 开销从何而来

「channel 比互斥锁慢」是流传很广的说法。下面的程序在一个 goroutine 中测量几种同步操作的开销，其中无缓冲
channel 的往返需要另一个 goroutine 应答：

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

func main() {
	var n atomic.Int64
	var mu sync.Mutex
	lock := make(chan struct{}, 1)
	ping, pong := make(chan int), make(chan int)
	go func() {
		for v := range ping {
			pong <- v
		}
	}()

	for _, c := range []struct {
		name string
		f    func()
	}{
		{"atomic.Int64.Add", func() { n.Add(1) }},
		{"Mutex 加锁再解锁", func() { mu.Lock(); mu.Unlock() }},
		{"容量为 1 的 channel 当锁", func() { lock <- struct{}{}; <-lock }},
		{"无缓冲 channel 往返一次", func() { ping <- 1; <-pong }},
	} {
		r := testing.Benchmark(func(b *testing.B) {
			for b.Loop() {
				c.f()
			}
		})
		fmt.Printf("%6.1f ns  %s\n", float64(r.T.Nanoseconds())/float64(r.N), c.name)
	}
}
```

某一次运行的结果如下（Apple M5 Pro，Go 1.26.10）：

```
   1.9 ns  atomic.Int64.Add
   5.4 ns  Mutex 加锁再解锁
  14.1 ns  容量为 1 的 channel 当锁
 207.5 ns  无缓冲 channel 往返一次
```

无竞争时，`sync.Mutex`（[11.2](../ch11sync/mutex.md)）的加锁是一次比较并交换，
解锁是一次原子加法（[11.3](../ch11sync/atomic.md)），二者都能内联到调用处，不进入运行时
[[Go Authors, 2026b](#ref-go-authors-2026b)]。把容量为 1 的 channel 当锁用时，
发送与接收各调用一次运行时函数，在 `hchan.lock` 的保护下拷贝元素、移动缓冲区的下标（[10.2.6](./impl.md)、[10.3.1](./sendrecv.md)），
开销近于互斥锁的三倍。只有非阻塞操作失败时可以不加锁
（[10.3.5](./sendrecv.md)），成功的发送和接收总要获取这把锁。

无缓冲 channel 往返一次则要慢一个数量级以上。每一次传递都要让一方挂起、
由另一方唤醒（[10.3.3](./sendrecv.md)），往返一次就是两次 goroutine 切换，开销的大头在调度，而不在锁。Go
的 FAQ 也提醒，花在同步与通信上的时间多于有用计算的程序，在多个线程上运行反而可能变慢，
因为在线程之间传递数据需要切换上下文；语言规范中的素数筛就是这样的例子
[[Go Authors, 2026a](#ref-go-authors-2026a)]。

不过，这些差距只在同步本身成为热点时才有意义。为 errgroup 加入并发上限时（10.7.4），
曾比较过用互斥锁管理等待者与用 channel 作信号量两种实现，每次 `Go` 调用的耗时没有显著差别（247 ns 对
245 ns），后者每次调用分配的内存还少 8 字节 [[Ou, 2022a](#ref-ou-2022a)]：
两者的差别淹没在每次调用的其余开销之中。Mills 在报告末尾也说明，所推荐的写法以清晰和健壮为目标，
渐近复杂度与常数因子都合理，但没有做过基准测试；如果出于性能考虑选用了报告中不推荐的写法，
应当把理由写进文档，并把支持这一选择的基准测试一起提交，因为语言本身变化不多，实现却一直在变
[[Mills, 2018a](#ref-mills-2018a)]。

## 10.7.3 判别规则

这句格言出自 Effective Go。Andrew Gerrand 在 2010 年的博文中用一个例子说明它
[[Gerrand, 2010](#ref-gerrand-2010)]：若干个轮询者反复从一组 URL 中取出一个去访问。按传统的线程写法，
每个资源要记录「是否正在轮询」与「上次轮询的时间」，整个列表由一把锁保护，轮询者加锁挑出最久未轮询的资源、
作标记、解锁，访问结束后再加锁更新记录；按 Go 的写法，轮询者从一个 channel 接收资源，
处理完毕后发送到另一个 channel，簿记字段与加锁的逻辑一并消失。资源在任一时刻只属于一个 goroutine，
发送即交出，接收即取得。由 [10.6.1](./lockfree.md) 的规则，发送之前的写入对接收者可见，
所有权的交接本身就完成了同步。

Go 的 FAQ 在「What operations are atomic? What about mutexes?」一条中写道，`sync` 与 `sync/atomic`
包适合简单的任务，例如递增引用计数、保证小范围的互斥；对于协调多个并发服务器这类更高层的操作，用
goroutine 与 channel 往往能写出更好的程序，例如让一份数据在任一时刻只由一个 goroutine 负责。FAQ 同时说明：
「大型并发程序很可能同时借用这两套工具。」[[Go Authors, 2026a](#ref-go-authors-2026a)]

Go Wiki 的「Use a sync.Mutex or a channel?」一页说得更直接：哪种写法表达力最强、最简单，就用哪种
[[Go Authors, 2026c](#ref-go-authors-2026c)]。它指出新手常犯的错误是过度使用 channel 与 goroutine，
只因为可以这样写，或者这样写很有趣；并给出一份对照：channel 适合传递数据的所有权、分发工作单元、
传递异步结果，互斥锁适合缓存与状态。反过来，如果互斥锁的加锁规则变得过于复杂，就该想一想改用 channel
是否更简单。

归结起来，channel 管数据的流动与所有权的转移，互斥锁管状态的就地保护。10.7.1 中的队列看似用 channel
保护状态，实际传递的正是状态本身：取到切片的 goroutine，也就取得了队列的所有权。

## 10.7.4 errgroup

一组任务不仅要全部结束，还要在任一任务出错时取消其余任务、把错误带回调用者，这时可以使用
`golang.org/x/sync/errgroup`。它属于扩展库 `x/sync`，不在标准库中，由 Mills 于 2016 年加入
[[Mills, 2016](#ref-mills-2016)]：

```go
func fetchAll(ctx context.Context, urls []string) error {
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(8) // 至多 8 个请求同时进行
	for _, url := range urls {
		g.Go(func() error {
			return fetch(ctx, url) // 任一请求出错，ctx 即被取消
		})
	}
	return g.Wait() // 等待全部结束，返回第一个错误
}
```

`Group` 的实现很短：

```go
type Group struct {
	cancel func(error)

	wg sync.WaitGroup

	sem chan token

	errOnce sync.Once
	err     error
}
```

`Go` 在新的 goroutine 中运行函数，由 `wg`（[11.5](../ch11sync/waitgroup.md)）计数。第一个非 nil 的错误由
`errOnce` 记下；若 `Group` 由 `WithContext` 创建，还同时调用 `cancel` 取消派生的 context，
取消的原因（`context.Cause`）就是这个错误；其余 goroutine 经由 context 的 `Done` channel
得知取消（[11.8](../ch11sync/context.md)）。`Wait` 等所有 goroutine 结束后取消 context，返回记下的错误。
整个过程不需要 `select`：错误由 `sync.Once` 收集，取消由 context 传播。

2022 年加入的 `SetLimit` 与 `TryGo` [[Ou, 2022a](#ref-ou-2022a)]实现了并发上限，用的正是 10.7.1 中 Mills
的信号量：`sem` 是容量等于上限的 channel，`Go` 在启动 goroutine 之前向它发送，goroutine 结束时从中接收。`TryGo`
把这次发送放进带 `default` 分支的 `select`，名额已满时立即返回 false，
走的是非阻塞发送的快速路径（[10.3.5](./sendrecv.md)）。

`Wait` 只返回第一个错误。有人提议让它返回全部错误，Mills 表示反对：那样 errgroup
占用的存储将随任务数线性增长，而不再是常数；而且「在典型的 errgroup 用法中，
第一个错误之后的错误都是由第一个错误触发的取消引起的，因而并不可靠」[[Mills, 2025](#ref-mills-2025)]。

## 10.7.5 跨语言对照

Go 的 FAQ 在解释为何以 CSP [[Hoare, 1978](#ref-hoare-1978)]为并发的基础时写道：「Occam 与 Erlang
是两门源自 CSP 的知名语言。Go 的并发原语来自这个家族的另一支，这一支的主要贡献，是把 channel
作为一等对象这一强有力的概念。」[[Go Authors, 2026a](#ref-go-authors-2026a)]这一支的来历见
[1.3.4](../../part1overview/ch01intro/csp.md)，CSP 与 Actor 模型的区别见
[1.3.6](../../part1overview/ch01intro/csp.md)。这里只比较几种 channel 在使用上的差异：

| | 默认容量 | 收发双方 | 多路选择 | 多个分支同时就绪时 | 关闭 |
| --- | --- | --- | --- | --- | --- |
| Go | 0，即会合 | 多对多 | `select`，分支在编译时确定 | 均匀随机 | 由发送方 `close`；重复关闭、向已关闭的 channel 发送均 panic |
| occam | 只有会合 | 一对一 | `ALT`，只能等待输入 | 语言不作规定；`PRI ALT` 按书写次序 | 无此操作 |
| Erlang | 无上限的信箱 | 发往进程 | `receive`，按模式匹配 | 取信箱中最早到达的匹配消息 | 无 channel；向进程发送永不失败 |
| Clojure core.async | 0，即会合 | 多对多 | `alts!`，操作个数可在运行时决定 | 随机；可指定按次序 | `close!`；之后的放入被忽略，重复关闭无效果 |
| Rust `std::sync::mpsc` | `channel()` 无上限；`sync_channel(n)` 容量为 n | 多对一 | 标准库不提供 | 不适用 | 无显式关闭；一端全部销毁即断开，另一端的操作返回错误 |
| Kotlin `Channel` | 0，即会合 | 多对多 | `select` 表达式 | 偏向第一个分支；`selectUnbiased` 随机 | `close`；之后的发送抛出异常，重复关闭返回 false |

默认容量上，Go、occam、core.async 与 Kotlin 都以会合为默认，Erlang 的信箱与 Rust 的 `channel()`
则没有上限，发送永不等待。Rich Hickey 在 core.async 的公告中解释了为何不鼓励无界缓冲：有界缓冲加上阻塞，
是协调速率、施加背压的重要工具，能保证系统不会接下超出其处理能力的工作
[[Hickey, 2013](#ref-hickey-2013)]。无界的信箱还有另一项代价：Erlang 的 `receive` 从信箱头部起逐条匹配，
耗时与匹配消息之前的消息数成正比，信箱很长而模式只匹配特定消息时，一次接收可能非常昂贵
[[Erlang/OTP, 2026](#ref-erlang-otp-2026)]。

多路选择上，Hoare 1978 年的论文对多个守卫同时成立时选择哪一个不作规定
（[1.3.2](../../part1overview/ch01intro/csp.md)），occam 沿用了这一点，另以 `PRI ALT`
按书写次序给出优先级；occam 的 `ALT` 也与原文一样只能等待输入
[[SGS-THOMSON, 1995](#ref-sgs-thomson-1995)]，Go 的 `select` 则也能等待发送（[10.5.6](./select.md)）。Go
把选择规定为均匀随机，不提供优先级（[10.5.3](./select.md)）；core.async 默认随机，可以要求按次序尝试；Kotlin
则默认偏向第一个分支，需要随机时另用 `selectUnbiased` [[JetBrains, 2026](#ref-jetbrains-2026)]。Hickey
列出的 core.async 与 Go 的四点区别中，有两点就在这里：`alts!` 是函数，操作的个数可以在运行时决定，
而 Go 的 `select` 分支在编译时确定，运行时可变的选择须借助 `reflect.Select`（[10.5.5](./select.md)）；`alt`
支持优先级，Go 的 `select` 不支持。

关闭上，各家差别最大。Go 的 `close` 由发送方宣告「不再有数据」，接收方据此结束（[10.4.2](./close.md)）；
反过来，接收方全部离开时发送方无从得知，阻塞在发送上的 goroutine 将永远等待，这是 goroutine
泄漏的常见来源（[10.4.5](./close.md)、[9.3.4](../ch09sched/mpg.md)）。Rust 没有显式的关闭，
而是把断开做成双向的：所有发送端销毁之后，接收在取完剩余消息时返回错误；接收端销毁之后，发送返回错误
[[Rust Project, 2026](#ref-rust-project-2026)]。core.async 与 Kotlin 都允许重复关闭而不报错
[[Clojure, 2026](#ref-clojure-2026)] [[JetBrains, 2026](#ref-jetbrains-2026)]，Go
则对重复关闭与向已关闭的 channel 发送一律 panic（[10.4.4](./close.md)）。

类型上，Go、occam（以协议声明 channel 上传递的数据）、Rust 与 Kotlin 的 channel 都有静态类型，Erlang 与
Clojure 是动态类型语言。Erlang 是 Actor 模型的代表，消息发往进程而不是 channel。Hickey 在公告中说明了
core.async 为何不采用 actor：「我对 actor 依然没有热情。它们仍然把生产者与消费者耦合在一起。……既然任何
actor 机制都已包含一个队列，队列看来显然是更基本的。」[[Hickey, 2013](#ref-hickey-2013)]

## 10.7.6 结构化并发

[3.6.5](../../part1overview/ch03life/main.md) 介绍了 Nathaniel J. Smith 2018 年的文章与结构化并发的含义
[[Smith, 2018a](#ref-smith-2018a)]，[11.8.5](../ch11sync/context.md) 比较了各语言的做法，这里只补充 Go
社区中的讨论。同年，Matthias Urlichs 援引 Smith 的文章，提议在 Go 2 中让 `go`
语句返回一个必须赋给变量的值，变量离开作用域时，运行时等待对应的 goroutine 结束
[[Urlichs, 2018](#ref-urlichs-2018)]。Ian Lance Taylor 随即指出，这会破坏几乎所有现有的 Go 代码
[[Taylor, 2018a](#ref-taylor-2018a)]。Mills 则提醒，让 goroutine 停止通常靠 `context`，而 errgroup
已经把错误与取消协调在一起，并问是否应把它移入标准库 [[Mills, 2018b](#ref-mills-2018b)]。Smith
本人也加入了讨论，说那篇文章被一些人拿来当作对 Go 的猛烈抨击，这从来不是写作的本意；如果要为 Go
补上结构化并发，Smith 会设法让 errgroup 及其取消与错误传播写起来尽量简短、用得尽量普遍
[[Smith, 2018b](#ref-smith-2018b)]。不到三周后，Taylor 关闭了提案：结构化并发领域或许有值得改进之处，
但这一提案只给出一种技术，即简化对 goroutine 结束的等待，是否应当为这一种情形修改语言而不顾其他情形，
并不清楚 [[Taylor, 2018b](#ref-taylor-2018b)]。

此后的进展都在库与工具一层。2022 年的提案 #57534 建议把 errgroup 移入标准库 [[Ou, 2022b](#ref-ou-2022b)]，
至今未有结论；Go 1.25 加入的 `sync.WaitGroup.Go` 使「启动时即登记」
成为最简单的写法（[10.6.3](./lockfree.md) 中用过）；Go 1.26 提供了实验性的 goroutine 泄漏剖析，
可以在事后找出永远阻塞的 goroutine（[9.3.4](../ch09sched/mpg.md)）。`go` 语句本身没有改变，goroutine
的生命周期仍然靠约定与工具来约束。

## 延伸阅读

- <a id="ref-burke-2022"></a>[Burke, 2022] Kevin Burke. sync: add more notes about Cond behavior. Go
  commit d42a48828f, 2022. https://go.dev/cl/412237
  随 Go 1.19 发布；`sync.Cond` 的文档自此建议简单的用例改用 channel，并链接 [Mills, 2018a] 的幻灯片。
- <a id="ref-clojure-2026"></a>[Clojure, 2026] Clojure. *clojure.core.async API
  Reference*（`alts!`、`close!`）. https://clojure.github.io/core.async/clojure.core.async.html
- <a id="ref-cox-2023a"></a>[Cox, 2023a] Russ Cox. Comment on golang/go#21165, 2023.
  https://github.com/golang/go/issues/21165#issuecomment-1611825240
  2023 年 6 月 28 日：认为即使在 sync 的第 2 版中也不会删除 `Cond`。
- <a id="ref-cox-2023b"></a>[Cox, 2023b] Russ Cox. Comment on golang/go#21165, 2023.
  https://github.com/golang/go/issues/21165#issuecomment-1622392204
  2023 年 7 月 5 日：附上一个用 `sync.Cond` 写成的工作队列。提案于 7 月 12 日被拒绝。
- <a id="ref-erlang-otp-2026"></a>[Erlang/OTP, 2026] Erlang/OTP. *Erlang System Documentation:
  Expressions*（节「Send」「Receive」）. https://www.erlang.org/doc/system/expressions.html
- <a id="ref-fitzpatrick-2016"></a>[Fitzpatrick, 2016] Brad Fitzpatrick. Go issue #16620. *proposal: sync:
  mechanism to select on condition variables.* 2016. https://github.com/golang/go/issues/16620
  截至 2026 年仍未关闭。
- <a id="ref-gerrand-2010"></a>[Gerrand, 2010] Andrew Gerrand. "Share Memory By Communicating."
  *The Go Blog*, 2010. https://go.dev/blog/codelab-share
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Frequently Asked Questions (FAQ)*:
  "Why build concurrency on the ideas of CSP?", "What operations are atomic? What about mutexes?", "Why
  doesn't my program run faster with more CPUs?" https://go.dev/doc/faq
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  *src/internal/sync/mutex.go*（`Lock`、`Unlock` 的快速路径）.
  https://github.com/golang/go/blob/release-branch.go1.26/src/internal/sync/mutex.go
  Go 1.24 起，`sync.Mutex` 的实现移入 `internal/sync`。
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Go Wiki: Use a sync.Mutex or a
  channel?* https://go.dev/wiki/MutexOrChannel
- <a id="ref-hickey-2013"></a>[Hickey, 2013] Rich Hickey. "Clojure core.async Channels."
  *clojure.org news*, 2013. https://clojure.org/news/2013/06/28/clojure-clore-async-channels
  core.async 的公告博文，讨论有界缓冲、`alts!`、与 Go channel 的区别，以及不采用 actor 的理由。
- <a id="ref-hoare-1978"></a>[Hoare, 1978] C. A. R. Hoare. "Communicating Sequential Processes."
  *Communications of the ACM*, 21(8), 1978. https://doi.org/10.1145/359576.359585
  CSP 的原始论文；进程以名称指定通信对象，选择命令源自 Dijkstra 的守卫命令（见 1.3.2）。
- <a id="ref-jetbrains-2026"></a>[JetBrains, 2026] JetBrains. *kotlinx.coroutines API
  Reference*（`Channel`、`SendChannel.close`、`select`）.
  https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.channels/-channel/
  多个协程收发同一 channel，见 Kotlin 文档「Channels」一节：https://kotlinlang.org/docs/channels.html
- <a id="ref-mills-2016"></a>[Mills, 2016] Bryan C. Mills. errgroup: add package. golang.org/x/sync commit
  457c582840, 2016. https://go.dev/cl/24894
  当前源码见 https://github.com/golang/sync/blob/master/errgroup/errgroup.go 。
- <a id="ref-mills-2017a"></a>[Mills, 2017a] Bryan C. Mills. Comment on golang/go#16620, 2017.
  https://github.com/golang/go/issues/16620#issuecomment-318192471
  2017 年 7 月 26 日：`sync.Cond` 本身不会无故唤醒，无效的唤醒来自用一个条件变量表示多个条件。
- <a id="ref-mills-2017b"></a>[Mills, 2017b] Bryan C. Mills. Go issue #21165. *proposal: sync: remove the
  Cond type.* 2017. https://github.com/golang/go/issues/21165
  2023 年被拒绝，见 [Cox, 2023a] 与 [Cox, 2023b]。
- <a id="ref-mills-2018a"></a>[Mills, 2018a] Bryan C. Mills. "Rethinking Classical Concurrency Patterns."
  *GopherCon 2018.* https://www.youtube.com/watch?v=5zXAHh5tJqQ
  条件变量、worker pool 等范式的再审视。幻灯片附有讲稿：https://drive.google.com/file/d/1nPdvhB0PutEJzdCq5ms6UI58dp50fcAN/view
- <a id="ref-mills-2018b"></a>[Mills, 2018b] Bryan C. Mills. Comment on golang/go#29011, 2018.
  https://github.com/golang/go/issues/29011#issuecomment-443023764
- <a id="ref-mills-2025"></a>[Mills, 2025] Bryan C. Mills. Comment on golang/go#57534, 2025.
  https://github.com/golang/go/issues/57534#issuecomment-2568403633
  2025 年 1 月 2 日：反对让 errgroup 返回全部错误。
- <a id="ref-ou-2022a"></a>[Ou, 2022a] Changkun Ou. x/sync/errgroup: add TryGo and SetLimit to control
  concurrency. golang.org/x/sync commit 0976fa681c, 2022. https://go.dev/cl/405174
  实现 Toby Burress 于 2018 年提出的 issue #27837；提交说明中给出了两种实现的基准测试。
- <a id="ref-ou-2022b"></a>[Ou, 2022b] Changkun Ou. Go issue #57534. *proposal: sync: add
  golang.org/x/sync/errgroup.* 2022. https://github.com/golang/go/issues/57534
  截至 2026 年仍未关闭。
- <a id="ref-rust-project-2026"></a>[Rust Project, 2026] The Rust Project. *Module `std::sync::mpsc`.*
  https://doc.rust-lang.org/std/sync/mpsc/
  `channel` 异步无界 vs `sync_channel` 会合。
- <a id="ref-sgs-thomson-1995"></a>[SGS-THOMSON, 1995] SGS-THOMSON Microelectronics. *occam 2.1 Reference
  Manual.* 1995. http://www.wotug.org/occam/documentation/oc21refman.pdf
  初版为 1988 年的 occam 2 Reference Manual；第 2.6 节讨论 `ALT`，第 2.6.2 节讨论 `PRI ALT`。
- <a id="ref-smith-2018a"></a>[Smith, 2018a] Nathaniel J. Smith. "Notes on structured concurrency, or: Go
  statement considered harmful." 2018.
  https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/
  nursery 与结构化并发的源头论述。
- <a id="ref-smith-2018b"></a>[Smith, 2018b] Nathaniel J. Smith. Comment on golang/go#29011, 2018.
  https://github.com/golang/go/issues/29011#issuecomment-443138892
- <a id="ref-taylor-2018a"></a>[Taylor, 2018a] Ian Lance Taylor. Comment on golang/go#29011, 2018.
  https://github.com/golang/go/issues/29011#issuecomment-443023264
- <a id="ref-taylor-2018b"></a>[Taylor, 2018b] Ian Lance Taylor. Comment on golang/go#29011, 2018.
  https://github.com/golang/go/issues/29011#issuecomment-448387797
  2018 年 12 月 18 日：关闭提案时的说明。
- <a id="ref-urlichs-2018"></a>[Urlichs, 2018] Matthias Urlichs. Go issue #29011. *proposal: Go 2: use
  structured concurrency.* 2018. https://github.com/golang/go/issues/29011
- 本书 [11.2 互斥锁](../ch11sync/mutex.md)、[11.3 原子操作](../ch11sync/atomic.md)、[11.5
  同步组](../ch11sync/waitgroup.md)、[11.8 上下文](../ch11sync/context.md).
