---
weight: 2303
title: "8.3 触发频率及其调步算法"
---

# 8.3 触发频率及其调步算法

## 8.3.1 GC 的调控方式

```go
// src/runtime/debug
func SetGCPercent(percent int) int
func SetMaxStack(bytes int) int
```

GOGC

## 8.3.2 调步算法及其数学模型

目前触发 GC 的条件使用的是从 Go 1.5 时提出的**调步（Pacing）算法**，
调步算法是优化并发执行时 GC 的步调，换句话说就是解决什么时候应该触发下一次 GC 
的这个问题。

调步算法包含四个部分：

1. GC 周期所需的扫描估计器
2. 为用户代码根据堆分配到目标堆大小的时间估计扫描工作量的机制
3. 用户代码为未充分利用 CPU 预算时进行后台扫描的调度程序
4. GC 触发比率的控制器

现在我们从两个不同的视角来对这个问题进行建模。

### 模型的建立

从用户的角度而言，我们希望给定一个给定的增长率，使堆在给定增长率的情况下触发下一次 GC。
这时设 $h_g$ 为**目标增长率**（即 GOGC / 100），则完成 n 个 GC 周期后标记对象的总大小为：

$$
H_g^{(n)} = (1+h_g) H_m^{(n-1)}
$$

<div class="img-center" style="margin: 0 auto; max-width: 70%">
<img src="../../../assets/gc-pacing.png"/>
<strong>图1：调步算法的模型</strong>
</div>

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

### 模型的解

TODO: 求解的具体数学建模过程

综上所述，计算 $H_T$ 的最终结论（从 Go 1.10 时开始 $h_t$ 增加了上界 $0.95 \rho$，从 Go 1.14 开始时 $h_t$ 增加了下界 0.6）是：

- 设第 n 次触发 GC 时 (n > 1)，估计得到的堆增长率为 $h_t^{(n)}$、运行过程中的实际堆增长率为 $h_a^{(n)}$，用户设置的增长率为 $\rho = \text{GOGC}/100$（ $\rho > 0$）则第 $n+1$ 次出触发 GC 时候，估计的堆增长率为：

$$
h_t^{(n+1)} = h_t^{(n)} + 0.5 \left[ \frac{H_g^{(n)} - H_a^{(n)}}{H_a^{(n)}} - h_t^{(n)} - \frac{u_a^{(n)}}{u_g^{(n)}} \left( h_a^{(n)} - h_t^{(n)} \right) \right]
$$

- 特别的，$h_t^{(1)} = 7 / 8$，$u_a^{(1)} = 0.25$，$u_g^{(1)} = 0.3$。第一次触发 GC 时，如果当前的堆小于 $4\rho$ MB，则强制调整到 $4\rho$ MB 时触发 GC

- 特别的，当 $h_t^{(n)}<0.6$时，将其调整为 $0.6$，当 $h_t^{(n)} > 0.95 \rho$ 时，将其设置为 $0.95 \rho$

- 默认情况下，$\rho = 1$（即 GOGC = 100），第一次触发 GC 时强制设置触发第一次 GC 为 4MB，


### 结论的验证

我们可以编写如下程序对我们的求解过程进行验证：

```go
package main

import (
	"os"
	"runtime"
	"runtime/trace"
	"sync/atomic"
)

var stop uint64

// 通过对象 P 的释放状态，来确定 GC 是否已经完成
func gcfinished() *int {
	p := 1
	runtime.SetFinalizer(&p, func(_ *int) {
		println("gc finished")
		atomic.StoreUint64(&stop, 1) // 通知停止分配
	})
	return &p
}

func allocate() {
	// 每次调用分配 0.25MB
	_ = make([]byte, int((1<<20)*0.25))
}

func main() {
	f, _ := os.Create("trace.out")
	defer f.Close()
	trace.Start(f)
	defer trace.Stop()

	gcfinished()

	// 当完成 GC 时停止分配
	for n := 1; atomic.LoadUint64(&stop) != 1; n++ {
		println("#allocate: ", n)
		allocate()
	}
	println("terminate")
}
```
我们先来验证最简单的一种情况，即第一次触发 GC 时的堆大小：

```
$ go build -o main
$ GODEBUG=gctrace=1 ./main
#allocate:  1
...
#allocate:  20
gc finished
gc 1 @0.001s 3%: 0.016+0.23+0.019 ms clock, 0.20+0.11/0.060/0.13+0.22 ms cpu, 4->5->1 MB, 5 MB goal, 12 P
scvg: 8 KB released
scvg: inuse: 1, idle: 62, sys: 63, released: 58, consumed: 5 (MB)
terminate
```

通过这一行数据我们可以看到：

```
gc 1 @0.001s 3%: 0.016+0.23+0.019 ms clock, 0.20+0.11/0.060/0.13+0.22 ms cpu, 4->5->1 MB, 5 MB goal, 12 P
```

1. 程序在完成第一次 GC 后便终止了程序，符合我们的设想
2. 第一次 GC 开始时的堆大小为 4MB，符合我们的设想
3. 当标记终止时，堆大小为 5MB，此后开始执行清扫，这时分配执行到第 20 次，即 20*0.25 = 5MB，符合我们的设想

我们将分配次数调整到 50 次

```go
for n := 1; n < 50; n++ {
	println("#allocate: ", n)
	allocate()
}
```

来验证第二次 GC 触发时是否满足公式所计算得到的值（为 GODEBUG 进一步设置 `gcpacertrace=1`）：

```
$ go build -o main
$ GODEBUG=gctrace=1,gcpacertrace=1 ./main
#allocate:  1
...

pacer: H_m_prev=2236962 h_t=+8.750000e-001 H_T=4194304 h_a=+2.387451e+000 H_a=7577600 h_g=+1.442627e+000 H_g=5464064 u_a=+2.652227e-001 u_g=+3.000000e-001 W_a=152832 goalΔ=+5.676271e-001 actualΔ=+1.512451e+000 u_a/u_g=+8.840755e-001
#allocate:  28
gc 1 @0.001s 5%: 0.032+0.32+0.055 ms clock, 0.38+0.068/0.053/0.11+0.67 ms cpu, 4->7->3 MB, 5 MB goal, 12 P

...
#allocate:  37
pacer: H_m_prev=3307736 h_t=+6.000000e-001 H_T=5292377 h_a=+7.949171e-001 H_a=5937112 h_g=+1.000000e+000 H_g=6615472 u_a=+2.658428e-001 u_g=+3.000000e-001 W_a=154240 goalΔ=+4.000000e-001 actualΔ=+1.949171e-001 u_a/u_g=+8.861428e-001
#allocate:  38
gc 2 @0.002s 9%: 0.017+0.26+0.16 ms clock, 0.20+0.079/0.058/0.12+1.9 ms cpu, 5->5->0 MB, 6 MB goal, 12 P
```

我们可以得到数据：

- 第一次估计得到的堆增长率为 $h_t^{(1)} = 0.875$
- 第一次的运行过程中的实际堆增长率为 $h_a^{(1)} = 0.2387451$
- 第一次实际的堆大小为 $H_a^{(1)}=7577600$
- 第一次目标的堆大小为 $H_g^{(1)}=5464064$
- 第一次的 CPU 实际使用率为 $u_a^{(1)} = 0.2652227$
- 第一次的 CPU 目标使用率为 $u_g^{(1)} = 0.3$

我们据此计算第二次估计的堆增长率：

$$
h_t^{(2)} = h_t^{(1)} + 0.5 \left[ \frac{H_g^{(1)} - H_a^{(1)}}{H_a^{(1)}} - h_t^{(1)} - \frac{u_a^{(1)}}{u_g^{(1)}} \left( h_a^{(1)} - h_t^{(1)} \right) \right]
$$
$$
= 0.875 + 0.5 \left[ \frac{5464064 - 7577600}{5464064} - 0.875 - \frac{0.2652227}{0.3} \left( 0.2387451 - 0.875 \right) \right]
$$
$$
\approx 0.52534543909
$$

因为 $0.52534543909 < 0.6\rho = 0.6$，因此下一次的触发率为 $h_t^{2} = 0.6$，与我们实际观察到的第二次 GC 的触发率 0.6 吻合。

## 8.3.3 实现细节

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
	...
	last_gc_nanotime uint64 // 上次 gc (monotonic 时间)
	...

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
	...
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
		...
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
	...

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

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).