# 垃圾回收器：触发频率与调步算法

## GC 的调控方式

```go
// src/runtime/debug
func SetGCPercent(percent int) int
func SetMaxStack(bytes int) int
```

GOGC

## 调步算法的设计

目前触发 GC 的条件使用的是从 Go 1.5 时提出的**调步（Pacing）算法**，
调步算法是优化并发执行时 GC 的步调，换句话说就是解决什么时候应该触发下一次 GC 的这个问题。现在我们从两个不同的视角来对这个问题进行建模。

从用户的角度而言，我们希望给定一个给定的增长率，使堆在给定增长率的情况下触发下一次 GC。这时设 $h_g$ 为**目标增长率**（即 GOGC / 100），则完成 n 个 GC 周期后标记对象的总大小为：

$$
H_g(n) = (1+h_g) \times H_m (n-1)
$$

这时的 $H_g(n)$ 是作为用户的我们锁希望的堆的增长结果，GC 必须将堆的大小限制在此结果以内。

从 GC 的角度而言，我们需要在观察到给定数量的新的内存分配后，开始执行 GC，设触发时刻的堆大小为 $H_T$，在执行 GC 的期间由于用户代码并发执行，同样会产生一定数量的内存分配，不妨设该次 GC 完成时堆的大小为 $H_a$。在不同的情况下，一个 GC 周期后得到的实际堆大小既可以大于也可以小于堆大小。但我们的优化还需要考虑这这个因素：

- 我们应该尽可能的使得第 n 次 GC 周期的目标堆大小 $H_a(n) < H_g$ 从而避免不断增加的内存消耗。
- 我们应该尽可能的避免第 n 次 GC 周期的目标堆大小 $H_a(n) - H_g$ 的指过大，从而产生过量的 CPU 消耗，进而导致应用的执行速度减慢。

显然，如果我们没有并行 GC，即需要对用户代码执行 STW，则 GC 期间不会产生新的分配，问题将变得异常简单：当堆增长到 $H_g$ 时开始执行下一次 GC。
但当需要 GC 并行的与用户代码执行时，我们则需要提前在堆大小为 $H_T$ 时候触发 GC，以得到最优的 GC 触发条件，则我们可以将合适触发 GC 这个问题转化为以下优化问题：

**优化问题1**：寻找 $H_T$，使得 $\min |H_g - H_a (n)|$。

而对于第二个因素而言，为了控制 GC 对 CPU 的使用率，并发阶段的 GC 应该尽可能接近 GOMAXPROCS 的 25%。这包括后台收集器中的时间和来自用户代码的富足，但不是写屏障的时间（仅因为技术会增加写屏障的开销）







<!-- 调步算法包含四个部分：

1. GC 周期所需的扫描估计器
2. 为用户代码根据堆分配到目标堆大小的时间估计扫描工作量的机制
3. 用户代码为未充分利用 CPU 预算时进行后台扫描的调度程序
4. GC 触发比率的控制器 -->

## 实现

### 扫描工作估计器

### 扫描协助

### 赋值器协助

### 触发比率控制器

```go
// gcTrigger 是一个 GC 周期开始的谓词。具体而言，它是一个 _GCoff 阶段的退出条件
type gcTrigger struct {
	kind gcTriggerKind
	now  int64  // gcTriggerTime: 当前时间
	n    uint32 // gcTriggerCycle: 开始的周期数
}

type gcTriggerKind int

const (
	// gcTriggerHeap 表示当堆大小达到控制器计算的触发堆大小时开始一个周期
	gcTriggerHeap gcTriggerKind = iota

	// gcTriggerTime 表示自上一个 GC 周期后当循环超过
	// forcegcperiod 纳秒时应开始一个周期。
	gcTriggerTime

	// gcTriggerCycle 表示如果我们还没有启动第 gcTrigger.n 个周期
	// （相对于 work.cycles）时应开始一个周期。
	gcTriggerCycle
)

// test 报告当前出发条件是否满足，换句话说 _GCoff 阶段的退出条件已满足。
// 退出条件应该在分配阶段已完成测试。
func (t gcTrigger) test() bool {
	// 如果已禁用 GC
	if !memstats.enablegc || panicking != 0 || gcphase != _GCoff {
		return false
	}
	// 根据类别做不同判断
	switch t.kind {
	case gcTriggerHeap:
		// 上个周期结束时剩余的加上到目前为止分配的内存 超过 触发标记阶段标准的内存
		// 考虑性能问题，对非原子操作访问 heap_live 。如果我们需要触发该条件，
		// 则所在线程一定会原子的写入 heap_live，从而我们会观察到我们的写入。
		return memstats.heap_live >= memstats.gc_trigger
	case gcTriggerTime:
		if gcpercent < 0 { // 因为允许在运行时动态调整 gcpercent，因此需要额外再检查一遍
			return false
		}
		// 计算上次 gc 开始时间是否大于强制执行 GC 周期的时间
		lastgc := int64(atomic.Load64(&memstats.last_gc_nanotime))
		return lastgc != 0 && t.now-lastgc > forcegcperiod // 两分钟
	case gcTriggerCycle:
		// 进行测试的周期 t.n 大于实际触发的，需要进行 GC 则通过测试
		return int32(t.n-work.cycles) > 0
	}
	return true
}
```

TODO:

```go
type mstats struct {
	(...)
	last_gc_nanotime uint64 // 上次 gc (monotonic 时间)
	(...)

	// triggerRatio is the heap growth ratio that triggers marking.
	//
	// E.g., if this is 0.6, then GC should start when the live
	// heap has reached 1.6 times the heap size marked by the
	// previous cycle. This should be ≤ GOGC/100 so the trigger
	// heap size is less than the goal heap size. This is set
	// during mark termination for the next cycle's trigger.
	triggerRatio float64

	// gc_trigger 指触发标记阶段的堆大小
	//
	// 当 heap_live ≥ gc_trigger 时，标记阶段将开始执行
	// 它同样用来表示必须完成的成比例清扫时的堆大小。
	//
	// 该字段在 triggerRatio 在标记终止阶段为下一个周期的触发器进行计算。
	gc_trigger uint64

	// heap_live 是 GC 认为的实际字节数。即：最近一次 GC 保留的加上从那之后分配的字节数。
	// heap_live <= heap_alloc ，因为 heap_alloc 包括尚未扫描的未标记对象
	// （因此在我们扫描时分配和向下），而 heap_live 不包含这些对象（因此只在 GC 之间上升）。
	//
	// 该字段是在没有锁的情况下原子更新的。
	// 为了减少竞争，只有在从 mcentral 获取 span 时才会更新，
	// 并且此时它会计算该 span 中的所有未分配的插槽（将在该 mcache 从该 mcentral 获取另一个 span 之前分配）。
	// 因此，它对 “真正的” 实时堆大小的估计略微偏高了。之所以高估而非低估的原因是
	// 1) 在必要时提前触发 GC 2) 这会导致保守的 GC 率而而非过低的 GC 率。
	//
	// 读取同样应该是原子的（或在 STW 期间）。
	//
	// 每当更新该字段时，请调用 traceHeapAlloc() 和 gcController.revise()
	heap_live uint64

	(>..)

	// heap_marked 表示前一个 GC 中标记的字节数。标记终止阶段结束后，heap_live == heap_marked,
	// 与 heap_live 不同的是，heap_marked 在下一个 mark_termination 之前都不会发生变化
	heap_marked uint64
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
	gcSetTriggerRatio(memstats.triggerRatio) // 更新步调来响应 gcpercent 变化
	unlock(&mheap_.lock)
	(...)
	return out
}
func gcSetTriggerRatio(triggerRatio float64) {
	// Compute the next GC goal, which is when the allocated heap
	// has grown by GOGC/100 over the heap marked by the last
	// cycle.
	goal := ^uint64(0)
	if gcpercent >= 0 {
		goal = memstats.heap_marked + memstats.heap_marked*uint64(gcpercent)/100
	}

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

	// 根据触发器比率来计算绝对的 GC 触发器
	//
	// 当分配的堆的大小超过标记的堆大小时，我们触发下一个 GC 循环。
	trigger := ^uint64(0)
	if gcpercent >= 0 {
		trigger = uint64(float64(memstats.heap_marked) * (1 + triggerRatio))
		// 小于最小堆大小时不触发
		minTrigger := heapminimum
		if !isSweepDone() { // 即 mheap_.sweepdone != 0
			// Concurrent sweep happens in the heap growth
			// from heap_live to gc_trigger, so ensure
			// that concurrent sweep has some heap growth
			// in which to perform sweeping before we
			// start the next GC cycle.
			sweepMin := atomic.Load64(&memstats.heap_live) + sweepMinHeapDistance
			if sweepMin > minTrigger {
				minTrigger = sweepMin
			}
		}
		if trigger < minTrigger {
			trigger = minTrigger
		}
		(...)
		if trigger > goal {
			// The trigger ratio is always less than GOGC/100, but
			// other bounds on the trigger may have raised it.
			// Push up the goal, too.
			goal = trigger
		}
	}

	// Commit to the trigger and goal.
	memstats.gc_trigger = trigger
	memstats.next_gc = goal
	(...)

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

	gcPaceScavenger()
}
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)