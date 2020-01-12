---
weight: 2101
title: "6.1 设计原则"
---

# 6.1 设计原则

[TOC]

我们首先了解一下调度器的设计原则及一些基本概念来建立对调度器较为宏观的认识。
理解调度器涉及的主要概念包括以下三个：

- G: **G**oroutine，即我们在 Go 程序中使用 `go` 关键字创建的执行体；
- M: **M**achine，或 worker thread，即传统意义上进程的线程；
- P: **P**rocessor，即一种人为抽象的、用于执行 Go 代码被要求局部资源。只有当 M 与一个 P 关联后才能执行 Go 代码。除非 M 发生阻塞或在进行系统调用时间过长时，没有与之关联的 P。

P 的存在不太好理解，我们暂时先记住这个概念，之后再来回顾这个概念。

## 6.1.1 工作线程的暂止和复始

运行时调度器的任务是给不同的工作线程 (worker thread) 分发可供运行的（ready-to-run）goroutine。
我们不妨设每个工作线程总是贪心的执行所有存在的 goroutine，那么当运行进程中存在 n 个线程（M），且
每个 M 在某个时刻有且只能调度一个 G。根据抽屉原理，可以很容易的证明这两条性质：

- 性质 1：当用户态代码创建了 p (p > n) 个 G 时，则必定存在 p-n 个 G 尚未被 M 调度执行；
- 性质 2：当用户态代码创建的 q (q < n) 时，则必定存在 n-q 个 M 不存在正在调度的 G。

这两条性质分别决定了工作线程的 **暂止（park）** 和 **复始（unpark）** 。

我们不难发现，调度器的设计需要在性质 1 和性质 2 之间进行权衡：
即既要保持足够的运行工作线程来利用有效硬件并发资源，又要暂止过多的工作线程来节约 CPU 能耗。
如果我们把调度器想象成一个系统，则寻找这个权衡的最优解意味着我们必须求解调度器系统中
每个 M 的状态，即系统的全局状态。这是非常困难的，不妨考虑以下两个难点：

**难点 1: 在多个 M 之间不使用屏障的情况下，得出调度器中多个 M 的全局状态是不可能的。**

我们都知道计算的局部性原理，为了利用这一原理，调度器所需调度的 G 都会被放在每个 M 自身对应的本地队列中。
换句话说，每个 M 都无法直接观察到其他的 M 所具有的 G 的状态，存在多个 M 之间的共识问题。这本质上就是一个分布式系统。
显然，每个 M 都能够连续的获取自身的状态，但当它需要获取整个系统的全局状态时却不容易。
原因在于我们没有一个能够让所有线程都同步的时钟，换句话说，
我们需要依赖屏障来保证多个 M 之间的全局状态同步。更进一步，在不使用屏障的情况下，
能否利用每个 M 在不同时间中记录的本地状态中计算出调度器的全局状态，或者形式化的说：能否在快速路径（fast path）下计算进程集的全局谓词（global predicates）呢？根据我们在共识技术中的知识，是不可能的。

**难点 2: 为了获得最佳的线程管理，我们必须获得未来的信息，即当一个新的 G 即将就绪（ready）时，则不再暂止一个工作线程。**

举例来说，目前我们的调度器存在 4 个 M，并其中有 3 个 M 正在调度 G，则其中有 1 个 M 处于空闲状态。
这时为了节约 CPU 能耗，我们希望对这个空闲的 M 进行暂止操作。但是，正当我们完成了对此 M 的暂止操作后，
用户态代码正好执行到了需要调度一个新的 G 时，我们又不得不将刚刚暂止的 M 重新启动，这无疑增加了开销。
我们当然有理由希望，如果我们能知晓一个程序生命周期中所有的调度信息，
提前知晓什么时候适合对 M 进行暂止自然再好不过了。
尽管我们能够对程序代码进行静态分析，但这显然是不可能的：考虑一个简单的 Web 服务端程序，每个用户请求
到达后会创建一个新的 G 交于调度器进行调度。但请求到达是一个随机过程，我们只能预测在给定置信区间下
可能到达的请求数，而不能完整知晓所有的调度需求。

那么我们又应该如何设计一个通用且可扩展的调度器呢？我们很容易想到三种平凡的做法：

**设计 1: 集中式管理所有状态**

显然这种做法自然是不可取的，在多个并发实体之间集中管理所有状态这一共享资源，需要锁的支持，
当并发实体的数量增大时，将限制调度器的可扩展性。

**设计 2**: 每当需要就绪一个 G1 时，都让出一个 P，直接切换出 G2，再复始一个 M 来执行 G2。

因为复始的 M 可能在下一个瞬间又没有调度任务，则会发生线程颠簸（thrashing），进而我们又需要暂止这个线程。
另一方面，我们希望在相同的线程内保存维护 G，这种方式还会破坏计算的局部性原理。

**设计 3**: 任何时候当就绪一个 G、也存在一个空闲的 P 时，都复始一个额外的线程，不进行切换。

因为这个额外线程会在没有检查任何工作的情况下立即进行暂止，最终导致大量 M 的暂止和复始行为，产生大量开销。

基于以上考虑，目前的 Go 的调度器实现中设计了工作线程的**自旋（spinning）状态**：

1. 如果一个工作线程的本地队列、全局运行队列或网络轮询器中均没有可调度的任务，则该线程成为自旋线程；
2. 满足该条件、被复始的线程也被称为自旋线程，对于这种线程，运行时不做任何事情。

自旋线程在进行暂止之前，会尝试从任务队列中寻找任务。当发现任务时，则会切换成非自旋状态，
开始执行 goroutine。而找到不到任务时，则进行暂止。
<!-- 我们也不对这种线程进行 G 切换，因此这类线程最初就是没有工作的状态。 -->

当一个 goroutine 准备就绪时，会首先检查自选线程的数量，而不是去复始一个新的线程。

如果最后一个自旋线程发现工作并且停止自旋时，则复始一个新的自旋线程。
这个方法消除了不合理的线程复始峰值，且同时保证最终的最大 CPU 并行度利用率。

我们可以通过下图来直观理解工作线程的状态转换：

```
  如果存在空闲的 P，且存在暂止的 M，并就绪 G
          +------+
          v      |
执行 --> 自旋 --> 暂止
 ^        |
 +--------+
  如果发现工作
```

总的来说，调度器的方式可以概括为：
**如果存在一个空闲的 P 并且没有自旋状态的工作线程 M，则当就绪一个 G 时，就复始一个额外的线程 M。**
这个方法消除了不合理的线程复始峰值，且同时保证最终的最大 CPU 并行度利用率。

这种设计的实现复杂性表现在进行自旋与费自选线程状态转换时必须非常小心。
这种转换在提交一个新的 G 时发生竞争，最终导致任何一个工作线程都需要暂止对方。
如果双方均发生失败，则会以半静态 CPU 利用不足而结束调度。

因此，就绪一个 G 的通用流程为：

- 提交一个 G 到 per-P 的本地工作队列
- 执行 StoreLoad 风格的写屏障
- 检查 `sched.nmspinning` 数量

而从自旋到非自旋转换的一般流程为：

- 减少 `nmspinning` 的数量
- 执行 StoreLoad 风格的写屏障
- 在所有 per-P 本地任务队列检查新的工作

当然，此种复杂性在全局任务队列对全局队列并不适用的，因为当给一个全局队列提交工作时，
不进行线程的复始操作。

## 6.1.2 主要结构

我们这个部分简单来浏览一遍 M/P/G 的结构，初次阅读此结构会感觉虚无缥缈，不知道在看什么。
事实上，我们更应该直接深入调度器相关的代码来逐个理解每个字段的实际用途。
因此这里仅在每个结构后简单讨论其宏观作用，用作后文参考。
读者可以简单浏览各个字段，为其留下一个初步的印象即可。

### M 的结构

M 是 OS 线程的实体。我们介绍几个比较重要的字段，包括：

- 持有用于执行调度器的 g0
- 持有用于信号处理的 gsignal
- 持有线程本地存储 tls
- 持有当前正在运行的 curg
- 持有运行 goroutine 时需要的本地资源 p
- 表示自身的自旋和非自旋状态 spining
- 管理在它身上执行的 cgo 调用
- 将自己与其他的 M 进行串联
- 持有当前线程上进行内存分配的本地缓存 mcache

等等其他五十多个字段，包括关于 M 的一些调度统计、调试信息等。

```go
// src/runtime/runtime2.go
type m struct {
	g0          *g			// 用于执行调度指令的 goroutine
	gsignal     *g			// 处理 signal 的 g
	tls         [6]uintptr	// 线程本地存储
	curg        *g			// 当前运行的用户 goroutine
	p           puintptr	// 执行 go 代码时持有的 p (如果没有执行则为 nil)
	spinning    bool		// m 当前没有运行 work 且正处于寻找 work 的活跃状态
	cgoCallers  *cgoCallers	// cgo 调用崩溃的 cgo 回溯
	alllink     *m			// 在 allm 上
	mcache      *mcache

	...
}
```

### P 的结构

P 只是处理器的抽象，而非处理器本身，它存在的意义在于实现工作窃取（work stealing）算法。
简单来说，每个 P 持有一个 G 的本地队列。

在没有 P 的情况下，所有的 G 只能放在一个全局的队列中。
当 M 执行完 G 而没有 G 可执行时，必须将队列锁住从而取值。

当引入了 P 之后，P 持有 G 的本地队列，而持有 P 的 M 执行完 G 后在 P 本地队列中没有
发现其他 G 可以执行时，虽然仍然会先检查全局队列、网络，但这时增加了一个从其他 P 的
队列偷取（steal）一个 G 来执行的过程。优先级为本地 > 全局 > 网络 > 偷取。

一个不恰当的比喻：银行服务台排队中身手敏捷的顾客，当一个服务台队列空（没有人）时，
没有在排队的顾客（全局）会立刻跑到该窗口，当彻底没人时在其他队列排队的顾客才会迅速
跑到这个没人的服务台来，即所谓的偷取。

```go
type p struct {
	id           int32
	status       uint32 // p 的状态 pidle/prunning/...
	link         puintptr
	m            muintptr   // 反向链接到关联的 m （nil 则表示 idle）
	mcache       *mcache
	pcache       pageCache
	deferpool    [5][]*_defer // 不同大小的可用的 defer 结构池
	deferpoolbuf [5][32]*_defer
	runqhead     uint32	// 可运行的 goroutine 队列，可无锁访问
	runqtail     uint32
	runq         [256]guintptr
	runnext      guintptr
	timersLock   mutex
	timers       []*timer
	preempt      bool
	...
}
```

所以整个结构除去 P 的本地 G 队列外，就是一些统计、调试、GC 辅助的字段了。

### G 的结构

G 既然是 goroutine，必然需要定义自身的执行栈：

```go
type g struct {
	stack struct {
		lo uintptr
		hi uintptr
	} 							// 栈内存：[stack.lo, stack.hi)
	stackguard0	uintptr
	stackguard1 uintptr

	_panic       *_panic
	_defer       *_defer
	m            *m				// 当前的 m
	sched        gobuf
	stktopsp     uintptr		// 期望 sp 位于栈顶，用于回溯检查
	param        unsafe.Pointer // wakeup 唤醒时候传递的参数
	atomicstatus uint32
	goid         int64
	preempt      bool       	// 抢占信号，stackguard0 = stackpreempt 的副本
	timer        *timer         // 为 time.Sleep 缓存的计时器

	...
}
```

除了执行栈之外，还有很多与调试和 profiling 相关的字段。
一个 G 没有什么黑魔法，无非是将需要执行的函数参数进行了拷贝，保存了要执行的函数体的入口地址，用于执行。

### 调度器 `sched` 结构

调度器，所有 goroutine 被调度的核心，存放了调度器持有的全局资源，访问这些资源需要持有锁：

- 管理了能够将 G 和 M 进行绑定的 M 队列
- 管理了空闲的 P 链表（队列）
- 管理了 G 的全局队列
- 管理了可被复用的 G 的全局缓存
- 管理了 defer 池

```go
type schedt struct {
	lock mutex

	pidle      puintptr	// 空闲 p 链表
	npidle     uint32	// 空闲 p 数量
	nmspinning uint32	// 自旋状态的 M 的数量
	runq       gQueue	// 全局 runnable G 队列
	runqsize   int32
	gFree struct {		// 有效 dead G 的全局缓存.
		lock    mutex
		stack   gList	// 包含栈的 Gs
		noStack gList	// 没有栈的 Gs
		n       int32
	}
	sudoglock  mutex	// sudog 结构的集中缓存
	sudogcache *sudog
	deferlock  mutex	// 不同大小的有效的 defer 结构的池
	deferpool  [5]*_defer
	
	...
}
```

## 小结

调度器的设计还是相当巧妙的。它通过引入一个 P，巧妙的减缓了全局锁的调用频率，进一步压榨了机器的性能。
goroutine 本身也不是什么黑魔法，运行时只是将其作为一个需要运行的入口地址保存在了 G 中，
同时对调用的参数进行了一份拷贝。我们说 P 是处理器自身的抽象，但 P 只是一个纯粹的概念。相反，M 才是运行代码的真身。

## 进一步阅读的参考文献

- [ROBERT et al., 1999] [Robert D. Blumofe and Charles E. Leiserson. 1999. Scheduling multithreaded computations by work stealing. J. ACM 46, 5 (September 1999), 720-748.](https://dl.acm.org/citation.cfm?id=324234)
- [VYUKOV, 2012] [Vyukov, Dmitry. Scalable Go Scheduler Design Doc, 2012](https://golang.org/s/go11sched)
- [VYUKOV, 2013] [Vyukov, Dmitry. Go Preemptive Scheduler Design Doc, 2013](https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit#heading=h.3pilqarbrc9h)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
