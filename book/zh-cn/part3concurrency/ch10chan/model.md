---
weight: 3201
title: "10.1 通道与 CSP 的工程化"
---

# 10.1 通道与 CSP 的工程化

> 本节内容提供一个线上演讲：[YouTube 在线](https://www.youtube.com/watch?v=d7fFCGGn0Wc)，
> [Google Slides 讲稿](https://changkun.de/s/chansrc/)。

[1.3](../../part1overview/ch01intro/csp.md) 追溯了 channel 的来历：从 Hoare 1978 年按进程名称通信的 CSP
[[Hoare, 1978](#ref-hoare-1978)]，到 Newsqueak 中可以自由传递的 channel，再到 Go；
那一节也演示了会合与缓冲的区别、素数筛和 `select` 的随机选择。本节不再重复这些内容，而是给出 channel
在语言层面的确切语义：它的类型与方向，它在不同状态下对各种操作的反应，它提供的同步保证，以及 `select`
的求值规则。后续各节讨论的运行时代码，实现的正是这些规则。本节最后回顾这些规则在 Go 1
之前是如何确定下来的。

## 10.1.1 类型与方向

Go 语言规范对 **channel** 的定义是：一种供并发执行的函数通过收发指定元素类型的值来通信的机制
[[Go Authors, 2026a](#ref-go-authors-2026a)]。channel 是普通的值，可以存入变量、作为参数和返回值传递，
也可以经由另一个 channel 发送。未初始化的 channel 的值为 `nil`，用 `make` 创建：

```go
ch := make(chan int)     // 无缓冲：只有收发双方都就绪时通信才能完成
buf := make(chan int, 8) // 有缓冲：缓冲区未满时发送、非空时接收都不阻塞
```

channel 类型可以带有方向。`chan<- T` 只能用于发送，`<-chan T` 只能用于接收。双向 channel
可以通过赋值或显式转换收窄为单向 channel，反之则不行。常见的写法是在一处用 `make` 创建双向 channel，
再分别以只发与只收两种类型交给生产者与消费者：

```go
func produce(out chan<- int) { // out 只能发送
	for i := range 10 {
		out <- i
	}
	close(out)
}

func consume(in <-chan int) { // in 只能接收
	for v := range in {
		use(v)
	}
}
```

方向不改变运行时的行为，它是编译期的约束：从 `out` 接收、向 `in` 发送都无法通过编译。对只能接收的 channel
调用 `close` 同样是编译错误，所以关闭 channel 的只能是持有发送端的一方，这与「由发送方关闭」
的惯例（[10.4](./close.md)）一致。

规范还规定了两条容易被忽略的性质：任意多个 goroutine 可以不加其他同步地对同一个 channel 发送、
接收以及调用 `len` 与 `cap`；channel 是先进先出的队列，一个 goroutine 依次发送的值，会被另一个 goroutine
按发送的次序收到。

## 10.1.2 三种状态下的操作

一个 channel 处于三种状态之一：为 `nil`、已创建且未关闭、已关闭。各种操作在这三种状态下的结果如下：

| 操作 | `nil` | 未关闭 | 已关闭 |
| --- | --- | --- | --- |
| 发送 `ch <- v` | 永久阻塞 | 能完成时完成，否则阻塞 | panic |
| 接收 `<-ch` | 永久阻塞 | 能完成时完成，否则阻塞 | 先取出缓冲区中剩余的值，取空后立即返回零值 |
| `v, ok := <-ch` | 永久阻塞 | `ok` 为 `true` | 取出剩余值时 `ok` 为 `true`，之后为 `false` |
| `close(ch)` | panic | 成功 | panic |
| `len(ch)`、`cap(ch)` | 0 | 缓冲区中的元素数、缓冲区容量 | 同左 |
| `for v := range ch` | 永久阻塞 | 逐个接收 | 取完剩余值后结束 |

接收的双返回值形式中，`ok` 报告收到的值是否来自一次成功的发送；为 `false` 时，收到的是因 channel
已关闭且已取空而产生的零值。`range` 循环反复接收，直到 channel 关闭且取空为止，
是消费一个数据流的常用写法。三种 panic 在运行时中的位置及其错误信息，见 [10.4](./close.md)。

## 10.1.3 同步保证

channel 不只传递数据，也同步收发双方。Go 内存模型对 channel 给出了四条规则，前三条是：
一次发送同步先于与之对应的接收完成；channel 的关闭同步先于因关闭而返回零值的接收；对于无缓冲 channel，
一次接收同步先于与之对应的发送完成 [[Go Authors, 2022](#ref-go-authors-2022)]。
第一条保证发送方在发送之前写入的数据，接收方在接收之后一定能看到；第三条说明无缓冲 channel 的发送返回时，
值已经被对方取走。第四条针对有缓冲 channel，它使有缓冲 channel 可以用作计数信号量。
这些规则的含义与它们在运行时中的落实，在 [10.6](./lockfree.md) 中讨论。

容量的选择因此首先是语义的选择。需要「对方已经收到」这样的确认时，用无缓冲 channel，会合本身就是确认。
需要让生产者与消费者在时间上解耦，或者为尚未处理的数据设定上限时，用有缓冲 channel，容量就是这个上限；`make(chan struct{}, k)`
配合「发送时占用、接收时释放」，可以把同时进行的任务数限制在 $k$ 以内
[[Go Authors, 2026b](#ref-go-authors-2026b)]。缓冲区只能减少较快一方的等待，
不能让较慢的一方变快（[1.3.5](../../part1overview/ch01intro/csp.md) 中的演示）。把容量设得很大，
往往只是推迟了阻塞发生的时刻，同时让积压变得不易察觉。容量是需要论证的设计参数，而不是调大就能提速的开关。

## 10.1.4 select 与 nil channel

规范把 `select` 语句的执行分为几步 [[Go Authors, 2026a](#ref-go-authors-2026a)]。首先，按源码次序对所有
case 中接收操作的 channel 操作数、发送语句的 channel 与待发送的值各求值一次，无论最终选中哪个 case，
求值的副作用都会发生。然后，若有一个或多个通信可以进行，以均匀的伪随机方式选择其中一个；
若都不能进行而存在 `default`，执行 `default`；否则阻塞，直到某个通信可以进行。随机选择的效果见
[1.3.5](../../part1overview/ch01intro/csp.md)，它在运行时中的实现见 [10.5](./select.md)。

nil channel 上的收发永远不能进行，因此 `select` 永远不会选中 nil channel 上的 case。把某个 case 所用的
channel 变量置为 `nil`，就可以在运行中禁用这个 case，而不必改变 `select` 的结构
[[Ajmani, 2013](#ref-ajmani-2013)]。下面的程序合并两路输入，这是 Pike 介绍过的扇入（fan-in）模式
[[Pike, 2012a](#ref-pike-2012a)]；某一路关闭后，就把对应的变量置为 `nil`：

```go {run=true}
package main

import "fmt"

// gen 启动一个 goroutine，依次发送 n 个值后关闭 channel。
func gen(n int) <-chan int {
	ch := make(chan int)
	go func() {
		for i := range n {
			ch <- i
		}
		close(ch)
	}()
	return ch
}

func main() {
	a, b := gen(3), gen(5)
	values, closes := 0, 0
	for a != nil || b != nil {
		select {
		case _, ok := <-a:
			if !ok {
				a = nil // a 已关闭且取空：此后这个分支不会再被选中
				closes++
				continue
			}
			values++
		case _, ok := <-b:
			if !ok {
				b = nil
				closes++
				continue
			}
			values++
		}
	}
	fmt.Println("收到的值:", values, " 发现关闭:", closes)
}
```

```
收到的值: 8  发现关闭: 2
```

循环恰好执行 10 次：8 次收到值，2 次发现关闭。如果发现关闭后不把变量置为 `nil`，已关闭的 channel
每次都能立即返回零值，`select` 会反复选中它，循环既不会结束，也不会阻塞。

「进入 `select` 时对所有 case 求值」这一条也有陷阱。Ajmani 的例子中，一个 goroutine 想把待发送队列
`pending` 的第一个元素发出去，于是写下 `case out <- pending[0]`；队列为空时，即使这个 case 不会被选中，`pending[0]`
也会在进入 `select` 时求值，导致越界 panic。解决办法同样是 nil channel：没有数据可发时，
让这个 case 使用一个为 `nil` 的 channel 变量 [[Ajmani, 2013](#ref-ajmani-2013)]。

```go {run=true}
package main

import "fmt"

// naive 在 pending 为空时也会求值 pending[0]，即使 select 带有 default。
func naive(out chan<- int, pending []int) (sent bool) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Println("naive:", r)
		}
	}()
	select {
	case out <- pending[0]:
		return true
	default:
		return false
	}
}

// guarded 在没有数据可发时把 channel 置为 nil，从而禁用发送分支。
func guarded(out chan<- int, pending []int) bool {
	var first int
	var send chan<- int // nil
	if len(pending) > 0 {
		first, send = pending[0], out
	}
	select {
	case send <- first:
		return true
	default:
		return false
	}
}

func main() {
	out := make(chan int, 1)
	naive(out, nil)
	fmt.Println("guarded:", guarded(out, nil))
	fmt.Println("guarded:", guarded(out, []int{42}), <-out)
}
```

```
naive: runtime error: index out of range [0] with length 0
guarded: false
guarded: true 42
```

## 10.1.5 Go 1 之前的演变

上面这些规则大多是在 2010 年至 2012 年间，即 Go 开源之后、Go 1 发布之前确定的。
规范的修改记录显示了其中的考虑。

最早的规范规定，发往已关闭 channel 的值将被忽略。运行时却对已关闭 channel 上的操作计数，累计约
500 次之后便以「too many operations on a closed channel」终止程序，而且这一错误无法被 `recover` 捕获。Nigel
Tao 指出，这样的程序在低负载下工作正常，到了高负载下却会莫名崩溃；向已关闭 channel
发送要么应当立即失败，要么应当永远允许 [[Tao, 2011](#ref-tao-2011)]。2011 年 1 月，Russ Cox 选择了前者：
向已关闭的 channel 发送、重复关闭都立即 panic，而从已关闭的 channel 接收无论多少次都不会 panic
[[Cox, 2011a](#ref-cox-2011a)]。

当时判断 channel 是否关闭，用的是内建函数 `closed(c)`，按规范，它在至少收到一个因关闭而产生的零值之后才
返回 `true`。接收与判断因此是两步操作：先 `v := <-c`，再检查 `closed(c)`。当时的 `v, ok := <-c` 另有含义，
表示非阻塞接收；`ok := c <- v` 则表示非阻塞发送。2011 年 1 月底，这两种非阻塞形式被删除，
因为同样的效果一直可以用带 `default` 的 `select` 写出；当周的发布说明写明，
这一删除是为重新定义接收的双返回值形式做准备 [[Cox, 2011b](#ref-cox-2011b)]。2011 年 3 月，`closed`
被删除，`v, ok := <-c` 改为在一次操作中同时给出收到的值以及它是否来自一次真实的发送
[[Cox, 2011c](#ref-cox-2011c)]。

nil channel 的语义也改过一次。2010 年 7 月，Rob Pike 修改规范 [[Pike, 2010](#ref-pike-2010)]，把 `select`
之外对 nil channel 的收发规定为 panic，同时规定没有可用 case 的 `select` 永久阻塞，并把多个 case
就绪时的选择规定为「伪随机且公平」。2011 年 5 月，Robert Griesemer 改为「nil channel 永远不会就绪」，nil
channel 上的收发因此永久阻塞；同一次修改让 nil map 在读取时表现得与空 map 一样
[[Griesemer, 2011](#ref-griesemer-2011)]。这样，`select` 内外遵循同一条规则，上一小节的技巧也由此成立。

其余的修改如下表所示。

| 时间 | 修改 |
| --- | --- |
| 2011 年 10 月 | 对只能接收的 channel 调用 `close` 成为编译错误 [[Cox, 2011d](#ref-cox-2011d)] |
| 2012 年 1 月 | 选择规则的措辞由「伪随机且公平」改为「均匀的伪随机」[[Pike, 2012b](#ref-pike-2012b)] |
| 2012 年 2 月 | 向已关闭 channel 的发送算作「可以进行」，`select` 可能选中它并因此 panic [[Cox, 2012](#ref-cox-2012)] |
| 2013 年 7 月 | 规范写明 channel 是先进先出的，并且可以不加同步地被多个 goroutine 并发使用 [[Pike, 2013](#ref-pike-2013)] |

Pike 在 2012 年那次修改的提交说明中写道，这一措辞上的斟酌是为了「安抚有理论倾向的读者」。2013
年的修改则把实践中一直依赖的两条性质写进了规范。此后，channel 的核心语义没有再改变；规范中与 channel
相关的修改，都是措辞上的澄清，或泛型引入之后关于类型参数的规则。

## 延伸阅读

- <a id="ref-ajmani-2013"></a>[Ajmani, 2013] Sameer Ajmani. *Advanced Go Concurrency Patterns.* Google I/O
  2013. https://go.dev/talks/2013/advconc.slide （nil channel 在 select 中关闭分支的技巧）
- <a id="ref-cox-2011a"></a>[Cox, 2011a] Russ Cox. spec, runtime, tests: send on closed channel panics. Go
  commit 27c74d3499, 2011. https://github.com/golang/go/commit/27c74d3499
  修复 issue #1349 与 #1419。
- <a id="ref-cox-2011b"></a>[Cox, 2011b] Russ Cox. spec: remove non-blocking channel operators. Go commit
  19d9a40845, 2011. https://github.com/golang/go/commit/19d9a40845
  另见当周的发布说明：https://go.dev/doc/devel/weekly#2011-02-01
- <a id="ref-cox-2011c"></a>[Cox, 2011c] Russ Cox. spec: remove closed from language, replaced by x, ok =
  <-c. Go commit 9f2cb86fe2, 2011. https://github.com/golang/go/commit/9f2cb86fe2
  另见当周的发布说明：https://go.dev/doc/devel/weekly#2011-03-15
- <a id="ref-cox-2011d"></a>[Cox, 2011d] Russ Cox. gc: disallow close on receive-only channels. Go commit
  f58ed4e641, 2011. https://github.com/golang/go/commit/f58ed4e641
- <a id="ref-cox-2012"></a>[Cox, 2012] Russ Cox. spec: send on closed channel counts as "proceeding". Go
  commit e7a138b856, 2012. https://github.com/golang/go/commit/e7a138b856
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *The Go Memory Model.* Version of
  June 6, 2022. https://go.dev/ref/mem
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *The Go Programming Language
  Specification: Channel types, Send statements, Receive operator, Close.*
  https://go.dev/ref/spec#Channel_types
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Effective Go: Channels.*
  https://go.dev/doc/effective_go#channels
- <a id="ref-griesemer-2011"></a>[Griesemer, 2011] Robert Griesemer. go spec: clarify semantics of range
  clause. Go commit 5473103666, 2011. https://github.com/golang/go/commit/5473103666
  nil channel 永远不会就绪，nil map 等同于只读的空 map。
- <a id="ref-hoare-1978"></a>[Hoare, 1978] C. A. R. Hoare. "Communicating Sequential Processes."
  *Communications of the ACM*, 21(8), 1978. https://doi.org/10.1145/359576.359585
- <a id="ref-pike-2010"></a>[Pike, 2010] Rob Pike. Go specification: Lock down some details about channels
  and select. Go commit 041d11623f, 2010. https://github.com/golang/go/commit/041d11623f
- <a id="ref-pike-2012a"></a>[Pike, 2012a] Rob Pike. *Go Concurrency Patterns.* Google I/O 2012.
  https://go.dev/talks/2012/concurrency.slide
- <a id="ref-pike-2012b"></a>[Pike, 2012b] Rob Pike. spec: change the wording regarding select statement
  choice. Go commit 5f7337769c, 2012. https://github.com/golang/go/commit/5f7337769c
- <a id="ref-pike-2013"></a>[Pike, 2013] Rob Pike. spec: clarify a couple of issues about channels. Go
  commit bd65404eef, 2013. https://github.com/golang/go/commit/bd65404eef
  修复 issue #5911。
- <a id="ref-tao-2011"></a>[Tao, 2011] Nigel Tao. golang/go#1419. *Sending on a closed channel should fail
  after 0 or ∞ times, not a finite N > 0.* 2011. https://github.com/golang/go/issues/1419
- 本书 [1.3 通信顺序进程](../../part1overview/ch01intro/csp.md)、[10.6
  内存模型与无锁演进](./lockfree.md)、[11.9 内存一致模型](../ch11sync/mem.md)、[10.4
  关闭的语义](./close.md)、[10.5 select 的实现](./select.md)。
