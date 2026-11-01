---
weight: 3304
title: "11.4 条件变量"
---

# 11.4 条件变量

互斥锁（[11.2](./mutex.md)）决定谁能进入临界区，却不能表达「进入之后发现条件不满足，需要等待」。**条
件变量**（condition variable）补上了这一点：goroutine 在持有锁时发现条件不成立，就在条件变量上等待，
同时让出锁；另一个 goroutine 改变状态之后，通知等待者重新检查。`sync.Cond` 的文档把它描述为一个会合点，
供 goroutine 等待或宣告某个事件的发生 [[Go Authors, 2026a](#ref-go-authors-2026a)]。

条件变量是 Brinch Hansen 与 Hoare 在 1973 至 1974 年提出的管程的一部分
（[11.1.1](./basic.md)）[[Brinch Hansen, 1972](#ref-brinch-hansen-1972)][[Hoare, 1974](#ref-hoare-1974)]；Go
在提供 CSP 式的 channel [[Hoare, 1978](#ref-hoare-1978)]的同时，也提供了管程式的锁与条件变量。
本节讨论它的两种唤醒语义，即 Hoare 的语义与 Mesa 的语义，以及 Go 为什么属于后者；随后介绍 `sync.Cond`
的实现如何演进到今天基于号码的通知列表，以及它在标准库中的用途。何时该用条件变量、何时该用 channel，见
[10.7.1](../ch10chan/pattern.md)。

## 11.4.1 等待与通知

Hoare 用有界缓冲区说明管程 [[Hoare, 1974](#ref-hoare-1974)]：缓冲区为空时消费者等待，缓冲区满时生产者
等待。用 `sync.Cond` 写出来是这样的：

```go
type Buffer struct {
	mu       sync.Mutex
	nonEmpty sync.Cond // 缓冲区变为非空时通知
	nonFull  sync.Cond // 缓冲区变为未满时通知
	items    []int
	size     int
}

func NewBuffer(size int) *Buffer {
	b := &Buffer{size: size}
	b.nonEmpty.L = &b.mu
	b.nonFull.L = &b.mu
	return b
}

func (b *Buffer) Put(x int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for len(b.items) == b.size {
		b.nonFull.Wait()
	}
	b.items = append(b.items, x)
	b.nonEmpty.Signal()
}

func (b *Buffer) Get() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	for len(b.items) == 0 {
		b.nonEmpty.Wait()
	}
	x := b.items[0]
	b.items = b.items[1:]
	b.nonFull.Signal()
	return x
}
```

两个条件变量共用同一把锁。Hoare 建议为每一种等待的理由声明一个条件变量，这里的理由有两种：缓冲区空，
缓冲区满。条件变量本身不存储任何值，状态完全由锁保护的数据表示；条件变量只是一个等待队列。

`Wait` 做三件事：释放 `c.L`，挂起当前 goroutine，被唤醒后重新获取 `c.L` 再返回。前两步必须是一个整体。
如果先释放锁、再挂起，那么在两步之间，另一个 goroutine 可能已经改变了状态并调用了 `Signal`，而此时还没有
挂起的等待者收不到这次通知，挂起之后便再也没有人唤醒它。11.4.4 将说明实现如何关闭这个窗口。

`Signal` 唤醒一个等待者，`Broadcast` 唤醒全部等待者。调用它们时可以持有 `c.L`，也可以不持有
[[Go Authors, 2026a](#ref-go-authors-2026a)]；但修改条件所依赖的数据时必须持有锁，否则就是数据竞争。

上面的代码用 `for` 而不是 `if` 检查条件。`Wait` 返回时，条件不一定成立。这条规则来自管程的两种唤醒语义。

## 11.4.2 Hoare 与 Mesa

问题出在唤醒的那一刻。进程 A 在管程内执行 signal，唤醒了等待者 B；管程要求同一时刻只有一个进程在内部
执行，A 与 B 必须有一个让路。

Hoare 的规定是让 A 让路 [[Hoare, 1974](#ref-hoare-1974)]：

> 然而，我们规定 signal 操作之后必须立即恢复一个等待的程序，其间不能有第三个程序的过程调用插入。只有
> 这样，等待的程序才能绝对保证获得发信程序刚刚释放的资源，而不必担心第三个程序进入管程，抢先夺走资源。

因此在 Hoare 的单资源管程中，`acquire` 在 `wait` 返回后不必重新检查资源是否空闲：`release` 已经保证了
这一点，而 signal 与被唤醒程序的继续执行之间，没有其他程序能够插入。有多个等待者时，signal 恢复等待最久
的那一个。这一语义也体现在 Hoare 给出的证明规则中：设 $I$ 为管程不变式，$B$ 为条件 `b` 所代表的断言，
则 wait 的规则是 $\{I\}\ b.\mathrm{wait}\ \{I \land B\}$，signal 的规则是
$\{I \land B\}\ b.\mathrm{signal}\ \{I\}$。等待者醒来时可以假定 $B$ 成立，因为发信者在 signal 之前必须
使它成立，而控制权直接交给了等待者。

代价在于实现。发信者让路之后，必须在等待者离开管程时优先恢复，Hoare 为此给每个管程增加了一个名为
`urgent` 的信号量，供发信者挂起。Hoare 还提到，如果每次 signal 都是管程过程的最后一个操作，这套机制就可以
省去；Dahl 甚至建议把这作为一条规定。

Lampson 与 Redell 在 Xerox 设计 Pilot 操作系统的并发设施时，选择了另一种做法
[[Lampson and Redell, 1980](#ref-lampson-redell-1980)]。他们指出，Hoare 的定义使进程在 WAIT 之后继续
执行时需要几次额外的进程切换，而且要求通知机制绝对可靠。Mesa 把 NOTIFY 看作给等待者的一个提示：
它使某个等待者在将来某个方便的时刻恢复执行；等待者恢复时要重新获取管程的锁，而在此之前，其他进程完全可能
先进入管程。因此 WAIT 之后能够假定的只有管程不变式，等待者每次恢复都要重新评估形势。等待的代码由 Hoare
管程中的

```
IF NOT <OK to proceed> THEN WAIT c
```

变为

```
WHILE NOT <OK to proceed> DO WAIT c ENDLOOP
```

换来的好处是没有额外的进程切换，对等待者在 NOTIFY 之后何时运行也不作任何约束。论文甚至说，即使没有
NOTIFY 就让等待者运行，也完全正确。验证规则因此更简单、更局部：只需在入口过程返回之前和 WAIT 之前建立
不变式，在入口过程开始时和 WAIT 之后假定不变式。有了这条规则，再加入三种恢复等待者的方式就很容易：
超时、中止，以及唤醒全部等待者的 BROADCAST。既然 NOTIFY 只是提示，用 BROADCAST 代替它总是正确的。

Hoare 的语义称为「发信并等待」（signal-and-wait），Mesa 的语义称为「发信并继续」（signal-and-continue）。`sync.Cond`
属于后者：`Signal` 之后，发信者继续持有锁，可以继续修改状态；被唤醒的 goroutine 要重新竞争锁，
而 `Signal` 的文档写明，它不影响 goroutine 的调度优先级，其他正在尝试获取 `c.L` 的 goroutine
可能先于等待者被唤醒 [[Go Authors, 2026a](#ref-go-authors-2026a)]。下面的程序让发信者在 `Signal` 之后、
释放锁之前，把刚刚使之成立的条件又消耗掉，分别用 `if` 与 `for` 检查条件：

```go {run=true}
package main

import (
	"fmt"
	"runtime"
	"sync"
)

// run 让一个等待者在 items > 0 时继续；loop 决定它用 for 还是 if 检查条件。
func run(loop bool) string {
	var mu sync.Mutex
	cond := sync.NewCond(&mu)
	items, waits := 0, 0
	done := make(chan string)

	go func() { // 等待者
		mu.Lock()
		defer mu.Unlock()
		if loop {
			for items == 0 {
				waits++
				cond.Wait()
			}
		} else if items == 0 {
			waits++
			cond.Wait()
		}
		done <- fmt.Sprintf("Wait 调用 %d 次，返回后 items = %d", waits, items)
	}()

	// waitFor 持锁返回，此时等待者已第 n 次进入 Wait。
	waitFor := func(n int) {
		mu.Lock()
		for waits < n {
			mu.Unlock()
			runtime.Gosched()
			mu.Lock()
		}
	}

	waitFor(1)
	items = 1
	cond.Signal() // 只使等待者变为可运行；发信者继续持有锁
	items = 0     // 等待者重新拿到锁之前，条件又被消耗了
	mu.Unlock()

	if loop {
		waitFor(2) // 等待者复查条件后再次 Wait
		items = 1
		cond.Signal()
		mu.Unlock()
	}
	return <-done
}

func main() {
	fmt.Printf("用 if 检查：%s\n", run(false))
	fmt.Printf("用 for 检查：%s\n", run(true))
}
```

运行结果如下：

```
用 if 检查：Wait 调用 1 次，返回后 items = 0
用 for 检查：Wait 调用 2 次，返回后 items = 1
```

`waitFor` 在 `waits` 达到 n 时才持锁返回，而等待者在释放锁之前就已登记（11.4.4），所以每次 `Signal`
都一定送达，结果是确定的。在 Hoare 的语义下，`Signal` 会立即把控制权交给等待者，用 `if` 也能看到
`items = 1`；在 Mesa 的语义下，用 `if` 的等待者带着一个不成立的条件继续执行。

Mesa 论文还提到一种用法：不必判断等待者需要的确切条件是否成立，只要有任何变化，就通知一个覆盖所有情况
的条件变量，由等待者自己判断是否继续。论文认为这样做可行，是因为唤醒一个进程的代价很小。[10.7.1](../ch10chan/pattern.md)
中 Mills 对 `sync.Cond` 的批评，针对的正是这种用法带来的无效唤醒。

## 11.4.3 不同系统中的条件变量

此后的条件变量都采用了 Mesa 的语义，但各自对「`Wait` 何时返回」的规定有所不同。

POSIX 允许**虚假唤醒**（spurious wakeup）：`pthread_cond_wait` 可能在没有对应通知的情况下返回
[[IEEE and The Open Group, 2024](#ref-ieee-open-group-2024)]。规范的基本原理一节解释说，在多处理器上，`pthread_cond_signal`
的实现可能无法避免唤醒不止一个线程；消除这种情况会降低这一基本构件的并发度，
为一个罕见的边缘情形付出这样的代价是不可接受的，何况调用者无论如何都要检查条件。规范还提到一个附带的
好处：允许虚假唤醒，迫使应用程序在等待外面写一个检查条件的循环，也就能容忍程序其他部分多余的通知，
程序因而更加健壮。Java 的 `Object.wait` 同样允许虚假唤醒，文档要求应用程序在循环中检查条件
[[Oracle, 2023](#ref-oracle-2023)]。

Go 的 `Wait` 则不会虚假唤醒。文档写明：与其他系统不同，`Wait` 只有在被 `Broadcast` 或 `Signal` 唤醒时
才会返回 [[Go Authors, 2026a](#ref-go-authors-2026a)]。即便如此，循环仍然必要，原因是上一节所说的
发信并继续，而不是虚假唤醒。

| 系统 | 唤醒语义 | 虚假唤醒 | 检查条件 |
| --- | --- | --- | --- |
| Hoare 管程（1974） | 发信并等待 | 无 | `if` 即可 |
| Mesa（1980） | 发信并继续 | 允许（超时、中止等） | `WHILE` 循环 |
| POSIX `pthread_cond_wait` | 发信并继续 | 允许 | 循环 |
| Java `Object.wait` | 发信并继续 | 允许 | 循环 |
| Go `sync.Cond.Wait` | 发信并继续 | 无 | 循环 |

## 11.4.4 实现的演进

`sync.Cond` 由 Gustavo Niemeyer 于 2011 年加入 [[Niemeyer, 2011](#ref-niemeyer-2011)]。最初的实现用一把
内部互斥锁保护一个等待者计数和一个信号量：`Wait` 先把计数加一，再释放 `c.L`，然后在信号量上等待；`Signal`
在计数大于零时释放一次信号量。先登记、后释放锁的次序关闭了 11.4.1 所说的窗口。`Broadcast` 则
按计数释放信号量之后，换一个新的信号量，使得此后到达的等待者不会消耗本次广播发出的唤醒。

2013 年，Vyukov 改用原子计数与运行时的同步信号量，去掉了内存分配，提交说明称速度提高了 30% 至 50%；
这次修改还加入了对复制的检测，随 Go 1.2 发布 [[Vyukov, 2013](#ref-vyukov-2013)]。
这一版本没有再为每次广播更换信号量。2016 年，Ian Lance Taylor 把 Wedson Almeida Filho 在 golang-nuts
上的报告转为议题：一个等待者已经把计数加一、释放了锁，但还没有开始在信号量上等待；此时另一个 goroutine
调用 `Broadcast`，随后又有第三个 goroutine 进入 `Wait`，它在信号量上的等待立即被满足，
消耗了本该属于前一个等待者的唤醒。前一个等待者随后挂起，再也收不到这次广播
[[Taylor, 2016](#ref-taylor-2016)]。

同年，Almeida Filho 给出了新的实现，随 Go 1.7 发布 [[Almeida Filho, 2016](#ref-almeida-filho-2016)]：
等待者先登记，领取一个号码，再释放锁，最后凭号码等待；发信者永远不需要挂起。号码使每次通知都对应确定的
等待者，后来者无法取走它。`Wait` 至今仍是这几步 [[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
func (c *Cond) Wait() {
	c.checker.check()
	t := runtime_notifyListAdd(&c.notify)
	c.L.Unlock()
	runtime_notifyListWait(&c.notify, t)
	c.L.Lock()
}
```

通知列表在运行时中实现 [[Go Authors, 2026b](#ref-go-authors-2026b)]：

```go
type notifyList struct {
	// wait is the ticket number of the next waiter. It is atomically
	// incremented outside the lock.
	wait atomic.Uint32

	// notify is the ticket number of the next waiter to be notified. It can
	// be read outside the lock, but is only written to with lock held.
	// ……
	notify uint32

	// List of parked waiters.
	lock mutex
	head *sudog
	tail *sudog
}
```

`notifyListAdd` 原子地把 `wait` 加一，返回加一之前的值作为号码，不需要加锁；`Wait` 在持有读锁时也可能
并发地调用它。`notifyListWait` 加锁后先比较号码与 `notify`：号码小于 `notify`，说明在登记之后、挂起之前
已经有人通知过它，于是立即返回；否则把自己挂入链表并挂起（[9.4.3](../ch09sched/schedule.md)）。`notifyListNotifyOne`
把 `notify` 加一，在链表中找到持有原号码的等待者并唤醒它；如果等待者还没来得及
挂入链表，它会在 `notifyListWait` 中看到新的 `notify`，不再挂起。`notifyListNotifyAll` 把 `notify`
直接设为 `wait`，唤醒链表中的全部等待者。两者都有一条不加锁的快速路径：`wait` 与 `notify` 相等，说明
上次通知以来没有新的等待者，直接返回。

这里有两处细节。其一，`Signal` 唤醒的是号码最小的、也就是最早登记的等待者，与 Hoare 恢复等待最久的程序
相同；但被唤醒者仍要重新竞争锁，次序并不因此得到保证。其二，两个计数都是 32 位的，会回绕。运行时用
`int32(a-b) < 0` 比较号码，只要两者实际的差小于 $2^{31}$，比较就是正确的；注释指出，这需要有 $2^{31}$
个以上的 goroutine 阻塞在同一个条件变量上，目前不可能发生。

先登记、后释放锁，起的正是 Mesa 论文中「唤醒等待开关」（wakeup-waiting switch）的作用。Mesa 用这个开关
处理设备发出的通知：设备不获取管程的锁，它的 NOTIFY 可能落在进程检查条件与开始 WAIT 之间，从而丢失
[[Lampson and Redell, 1980](#ref-lampson-redell-1980)]。`sync.Cond` 允许在不持有锁时调用 `Signal`，
面对的是同样的情形；号码在释放锁之前就已领取，之后的任何通知都不会遗漏它。

最后是复制检测。`Cond` 在首次使用后不能复制：副本中的通知列表与原件互不相干，通知会发往错误的队列。`noCopy`
字段供 `go vet` 的 copylocks 检查在编译前发现复制；`copyChecker` 则在运行时检测，
它保存自己的地址：

```go
func (c *copyChecker) check() {
	// ……
	if uintptr(*c) != uintptr(unsafe.Pointer(c)) &&
		!atomic.CompareAndSwapUintptr((*uintptr)(c), 0, uintptr(unsafe.Pointer(c))) &&
		uintptr(*c) != uintptr(unsafe.Pointer(c)) {
		panic("sync.Cond is copied")
	}
}
```

首次使用时，CAS 把自身地址写入；此后每次检查，保存的地址都应等于当前地址。复制之后，副本中保存的仍是
原件的地址，与副本自己的地址不符，CAS 又因为值非零而失败，于是引发 panic。

## 11.4.5 同步先于

Go 内存模型对条件变量、`Map`、`Pool` 与 `WaitGroup` 只说明它们提供的保证见各自的文档
[[Go Authors, 2022](#ref-go-authors-2022)]。`Cond` 的文档写道：`Broadcast` 或 `Signal` 的调用同步先于
它所唤醒的那次 `Wait` [[Go Authors, 2026a](#ref-go-authors-2026a)]。这句话由 Cox 在 2022 年修订内存模型时
加入，随 Go 1.19 发布 [[Cox, 2022](#ref-cox-2022)]。

由此可以推出先行发生关系（[11.9](./mem.md)）：发信者在调用 `Signal` 之前的写入，对被唤醒的 goroutine 在
`Wait` 返回之后可见。不过，实际程序中的可见性通常来自锁本身：修改条件时持有 `c.L`，`Wait` 返回前又重新
获取了 `c.L`。这条保证也不意味着条件成立：发信者在 `Signal` 之后的写入，以及其他 goroutine 抢先获取锁之后
的写入，同样会被等待者看到。可见性由内存模型保证，条件是否成立则要由循环检查。

## 11.4.6 标准库中的条件变量

`io.Pipe` 的历史说明了条件变量与 channel 的关系。它最初用 channel 和一个长期运行的 goroutine 实现；`sync.Cond`
加入不到三周，Cox 就用两个条件变量重写了它 [[Cox, 2011](#ref-cox-2011)]。2017 年，Joe Tsai
又把它改回 channel，随 Go 1.10 发布 [[Tsai, 2017](#ref-tsai-2017)]。提交说明解释道，基于条件变量的实现中，`p.data`
总是在 `Signal` 之前设置，两者合起来实际上就是一次 channel 式的操作，却还要在 `p.data`
周围显式加锁；数据加上读者的条件变量可以换成一个 `chan []byte`，数据加上写者的条件变量可以换成一个
`chan int`。`Cond` 文档中「`Signal` 对应在 channel 上发送，`Broadcast` 对应关闭 channel」的建议，
说的正是这种情形。需要注意，关闭只能进行一次，重复关闭会引发 panic（[10.4](../ch10chan/close.md)），
用它表示的广播也只能发生一次；`Broadcast` 则可以反复调用。

Go 1.26 的源码树中，除测试外用到 `sync.Cond` 的地方只有几处：

- `net/http` 服务器的 `connReader`。`abortPendingRead` 在持有 `cr.mu` 时设置读截止时间，然后用
  `for cr.inRead { cr.cond.Wait() }` 等待后台的读操作结束。
- `cmd/internal/par` 的 `Work`，`go` 命令用它并行处理一组工作项。没有待处理的工作项时，执行者在条件变量上
  等待。
- `net/http` 内置的 HTTP/2 实现：其中的 `pipe` 用条件变量等待数据，客户端连接用它在流量控制窗口或连接
  状态变化时通知等待者。

它们的共同点是，等待的对象是一个已经由互斥锁保护、并且会反复变化的状态谓词。这种情况下，
条件变量直接表达了「持有这把锁，等待这个条件」，这正是 Cox 在拒绝删除 `sync.Cond`
时给出的理由（[10.7.1](../ch10chan/pattern.md)）。

## 延伸阅读

- <a id="ref-almeida-filho-2016"></a>[Almeida Filho, 2016] Wedson Almeida Filho. sync: new Cond
  implementation. Go commit 8e7072ca83, 2016. https://go.dev/cl/18892
  修复 issue #14064，随 Go 1.7 发布。
- <a id="ref-brinch-hansen-1972"></a>[Brinch Hansen, 1972] Per Brinch Hansen. "Structured
  Multiprogramming." *Communications of the ACM*, 15(7): 574–578, 1972.
  https://doi.org/10.1145/361454.361473
  与 Hoare 同期的管程构想。
- <a id="ref-cox-2011"></a>[Cox, 2011] Russ Cox. io: reimplement Pipe. Go commit 6d6f3381ff, 2011.
  https://github.com/golang/go/commit/6d6f3381ffa470e879cceec7ef926445ed86bc27
  用两个条件变量重写 `io.Pipe`。
- <a id="ref-cox-2022"></a>[Cox, 2022] Russ Cox. runtime, sync, sync/atomic: document happens-before
  guarantees. Go commit a71ca3dfbd, 2022. https://go.dev/cl/381316
  随 Go 1.19 发布。
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *The Go Memory Model* (Version of
  June 6, 2022). https://go.dev/ref/mem
  「Additional Mechanisms」一节对 Cond 等类型只指向各自的文档。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *sync.Cond documentation and
  source* (`src/sync/cond.go`). https://pkg.go.dev/sync#Cond
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. src/runtime/sema.go. Go 1.26 源码.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/sema.go
  `notifyList` 的实现。
- <a id="ref-hoare-1974"></a>[Hoare, 1974] C. A. R. Hoare. "Monitors: An Operating System Structuring
  Concept." *Communications of the ACM*, 17(10): 549–557, 1974. https://doi.org/10.1145/355620.361161
  管程与 signal-and-wait 语义的原始提出。
- <a id="ref-hoare-1978"></a>[Hoare, 1978] C. A. R. Hoare. "Communicating Sequential Processes."
  *Communications of the ACM*, 21(8): 666–677, 1978. https://doi.org/10.1145/359576.359585
  Go channel 取向的理论源头。
- <a id="ref-ieee-open-group-2024"></a>[IEEE and The Open Group, 2024] IEEE, The Open Group.
  pthread_cond_broadcast, pthread_cond_signal. *The Open Group Base Specifications Issue 8*, IEEE Std
  1003.1-2024. https://pubs.opengroup.org/onlinepubs/9799919799/functions/pthread_cond_signal.html
  基本原理一节解释了为什么允许虚假唤醒。
- <a id="ref-lampson-redell-1980"></a>[Lampson and Redell, 1980] Butler W. Lampson, David D. Redell.
  "Experience with Processes and Monitors in Mesa." *Communications of the ACM*, 23(2): 105–117, 1980.
  https://doi.org/10.1145/358818.358824
  signal-and-continue 语义与「循环复查」规则的来源。
- <a id="ref-niemeyer-2011"></a>[Niemeyer, 2011] Gustavo Niemeyer. sync: add Cond. Go commit 05b1dbd0a6,
  2011. https://github.com/golang/go/commit/05b1dbd0a6994f6ba9ab3505fce1abff93606d9e
  随 Go 1 发布。
- <a id="ref-oracle-2023"></a>[Oracle, 2023] Oracle. Object.wait. *Java SE 21 & JDK 21 API Specification*,
  2023. https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html
- <a id="ref-taylor-2016"></a>[Taylor, 2016] Ian Lance Taylor. Go issue #14064. *sync: potential race when
  using cond.Broadcast.* 2016. https://github.com/golang/go/issues/14064
  转述 Wedson Almeida Filho 在 golang-nuts 上的报告。
- <a id="ref-tsai-2017"></a>[Tsai, 2017] Joe Tsai. io: simplify pipe implementation. Go commit 371eda4558,
  2017. https://go.dev/cl/65330
  随 Go 1.10 发布。
- <a id="ref-vyukov-2013"></a>[Vyukov, 2013] Dmitriy Vyukov. sync: faster Cond. Go commit 5a20b4a6a9,
  2013. https://github.com/golang/go/commit/5a20b4a6a9dcf26a402edfe352aa1e8564f2fb01
  随 Go 1.2 发布。
- 本书 [11.2 互斥锁](./mutex.md)、[11.9 内存一致模型](./mem.md)、[10.7 并发模式](../ch10chan/pattern.md)、[12.2
  组件](../../part4memory/ch12alloc/component.md)。
