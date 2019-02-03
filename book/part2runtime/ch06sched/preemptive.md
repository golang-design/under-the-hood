# 调度器: 协作与抢占

我们在[分析调度循环](./exec.md)的时候总结过一个问题：如果某个 G 执行时间过长，
其他的 G 如何才能被正常的调度？
这便涉及到 Go 调度器本身的设计理念：协作式调度。

协作式和抢占式这两个理念解释起来很简单：协作式调度依靠被调度方主动弃权；
抢占式调度则依靠被调度方被动中断。
这两个概念其实描述了调度的两种截然不同的策略，这两种决策模式，在调度理论中其实已经研究得很透彻了。
这里我们根据不同类别的选择函数所具有不同的特点针对 goroutine 进行总结：

| 类别 | 决策模式 | 决策函数 | 吞吐量 | 响应时间 | 开销 | 对 goroutine 的影响 | 饥饿 |
|:----:|:----|:---|:---|:---|:---|:---|:---|
| 先来服务 FCFS | 协作式 | max[w] | 不强调 | 可能很高 | 最小     | 对短时 goroutine 或 IO 密集型不利 |无|
| 最短处理优先 SPN  |协作式|min[s]|高|短时 goroutine 提供好的响应时间|可能较高|对长时间 goroutine 不利|可能|
| 最高响应比优先 HRRN |协作式|max[(w+s)/s]|高|提供好的响应时间|可能较高|很好的平衡|无|
| 轮转    | 抢占式 | 常数    | 时间片小则低 | 短时 goroutine 提供好的响应时间 | 最小 | 公平对待 | 无 |
| 最短剩余时间 SRT |抢占式|min[s-e]|高|提供好的响应时间|可能较高|对长时间 goroutine 不利|可能|
| 多级反馈(抢占后降级) |抢占式|e 与优先级|不强调|不强调|可能较高|对 IO 密集型 goroutine 有利|可能|

其中 w 为花费的等待时间，e 为到现在为止花费的执行时间，s 为需要的总服务时间。

Go 的运行时并不具备操作系统内核级的中断能力，基于工作窃取的调度器实现，本质上属于先来先服务的协作式调度，
为了解决响应时间可能较高的问题，目前运行时实现了三种协作式的调度逻辑来保证，在大部分情况下，不同的 G 能够获得均匀的时间片：

1. 主动让权：通过 Gosched 调用主动让出执行机会；
3. 主动弃权：当发生执行栈分段时，检查自身的抢占标记，决定是否继续执行；
2. 被动弃权：当 G 阻塞在 M 上时（系统调用、channel 等），系统监控会将 P 从 M 上抢夺并分配给其他的 M 来执行其他的 G，
而位于被抢夺 P 的 M 本地调度队列中的 G 则可能会被偷取到其他 M 中。

## 协作式调度

### 主动让权：Gosched

Gosched 是一种主动放弃执行的手段，用户态代码通过调用此接口来出让执行机会，使其他人也能在
密集的执行过程中获得被调度的机会。

`Gosched` 的实现非常简单：

```go
// Gosched 会让出当前的 P，并允许其他 goroutine 运行。
// 它不会推迟当前的 goroutine，因此执行会被自动恢复
func Gosched() {
	checkTimeouts()
	mcall(gosched_m)
}
// Gosched 在 g0 上继续执行
func gosched_m(gp *g) {
	if trace.enabled {
		traceGoSched()
	}
	goschedImpl(gp)
}
```

它首先会通过 note 机制通知那些等待被 `ready` 的 goroutine：

```go
// checkTimeouts 恢复那些在等待一个 note 且已经触发其 deadline 时的 goroutine。
func checkTimeouts() {
	now := nanotime()
	for n, nt := range notesWithTimeout {
		if n.key == note_cleared && now > nt.deadline {
			n.key = note_timeout
			goready(nt.gp, 1)
		}
	}
}
func goready(gp *g, traceskip int) {
	systemstack(func() {
		ready(gp, traceskip, true)
	})
}
// 将 gp 标记为 ready 来运行
func ready(gp *g, traceskip int, next bool) {
	if trace.enabled {
		traceGoUnpark(gp, traceskip)
	}

	status := readgstatus(gp)

	// 标记为 runnable.
	_g_ := getg()
	_g_.m.locks++ // 禁止抢占，因为它可以在局部变量中保存 p
	if status&^_Gscan != _Gwaiting {
		dumpgstatus(gp)
		throw("bad g->status in ready")
	}

	// 状态为 Gwaiting 或 Gscanwaiting, 标记 Grunnable 并将其放入运行队列 runq
	casgstatus(gp, _Gwaiting, _Grunnable)
	runqput(_g_.m.p.ptr(), gp, next)
	if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 {
		wakep()
	}
	_g_.m.locks--
	if _g_.m.locks == 0 && _g_.preempt { // 在 newstack 中已经清除它的情况下恢复抢占请求
		_g_.stackguard0 = stackPreempt
	}
}
```

而后通过 `mcall` 调用 `gosched_m` 在 g0 上继续执行并让出 P，
实质上是让 M 放弃当前的 G 并将 G 放入全局队列：

```go
func goschedImpl(gp *g) {
	// 放弃当前 g 的运行状态
	status := readgstatus(gp)
	if status&^_Gscan != _Grunning {
		dumpgstatus(gp)
		throw("bad g status")
	}
	casgstatus(gp, _Grunning, _Grunnable)
	// 使当前 m 放弃 g
	dropg()
	// 并将 g 放回全局队列中
	lock(&sched.lock)
	globrunqput(gp)
	unlock(&sched.lock)

	// 重新进入调度循环
	schedule()
}
```

当然，尽管具有主动弃权的能力，但它对 Go 语言的用户要求比较高，因为用户在编写并发逻辑的时候
需要自行甄别是否需要让出时间片，这并非用户友好的。

### 主动弃权：栈扩张与抢占标记

TODO:

### 被动弃权：阻塞监控

在[系统监控](./sysmon.md)一节中，我们提到了系统监控会将发生阻塞的 goroutine 抢占，
解绑 P 与 M，从而让其他的线程能够获得 P 继续执行其他的 goroutine。
这得益于 `sysmon` 中调用的 `retake` 方法。这个方法处理了两种抢占情况，一是抢占阻塞在系统调用上的 P，
二是抢占运行时间过长的 G。

```go
func retake(now int64) uint32 {
	n := 0
	// 防止 allp 数组发生变化，除非我们已经 STW，此锁将完全没有人竞争
	lock(&allpLock)
	// 不能使用 range 循环，因为 range 可能临时性的放弃 allpLock。
	// 所以每轮循环中都需要重新获取 allp
	for i := 0; i < len(allp); i++ {
		_p_ := allp[i]
		if _p_ == nil {
			// 这是可能的，如果 procresize 已经增长 allp 但还没有创建新的 P
			continue
		}
		pd := &_p_.sysmontick
		s := _p_.status

		// 对阻塞在系统调用上的 P 进行抢占
		if s == _Psyscall {
			// 如果已经超过了一个系统监控的 tick（20us），则从系统调用中抢占 P
			t := int64(_p_.syscalltick)
			if int64(pd.syscalltick) != t {
				pd.syscalltick = uint32(t)
				pd.syscallwhen = now
				continue
			}
			// 一方面，在没有其他 work 的情况下，我们不希望抢夺 P
			// 另一方面，因为它可能阻止 sysmon 线程从深度睡眠中唤醒，所以最终我们仍希望抢夺 P
			if runqempty(_p_) && atomic.Load(&sched.nmspinning)+atomic.Load(&sched.npidle) > 0 && pd.syscallwhen+10*1000*1000 > now {
				continue
			}
			// 解除 allpLock，从而可以获取 sched.lock
			unlock(&allpLock)
			// 在 CAS 之前需要减少空闲 M 的数量（假装某个还在运行）
			// 否则发生抢夺的 M 可能退出 syscall 然后再增加 nmidle ，进而发生死锁
			// 这个过程发生在 stoplockedm 中
			incidlelocked(-1)
			if atomic.Cas(&_p_.status, s, _Pidle) { // 将 P 设为 idle，从而交于其他 M 使用
				(...)
				n++
				_p_.syscalltick++
				handoffp(_p_)
			}
			incidlelocked(1)
			lock(&allpLock)

		} else if s == _Prunning { // 对正在运行的 P 进行抢占
			// 如果运行时间太长，则抢占 G
			t := int64(_p_.schedtick)
			if int64(pd.schedtick) != t {
				pd.schedtick = uint32(t)
				pd.schedwhen = now
				continue
			}
			if pd.schedwhen+forcePreemptNS > now {
				continue
			}
			preemptone(_p_)
		}
	}
	unlock(&allpLock)
	return uint32(n)
}
```

在抢占 P 的过程中，有两个非常小心的处理方式：

1. 如果此时队列为空，那么完全没有必要进行抢占，这时候似乎可以继续遍历其他的 P，
但必须在调度器中自旋的 M 和 空闲的 P 同时存在时、且系统调用阻塞时间非常长的情况下才能这么做。
否则，这个 retake 过程可能返回 0，进而系统监控可能看起来像是什么事情也没做的情况下调整自己的步调进入深度睡眠。
2. 在将 P 设置为空闲状态前，必须先将 M 的数量减少，否则当 M 退出系统调用时，
会在 `exitsyscall0` 中调用 `stoplockedm` 从而增加空闲 M 的数量，进而发生死锁。

而在抢占 G 的过程中，也只是使用与前面提到的抢占标记的方式调用 `preemptone` 尽力而为，
仍然有可能无法进行抢占。

## 抢占式调度

从上面提到的三种协作式抢占逻辑我们可以看出，Go 运行时的抢占逻辑其实是有很大问题的。
比如：

```go
func main() {
	go func() {
		for {
		}
	}()
	println("dead")
}
```

这段代码中处于死循环的 goroutine 永远无法被抢占，它既没有主动让权、也没有调用其他函数，
如果此时主 goroutine 恰好排在此 goroutine 之后执行，那么程序永远无法退出。

Go 官方其实很早就已经意识到了这个问题，终于在 Go 1.12 发布前后，开始着手解决此问题 [1]。

TODO: go1.12

## 进一步阅读的参考文献

1. [Proposal: Non-cooperative goroutine preemption](https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)

