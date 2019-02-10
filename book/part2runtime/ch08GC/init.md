# 垃圾回收器：初始化

TODO:

```go
// runtime/mgc.go
func gcinit() {
	(...)

	// 第一个周期没有扫描。
	mheap_.sweepdone = 1

	// 设置合理的初始 GC 触发比率。
	memstats.triggerRatio = 7 / 8.0

	// 伪造一个 heap_marked 值，使它看起来像一个触发器
	// heapminimum 是 heap_marked的 适当增长。
	// 这将用于计算初始 GC 目标。
	memstats.heap_marked = uint64(float64(heapminimum) / (1 + memstats.triggerRatio))

	// 从环境中设置 gcpercent。这也将计算并设置 GC 触发器和目标。
	_ = setGCPercent(readgogc())

	work.startSema = 1
	work.markDoneSema = 1
}
func readgogc() int32 {
	p := gogetenv("GOGC")
	if p == "off" {
		return -1
	}
	if n, ok := atoi32(p); ok {
		return n
	}
	return 100
}
//go:linkname setGCPercent runtime/debug.setGCPercent
func setGCPercent(in int32) (out int32) {
	lock(&mheap_.lock)
	out = gcpercent
	if in < 0 {
		in = -1
	}
	gcpercent = in
	heapminimum = defaultHeapMinimum * uint64(gcpercent) / 100
	// 更新步调来响应 gcpercent 变化
	gcSetTriggerRatio(memstats.triggerRatio)
	unlock(&mheap_.lock)

	// 如果我们刚好禁用了 GC，则等待任何并发 GC 标记完成，从而我们总是能够在没有 GC 的情况下返回
	if in < 0 {
		gcWaitOnMark(atomic.Load(&work.cycles))
	}

	return out
}
```

```go
func isSweepDone() bool {
	return mheap_.sweepdone != 0
}
func gcSetTriggerRatio(triggerRatio float64) {
	// Set the trigger ratio, capped to reasonable bounds.
	if triggerRatio < 0 {
		// This can happen if the mutator is allocating very
		// quickly or the GC is scanning very slowly.
		triggerRatio = 0
	} else if gcpercent >= 0 {
		// Ensure there's always a little margin so that the
		// mutator assist ratio isn't infinity.
		maxTriggerRatio := 0.95 * float64(gcpercent) / 100
		if triggerRatio > maxTriggerRatio {
			triggerRatio = maxTriggerRatio
		}
	}
	memstats.triggerRatio = triggerRatio

	// Compute the absolute GC trigger from the trigger ratio.
	//
	// We trigger the next GC cycle when the allocated heap has
	// grown by the trigger ratio over the marked heap size.
	trigger := ^uint64(0)
	if gcpercent >= 0 {
		trigger = uint64(float64(memstats.heap_marked) * (1 + triggerRatio))
		// Don't trigger below the minimum heap size.
		minTrigger := heapminimum
		if !isSweepDone() {
			// Concurrent sweep happens in the heap growth
			// from heap_live to gc_trigger, so ensure
			// that concurrent sweep has some heap growth
			// in which to perform sweeping before we
			// start the next GC cycle.
			sweepMin := atomic.Load64(&memstats.heap_live) + sweepMinHeapDistance*uint64(gcpercent)/100
			if sweepMin > minTrigger {
				minTrigger = sweepMin
			}
		}
		if trigger < minTrigger {
			trigger = minTrigger
		}
		if int64(trigger) < 0 {
			print("runtime: next_gc=", memstats.next_gc, " heap_marked=", memstats.heap_marked, " heap_live=", memstats.heap_live, " initialHeapLive=", work.initialHeapLive, "triggerRatio=", triggerRatio, " minTrigger=", minTrigger, "\n")
			throw("gc_trigger underflow")
		}
	}
	memstats.gc_trigger = trigger

	// Compute the next GC goal, which is when the allocated heap
	// has grown by GOGC/100 over the heap marked by the last
	// cycle.
	goal := ^uint64(0)
	if gcpercent >= 0 {
		goal = memstats.heap_marked + memstats.heap_marked*uint64(gcpercent)/100
		if goal < trigger {
			// The trigger ratio is always less than GOGC/100, but
			// other bounds on the trigger may have raised it.
			// Push up the goal, too.
			goal = trigger
		}
	}
	memstats.next_gc = goal
	if trace.enabled {
		traceNextGC()
	}

	// Update mark pacing.
	if gcphase != _GCoff {
		gcController.revise()
	}

	// Update sweep pacing.
	if isSweepDone() {
		mheap_.sweepPagesPerByte = 0
	} else {
		// Concurrent sweep needs to sweep all of the in-use
		// pages by the time the allocated heap reaches the GC
		// trigger. Compute the ratio of in-use pages to sweep
		// per byte allocated, accounting for the fact that
		// some might already be swept.
		heapLiveBasis := atomic.Load64(&memstats.heap_live)
		heapDistance := int64(trigger) - int64(heapLiveBasis)
		// Add a little margin so rounding errors and
		// concurrent sweep are less likely to leave pages
		// unswept when GC starts.
		heapDistance -= 1024 * 1024
		if heapDistance < _PageSize {
			// Avoid setting the sweep ratio extremely high
			heapDistance = _PageSize
		}
		pagesSwept := atomic.Load64(&mheap_.pagesSwept)
		sweepDistancePages := int64(mheap_.pagesInUse) - int64(pagesSwept)
		if sweepDistancePages <= 0 {
			mheap_.sweepPagesPerByte = 0
		} else {
			mheap_.sweepPagesPerByte = float64(sweepDistancePages) / float64(heapDistance)
			mheap_.sweepHeapLiveBasis = heapLiveBasis
			// Write pagesSweptBasis last, since this
			// signals concurrent sweeps to recompute
			// their debt.
			atomic.Store64(&mheap_.pagesSweptBasis, pagesSwept)
		}
	}
}
```

```go
func (c *gcControllerState) revise() {
	gcpercent := gcpercent
	if gcpercent < 0 {
		// If GC is disabled but we're running a forced GC,
		// act like GOGC is huge for the below calculations.
		gcpercent = 100000
	}
	live := atomic.Load64(&memstats.heap_live)

	var heapGoal, scanWorkExpected int64
	if live <= memstats.next_gc {
		// We're under the soft goal. Pace GC to complete at
		// next_gc assuming the heap is in steady-state.
		heapGoal = int64(memstats.next_gc)

		// Compute the expected scan work remaining.
		//
		// This is estimated based on the expected
		// steady-state scannable heap. For example, with
		// GOGC=100, only half of the scannable heap is
		// expected to be live, so that's what we target.
		//
		// (This is a float calculation to avoid overflowing on
		// 100*heap_scan.)
		scanWorkExpected = int64(float64(memstats.heap_scan) * 100 / float64(100+gcpercent))
	} else {
		// We're past the soft goal. Pace GC so that in the
		// worst case it will complete by the hard goal.
		const maxOvershoot = 1.1
		heapGoal = int64(float64(memstats.next_gc) * maxOvershoot)

		// Compute the upper bound on the scan work remaining.
		scanWorkExpected = int64(memstats.heap_scan)
	}

	// Compute the remaining scan work estimate.
	//
	// Note that we currently count allocations during GC as both
	// scannable heap (heap_scan) and scan work completed
	// (scanWork), so allocation will change this difference will
	// slowly in the soft regime and not at all in the hard
	// regime.
	scanWorkRemaining := scanWorkExpected - c.scanWork
	if scanWorkRemaining < 1000 {
		// We set a somewhat arbitrary lower bound on
		// remaining scan work since if we aim a little high,
		// we can miss by a little.
		//
		// We *do* need to enforce that this is at least 1,
		// since marking is racy and double-scanning objects
		// may legitimately make the remaining scan work
		// negative, even in the hard goal regime.
		scanWorkRemaining = 1000
	}

	// Compute the heap distance remaining.
	heapRemaining := heapGoal - int64(live)
	if heapRemaining <= 0 {
		// This shouldn't happen, but if it does, avoid
		// dividing by zero or setting the assist negative.
		heapRemaining = 1
	}

	// Compute the mutator assist ratio so by the time the mutator
	// allocates the remaining heap bytes up to next_gc, it will
	// have done (or stolen) the remaining amount of scan work.
	c.assistWorkPerByte = float64(scanWorkRemaining) / float64(heapRemaining)
	c.assistBytesPerWork = float64(heapRemaining) / float64(scanWorkRemaining)
}



var gcController gcControllerState

type gcControllerState struct {
	scanWork int64
	bgScanCredit int64
	assistTime int64
	dedicatedMarkTime int64
	fractionalMarkTime int64
	idleMarkTime int64
	markStartTime int64
	dedicatedMarkWorkersNeeded int64
	assistWorkPerByte float64
	assistBytesPerWork float64
	fractionalUtilizationGoal float64

	_ cpu.CacheLinePad
}
```

```go
func gcWaitOnMark(n uint32) {
	for {
		// Disable phase transitions.
		lock(&work.sweepWaiters.lock)
		nMarks := atomic.Load(&work.cycles)
		if gcphase != _GCmark {
			// We've already completed this cycle's mark.
			nMarks++
		}
		if nMarks > n {
			// We're done.
			unlock(&work.sweepWaiters.lock)
			return
		}

		// Wait until sweep termination, mark, and mark
		// termination of cycle N complete.
		work.sweepWaiters.list.push(getg())
		goparkunlock(&work.sweepWaiters.lock, waitReasonWaitForGCCycle, traceEvGoBlock, 1)
	}
}
// 将当前 goroutine 置于等待状态并解锁 lock。
// 通过调用 goready(gp) 可让 goroutine 再次 runnable
func goparkunlock(lock *mutex, reason waitReason, traceEv byte, traceskip int) {
	gopark(parkunlock_c, unsafe.Pointer(lock), reason, traceEv, traceskip)
}
```

```go
// 在我们即将开始让用户代码运行之前，在大量运行时初始化之后调用 gcenable。
// 它启动后台的 sweeper goroutine 并启用 GC。
func gcenable() {
	c := make(chan int, 1)
	go bgsweep(c)
	<-c
	memstats.enablegc = true // 现在运行时已经初始化完毕了，GC 已就绪
}
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)