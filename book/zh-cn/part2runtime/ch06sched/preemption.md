---
weight: 2107
title: "6.7 协作与抢占"
---

# 6.7 协作与抢占

[TOC]

我们在[分析调度循环](./exec.md)的时候总结过一个问题：
如果某个 G 执行时间过长，其他的 G 如何才能被正常的调度？
这便涉及到有关调度的两个理念：协作式调度与抢占式调度。

协作式和抢占式这两个理念解释起来很简单：
协作式调度依靠被调度方主动弃权；抢占式调度则依靠调度器强制将被调度方被动中断。
这两个概念其实描述了调度的两种截然不同的策略，这两种决策模式，在调度理论中其实已经研究得很透彻了。
Go 的运行时并不具备操作系统内核级的中断能力，基于工作窃取的调度器实现，本质上属于先来先服务的协作式调度，
为了解决响应时间可能较高的问题，目前运行时实现了两种不同的调度策略、每种策略哥两个形式来保证，
在大部分情况下，不同的 G 能够获得均匀的时间片：

- 同步协作式调度
  1. 主动用户让权：通过 `runtime.Gosched` 调用主动让出执行机会；
  2. 主动调度弃权：当发生执行栈分段时，检查自身的抢占标记，决定是否继续执行；
- 异步抢占式调度
  1. 被动监控抢占：当 G 阻塞在 M 上时（系统调用、channel 等），系统监控会将 P 
     从 M 上抢夺并分配给其他的 M 来执行其他的 G，而位于被抢夺 P 的 M 本地调度队列中
     的 G 则可能会被偷取到其他 M 中。
  2. 被动 GC 抢占：当需要进行 GC 时，为了保证不具备主动抢占处理的函数执行时间过长，导致
     导致 GC 迟迟不得执行而导致的高延迟，而强制停止 G 并转为执行垃圾回收。
     + enlistWorker
     + gcStart: gcbgmarkworker
     + gcStart: marktermination

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
	(...)
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

func notetsleepg(n *note, ns int64) bool {
	gp := getg()
	(...)

	if ns >= 0 {
		deadline := nanotime() + ns
		(...)

		(...)
		notesWithTimeout[n] = noteWithTimeout{gp: gp, deadline: deadline}
		(...)

		gopark(nil, nil, waitReasonSleep, traceEvNone, 1)

		(...)
		delete(notesWithTimeout, n)
		(...)
	}

	(...)
}
```

而后通过 `mcall` 调用 `gosched_m` 在 g0 上继续执行并让出 P，
实质上是让 G 放弃当前在 M 上的执行权利，转去执行其他的 G，并在上下文切换时候，
将自身放入全局队列等待后续调度：

```go
func goschedImpl(gp *g) {
	// 放弃当前 g 的运行状态
	status := readgstatus(gp)
	(...)
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

当然，尽管具有主动弃权的能力，但它对 Go 语言的用户要求比较高，
因为用户在编写并发逻辑的时候需要自行甄别是否需要让出时间片，这并非用户友好的，
而且很多 Go 的新用户并不会了解到这个问题的存在，我们在随后的抢占式调度中再进一步展开讨论。

### 主动调度弃权：栈扩张与抢占标记

另一种主动放弃的方式是通过抢占标记的方式实现的。基本想法是在每个函数调用的序言
（函数调用的最前方）插入抢占检测指令，当检测到当前 goroutine 被标记为被应该被抢占时，
则主动中断执行，让出执行权利。表面上看起来想法很简单，但实施起来就比较复杂了。

在 [6.6 goroutine 执行栈管理](./stack.md) 一节中我们已经了解到，函数调用的序言部分
会检查 SP 寄存器与 `stackguard0` 之间的大小，如果 SP 小于 `stackguard0` 则会
触发 `morestack_noctxt`，触发栈分段操作。
换言之，如果抢占标记将 `stackgard0` 设为比所有可能的 SP 都要大（即 `stackPreempt`），
则会触发 `morestack`，进而调用 `newstack`：

```go
// Goroutine 抢占请求
// 存储到 g.stackguard0 来导致栈分段检查失败
// 必须必任何实际的 SP 都要大
// 十六进制为：0xfffffade
const stackPreempt = (1<<(8*sys.PtrSize) - 1) & -1314
```

从抢占调度的角度来看，这种发生在函数序言部分的抢占的一个重要目的就是能够简单且安全的
记录执行现场（随后的抢占式调度我们会看到记录执行现场给采用信号方式中断线程执行的调度
带来多大的困难）。事实也是如此，在 `morestack` 调用中：

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

是有记录 goroutine 的 PC 和 SP 寄存器，而后才开始调用 `newstack` 的：

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
		if !canPreemptM(thisg.m) {
			// 不发生抢占，继续调度
			gp.stackguard0 = gp.stack.lo + _StackGuard
			gogo(&gp.sched) // 重新进入调度循环
		}
	}
	(...)
	// 如果需要对栈进行调整
	if preempt {
		(...)
		if gp.preemptShrink {
			// 我们正在一个同步安全点，因此等待栈收缩
			gp.preemptShrink = false
			shrinkstack(gp)
		}
		if gp.preemptStop {
			preemptPark(gp) // 永不返回
		}
		(...)
		// 表现得像是调用了 runtime.Gosched，主动让权
		gopreempt_m(gp) // 重新进入调度循环
	}
	(...)
}
// 与 gosched_m 一致
func gopreempt_m(gp *g) {
	(...)
	goschedImpl(gp)
}
```

其中的 canPreemptM 验证了可以被抢占的条件：

1. 运行时**没有**禁止抢占（`m.locks == 0`）
2. 运行时**没有**在执行内存分配（`m.mallocing == 0`）
3. 运行时**没有**关闭抢占机制（`m.preemptoff == ""`）
4. M 与 P 绑定且**没有**进入系统调用（`p.status == _Prunning`）

```go
// canPreemptM 报告 mp 是否处于可抢占的安全状态。
//go:nosplit
func canPreemptM(mp *m) bool {
	return mp.locks == 0 && mp.mallocing == 0 && mp.preemptoff == "" && mp.p.ptr().status == _Prunning
}
```

从可被抢占的条件来看，能够对一个 G 进行抢占其实是呈保守状态的。
这一保守体现在抢占对很多运行时所需的条件进行了判断，这也理所当然是因为
运行时优先级更高，不应该轻易发生抢占，
但与此同时由于又需要对用户态代码进行抢占，于是先作出一次不需要抢占的判断（快速路径），
确定不能抢占时返回并继续调度，如果真的需要进行抢占，则转入调用 `gopreempt_m`，
放弃当前 G 的执行权，将其加入全局队列，重新进入调度循环。

什么时候会会给 stackguard0 设置抢占标记 `stackPreempt` 呢？
一共有以下几种情况：

1. 进入系统调用时（`runtime.reentersyscall`，注意这种情况是为了保证不会发生栈分裂，
   真正的抢占是异步的通过系统监控进行的）
3. 任何运行时不再持有锁的时候（`m.locks == 0`）
4. GC 需要进入 STW 时（包括清扫终止以及标记终止两个需要 STW 的阶段）

## 抢占式调度

从上面提到的两种协作式调度逻辑我们可以看出，这种需要用户代码来主动配合的调度方式存在
一些致命的缺陷：一个没有主动放弃执行权、且不参与任何函数调用的函数，直到执行完毕之前，
是不会被抢占的。那么这种不会被抢占的函数会导致什么严重的问题呢？回答是，由于运行时无法
停止该用户代码，则当需要进行垃圾回收时，无法及时进行；对于一些实时性要求较高的用户态
goroutine 而言，也久久得不到调度。我们这里不去深入讨论 GC 的具体细节，读者将垃圾回收器
一章中详细看到这类问题导致的后果。单从调度的角度而言，我们直接来看一个非常简单的例子：

```go
// 此程序在 Go 1.14 之前的版本不会输出 OK
package main
import (
	"runtime"
	"time"
)
func main() {
	runtime.GOMAXPROCS(1)
	go func() {
		for {
		}
	}()
	time.Sleep(time.Millisecond)
	println("OK")
}
```

这段代码中处于死循环的 goroutine 永远无法被抢占，其中创建的 goroutine
会执行一个不产生任何调用、不主动放弃执行权的死循环。由于 main goroutine 优先调用了
休眠，此时唯一的 P 会转去执行 for 循环所创建的 goroutine。进而 main goroutine
永远不会再被调度，进而程序彻底阻塞在了这四个 goroutine 上，永远无法退出。这样的例子
非常多，但追根溯源，均为此问题导致。

Go 官方其实很早（1.0 以前）就已经意识到了这个问题，但在 Go 1.2 时增加了上文提到的
在函数序言部分增加抢占标记后，此问题便被搁置，直到越来越多的用户提交并报告此问题，
在 Go 1.5 前后，Go 团队希望仅解决这种由密集循环导致的无法抢占的问题 [CELMENTS, 2015]，
于是尝试通过协作式 loop 循环抢占，通过编译器辅助的方式，插入抢占检查指令，
与流程图回边（指节点被访问过但其子节点尚未访问完毕）**安全点**（在一个线程执行中，垃圾回收器
能够识别所有对象引用状态的一个状态）的方式进行解决，尽管此举能为抢占带来显著的提升，但是在一个循环中
引入分支显然会降低性能。尽管随后官方对这个方法进行了改进，仅在插入了一条
 TESTB 指令 [CHASE et al., 2017]，在完全没有分支以及寄存器压力的情况下，
仍然造成了几何平均 7.8% 的性能损失。这种结果其实是情理之中的，很多需要进行密集循环的
计算时间都是在运行时才能确定的，直接由编译器检测这类密集循环而插入额外的指令可想而知是
欠妥的做法。
终于在 Go 1.10 后 [CELMENTS, 2019]，官方进一步提出的解决方案，希望使用每个指令
与执行栈和寄存器的映射，通过记录足够多的 metadata ，并通过异步线程来发送抢占信号的方式
来支持异步抢占式调度。我们来仔细分析这一抢占的的原理。

### 用户态运行时抢占

我们知道现代操作系统的调度器多为抢占式调度，其实现方式通过硬件终端来支持线程的切换，
进而能安全的保存运行上下文。在 Go 运行时实现抢占式调度同样也可以使用类似的方式，通过
向线程发送系统信号的方式来中断 M 的执行，进而达到抢占的目的。
但与操作系统的不同之处在于，由于运行时诸多机制的存在（例如垃圾回收器），还必须能够在
goroutine 被停止时，保存充足的上下文信息（例如 GC 标记阶段的存活指针）。
这就给中断信号带来了麻烦，如果中断信号恰好发生在一些关键阶段（例如写屏障期间），
则无法保证程序的正确性。这也就要求我们需要严格考虑触发异步抢占的时机。

异步抢占式调度的一种方式就与运行时系统监控有关，
监控循环会将发生阻塞的 goroutine 抢占，解绑 P 与 M，从而让其他的线程能够获得 P 继续
执行其他的 goroutine。这得益于 `sysmon` 中调用的 `retake` 方法。
这个方法处理了两种抢占情况，一是抢占阻塞在系统调用上的 P，二是抢占运行时间过长的 G。
其中抢占运行时间过长的 G 这一方式还会出现在垃圾回收需要进入 STW 时。

### P 抢占

我们先来看抢占阻塞在系统调用上的 G 这种情况。这种抢占的实现方法非常的自然，因为
goroutine 已经阻塞在了系统调用上，我们可以非常安全的将 M 与 P 进行解绑，即便是
goroutine 从阻塞中恢复，也会检查自身所在的 M 是否仍然持有 P，如果没有 P 则重新考虑
与可用的 P 进行绑定。这种异步抢占的本质是：抢占 P。

```go
func retake(now int64) uint32 {
	n := 0
	// 防止 allp 数组发生变化，除非我们已经 STW，此锁将完全没有人竞争
	lock(&allpLock)
	for i := 0; i < len(allp); i++ {
		_p_ := allp[i]
		(...)
		pd := &_p_.sysmontick
		s := _p_.status
		sysretake := false
		if s == _Prunning || s == _Psyscall {
			// 如果 G 运行时时间太长则进行抢占
			t := int64(_p_.schedtick)
			if int64(pd.schedtick) != t {
				pd.schedtick = uint32(t)
				pd.schedwhen = now
			} else if pd.schedwhen+forcePreemptNS <= now {
				(...)
				sysretake = true
			}
		}
		// 对阻塞在系统调用上的 P 进行抢占
		if s == _Psyscall {
			// 如果已经超过了一个系统监控的 tick（20us），则从系统调用中抢占 P
			t := int64(_p_.syscalltick)
			if !sysretake && int64(pd.syscalltick) != t {
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
		}
	}
	unlock(&allpLock)
	return uint32(n)
}
```

在抢占 P 的过程中，有两个非常小心的处理方式：

1. 如果此时队列为空，那么完全没有必要进行抢占，这时候似乎可以继续遍历其他的 P，
   但必须在调度器中自旋的 M 和 空闲的 P 同时存在时、且系统调用阻塞时间非常长的情况下
   才能这么做。否则，这个 retake 过程可能返回 0，进而系统监控可能看起来像是什么事情
   也没做的情况下调整自己的步调进入深度睡眠。
2. 在将 P 设置为空闲状态前，必须先将 M 的数量减少，否则当 M 退出系统调用时，
会在 `exitsyscall0` 中调用 `stoplockedm` 从而增加空闲 M 的数量，进而发生死锁。

### M 抢占

在上面我们没有展现一个细节，那就是在检查 P 的状态时，P 如果是运行状态会调用 
`preemptone`，来通过系统信号来完成抢占，之所以没有在之前提及的原因在于该调用
在 M 不与 P 绑定的情况下是不起任何作用直接返回的。这种异步抢占的本质是：抢占 M。
我们不妨继续从系统监控产生的抢占谈起：

```go
func retake(now int64) uint32 {
	(...)
	for i := 0; i < len(allp); i++ {
		_p_ := allp[i]
		(...)
		if s == _Prunning || s == _Psyscall {
			(...)
			} else if pd.schedwhen+forcePreemptNS <= now {
				// 对于 syscall 的情况，因为 M 没有与 P 绑定，
				// preemptone() 不工作
				preemptone(_p_)
				sysretake = true
			}
		}
		(...)
	}
	(...)
}
func preemptone(_p_ *p) bool {
	// 检查 M 与 P 是否绑定
	mp := _p_.m.ptr()
	if mp == nil || mp == getg().m {
		return false
	}
	gp := mp.curg
	if gp == nil || gp == mp.g0 {
		return false
	}

	// 将 G 标记为抢占
	gp.preempt = true

	// 一个 goroutine 中的每个调用都会通过比较当前栈指针和 gp.stackgard0
	// 来检查栈是否溢出。
	// 设置 gp.stackgard0 为 StackPreempt 来将抢占转换为正常的栈溢出检查。
	gp.stackguard0 = stackPreempt

	// 请求该 P 的异步抢占
	if preemptMSupported && debug.asyncpreemptoff == 0 {
		_p_.preempt = true
		preemptM(mp)
	}

	return true
}
```

#### 抢占信号的选取

preemptM 完成了信号的发送，其实现也非常直接，直接向需要进行抢占的 M 发送 SIGURG 信号
即可。但是真正的重要的问题是，为什么是 SIGURG 信号而不是其他的信号？如何才能保证该信号
不与用户态产生的信号产生冲突？这里面有几个原因：

1. 默认情况下，SIGURG 已经用于调试器传递信号。
2. SIGRUURG 可以不加选择地虚假发生的信号。例如，我们不能选择 SIGALRM，因为
  信号处理程序无法分辨它是否是由实际过程引起的（可以说这意味着信号已损坏）。 
  而常见的用户自定义信号 SIGUSR1 和 SIGUSR2 也不够好，因为用户态代码可能会将其进行使用
3. 需要处理没有实时信号的平台（例如 macOS）

考虑以上的观点，SIGURG 其实是一个很好的、满足所有这些条件、且极不可能因被用户态代码
进行使用的一种信号。

```go
const sigPreempt = _SIGURG

// preemptM 向 mp 发送抢占请求。该请求可以异步处理，也可以与对 M 的其他请求合并。
// 接收到该请求后，如果正在运行的 G 或 P 被标记为抢占，并且 goroutine 处于异步安全点，
// 它将抢占 goroutine。在处理抢占请求后，它始终以原子方式递增 mp.preemptGen。
func preemptM(mp *m) {
	(...)
	signalM(mp, sigPreempt)
}
func signalM(mp *m, sig int) {
	tgkill(getpid(), int(mp.procid), sig)
}
```

#### 抢占调用的注入

我们在信号处理一节中已经知道，每个运行的 M 都会设置一个系统信号的处理的回调，当出现系统
信号时，操作系统将负责将运行代码进行中断，并安全的保护其执行现场，进而 Go 运行时能
将针对信号的类型进行处理，当信号处理函数执行结束后，程序会再次进入内核空间，进而恢复到
被中断的位置。

但是这里面又一个很巧妙的用法，因为 sighandler 能够获得操作系统所提供的执行上下文参数
（例如寄存器 `rip`, `rep` 等），如果在 sighandler 中修改了这个上下文参数，OS 会
根据就该的寄存器进行恢复，这也就为抢占提供了机会。

```go
//go:nowritebarrierrec
func sighandler(sig uint32, info *siginfo, ctxt unsafe.Pointer, gp *g) {
	(...)
	c := &sigctxt{info, ctxt}
	(...)
	if sig == sigPreempt {
		// 可能是一个抢占信号
		doSigPreempt(gp, c)
		// 即便这是一个抢占信号，它也可能与其他信号进行混合，因此我们
		// 继续进行处理。
	}
	(...)
}
// doSigPreempt 处理了 gp 上的抢占信号
func doSigPreempt(gp *g, ctxt *sigctxt) {
	// 检查 G 是否需要被抢占、抢占是否安全
	if wantAsyncPreempt(gp) && isAsyncSafePoint(gp, ctxt.sigpc(), ctxt.sigsp(), ctxt.siglr()) {
		// 插入抢占调用
		ctxt.pushCall(funcPC(asyncPreempt))
	}

	// 记录抢占
	atomic.Xadd(&gp.m.preemptGen, 1)
```

在 `ctxt.pushCall` 之前， `ctxt.rip()` 和 `ctxt.rep()` 都保存了被中断的 goroutine 所在的位置，
但是 `pushCall` 直接修改了这些寄存器，进而当从 sighandler 返回用户态 goroutine 时，
能够从注入的 `asyncPreempt` 开始执行：

```go
func (c *sigctxt) pushCall(targetPC uintptr) {
	pc := uintptr(c.rip())
	sp := uintptr(c.rsp())
	sp -= sys.PtrSize
	*(*uintptr)(unsafe.Pointer(sp)) = pc
	c.set_rsp(uint64(sp))
	c.set_rip(uint64(targetPC))
}
```

完成 sighandler 之，我们成功恢复到 asyncPreempt 调用：

```go
// asyncPreempt 保存了所有用户寄存器，并调用 asyncPreempt2
//
// 当栈扫描遭遇 asyncPreempt 栈帧时，将会保守的扫描调用方栈帧
func asyncPreempt()
```

该函数的主要目的是保存用户态寄存器，并且在调用完毕前恢复所有的寄存器上下文，
就好像什么事情都没有发生过一样：

```asm
TEXT ·asyncPreempt(SB),NOSPLIT|NOFRAME,$0-0
	(...)
	MOVQ AX, 0(SP)
	(...)
	MOVUPS X15, 352(SP)
	CALL ·asyncPreempt2(SB)
	MOVUPS 352(SP), X15
	(...)
	MOVQ 0(SP), AX
	(...)
	RET
```

当调用 `asyncPreempt2` 时，会根据 preemptPark 或者 gopreempt_m 重新切换回
调度循环，从而打断密集循环的继续执行。

```go
//go:nosplit
func asyncPreempt2() {
	gp := getg()
	gp.asyncSafePoint = true
	if gp.preemptStop {
		mcall(preemptPark)
	} else {
		mcall(gopreempt_m)
	}
	// 异步抢占过程结束
	gp.asyncSafePoint = false
}
```

至此，异步抢占过程结束。

我们总结一下抢占调用的整体逻辑：

1. M1 发送中断信号 `signalM(mp, sigPreempt)`
2. M2 收到信号，操作系统中断其执行代码，并切换到信号处理函数 `sighandler(signum, info, ctxt, gp)`
3. M2 修改执行的上下文，并恢复到修改后的位置 `asyncPreempt`
4. 重新进入调度循环进而调度其他 goroutine `preemptPark` `gopreempt_m`

#### 抢占的安全区

什么时候才能进行抢占呢？如何才能区分该抢占信号是运行时发出的还是用户代码发出的呢？
TODO:


TODO: 解释执行栈映射补充寄存器映射，中断信号 SIGURG

```go
// wantAsyncPreempt 返回异步抢占是否被 gp 请求
func wantAsyncPreempt(gp *g) bool {
	// 同时检查 G 和 P
	return (gp.preempt || gp.m.p != 0 && gp.m.p.ptr().preempt) && readgstatus(gp)&^_Gscan == _Grunning
}
```

什么时候才是安全的异步抢占点呢？
TODO:

```go
func isAsyncSafePoint(gp *g, pc, sp, lr uintptr) bool {
	mp := gp.m

	// Only user Gs can have safe-points. We check this first
	// because it's extremely common that we'll catch mp in the
	// scheduler processing this G preemption.
	if mp.curg != gp {
		return false
	}

	// Check M state.
	if mp.p == 0 || !canPreemptM(mp) {
		return false
	}

	// Check stack space.
	if sp < gp.stack.lo || sp-gp.stack.lo < asyncPreemptStack {
		return false
	}

	// Check if PC is an unsafe-point.
	f := findfunc(pc)
	if !f.valid() {
		// Not Go code.
		return false
	}
	(...)
	smi := pcdatavalue(f, _PCDATA_RegMapIndex, pc, nil)
	if smi == -2 {
		// Unsafe-point marked by compiler. This includes
		// atomic sequences (e.g., write barrier) and nosplit
		// functions (except at calls).
		return false
	}
	if fd := funcdata(f, _FUNCDATA_LocalsPointerMaps); fd == nil || fd == unsafe.Pointer(&no_pointers_stackmap) {
		// This is assembly code. Don't assume it's
		// well-formed. We identify assembly code by
		// checking that it has either no stack map, or
		// no_pointers_stackmap, which is the stack map
		// for ones marked as NO_LOCAL_POINTERS.
		//
		// TODO: Are there cases that are safe but don't have a
		// locals pointer map, like empty frame functions?
		return false
	}
	if hasPrefix(funcname(f), "runtime.") ||
		hasPrefix(funcname(f), "runtime/internal/") ||
		hasPrefix(funcname(f), "reflect.") {
		// For now we never async preempt the runtime or
		// anything closely tied to the runtime. Known issues
		// include: various points in the scheduler ("don't
		// preempt between here and here"), much of the defer
		// implementation (untyped info on stack), bulk write
		// barriers (write barrier check),
		// reflect.{makeFuncStub,methodValueCall}.
		//
		// TODO(austin): We should improve this, or opt things
		// in incrementally.
		return false
	}

	return true
}
```

#### 其他抢占触发点

TODO: 一些 GC 的处理， suspendG

preemptStop 会在什么时候被设置为抢占呢？GC。


## 小结

异步抢占的引入，解决的核心问题是任意时间的 GC 延迟，Go 语言的用户可以放心的写出密集
循环，垃圾回收也能够在适当的时候及时中断用户代码，不至于导致整个系统进入不可预测的停顿。
总的来说，Go 从设计之初就没有刻意的去考虑对 goroutine 的抢占机制，到意识到这一协作式
抢占机制对用户造成的影响，再到如今支持异步抢占，造就了目前运行时提供的多种多样
的协作与抢占调度机制。

## 进一步阅读的参考文献

- [CELMENTS, 2019] [Proposal: Non-cooperative goroutine preemption](https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md)
- [CELMENTS, 2015] [runtime: tight loops should be preemptible](https://github.com/golang/go/issues/10958)
- [CHASE et al., 2017] [cmd/compile: loop preemption with "fault branch" on amd64](https://go-review.googlesource.com/c/go/+/43050/)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)

