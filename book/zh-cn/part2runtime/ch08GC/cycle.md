# 垃圾回收器：GC 周期概述

## 停止、启动一切

## Stop The World 的实现

```go
func stopTheWorldWithSema() {
	_g_ := getg()
	(...)

	lock(&sched.lock)
	sched.stopwait = gomaxprocs
	atomic.Store(&sched.gcwaiting, 1)
	preemptall()
	// 停止当前的 P
	_g_.m.p.ptr().status = _Pgcstop // Pgcstop 只用于诊断.
	sched.stopwait--
	// 尝试抢占所有在 Psyscall 状态的 P
	for _, p := range allp {
		s := p.status
		if s == _Psyscall && atomic.Cas(&p.status, s, _Pgcstop) {
			if trace.enabled {
				traceGoSysBlock(p)
				traceProcStop(p)
			}
			p.syscalltick++
			sched.stopwait--
		}
	}
	// 停止 idle P's
	for {
		p := pidleget()
		if p == nil {
			break
		}
		p.status = _Pgcstop
		sched.stopwait--
	}
	wait := sched.stopwait > 0
	unlock(&sched.lock)

	// 等待剩余的 P 主动停止
	if wait {
		for {
			// 等待 100us, 然后尝试重新抢占，从而防止竞争
			if notetsleep(&sched.stopnote, 100*1000) {
				noteclear(&sched.stopnote)
				break
			}
			preemptall()
		}
	}

	(...)
}
```

## Start The World

```go
func startTheWorldWithSema(emitTraceEvent bool) int64 {
	mp := acquirem() // disable preemption because it can be holding p in a local var
	if netpollinited() {
		list := netpoll(false) // 非阻塞
		injectglist(&list)
	}
	lock(&sched.lock)

	procs := gomaxprocs
	if newprocs != 0 {
		procs = newprocs
		newprocs = 0
	}
	p1 := procresize(procs)
	sched.gcwaiting = 0
	if sched.sysmonwait != 0 {
		sched.sysmonwait = 0
		notewakeup(&sched.sysmonnote)
	}
	unlock(&sched.lock)

	for p1 != nil {
		p := p1
		p1 = p1.link.ptr()
		if p.m != 0 {
			mp := p.m.ptr()
			p.m = 0
			(...)
			mp.nextp.set(p)
			notewakeup(&mp.park)
		} else {
			// 运行 M 并运行 P. 下面不会创建一个新的 M
			newm(nil, p)
		}
	}

	// 在执行清理任务之前捕获 start-the-world 时间。
	startTime := nanotime()
	(...)

	// 如果我们在本地队列或全局队列中有过多的可运行的 goroutine，则唤醒一个额外的 proc。
	// 如果我们不这样做，那么过程就会停止。
	// 如果我们有大量过多的工作，重新设置将取消必要的额外过程。
	if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 {
		wakep()
	}

	releasem(mp)
	return startTime
}
```

## GC 周期

```go
func gcStart(trigger gcTrigger) {
	// 不要尝试在非抢占或可能不稳定的情况下（m 被锁）启动 GC。
	mp := acquirem()
	if gp := getg(); gp == mp.g0 || mp.locks > 1 || mp.preemptoff != "" {
		releasem(mp)
		return
	}
	releasem(mp)
	mp = nil

	// 记录已经启动的 sweeper 数量
	for trigger.test() && sweepone() != ^uintptr(0) {
		sweep.nbgsweep++
	}

	// 执行 GC 初始化，以及 sweep 终止转换 termination transition
	semacquire(&work.startSema)
	// 在持有锁的情况下 重新检查转换条件，若不需要触发则不触发
	if !trigger.test() {
		semrelease(&work.startSema)
		return
	}

	// 对于统计信息，请检查用户是否强制使用此 GC。
	work.userForced = trigger.kind == gcTriggerCycle

	mode := gcBackgroundMode
	(...)

	// 好的，我们确实要进行 GC，停止所有其他人！
	semacquire(&worldsema)
	(...)

	gcBgMarkStartWorkers()

	systemstack(gcResetMarkState)

	// 记录此次 GC 时 STW 的各项信息，用于计算下一次 GC 周期的触发时间
	work.stwprocs, work.maxprocs = gomaxprocs, gomaxprocs
	if work.stwprocs > ncpu {
		work.stwprocs = ncpu
	}
	work.heap0 = atomic.Load64(&memstats.heap_live)
	work.pauseNS = 0
	work.mode = mode

	now := nanotime()
	work.tSweepTerm = now
	work.pauseStart = now
	(...)

	// ----------------- 正式 STW ----------------------
	systemstack(stopTheWorldWithSema)
	// 在我们开始并发 scan 之前完成 sweep。
	systemstack(func() {
		finishsweep_m()
	})
	(...)

	work.cycles++
	gcController.startCycle()
	work.heapGoal = memstats.next_gc
	(...)

	// 进入并发标记阶段并启用写障碍。
	// 因为世界已经停止，所有 Ps 都会观察到，当我们开始世界并开始扫描时，写入障碍就会被启用。
	// 写屏障必须在 assists 之前启用，因为必须在标记任何非叶堆对象之前启用它们。
	// 由于分配被阻止直到 assists 可能发生，我们希望尽早启用 assists。
	setGCPhase(_GCmark)

	gcBgMarkPrepare() // 必须 happen before assist enable.
	gcMarkRootPrepare()

	// 标记所有活动的 tinyalloc 块。由于我们从这些分配，他们需要像其他分配一样黑。
	// 另一种方法是在每次分配时使小块变黑，这会减慢 tiny allocator。
	gcMarkTinyAllocs()

	// 此时所有 Ps 都启用了写入屏障，从而保持了无白色到黑色的不变性。
	// 启用 mutator 协助对快速分配 mutator 施加压力。
	atomic.Store(&gcBlackenEnabled, 1)

	// Assists 和 workers 可以在我们 start the world 的瞬间直接启动
	gcController.markStartTime = now

	// 并发 mark
	systemstack(func() {
		now = startTheWorldWithSema(trace.enabled)
		work.pauseNS += now - work.pauseStart
		work.tMark = now
	})
	// ----------------- 结束 STW -----------------------

	(...)
	semrelease(&work.startSema)
}
```


### 后台标记

```go
// gcBgMarkStartWorkers 准备后台标记 worker goroutines。
// 这些 goroutine 直到标记阶段才会运行，但它们必须在工作未停止时从常规 G 栈启动。调用方必须持有 worldsema。
func gcBgMarkStartWorkers() {
	// 后台 mark 分别每个 P 上执行。确保每个 P 都有一个后台 GC G
	for _, p := range allp {
		if p.gcBgMarkWorker == 0 {
			go gcBgMarkWorker(p) // 启动一个 goroutine 来运行 mark worker
			notetsleepg(&work.bgMarkReady, -1) // 休眠，直到 gcBgMarkWorker 就绪
			noteclear(&work.bgMarkReady) // 这时启动继续启动下一个 Worker
		}
	}
}
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)