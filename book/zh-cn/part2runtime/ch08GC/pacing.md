---
weight: 2305
title: "8.5 触发频率与调步算法"
---

# 8.5 触发频率与调步算法

## GC 的调控方式

```go
// src/runtime/debug
func SetGCPercent(percent int) int
func SetMaxStack(bytes int) int
```

GOGC

## 调步算法及其数学模型

目前触发 GC 的条件使用的是从 Go 1.5 时提出的**调步（Pacing）算法**，
调步算法是优化并发执行时 GC 的步调，换句话说就是解决什么时候应该触发下一次 GC 
的这个问题。

调步算法包含四个部分：

1. GC 周期所需的扫描估计器
2. 为用户代码根据堆分配到目标堆大小的时间估计扫描工作量的机制
3. 用户代码为未充分利用 CPU 预算时进行后台扫描的调度程序
4. GC 触发比率的控制器

现在我们从两个不同的视角来对这个问题进行建模。

从用户的角度而言，我们希望给定一个给定的增长率，使堆在给定增长率的情况下触发下一次 GC。
这时设 $h_g$ 为**目标增长率**（即 GOGC / 100），则完成 n 个 GC 周期后标记对象的总大小为：

$$
H_g^{(n)} = (1+h_g) H_m^{(n-1)}
$$

![](../../../assets/gc-pacing.png)

这时的 $H_g(n)$ 是作为用户的我们所希望的堆的增长结果，GC 必须将堆的大小限制在此结果以内。

从 GC 的角度而言，我们需要在观察到给定数量的新的内存分配后，开始执行 GC，设触发时刻的堆大小为 $H_T$，
在执行 GC 的期间由于用户代码并发执行，同样会产生一定数量的内存分配，不妨设该次 GC 完成时堆的大小为 $H_a$。
在不同的情况下，一个 GC 周期后得到的实际堆大小既可以大于也可以小于堆大小。但我们的优化还需要考虑这这个因素：

- 因素1: 我们应该尽可能的使得第 n 次 GC 周期的目标堆大小 $H_a^{(n)} < H_g^{(n)}$ 从而避免不断增加的内存消耗。
- 因素2: 我们应该尽可能的避免第 n 次 GC 周期的目标堆大小 $H_a^{(n)} - H_g^{(n)}$ 的指过大，从而产生过量的 CPU 消耗，进而导致应用的执行速度减慢。

显然，如果我们没有并行 GC，即需要对用户代码执行 STW，则 GC 期间不会产生新的分配，
问题将变得异常简单：当堆增长到 $H_g^{(n)}$ 时开始执行下一阶段的 GC。
但当需要 GC 并行的与用户代码执行时，我们则需要提前在堆大小为 $H_T$ 时候触发 GC，
以得到最优的 GC 触发条件，则我们可以将合适触发 GC 这个问题转化为以下优化问题：

**优化问题1**：寻找 $H_T^{(n)}$，使得 $\min |H_g^{(n)} - H_a^{(n)}| = \min |(1+h_g) H_m^{(n-1)} - H_a^{(n)}|$。

而对于第二个因素而言，为了控制 GC 对 CPU 的使用率，并发阶段的 GC 应该尽可能接近 GOMAXPROCS 的 25%。这包括后台收集器中的时间和来自用户代码的富足，但不是写屏障的时间（仅因为计数会增加写屏障的开销）。如果设 $u_g$为目标 CPU 使用率（goal utilization），而 $u_a$为实际 CPU 使用率（actual utilization），于是我们有第二个优化问题：

**优化问题2**：寻找 $H_T^{(n)}$，同时使得 $\min|u_g^{(n)} - u_a^{(n)}|$。

TODO: 求解的具体数学建模过程

综上所述，计算 $H_T$ 的公式（从 Go 1.10 时开始）为：
  
设第 n 次触发 GC 时，估计得到的堆增长率为 $h_T^{(n)}$、运行过程中的实际堆增长率为 $h_a^{(n)}$、标记辅助花费的时间 $t_A^{(n)}$，用户设置的增长率为 $\rho = \text{GOGC}/100$（ $\rho > 0$）则第 $n+1$ 次出触发 GC 时候，估计的堆增长率为：

$$
h_T^{(n+1)} = h_T^{(n)} + 0.5 \left[ \rho - h_T^{(n)} - \frac{0.25 t_A^{(n)}}{0.3} \left( h_a^{(n)} - h_T^{(n)} \right) \right]
$$

特别的，当 $n=0$ 时，标记辅助的时间 $t_A^{(n)} = 0$，且令 $h_t^{(0)} = 0.875$，即第一次触发 GC 时：
$$
h_T^{(1)} = \frac{1}{2}\left[ \frac{7}{8} + \rho \right]
$$

当 $h_T<0.6$时，将其调整为 $0.6$，当 $h_T > 0.95 \rho$ 时，将其设置为 $0.95 \rho$。

默认情况下，$\rho = 1$（即 GOGC = 100），第一次出发 GC 时，$h_T^{(1)} = 0.9375$，由于默认的最小堆大小为 4MB，因此当程序消耗 3.75MB 时，触发第一次 GC，可以写如下程序进行验证：

```go
package main

import (
	"os"
	"runtime"
	"runtime/trace"
	"sync/atomic"
)

var stop uint64

func gcfinished() *int {
	p := 1
	runtime.SetFinalizer(&p, func(_ *int) {
		println("gc finished")
		atomic.StoreUint64(&stop, 1)
	})
	return &p
}

func allocate() {
	// 每次调用分配 0.25MB，第一次触发 GC 时，此函数被调用了 15 次
	_ = make([]byte, int((1<<20)*0.25))
}

func main() {
	f, _ := os.Create("trace.out")
	defer f.Close()
	trace.Start(f)
	defer trace.Stop()
	gcfinished()
	for n := 1; atomic.LoadUint64(&stop) != 1; n++ {
		println("#allocate: ", n)
		allocate()
	}
	println("terminate")
}
```

```
go tool trace trace.out
```

![](../../../assets/gc-trigger.png)

便能发现，根据 Heap 数值上升的阶梯状来看，当进行第 16 次阶梯式上升（内存分配）时，此时已经在堆中分配了 3948544 / (1025 * 1024) 约等于 3.76 MB，符合理论上计算的 15 * 0.25MB = 3.75MB，时，GC开始被触发。

我们再来根据调试信息验证一下下一个GC触发时的堆大小：

首先，从记录中可以看到，标记辅助所消耗的时间为 $t_A = 354017/(4*68182) \approx 1.3 $

![](../../../assets/gc-trigger2.png)

运行过程中的实际堆增长率为 $h_a(1) = (3948544-3936000)/3936000 = 0.0031$

根据第一次 GC 得到的结果，估计得到的堆增长率为 

$$
h_T^{(2)} = h_T^{(1)} + 0.5 \left[ 1 - h_T^{(1)} - \frac{0.25 \times 1.3}{0.3} \left(0.0031 - h_T^{(1)}\right) \right] = 0.9375 + 0.5 (1 - 0.9375 - 1.083(0.0031 - 0.9375)) \approx 1.4747
$$

数值超过 0.95，因此最终的 $h_T^{(2)} = 0.95$ 则再次触发 GC 时的堆大小为 0.95*4MB = 3.8 MB。

- 根据实际所记录的数据 4022528/(1024*1024)约等于 3.83MB，符合理论计算结果。

![](../../../assets/gc-trigger3.png)

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

## 进一步阅读的参考文献

- [Go 1.5 concurrent garbage collector pacing](https://docs.google.com/document/d/1wmjrocXIWTr1JxU-3EQBI6BK6KgtiFArkG47XK73xIQ/edit#)
- [Separate soft and hard heap size goal](https://github.com/golang/proposal/blob/master/design/14951-soft-heap-limit.md)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)