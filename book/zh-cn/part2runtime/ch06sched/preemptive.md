# 调度器: 协作与抢占

[TOC]

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

1. 主动用户让权：通过 Gosched 调用主动让出执行机会；
3. 主动调度弃权：当发生执行栈分段时，检查自身的抢占标记，决定是否继续执行；
2. 被动监控弃权：当 G 阻塞在 M 上时（系统调用、channel 等），系统监控会将 P 从 M 上抢夺并分配给其他的 M 来执行其他的 G，
而位于被抢夺 P 的 M 本地调度队列中的 G 则可能会被偷取到其他 M 中。

## 协作式调度

### 主动用户让权：Gosched

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
需要自行甄别是否需要让出时间片，这并非用户友好的，
而且很多 Go 的新用户并不会了解到这个问题的存在，我们在随后的抢占式调度中再进一步展开讨论。

### 主动调度弃权：栈扩张与抢占标记

另一种主动放弃的方式是通过抢占标记的方式实现的。基本想法是在每个函数调用的序言（函数调用的最前方）插入
抢占检测指令，当检测到当前 goroutine 被标记为被应该被抢占时，则主动中断执行，让出执行权利。
表面上看起来想法很简单，但实施起来就比较复杂了。

在 [goroutine 执行栈管理](./stack.md) 一节中我们已经了解到，函数调用的序言部分会检查 SP 寄存器与 `stackguard0`
之间的大小，如果 SP 小于 `stackguard0` 则会触发 `morestack_noctxt`，触发栈分段操作。换言之，如果抢占标记
将 `stackgard0` 设为比所有可能的 SP 都要大（即 `stackPreempt`），则会触发 `morestack`，进而调用 `newstack`：

```go
const (
	uintptrMask = 1<<(8*sys.PtrSize) - 1

	// Goroutine 抢占请求
	// 存储到 g.stackguard0 来导致栈分段检查失败
	// 必须必任何实际的 SP 都要大
	// 十六进制为：0xfffffade
	stackPreempt = uintptrMask & -1314
)
```

从抢占调度的角度来看，这种发生在函数序言部分的抢占的一个重要目的就是能够简单且安全的记录执行现场（随后的抢占式调度我们会看到
记录执行现场给采用信号方式中断线程执行的调度带来多大的困难）。事实也是如此，在 `morestack` 调用中：

```asm
TEXT runtime·morestack(SB),NOSPLIT,$0-0
	(...)
	MOVQ	0(SP), AX // f's PC
	MOVQ	AX, (g_sched+gobuf_pc)(SI)
	MOVQ	SI, (g_sched+gobuf_g)(SI)
	LEAQ	8(SP), AX // f's SP
	MOVQ	AX, (g_sched+gobuf_sp)(SI)
	MOVQ	BP, (g_sched+gobuf_bp)(SI)
	MOVQ	DX, (g_sched+gobuf_ctxt)(SI)
	(...)
	CALL	runtime·newstack(SB)
```

是有记录 goroutine 的 PC 和 SP 寄存器，而后才开始调用 `newstack` 的。在 `newstack` 中：

```go
//go:nowritebarrierrec
func newstack() {
	thisg := getg()
	(...)

	gp := thisg.m.curg

	(...)

	morebuf := thisg.m.morebuf
	thisg.m.morebuf.pc = 0
	thisg.m.morebuf.lr = 0
	thisg.m.morebuf.sp = 0
	thisg.m.morebuf.g = 0

	// 如果是发起的抢占请求而非真正的栈分段
	preempt := atomic.Loaduintptr(&gp.stackguard0) == stackPreempt

	// 保守的对用户态代码进行抢占，而非抢占运行时代码
	// 如果正持有锁、分配内存或抢占被禁用，则不发生抢占
	if preempt {
		if thisg.m.locks != 0 || thisg.m.mallocing != 0 || thisg.m.preemptoff != "" || thisg.m.p.ptr().status != _Prunning {
			// 不发生抢占，继续调度
			gp.stackguard0 = gp.stack.lo + _StackGuard
			gogo(&gp.sched) // 重新进入调度循环
		}
	}
	(...)
	if preempt {
		(...)
		casgstatus(gp, _Grunning, _Gwaiting)
		(...)
		// 表现得像是调用了 runtime.Gosched，主动让权
		casgstatus(gp, _Gwaiting, _Grunning)
		gopreempt_m(gp) // 重新进入调度循环
	}
	(...)
}
```

保守的对是否抢占进行估计，因为运行时优先级更高，不应该轻易发生抢占，
但同时有需要对用户态代码进行抢占，于是先作出一次不需要抢占的判断（快速路径），
再判断是否真的要进行抢占，调用 `gopreempt_m`。

值得一提的是 `newstack` 函数的作用非常多，除了抢占、栈扩张外，
其第二个 `preempt` 其实省略了它的第三个功能，帮助 GC 对栈进行扫描，这个我们等到垃圾回收一章中才来回顾。

### 被动监控弃权：阻塞监控

第三种协作式调度与我们在[系统监控](./sysmon.md)一节中提到的系统监控有关，监控循环会将发生阻塞的 goroutine 抢占，
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

从上面提到的三种协作式抢占逻辑我们可以看出，Go 运行时的抢占逻辑其实是有很大问题的：调度器只能在某些特定的点
切换并发执行的 goroutine。这么当然有好处（能够确保 GC 在安全点精准回收，见垃圾回收器一章），但也有坏处比如这个最简单的情况：

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
如果此时主 goroutine 恰好排在此 goroutine 之后执行，那么程序永远无法退出
（各种类似的例子非常多，诸如 #17831, #19241, #543, #12553, #13546, #14561, #15442, #17174, #20793, #21053）。

Go 官方其实很早（1.0 以前）就已经意识到了这个问题，但在 Go 1.2 时增加了上文提到的在函数序言部分增加抢占标记后，
此问题便被搁置，直到越来越多的用户提交并报告此问题，在 Go 1.5 前后，
Go 团队希望仅解决这种由密集循环导致的无法抢占的问题 [CELMENTS, 2015]，于是尝试通过协作式 loop 循环抢占，通过编译器辅助的方式，插入抢占检查指令，
与流程图回边（指节点被访问过但其子节点尚未访问完毕）安全点（GC root 状态均已知且堆中对象是一致的）的方式进行解决，
尽管此举能为抢占带来显著的提升，但是在一个循环中引入分支显然会降低性能。
尽管随后官方对这个方法进行了改进，仅在插入了一条 TESTB 指令 [CHASE et al., 2017]，在完全没有分支以及寄存器压力的情况下，
仍然造成了几何平均 7.8% 的性能损失。

终于在 Go 1.10 后 [CELMENTS, 2019]，官方进一步提出的解决方案，希望使用每个指令与执行栈和寄存器的映射，
通过记录足够多的 metadata 来从协作式调度正式变更为到抢占调度。

我们知道现代操作系统的调度器多为抢占式调度，其实现方式通过硬件终端来支持线程的切换，进而能安全的保存运行上下文。
在 Go 运行时实现抢占式调度同样也可以使用类似的方式，通过向线程发送系统信号的方式来中断 M 的执行，进而达到抢占的目的。
但与操作系统的不同之处在于，由于垃圾回收器的存在，运行时还必须能够在 goroutine 被停止时，获得存活指针的信息。
这就给中断信号带来了麻烦，如果中断信号恰好发生在写屏障（一种保证 GC 完备性的机制，见垃圾回收一章）期间，则
无法保证 GC 的正确性，甚至会导致内存泄漏。

TODO: 中断信号 SIGURG, go1.14，解释初期提案的基本想法是通过给执行栈映射补充寄存器映射及其缺点

不过 Go 1.12 和 Go 1.13 忙着进一步改进 GC 以及追踪 GC 的 Bug，Go 团队并没有按时完成这一提案，我们只能等到 Go 1.14
时候再来细说了。

## 总结

总的来说，Go 从设计之初就没有刻意的去考虑对 goroutine 的抢占机制，也就造就了目前运行时提供的多种多样的
需要用户自己负责的协作式调度机制。大部分情况下，初次接触 Go 的用户对这一缺陷并不得而知
（尤其是希望用 Go 进行科学计算的用户，他们的代码通常依赖密集的循环从而才能将结果收敛到某个精度的数值计算），
进而导致莫名其妙的计算效率问题。随着报告问题的数量逐渐增加，可以看到 Go 团队对这一设计缺陷逐渐开始重视，
让我们对其最终的改进方案拭目以待。

[返回目录](./readme.md) | [上一节](./stack.md) | [下一节 同步机制](./sync.md)

## 进一步阅读的参考文献

- [CELMENTS, 2019] [Proposal: Non-cooperative goroutine preemption](https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md)
- [CELMENTS, 2015] [runtime: tight loops should be preemptible](https://github.com/golang/go/issues/10958)
- [CHASE et al., 2017] [cmd/compile: loop preemption with "fault branch" on amd64](https://go-review.googlesource.com/c/go/+/43050/)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)

