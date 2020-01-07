---
weight: 2109
title: "6.9 系统监控"
---

# 6.9 系统监控

[TOC]

我们已经完整分析过调度器的调度执行了。
当我们通过 `runtime.newproc` 创建好主 goroutine 后，会将其加入到一个 P 的本地队列中。
随着 `runtime.mstart` 启动调度器，主 goroutine 便开始得以调度。

```go
// src/runtime/proc.go

// 主 goroutine
func main() {
	(...)
	// 启动系统后台监控（定期垃圾回收、并发任务调度）
	systemstack(func() {
		newm(sysmon, nil)
	})
	(...)
}
```

那么是时候看看主 goroutine 中的系统监控 `newm(sysmon, nil)` 到底在干什么了。

## 监控循环

```go
// 系统监控在一个独立的 m 上运行
// 总是在没有 P 的情况下运行，因此不能出现写屏障
//go:nowritebarrierrec
func sysmon() {
	lock(&sched.lock)
	// 不计入死锁的系统 m 的数量
	sched.nmsys++
	// 死锁检查
	checkdead()
	unlock(&sched.lock)

	idle := 0 // 没有 wokeup 的周期数
	delay := uint32(0)
	for {
		if idle == 0 { // 每次启动先休眠 20us
			delay = 20
		} else if idle > 50 { // 1ms 后就翻倍休眠时间
			delay *= 2
		}
		if delay > 10*1000 { // 增加到 10ms
			delay = 10 * 1000
		}
		// 休眠
		usleep(delay)
		now := nanotime()
		next := timeSleepUntil()

		// 如果在 STW，则暂时休眠
		if debug.schedtrace <= 0 && (sched.gcwaiting != 0 || atomic.Load(&sched.npidle) == uint32(gomaxprocs)) {
			lock(&sched.lock)
			if atomic.Load(&sched.gcwaiting) != 0 || atomic.Load(&sched.npidle) == uint32(gomaxprocs) {
				if next > now {
					atomic.Store(&sched.sysmonwait, 1)
					unlock(&sched.lock)
					// 确保 wake-up 周期足够小从而进行正确的采样
					sleep := forcegcperiod / 2
					if next-now < sleep {
						sleep = next - now
					}
					shouldRelax := sleep >= osRelaxMinNS
					if shouldRelax {
						osRelax(true)
					}
					notetsleep(&sched.sysmonnote, sleep)
					if shouldRelax {
						osRelax(false)
					}
					now = nanotime()
					next = timeSleepUntil()
					lock(&sched.lock)
					atomic.Store(&sched.sysmonwait, 0)
					noteclear(&sched.sysmonnote)
				}
				idle = 0
				delay = 20
			}
			unlock(&sched.lock)
		}
		// 需要时触发 libc interceptor
		if *cgo_yield != nil {
			asmcgocall(*cgo_yield, nil)
		}
		// 如果超过 10ms 没有 poll，则 poll 一下网络
		lastpoll := int64(atomic.Load64(&sched.lastpoll))
		if netpollinited() && lastpoll != 0 && lastpoll+10*1000*1000 < now {
			atomic.Cas64(&sched.lastpoll, uint64(lastpoll), uint64(now))
			list := netpoll(0) // 非阻塞，返回 goroutine 列表
			if !list.empty() {
				// 需要在插入 g 列表前减少空闲锁住的 m 的数量（假装有一个正在运行）
				// 否则会导致这些情况：
				// injectglist 会绑定所有的 p，但是在它开始 M 运行 P 之前，另一个 M 从 syscall 返回，
				// 完成运行它的 G ，注意这时候没有 work 要做，且没有其他正在运行 M 的死锁报告。
				incidlelocked(-1)
				injectglist(&list)
				incidlelocked(1)
			}
		}
		if next < now {
			// There are timers that should have already run,
			// perhaps because there is an unpreemptible P.
			// Try to start an M to run them.
			startm(nil, false)
		}
		// 抢夺在 syscall 中阻塞的 P、运行时间过长的 G
		if retake(now) != 0 {
			idle = 0
		} else {
			idle++
		}
		// 检查是否需要强制触发 GC
		if t := (gcTrigger{kind: gcTriggerTime, now: now}); t.test() && atomic.Load(&forcegc.idle) != 0 {
			lock(&forcegc.lock)
			forcegc.idle = 0
			var list gList
			list.push(forcegc.g)
			injectglist(&list)
			unlock(&forcegc.lock)
		}
		(...)
	}
}
```

系统监控在运行时扮演的角色无需多言，
因为使用的是运行时通知机制，在 Linux 上由 Futex 实现，不依赖调度器，
因此它自身通过 `newm` 在一个 M 上独立运行，
自身永远保持在一个循环内直到应用结束。休眠有好几种不同的休眠策略：

1. 至少休眠 20us
2. 如果抢占 P 和 G 失败次数超过五十、且没有触发 GC，则说明很闲，翻倍休眠
3. 如果休眠翻倍时间超过 10ms，保持休眠 10ms 不变

休眠结束后，先观察目前的系统状态，如果正在进行 GC，那么继续休眠。
这时的休眠会被设置超时。

如果没有超时被唤醒，则说明 GC 已经结束，一切都很好，继续做本职工作。
如果超时，则无关 GC，必须开始进行本职善后：

1. 如果 cgo 调用被 libc 拦截，继续触发起调用
2. 如果已经有 10ms 没有 poll 网络数据，则 poll 一下网络数据
3. 抢占在系统调用中阻塞的 P 已经运行时间过长的 G
4. 检查是不是该触发 GC 了
5. 如果距离上一次堆清理已经超过了两分半，则执行清理工作

其中的 `note` 同步机制 `retake` 抢占已在[6.7 协作与抢占](./preemption.md) 和 [6.8 运行时同步原语](./sync.md) 中详细讨论过了。

## 小结

总的来说系统监控的本职工作还是比较明确的，它在一个单独的 M 上执行，负责处理网络数据、抢占 P/G、触发 GC、清理堆 span。
对于这些职责，我们需要确定一些细节工作：

2. `gcTrigger` 如何触发 GC？在 [垃圾回收器：初始化](../ch08GC/init.md) 一节中详细讨论。
3. `scavenge` 如何清理堆 span？
4. `netpoll` 如何 poll 网络数据？

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)