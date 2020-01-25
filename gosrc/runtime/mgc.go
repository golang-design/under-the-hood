// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// 垃圾回收器 (GC).
//
// GC 与 mutator 线程同时运行，类型准确（也称为精确），允许多个 GC 线程并行运行。
// 它是一个使用 write barrier 的并发标记和扫描。它是 non-generational 和 non-compacting 的。
// 使用 per-P 分配区域隔离的大小来完成分配，以最小化碎片，同时消除通常情况下的加锁。
//
// 该算法分解为几个步骤。
// 这里给出的是正在使用的算法的高阶描述。有关 GC 的概述请参考 Richard Jones 的 gchandbook.org。
//
// 该算法的精神遗产包括 Dijkstra 的 on-the-fly 算法，参见：
// Edsger W. Dijkstra, Leslie Lamport, A. J. Martin, C. S. Scholten, and E. F. M. Steffens. 1978.
// On-the-fly garbage collection: an exercise in cooperation. Commun. ACM 21, 11 (November 1978),
// 966-975.
// 关于算法的完整性、正确性和可终止性证明，请参考期刊文献：
// Hudson, R., and Moss, J.E.B. Copying Garbage Collection without stopping the world.
// Concurrency and Computation: Practice and Experience 15(3-5), 2003.
//
// 1. GC 执行终止扫描 (sweep termination)
//
//    a. 停止世界（STW, Stop the World），此操作会导致所有 P 进入 GC safe-point
//
//    b. 扫描所有未被扫描过的 span。如果在预期的时间之前强制执行 GC 周期，那么只会有未清扫的span。
//
// 2. GC 执行 "mark" 阶段
//
//    a. 通过将 gcphase 设置为 _GCmark（来自_GCoff），来启用 write barrier
//    启用 mutator assists 以及 root mark 任务入队以准备标记阶段。
//    在所有 P 启用 write barrier 之前，没有任何对象会被扫描，这是由 STW 完成的。
//
//    b. 启动世界（start the world）。从这时开始，GC work 由调度器启动的
//    mark worker 和作为分配的一部分执行的 assist 完成。write barrier 着色
//    被复用的指针以及任何指针写行为的指针新值。（见 mbarrier.go）。新分配的对象
//    会立即标记为黑色。
//
//    c. GC 执行 root mark 任务。这包括扫描所有栈、着色所有全局变量、以及
//    堆外运行时数据结构中的任何堆指针。扫描栈的工作会停止运行的 goroutine，
//    并为栈中找到的所有指针进行着色，然后恢复 goroutine 的执行。
//
//    d. GC 将灰色对象的工作队列排除，将每个灰色对象扫描为黑色，并对对象中找到的
//    所有指针进行着色（然后将这些指针添加回工作队列）。
//
//    e. 因为 GC work 在不同的局部缓存中被分开，GC 使用分布式终止算法来检测何时
//    没有更多的 root 标记任务或灰色对象（见 gcMarkDone）
//
// 3. GC 执行 mark termination
//
//    a. STW
//
//    b. 设置 gcphase 为 _GCmarktermination，并禁用所有的 worker 和 assist
//
//    c. Perform housekeeping like flushing mcaches.
//
// 4. GC 执行扫描阶段 (sweep phase)
//
//    a. 通过设置 gcphase 到 _GCoff 来准备 sweep 阶段，设置 sweep 状态并禁用 write barrier。
//
//    b. Start the world。这时，所有新创建的对象为白色，并在必要时分配 sweep span。
//
//    c. GC 并发执行 sweep，来响应分配工作，见下面的描述。
//
// 5. 当用户进行了足够的分配工作后，重新从上面 1 开始。 请参阅下面有关 GC 频率的讨论。

// 并发 sweep.
//
// sweep 阶段与正常程序执行同时进行。堆懒惰的清扫 span-by-span（当 goroutine 需要另一个 span 时）
// 并且并发的在后台 goroutine 中扫描（这有助于不受 CPU 限制的程序）。
// 在 STW 标记终止结束时，所有 span 都标记为“需要清扫”。
//
// 后台 sweeper 简单的对一个个 span 进行 sweep。
//
// 为了避免在未扫描 span 时请求更多 OS 内存，当 goroutine 需要另一个 span 时，它首先尝试通过扫描来回收那么多内存。
// 当 goroutine 需要分配一个新的小对象 span 时，它会扫描相同对象大小的小对象 span，直到它释放至少一个对象。
// 当 goroutine 需要从堆中分配大对象 span 时，它会扫描 span，直到它将至少那么多页释放到堆中。
// 有一种情况，这可能是不够的：如果 goroutine 扫描并释放两个不相邻的单页 span 到堆，
// 它将分配一个新的两页 span，但仍然可以有其他单页未扫描 span 可能是合并为两页 span。
//
// 确保在未扫描的 span 上不进行任何操作（这会破坏 GC bitmap 中的标记位）至关重要。
// 在GC期间，所有 mcache 都被刷新到 mcentral 中，因此它们是空的。当 goroutine 抓住一个新的 span 到 mcache 时，它会扫过它。
// 当 goroutine 显式释放对象或设置 finalizer 时，它确保扫描 span（通过扫描它，或等待并发扫描完成）。
// 只有当所有 span 都被扫过时，finalizer goroutine 才会开始。当下一个 GC 开始时，它会扫描所有尚未扫描的 span（如果有的话）。

// GC 频率
// 下一次 GC 是在分配了与已经使用的量成比例的额外内存量之后开始。该比例由 GOGC 环境变量控制（默认为 100）。
// 如果 GOGC = 100 并且我们正在使用 4M，那么当我们达到 8M 时将再次使用 GC（此标记在 next_gc 变量中被跟踪）。
// 这使 GC 成本与分配成本成线性比例。调整 GOGC 只会改变线性常量（以及使用的额外内存量）。

// Oblets
//
// 为了防止在扫描大对象时出现长时间暂停并提高并行性，垃圾收集器将大于m axObletBytes 的对象的扫描 work
// 分解为最多 maxobletBytes 的 “oblets”。
// 当扫描遇到大对象的开头时，它只扫描第一个 oblet 并将剩余的 oblet 排队为新的扫描 work。

package runtime

import (
	"internal/cpu"
	"runtime/internal/atomic"
	"unsafe"
)

const (
	_DebugGC         = 0
	_ConcurrentSweep = true
	_FinBlockSize    = 4 * 1024

	// debugScanConservative enables debug logging for stack
	// frames that are scanned conservatively.
	debugScanConservative = false

	// sweepMinHeapDistance 是为 GC 周期之间的并发扫描保留的堆距离（以字节为单位）的下限。
	sweepMinHeapDistance = 1024 * 1024
)

// heapminimum is the minimum heap size at which to trigger GC.
// For small heaps, this overrides the usual GOGC*live set rule.
//
// When there is a very small live set but a lot of allocation, simply
// collecting when the heap reaches GOGC*live results in many GC
// cycles and high total per-GC overhead. This minimum amortizes this
// per-GC overhead while keeping the heap reasonably small.
//
// During initialization this is set to 4MB*GOGC/100. In the case of
// GOGC==0, this will set heapminimum to 0, resulting in constant
// collection even when the heap size is small, which is useful for
// debugging.
var heapminimum uint64 = defaultHeapMinimum

// defaultHeapMinimum 是 GOGC == 100 的 heapminimum 值。
const defaultHeapMinimum = 4 << 20

// 从 $GOGC 初始化.  GOGC=off 表示禁用 GC.
var gcpercent int32

func gcinit() {
	if unsafe.Sizeof(workbuf{}) != _WorkbufSize {
		throw("size of Workbuf is suboptimal")
	}

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

// 在我们即将开始让用户代码运行之前，在大量运行时初始化之后调用 gcenable。
// 它启用了后台 sweeper goroutine，后台 scavenger goroutine，并启用了 GC
func gcenable() {
	// Kick off sweeping and scavenging.
	c := make(chan int, 2)
	go bgsweep(c)
	go bgscavenge(c)
	<-c
	<-c
	memstats.enablegc = true // 现在运行时已经初始化完毕了，GC 已就绪
}

//go:linkname setGCPercent runtime/debug.setGCPercent
func setGCPercent(in int32) (out int32) {
	// 需要获取 heap 锁，切换到系统栈
	systemstack(func() {
		lock(&mheap_.lock)
		out = gcpercent
		if in < 0 { // GC=off
			in = -1
		}
		gcpercent = in
		heapminimum = defaultHeapMinimum * uint64(gcpercent) / 100
		// 更新步调来响应 gcpercent 变化
		gcSetTriggerRatio(memstats.triggerRatio)
		unlock(&mheap_.lock)
	})
	// Pacing changed, so the scavenger should be awoken.
	wakeScavenger()

	// 如果我们刚好禁用了 GC，则等待任何并发 GC 标记完成，从而我们总是能够在没有 GC 的情况下返回
	if in < 0 {
		gcWaitOnMark(atomic.Load(&work.cycles))
	}

	return out
}

// 垃圾回收期阶段，表示要执行 write barrier 和同步任务
var gcphase uint32

// 编译器了解此变量
// 如果你修改它，你还需要修改 builtin/runtime.go
// 如果你修改前四个字节，则还需要修改插入的 write barrier 代码.
var writeBarrier struct {
	enabled bool    // 编译器在调用 write barrier 之前会发出这样的检查
	pad     [3]byte // 编译器在 enabled 字段中使用32位 load
	needed  bool    // 在当前 GC 阶段中是否需要 write barrier
	cgo     bool    // 在一个 cgo 检查中是否需要 write barrier
	alignme uint64  // 对齐保证，从而编译器可以使用 32 或 64 位 load
}

// gcBlackenEnabled 如果 mutator assists 和 background mark worker 被允许 blacken 对象。
// 它只有在 gcphase == _GCmark 时才被设置
var gcBlackenEnabled uint32

const (
	_GCoff             = iota // GC 没有运行，sweep 在后台运行，写屏障没有启用
	_GCmark                   // GC 标记 roots 和 workbufs: 分配黑色，写屏障启用
	_GCmarktermination        // GC 标记终止: 分配黑色, P's 帮助 GC, 写屏障启用
)

//go:nosplit
func setGCPhase(x uint32) {
	atomic.Store(&gcphase, x) // *gcphase = x
	writeBarrier.needed = gcphase == _GCmark || gcphase == _GCmarktermination
	writeBarrier.enabled = writeBarrier.needed || writeBarrier.cgo
}

// gcMarkWorkerMode represents the mode that a concurrent mark worker
// should operate in.
//
// Concurrent marking happens through four different mechanisms. One
// is mutator assists, which happen in response to allocations and are
// not scheduled. The other three are variations in the per-P mark
// workers and are distinguished by gcMarkWorkerMode.
type gcMarkWorkerMode int

const (
	// gcMarkWorkerDedicatedMode indicates that the P of a mark
	// worker is dedicated to running that mark worker. The mark
	// worker should run without preemption.
	gcMarkWorkerDedicatedMode gcMarkWorkerMode = iota

	// gcMarkWorkerFractionalMode indicates that a P is currently
	// running the "fractional" mark worker. The fractional worker
	// is necessary when GOMAXPROCS*gcBackgroundUtilization is not
	// an integer. The fractional worker should run until it is
	// preempted and will be scheduled to pick up the fractional
	// part of GOMAXPROCS*gcBackgroundUtilization.
	gcMarkWorkerFractionalMode

	// gcMarkWorkerIdleMode indicates that a P is running the mark
	// worker because it has nothing else to do. The idle worker
	// should run until it is preempted and account its time
	// against gcController.idleMarkTime.
	gcMarkWorkerIdleMode
)

// gcMarkWorkerModeStrings are the strings labels of gcMarkWorkerModes
// to use in execution traces.
var gcMarkWorkerModeStrings = [...]string{
	"GC (dedicated)",
	"GC (fractional)",
	"GC (idle)",
}

// gcController implements the GC pacing controller that determines
// when to trigger concurrent garbage collection and how much marking
// work to do in mutator assists and background marking.
//
// It uses a feedback control algorithm to adjust the memstats.gc_trigger
// trigger based on the heap growth and GC CPU utilization each cycle.
// This algorithm optimizes for heap growth to match GOGC and for CPU
// utilization between assist and background marking to be 25% of
// GOMAXPROCS. The high-level design of this algorithm is documented
// at https://golang.org/s/go15gcpacing.
//
// All fields of gcController are used only during a single mark
// cycle.
var gcController gcControllerState

type gcControllerState struct {
	// scanWork is the total scan work performed this cycle. This
	// is updated atomically during the cycle. Updates occur in
	// bounded batches, since it is both written and read
	// throughout the cycle. At the end of the cycle, this is how
	// much of the retained heap is scannable.
	//
	// Currently this is the bytes of heap scanned. For most uses,
	// this is an opaque unit of work, but for estimation the
	// definition is important.
	scanWork int64

	// bgScanCredit is the scan work credit accumulated by the
	// concurrent background scan. This credit is accumulated by
	// the background scan and stolen by mutator assists. This is
	// updated atomically. Updates occur in bounded batches, since
	// it is both written and read throughout the cycle.
	bgScanCredit int64

	// assistTime is the nanoseconds spent in mutator assists
	// during this cycle. This is updated atomically. Updates
	// occur in bounded batches, since it is both written and read
	// throughout the cycle.
	assistTime int64

	// dedicatedMarkTime is the nanoseconds spent in dedicated
	// mark workers during this cycle. This is updated atomically
	// at the end of the concurrent mark phase.
	dedicatedMarkTime int64

	// fractionalMarkTime is the nanoseconds spent in the
	// fractional mark worker during this cycle. This is updated
	// atomically throughout the cycle and will be up-to-date if
	// the fractional mark worker is not currently running.
	fractionalMarkTime int64

	// idleMarkTime is the nanoseconds spent in idle marking
	// during this cycle. This is updated atomically throughout
	// the cycle.
	idleMarkTime int64

	// markStartTime is the absolute start time in nanoseconds
	// that assists and background mark workers started.
	markStartTime int64

	// dedicatedMarkWorkersNeeded is the number of dedicated mark
	// workers that need to be started. This is computed at the
	// beginning of each cycle and decremented atomically as
	// dedicated mark workers get started.
	dedicatedMarkWorkersNeeded int64

	// assistWorkPerByte is the ratio of scan work to allocated
	// bytes that should be performed by mutator assists. This is
	// computed at the beginning of each cycle and updated every
	// time heap_scan is updated.
	assistWorkPerByte float64

	// assistBytesPerWork is 1/assistWorkPerByte.
	assistBytesPerWork float64

	// fractionalUtilizationGoal is the fraction of wall clock
	// time that should be spent in the fractional mark worker on
	// each P that isn't running a dedicated worker.
	//
	// For example, if the utilization goal is 25% and there are
	// no dedicated workers, this will be 0.25. If the goal is
	// 25%, there is one dedicated worker, and GOMAXPROCS is 5,
	// this will be 0.05 to make up the missing 5%.
	//
	// If this is zero, no fractional workers are needed.
	fractionalUtilizationGoal float64

	_ cpu.CacheLinePad
}

// startCycle resets the GC controller's state and computes estimates
// for a new GC cycle. The caller must hold worldsema.
func (c *gcControllerState) startCycle() {
	c.scanWork = 0
	c.bgScanCredit = 0
	c.assistTime = 0
	c.dedicatedMarkTime = 0
	c.fractionalMarkTime = 0
	c.idleMarkTime = 0

	// Ensure that the heap goal is at least a little larger than
	// the current live heap size. This may not be the case if GC
	// start is delayed or if the allocation that pushed heap_live
	// over gc_trigger is large or if the trigger is really close to
	// GOGC. Assist is proportional to this distance, so enforce a
	// minimum distance, even if it means going over the GOGC goal
	// by a tiny bit.
	if memstats.next_gc < memstats.heap_live+1024*1024 {
		memstats.next_gc = memstats.heap_live + 1024*1024
	}

	// Compute the background mark utilization goal. In general,
	// this may not come out exactly. We round the number of
	// dedicated workers so that the utilization is closest to
	// 25%. For small GOMAXPROCS, this would introduce too much
	// error, so we add fractional workers in that case.
	totalUtilizationGoal := float64(gomaxprocs) * gcBackgroundUtilization
	c.dedicatedMarkWorkersNeeded = int64(totalUtilizationGoal + 0.5)
	utilError := float64(c.dedicatedMarkWorkersNeeded)/totalUtilizationGoal - 1
	const maxUtilError = 0.3
	if utilError < -maxUtilError || utilError > maxUtilError {
		// Rounding put us more than 30% off our goal. With
		// gcBackgroundUtilization of 25%, this happens for
		// GOMAXPROCS<=3 or GOMAXPROCS=6. Enable fractional
		// workers to compensate.
		if float64(c.dedicatedMarkWorkersNeeded) > totalUtilizationGoal {
			// Too many dedicated workers.
			c.dedicatedMarkWorkersNeeded--
		}
		c.fractionalUtilizationGoal = (totalUtilizationGoal - float64(c.dedicatedMarkWorkersNeeded)) / float64(gomaxprocs)
	} else {
		c.fractionalUtilizationGoal = 0
	}

	// 在 STW 模式下, 我们只想要专用的 worker
	if debug.gcstoptheworld > 0 {
		c.dedicatedMarkWorkersNeeded = int64(gomaxprocs)
		c.fractionalUtilizationGoal = 0
	}

	// Clear per-P state
	for _, p := range allp {
		p.gcAssistTime = 0
		p.gcFractionalMarkTime = 0
	}

	// Compute initial values for controls that are updated
	// throughout the cycle.
	c.revise()

	if debug.gcpacertrace > 0 {
		print("pacer: assist ratio=", c.assistWorkPerByte,
			" (scan ", memstats.heap_scan>>20, " MB in ",
			work.initialHeapLive>>20, "->",
			memstats.next_gc>>20, " MB)",
			" workers=", c.dedicatedMarkWorkersNeeded,
			"+", c.fractionalUtilizationGoal, "\n")
	}
}

// revise 在 GC 周期期间更新 assist ratio 以考虑改进估计。
// 该函数应该在 STW 或者下调用，或每当 memstats.heap_scan，memstats.heap_live 或
// memstats.next_gc （在只有 mheap_.lock 的情况下）更新时调用。
//
// 它只应在 gcBlackenEnabled != 0 时调用（因为这是启用 assist 并且必要的统计信息可用的时候）。
func (c *gcControllerState) revise() {
	gcpercent := gcpercent
	if gcpercent < 0 {
		// If GC is disabled but we're running a forced GC,
		// act like GOGC is huge for the below calculations.
		gcpercent = 100000
	}
	live := atomic.Load64(&memstats.heap_live)

	// Assume we're under the soft goal. Pace GC to complete at
	// next_gc assuming the heap is in steady-state.
	heapGoal := int64(memstats.next_gc)
	// Compute the expected scan work remaining.
	//
	// This is estimated based on the expected
	// steady-state scannable heap. For example, with
	// GOGC=100, only half of the scannable heap is
	// expected to be live, so that's what we target.
	//
	// (This is a float calculation to avoid overflowing on
	// 100*heap_scan.)
	scanWorkExpected := int64(float64(memstats.heap_scan) * 100 / float64(100+gcpercent))
	if live > memstats.next_gc || c.scanWork > scanWorkExpected {
		// We're past the soft goal, or we've already done more scan
		// work than we expected. Pace GC so that in the worst case it
		// will complete by the hard goal.
		const maxOvershoot = 1.1
		heapGoal = int64(float64(memstats.next_gc) * maxOvershoot)

		// Compute the upper bound on the scan work remaining.
		scanWorkExpected = int64(memstats.heap_scan)
	}

	// Compute the remaining scan work estimate.
	//
	// Note that we currently count allocations during GC as both
	// scannable heap (heap_scan) and scan work completed
	// (scanWork), so allocation will change this difference
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

// endCycle 计算了下一个周期的触发比率
func (c *gcControllerState) endCycle() float64 {
	if work.userForced {
		// Forced GC means this cycle didn't start at the
		// trigger, so where it finished isn't good
		// information about how to adjust the trigger.
		// Just leave it where it is.
		return memstats.triggerRatio
	}

	// Proportional response gain for the trigger controller. Must
	// be in [0, 1]. Lower values smooth out transient effects but
	// take longer to respond to phase changes. Higher values
	// react to phase changes quickly, but are more affected by
	// transient changes. Values near 1 may be unstable.
	const triggerGain = 0.5

	// Compute next cycle trigger ratio. First, this computes the
	// "error" for this cycle; that is, how far off the trigger
	// was from what it should have been, accounting for both heap
	// growth and GC CPU utilization. We compute the actual heap
	// growth during this cycle and scale that by how far off from
	// the goal CPU utilization we were (to estimate the heap
	// growth if we had the desired CPU utilization). The
	// difference between this estimate and the GOGC-based goal
	// heap growth is the error.
	goalGrowthRatio := gcEffectiveGrowthRatio()
	actualGrowthRatio := float64(memstats.heap_live)/float64(memstats.heap_marked) - 1
	assistDuration := nanotime() - c.markStartTime

	// Assume background mark hit its utilization goal.
	utilization := gcBackgroundUtilization
	// Add assist utilization; avoid divide by zero.
	if assistDuration > 0 {
		utilization += float64(c.assistTime) / float64(assistDuration*int64(gomaxprocs))
	}

	triggerError := goalGrowthRatio - memstats.triggerRatio - utilization/gcGoalUtilization*(actualGrowthRatio-memstats.triggerRatio)

	// Finally, we adjust the trigger for next time by this error,
	// damped by the proportional gain.
	triggerRatio := memstats.triggerRatio + triggerGain*triggerError

	if debug.gcpacertrace > 0 {
		// Print controller state in terms of the design
		// document.
		H_m_prev := memstats.heap_marked
		h_t := memstats.triggerRatio
		H_T := memstats.gc_trigger
		h_a := actualGrowthRatio
		H_a := memstats.heap_live
		h_g := goalGrowthRatio
		H_g := int64(float64(H_m_prev) * (1 + h_g))
		u_a := utilization
		u_g := gcGoalUtilization
		W_a := c.scanWork
		print("pacer: H_m_prev=", H_m_prev,
			" h_t=", h_t, " H_T=", H_T,
			" h_a=", h_a, " H_a=", H_a,
			" h_g=", h_g, " H_g=", H_g,
			" u_a=", u_a, " u_g=", u_g,
			" W_a=", W_a,
			" goalΔ=", goalGrowthRatio-h_t,
			" actualΔ=", h_a-h_t,
			" u_a/u_g=", u_a/u_g,
			"\n")
	}

	return triggerRatio
}

// enlistWorker encourages another dedicated mark worker to start on
// another P if there are spare worker slots. It is used by putfull
// when more work is made available.
//
//go:nowritebarrier
func (c *gcControllerState) enlistWorker() {
	// If there are idle Ps, wake one so it will run an idle worker.
	// NOTE: This is suspected of causing deadlocks. See golang.org/issue/19112.
	//
	//	if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 {
	//		wakep()
	//		return
	//	}

	// There are no idle Ps. If we need more dedicated workers,
	// try to preempt a running P so it will switch to a worker.
	if c.dedicatedMarkWorkersNeeded <= 0 {
		return
	}
	// Pick a random other P to preempt.
	if gomaxprocs <= 1 {
		return
	}
	gp := getg()
	if gp == nil || gp.m == nil || gp.m.p == 0 {
		return
	}
	myID := gp.m.p.ptr().id
	for tries := 0; tries < 5; tries++ {
		id := int32(fastrandn(uint32(gomaxprocs - 1)))
		if id >= myID {
			id++
		}
		p := allp[id]
		if p.status != _Prunning {
			continue
		}
		if preemptone(p) {
			return
		}
	}
}

// findRunnableGCWorker returns the background mark worker for _p_ if it
// should be run. This must only be called when gcBlackenEnabled != 0.
func (c *gcControllerState) findRunnableGCWorker(_p_ *p) *g {
	if gcBlackenEnabled == 0 {
		throw("gcControllerState.findRunnable: blackening not enabled")
	}
	if _p_.gcBgMarkWorker == 0 {
		// The mark worker associated with this P is blocked
		// performing a mark transition. We can't run it
		// because it may be on some other run or wait queue.
		return nil
	}

	if !gcMarkWorkAvailable(_p_) {
		// No work to be done right now. This can happen at
		// the end of the mark phase when there are still
		// assists tapering off. Don't bother running a worker
		// now because it'll just return immediately.
		return nil
	}

	decIfPositive := func(ptr *int64) bool {
		if *ptr > 0 {
			if atomic.Xaddint64(ptr, -1) >= 0 {
				return true
			}
			// We lost a race
			atomic.Xaddint64(ptr, +1)
		}
		return false
	}

	if decIfPositive(&c.dedicatedMarkWorkersNeeded) {
		// This P is now dedicated to marking until the end of
		// the concurrent mark phase.
		_p_.gcMarkWorkerMode = gcMarkWorkerDedicatedMode
	} else if c.fractionalUtilizationGoal == 0 {
		// No need for fractional workers.
		return nil
	} else {
		// Is this P behind on the fractional utilization
		// goal?
		//
		// This should be kept in sync with pollFractionalWorkerExit.
		delta := nanotime() - gcController.markStartTime
		if delta > 0 && float64(_p_.gcFractionalMarkTime)/float64(delta) > c.fractionalUtilizationGoal {
			// Nope. No need to run a fractional worker.
			return nil
		}
		// Run a fractional worker.
		_p_.gcMarkWorkerMode = gcMarkWorkerFractionalMode
	}

	// Run the background mark worker
	gp := _p_.gcBgMarkWorker.ptr()
	casgstatus(gp, _Gwaiting, _Grunnable)
	if trace.enabled {
		traceGoUnpark(gp, 0)
	}
	return gp
}

// pollFractionalWorkerExit reports whether a fractional mark worker
// should self-preempt. It assumes it is called from the fractional
// worker.
func pollFractionalWorkerExit() bool {
	// This should be kept in sync with the fractional worker
	// scheduler logic in findRunnableGCWorker.
	now := nanotime()
	delta := now - gcController.markStartTime
	if delta <= 0 {
		return true
	}
	p := getg().m.p.ptr()
	selfTime := p.gcFractionalMarkTime + (now - p.gcMarkWorkerStartTime)
	// Add some slack to the utilization goal so that the
	// fractional worker isn't behind again the instant it exits.
	return float64(selfTime)/float64(delta) > 1.2*gcController.fractionalUtilizationGoal
}

// gcSetTriggerRatio sets the trigger ratio and updates everything
// derived from it: the absolute trigger, the heap goal, mark pacing,
// and sweep pacing.
//
// This can be called any time. If GC is the in the middle of a
// concurrent phase, it will adjust the pacing of that phase.
//
// This depends on gcpercent, memstats.heap_marked, and
// memstats.heap_live. These must be up to date.
//
// mheap_.lock must be held or the world must be stopped.
func gcSetTriggerRatio(triggerRatio float64) {
	// Compute the next GC goal, which is when the allocated heap
	// has grown by GOGC/100 over the heap marked by the last
	// cycle.
	goal := ^uint64(0)
	if gcpercent >= 0 {
		goal = memstats.heap_marked + memstats.heap_marked*uint64(gcpercent)/100
	}

	// If we let triggerRatio go too low, then if the application
	// is allocating very rapidly we might end up in a situation
	// where we're allocating black during a nearly always-on GC.
	// The result of this is a growing heap and ultimately an
	// increase in RSS. By capping us at a point >0, we're essentially
	// saying that we're OK using more CPU during the GC to prevent
	// this growth in RSS.
	//
	// The current constant was chosen empirically: given a sufficiently
	// fast/scalable allocator with 48 Ps that could drive the trigger ratio
	// to <0.05, this constant causes applications to retain the same peak
	// RSS compared to not having this allocator.
	const minTriggerRatio = 0.6

	// Set the trigger ratio, capped to reasonable bounds.
	if triggerRatio < minTriggerRatio {
		// This can happen if the mutator is allocating very
		// quickly or the GC is scanning very slowly.
		triggerRatio = minTriggerRatio
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
		if int64(trigger) < 0 {
			print("runtime: next_gc=", memstats.next_gc, " heap_marked=", memstats.heap_marked, " heap_live=", memstats.heap_live, " initialHeapLive=", work.initialHeapLive, "triggerRatio=", triggerRatio, " minTrigger=", minTrigger, "\n")
			throw("gc_trigger underflow")
		}
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
	if trace.enabled {
		traceNextGC()
	}

	// 更新 mark 步调.
	if gcphase != _GCoff {
		gcController.revise()
	}

	// 更新 sweep 步调.
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
		pagesInUse := atomic.Load64(&mheap_.pagesInUse)
		sweepDistancePages := int64(pagesInUse) - int64(pagesSwept)
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

// gcEffectiveGrowthRatio returns the current effective heap growth
// ratio (GOGC/100) based on heap_marked from the previous GC and
// next_gc for the current GC.
//
// This may differ from gcpercent/100 because of various upper and
// lower bounds on gcpercent. For example, if the heap is smaller than
// heapminimum, this can be higher than gcpercent/100.
//
// mheap_.lock must be held or the world must be stopped.
func gcEffectiveGrowthRatio() float64 {
	egogc := float64(memstats.next_gc-memstats.heap_marked) / float64(memstats.heap_marked)
	if egogc < 0 {
		// Shouldn't happen, but just in case.
		egogc = 0
	}
	return egogc
}

// gcGoalUtilization is the goal CPU utilization for
// marking as a fraction of GOMAXPROCS.
const gcGoalUtilization = 0.30

// gcBackgroundUtilization is the fixed CPU utilization for background
// marking. It must be <= gcGoalUtilization. The difference between
// gcGoalUtilization and gcBackgroundUtilization will be made up by
// mark assists. The scheduler will aim to use within 50% of this
// goal.
//
// Setting this to < gcGoalUtilization avoids saturating the trigger
// feedback controller when there are no assists, which allows it to
// better control CPU and heap growth. However, the larger the gap,
// the more mutator assists are expected to happen, which impact
// mutator latency.
const gcBackgroundUtilization = 0.25

// gcCreditSlack is the amount of scan work credit that can
// accumulate locally before updating gcController.scanWork and,
// optionally, gcController.bgScanCredit. Lower values give a more
// accurate assist ratio and make it more likely that assists will
// successfully steal background credit. Higher values reduce memory
// contention.
const gcCreditSlack = 2000

// gcAssistTimeSlack is the nanoseconds of mutator assist time that
// can accumulate on a P before updating gcController.assistTime.
const gcAssistTimeSlack = 5000

// gcOverAssistWork determines how many extra units of scan work a GC
// assist does when an assist happens. This amortizes the cost of an
// assist by pre-paying for this many bytes of future allocations.
const gcOverAssistWork = 64 << 10

var work struct {
	full  lfstack          // lock-free list of full blocks workbuf
	empty lfstack          // lock-free list of empty blocks workbuf
	pad0  cpu.CacheLinePad // prevents false-sharing between full/empty and nproc/nwait

	wbufSpans struct {
		lock mutex
		// free is a list of spans dedicated to workbufs, but
		// that don't currently contain any workbufs.
		free mSpanList
		// busy is a list of all spans containing workbufs on
		// one of the workbuf lists.
		busy mSpanList
	}

	// Restore 64-bit alignment on 32-bit.
	_ uint32

	// bytesMarked is the number of bytes marked this cycle. This
	// includes bytes blackened in scanned objects, noscan objects
	// that go straight to black, and permagrey objects scanned by
	// markroot during the concurrent scan phase. This is updated
	// atomically during the cycle. Updates may be batched
	// arbitrarily, since the value is only read at the end of the
	// cycle.
	//
	// Because of benign races during marking, this number may not
	// be the exact number of marked bytes, but it should be very
	// close.
	//
	// Put this field here because it needs 64-bit atomic access
	// (and thus 8-byte alignment even on 32-bit architectures).
	bytesMarked uint64

	markrootNext uint32 // next markroot job
	markrootJobs uint32 // number of markroot jobs

	nproc  uint32
	tstart int64
	nwait  uint32
	ndone  uint32

	// Number of roots of various root types. Set by gcMarkRootPrepare.
	nFlushCacheRoots                               int
	nDataRoots, nBSSRoots, nSpanRoots, nStackRoots int

	// Each type of GC state transition is protected by a lock.
	// Since multiple threads can simultaneously detect the state
	// transition condition, any thread that detects a transition
	// condition must acquire the appropriate transition lock,
	// re-check the transition condition and return if it no
	// longer holds or perform the transition if it does.
	// Likewise, any transition must invalidate the transition
	// condition before releasing the lock. This ensures that each
	// transition is performed by exactly one thread and threads
	// that need the transition to happen block until it has
	// happened.
	//
	// startSema protects the transition from "off" to mark or
	// mark termination.
	startSema uint32
	// markDoneSema protects transitions from mark to mark termination.
	markDoneSema uint32

	bgMarkReady note   // signal background mark worker has started
	bgMarkDone  uint32 // cas to 1 when at a background mark completion point
	// Background mark completion signaling

	// mode is the concurrency mode of the current GC cycle.
	mode gcMode

	// userForced indicates the current GC cycle was forced by an
	// explicit user call.
	userForced bool

	// totaltime is the CPU nanoseconds spent in GC since the
	// program started if debug.gctrace > 0.
	totaltime int64

	// initialHeapLive is the value of memstats.heap_live at the
	// beginning of this GC cycle.
	initialHeapLive uint64

	// assistQueue is a queue of assists that are blocked because
	// there was neither enough credit to steal or enough work to
	// do.
	assistQueue struct {
		lock mutex
		q    gQueue
	}

	// sweepWaiters is a list of blocked goroutines to wake when
	// we transition from mark termination to sweep.
	sweepWaiters struct {
		lock mutex
		list gList
	}

	// cycles is the number of completed GC cycles, where a GC
	// cycle is sweep termination, mark, mark termination, and
	// sweep. This differs from memstats.numgc, which is
	// incremented at mark termination.
	cycles uint32

	// Timing/utilization stats for this cycle.
	stwprocs, maxprocs                 int32
	tSweepTerm, tMark, tMarkTerm, tEnd int64 // nanotime() of phase start

	pauseNS    int64 // total STW time this cycle
	pauseStart int64 // nanotime() of last STW

	// debug.gctrace heap sizes for this cycle.
	heap0, heap1, heap2, heapGoal uint64
}

// GC runs a garbage collection and blocks the caller until the
// garbage collection is complete. It may also block the entire
// program.
func GC() {
	// 我们考虑一个周期：清扫终止, 标记, 标记终止, 清扫.
	// 这个函数在一个从开始到结束的完整周期完成之前，不应该返回。
	// 因此我们总是希望完成当前周期，然后开始下一个周期，这意味着：
	//
	// 1. 在周期 N 的清扫终止、标记或者标记终止中，总是等待到第 N 个标记终止完成且转换到第 N 个清扫
	//
	// 2. 在清扫 N 时，帮助清扫 N。
	//
	// 这时我们可以开始第 N+1 个周期
	//
	// 3. Trigger cycle N+1 by starting sweep termination N+1.
	//
	// 4. Wait for mark termination N+1 to complete.
	//
	// 5. Help with sweep N+1 until it's done.
	//
	// This all has to be written to deal with the fact that the
	// GC may move ahead on its own. For example, when we block
	// until mark termination N, we may wake up in cycle N+2.

	// Wait until the current sweep termination, mark, and mark
	// termination complete.
	n := atomic.Load(&work.cycles)
	gcWaitOnMark(n)

	// We're now in sweep N or later. Trigger GC cycle N+1, which
	// will first finish sweep N if necessary and then enter sweep
	// termination N+1.
	gcStart(gcTrigger{kind: gcTriggerCycle, n: n + 1})

	// Wait for mark termination N+1 to complete.
	gcWaitOnMark(n + 1)

	// Finish sweep N+1 before returning. We do this both to
	// complete the cycle and because runtime.GC() is often used
	// as part of tests and benchmarks to get the system into a
	// relatively stable and isolated state.
	for atomic.Load(&work.cycles) == n+1 && sweepone() != ^uintptr(0) {
		sweep.nbgsweep++
		Gosched()
	}

	// Callers may assume that the heap profile reflects the
	// just-completed cycle when this returns (historically this
	// happened because this was a STW GC), but right now the
	// profile still reflects mark termination N, not N+1.
	//
	// As soon as all of the sweep frees from cycle N+1 are done,
	// we can go ahead and publish the heap profile.
	//
	// First, wait for sweeping to finish. (We know there are no
	// more spans on the sweep queue, but we may be concurrently
	// sweeping spans, so we have to wait.)
	for atomic.Load(&work.cycles) == n+1 && atomic.Load(&mheap_.sweepers) != 0 {
		Gosched()
	}

	// Now we're really done with sweeping, so we can publish the
	// stable heap profile. Only do this if we haven't already hit
	// another mark termination.
	mp := acquirem()
	cycle := atomic.Load(&work.cycles)
	if cycle == n+1 || (gcphase == _GCmark && cycle == n+2) {
		mProf_PostSweep()
	}
	releasem(mp)
}

// gcWaitOnMark 将阻塞到 GC 完成第 N 个周期的 Mark 阶段。
// 如果 GC 已经完成了该 Mark 阶段，则立刻返回。
func gcWaitOnMark(n uint32) {
	for {
		// 禁止转换到不同的阶段
		lock(&work.sweepWaiters.lock)

		// 读取 GC 的周期数
		nMarks := atomic.Load(&work.cycles)
		if gcphase != _GCmark {
			// 已经完成该周期的 Mark 阶段
			nMarks++
		}
		if nMarks > n {
			// 完成，立刻返回
			unlock(&work.sweepWaiters.lock)
			return
		}

		// 等待到第 N 个周期的清扫终止、标记、标记终止结束
		work.sweepWaiters.list.push(getg())
		goparkunlock(&work.sweepWaiters.lock, waitReasonWaitForGCCycle, traceEvGoBlock, 1)
	}
}

// gcMode indicates how concurrent a GC cycle should be.
type gcMode int

const (
	gcBackgroundMode gcMode = iota // 并发 GC 与清扫
	gcForceMode                    // 立即 stop-the-world GC, 并发 sweep
	gcForceBlockMode               // 立即 stop-the-world GC, 以及 STW sweep (用户强制)
)

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
		return lastgc != 0 && t.now-lastgc > forcegcperiod
	case gcTriggerCycle:
		// 进行测试的周期 t.n 大于实际触发的，需要进行 GC 则通过测试
		return int32(t.n-work.cycles) > 0
	}
	return true
}

// gcStart 开始执行 GC. 它从 _GCoff 过渡到 _GCmark （如果 debug.gcstoptheworld == 0）
// 或执行所有 GC（如果 debug.gcstoptheworld != 0）
//
// This may return without performing this transition in some cases,
// such as when called on a system stack or with locks held.
// 他可在没有完成过渡的情况下返回，例如当在一个系统栈上调用、或者当锁被持有时。
func gcStart(trigger gcTrigger) {
	// 于这是从 malloc 调用的，而 malloc 是在许多可能持有锁的库的内核中调用的，
	// 因此不要尝试在非抢占或可能不稳定的情况下启动 GC。
	mp := acquirem()
	if gp := getg(); gp == mp.g0 || mp.locks > 1 || mp.preemptoff != "" {
		releasem(mp)
		return
	}
	releasem(mp)
	mp = nil

	// 并发拾取剩余的 unswept/not being swept spans。
	// 如果我们在后台模式下被调用，这不应该发生，
	// 因为比例扫描应该刚刚完成扫描一切，但是舍入错误等可能会留下几个未扫描的跨度。
	// 在强制模式下，这是必要的，因为可以在扫描周期的任何点强制 GC。
	// 我们在这里连续检查转换条件，以防 G defer 到下一个 GC 循环。
	//
	// 记录启动的 sweeper 数量
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

	// 在 gcstoptheworld 调试模式下，相应地升级模式。
	// 我们在重新检查转换条件之后执行此操作，以便检测堆触发器的多个 goroutine 不会启动多个 STW GC。
	mode := gcBackgroundMode
	if debug.gcstoptheworld == 1 {
		mode = gcForceMode
	} else if debug.gcstoptheworld == 2 {
		mode = gcForceBlockMode
	}

	// 好的，我们确实要进行 GC，停止所有其他人！
	semacquire(&worldsema)

	if trace.enabled {
		traceGCStart()
	}

	// 检查所有 Ps 是否已完成 defer 的 mcache 刷新。
	for _, p := range allp {
		if fg := atomic.Load(&p.mcache.flushGen); fg != mheap_.sweepgen {
			println("runtime: p", p.id, "flushGen", fg, "!= sweepgen", mheap_.sweepgen)
			throw("p mcache not flushed")
		}
	}

	gcBgMarkStartWorkers()

	systemstack(gcResetMarkState)

	work.stwprocs, work.maxprocs = gomaxprocs, gomaxprocs
	if work.stwprocs > ncpu {
		// 这用于计算 STW 阶段的 CPU 时间，所以它不能超过 ncpu，即使 GOMAXPROCS 是。
		work.stwprocs = ncpu
	}
	work.heap0 = atomic.Load64(&memstats.heap_live)
	work.pauseNS = 0
	work.mode = mode

	now := nanotime()
	work.tSweepTerm = now
	work.pauseStart = now
	if trace.enabled {
		traceGCSTWStart(1)
	}
	systemstack(stopTheWorldWithSema)
	systemstack(func() {
		finishsweep_m()
	})
	// 我们启动 GC 之前的 clearpools。 如果我们等待，直到下一个 GC 循环，他们的内存将不会被回收。
	clearpools()

	work.cycles++

	gcController.startCycle()
	work.heapGoal = memstats.next_gc

	// 在 STW 模式下，禁用用户 Gs 的调度。 这也可能会禁用此 goroutine 的调度，
	// 因此一旦我们再次启动世界，它就可能会阻塞。
	if mode != gcBackgroundMode {
		schedEnableUser(false)
	}

	// Enter concurrent mark phase and enable
	// write barriers.
	//
	// Because the world is stopped, all Ps will
	// observe that write barriers are enabled by
	// the time we start the world and begin
	// scanning.
	//
	// Write barriers must be enabled before assists are
	// enabled because they must be enabled before
	// any non-leaf heap objects are marked. Since
	// allocations are blocked until assists can
	// happen, we want enable assists as early as
	// possible.
	// 输入并发标记阶段并启用写入障碍。
	// 因为世界已经停止，所有Ps都会观察到，当我们开始世界并开始扫描时，写入障碍就会被启用。
	// 必须在启用辅助之前启用写入障碍，因为必须在标记任何非叶堆对象之前启用它们。 由于分配被阻止直到助攻可能发生，我们希望尽早启用助攻。
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

	// 在 STW 模式下，我们可以阻止即时 systemstack 返回，所以这里不要做任何重要的事情。
	// 确保我们阻止而不是返回用户代码。
	if mode != gcBackgroundMode {
		Gosched()
	}

	semrelease(&work.startSema)
}

// gcMarkDoneFlushed counts the number of P's with flushed work.
//
// Ideally this would be a captured local in gcMarkDone, but forEachP
// escapes its callback closure, so it can't capture anything.
//
// This is protected by markDoneSema.
var gcMarkDoneFlushed uint32

// debugCachedWork enables extra checks for debugging premature mark
// termination.
//
// For debugging issue #27993.
const debugCachedWork = false

// gcWorkPauseGen is for debugging the mark completion algorithm.
// gcWork put operations spin while gcWork.pauseGen == gcWorkPauseGen.
// Only used if debugCachedWork is true.
//
// For debugging issue #27993.
var gcWorkPauseGen uint32 = 1

// gcMarkDone transitions the GC from mark to mark termination if all
// reachable objects have been marked (that is, there are no grey
// objects and can be no more in the future). Otherwise, it flushes
// all local work to the global queues where it can be discovered by
// other workers.
//
// This should be called when all local mark work has been drained and
// there are no remaining workers. Specifically, when
//
//   work.nwait == work.nproc && !gcMarkWorkAvailable(p)
//
// The calling context must be preemptible.
//
// Flushing local work is important because idle Ps may have local
// work queued. This is the only way to make that work visible and
// drive GC to completion.
//
// It is explicitly okay to have write barriers in this function. If
// it does transition to mark termination, then all reachable objects
// have been marked, so the write barrier cannot shade any more
// objects.
func gcMarkDone() {
	// Ensure only one thread is running the ragged barrier at a
	// time.
	semacquire(&work.markDoneSema)

top:
	// Re-check transition condition under transition lock.
	//
	// It's critical that this checks the global work queues are
	// empty before performing the ragged barrier. Otherwise,
	// there could be global work that a P could take after the P
	// has passed the ragged barrier.
	if !(gcphase == _GCmark && work.nwait == work.nproc && !gcMarkWorkAvailable(nil)) {
		semrelease(&work.markDoneSema)
		return
	}

	// Flush all local buffers and collect flushedWork flags.
	gcMarkDoneFlushed = 0
	systemstack(func() {
		gp := getg().m.curg
		// Mark the user stack as preemptible so that it may be scanned.
		// Otherwise, our attempt to force all P's to a safepoint could
		// result in a deadlock as we attempt to preempt a worker that's
		// trying to preempt us (e.g. for a stack scan).
		casgstatus(gp, _Grunning, _Gwaiting)
		forEachP(func(_p_ *p) {
			// Flush the write barrier buffer, since this may add
			// work to the gcWork.
			wbBufFlush1(_p_)
			// For debugging, shrink the write barrier
			// buffer so it flushes immediately.
			// wbBuf.reset will keep it at this size as
			// long as throwOnGCWork is set.
			if debugCachedWork {
				b := &_p_.wbBuf
				b.end = uintptr(unsafe.Pointer(&b.buf[wbBufEntryPointers]))
				b.debugGen = gcWorkPauseGen
			}
			// Flush the gcWork, since this may create global work
			// and set the flushedWork flag.
			//
			// TODO(austin): Break up these workbufs to
			// better distribute work.
			_p_.gcw.dispose()
			// Collect the flushedWork flag.
			if _p_.gcw.flushedWork {
				atomic.Xadd(&gcMarkDoneFlushed, 1)
				_p_.gcw.flushedWork = false
			} else if debugCachedWork {
				// For debugging, freeze the gcWork
				// until we know whether we've reached
				// completion or not. If we think
				// we've reached completion, but
				// there's a paused gcWork, then
				// that's a bug.
				_p_.gcw.pauseGen = gcWorkPauseGen
				// Capture the G's stack.
				for i := range _p_.gcw.pauseStack {
					_p_.gcw.pauseStack[i] = 0
				}
				callers(1, _p_.gcw.pauseStack[:])
			}
		})
		casgstatus(gp, _Gwaiting, _Grunning)
	})

	if gcMarkDoneFlushed != 0 {
		if debugCachedWork {
			// Release paused gcWorks.
			atomic.Xadd(&gcWorkPauseGen, 1)
		}
		// More grey objects were discovered since the
		// previous termination check, so there may be more
		// work to do. Keep going. It's possible the
		// transition condition became true again during the
		// ragged barrier, so re-check it.
		goto top
	}

	if debugCachedWork {
		throwOnGCWork = true
		// Release paused gcWorks. If there are any, they
		// should now observe throwOnGCWork and panic.
		atomic.Xadd(&gcWorkPauseGen, 1)
	}

	// There was no global work, no local work, and no Ps
	// communicated work since we took markDoneSema. Therefore
	// there are no grey objects and no more objects can be
	// shaded. Transition to mark termination.
	now := nanotime()
	work.tMarkTerm = now
	work.pauseStart = now
	getg().m.preemptoff = "gcing"
	if trace.enabled {
		traceGCSTWStart(0)
	}
	systemstack(stopTheWorldWithSema)
	// The gcphase is _GCmark, it will transition to _GCmarktermination
	// below. The important thing is that the wb remains active until
	// all marking is complete. This includes writes made by the GC.

	if debugCachedWork {
		// For debugging, double check that no work was added after we
		// went around above and disable write barrier buffering.
		for _, p := range allp {
			gcw := &p.gcw
			if !gcw.empty() {
				printlock()
				print("runtime: P ", p.id, " flushedWork ", gcw.flushedWork)
				if gcw.wbuf1 == nil {
					print(" wbuf1=<nil>")
				} else {
					print(" wbuf1.n=", gcw.wbuf1.nobj)
				}
				if gcw.wbuf2 == nil {
					print(" wbuf2=<nil>")
				} else {
					print(" wbuf2.n=", gcw.wbuf2.nobj)
				}
				print("\n")
				if gcw.pauseGen == gcw.putGen {
					println("runtime: checkPut already failed at this generation")
				}
				throw("throwOnGCWork")
			}
		}
	} else {
		// For unknown reasons (see issue #27993), there is
		// sometimes work left over when we enter mark
		// termination. Detect this and resume concurrent
		// mark. This is obviously unfortunate.
		//
		// Switch to the system stack to call wbBufFlush1,
		// though in this case it doesn't matter because we're
		// non-preemptible anyway.
		restart := false
		systemstack(func() {
			for _, p := range allp {
				wbBufFlush1(p)
				if !p.gcw.empty() {
					restart = true
					break
				}
			}
		})
		if restart {
			getg().m.preemptoff = ""
			systemstack(func() {
				now := startTheWorldWithSema(true)
				work.pauseNS += now - work.pauseStart
			})
			goto top
		}
	}

	// Disable assists and background workers. We must do
	// this before waking blocked assists.
	atomic.Store(&gcBlackenEnabled, 0)

	// Wake all blocked assists. These will run when we
	// start the world again.
	gcWakeAllAssists()

	// Likewise, release the transition lock. Blocked
	// workers and assists will run when we start the
	// world again.
	semrelease(&work.markDoneSema)

	// In STW mode, re-enable user goroutines. These will be
	// queued to run after we start the world.
	schedEnableUser(true)

	// endCycle depends on all gcWork cache stats being flushed.
	// The termination algorithm above ensured that up to
	// allocations since the ragged barrier.
	nextTriggerRatio := gcController.endCycle()

	// Perform mark termination. This will restart the world.
	gcMarkTermination(nextTriggerRatio)
}

func gcMarkTermination(nextTriggerRatio float64) {
	// World is stopped.
	// Start marktermination which includes enabling the write barrier.
	atomic.Store(&gcBlackenEnabled, 0)
	setGCPhase(_GCmarktermination)

	work.heap1 = memstats.heap_live
	startTime := nanotime()

	mp := acquirem()
	mp.preemptoff = "gcing"
	_g_ := getg()
	_g_.m.traceback = 2
	gp := _g_.m.curg
	casgstatus(gp, _Grunning, _Gwaiting)
	gp.waitreason = waitReasonGarbageCollection

	// Run gc on the g0 stack. We do this so that the g stack
	// we're currently running on will no longer change. Cuts
	// the root set down a bit (g0 stacks are not scanned, and
	// we don't need to scan gc's internal state).  We also
	// need to switch to g0 so we can shrink the stack.
	systemstack(func() {
		gcMark(startTime)
		// Must return immediately.
		// The outer function's stack may have moved
		// during gcMark (it shrinks stacks, including the
		// outer function's stack), so we must not refer
		// to any of its variables. Return back to the
		// non-system stack to pick up the new addresses
		// before continuing.
	})

	systemstack(func() {
		work.heap2 = work.bytesMarked
		if debug.gccheckmark > 0 {
			// Run a full non-parallel, stop-the-world
			// mark using checkmark bits, to check that we
			// didn't forget to mark anything during the
			// concurrent mark process.
			gcResetMarkState()
			initCheckmarks()
			gcw := &getg().m.p.ptr().gcw
			gcDrain(gcw, 0)
			wbBufFlush1(getg().m.p.ptr())
			gcw.dispose()
			clearCheckmarks()
		}

		// marking is complete so we can turn the write barrier off
		setGCPhase(_GCoff)
		gcSweep(work.mode)
	})

	_g_.m.traceback = 0
	casgstatus(gp, _Gwaiting, _Grunning)

	if trace.enabled {
		traceGCDone()
	}

	// all done
	mp.preemptoff = ""

	if gcphase != _GCoff {
		throw("gc done but gcphase != _GCoff")
	}

	// Record next_gc and heap_inuse for scavenger.
	memstats.last_next_gc = memstats.next_gc
	memstats.last_heap_inuse = memstats.heap_inuse

	// Update GC trigger and pacing for the next cycle.
	gcSetTriggerRatio(nextTriggerRatio)

	// Pacing changed, so the scavenger should be awoken.
	wakeScavenger()

	// Update timing memstats
	now := nanotime()
	sec, nsec, _ := time_now()
	unixNow := sec*1e9 + int64(nsec)
	work.pauseNS += now - work.pauseStart
	work.tEnd = now
	atomic.Store64(&memstats.last_gc_unix, uint64(unixNow)) // must be Unix time to make sense to user
	atomic.Store64(&memstats.last_gc_nanotime, uint64(now)) // monotonic time for us
	memstats.pause_ns[memstats.numgc%uint32(len(memstats.pause_ns))] = uint64(work.pauseNS)
	memstats.pause_end[memstats.numgc%uint32(len(memstats.pause_end))] = uint64(unixNow)
	memstats.pause_total_ns += uint64(work.pauseNS)

	// Update work.totaltime.
	sweepTermCpu := int64(work.stwprocs) * (work.tMark - work.tSweepTerm)
	// We report idle marking time below, but omit it from the
	// overall utilization here since it's "free".
	markCpu := gcController.assistTime + gcController.dedicatedMarkTime + gcController.fractionalMarkTime
	markTermCpu := int64(work.stwprocs) * (work.tEnd - work.tMarkTerm)
	cycleCpu := sweepTermCpu + markCpu + markTermCpu
	work.totaltime += cycleCpu

	// Compute overall GC CPU utilization.
	totalCpu := sched.totaltime + (now-sched.procresizetime)*int64(gomaxprocs)
	memstats.gc_cpu_fraction = float64(work.totaltime) / float64(totalCpu)

	// Reset sweep state.
	sweep.nbgsweep = 0
	sweep.npausesweep = 0

	if work.userForced {
		memstats.numforcedgc++
	}

	// Bump GC cycle count and wake goroutines waiting on sweep.
	lock(&work.sweepWaiters.lock)
	memstats.numgc++
	injectglist(&work.sweepWaiters.list)
	unlock(&work.sweepWaiters.lock)

	// Finish the current heap profiling cycle and start a new
	// heap profiling cycle. We do this before starting the world
	// so events don't leak into the wrong cycle.
	mProf_NextCycle()

	systemstack(func() { startTheWorldWithSema(true) })

	// Flush the heap profile so we can start a new cycle next GC.
	// This is relatively expensive, so we don't do it with the
	// world stopped.
	mProf_Flush()

	// Prepare workbufs for freeing by the sweeper. We do this
	// asynchronously because it can take non-trivial time.
	prepareFreeWorkbufs()

	// Free stack spans. This must be done between GC cycles.
	systemstack(freeStackSpans)

	// Ensure all mcaches are flushed. Each P will flush its own
	// mcache before allocating, but idle Ps may not. Since this
	// is necessary to sweep all spans, we need to ensure all
	// mcaches are flushed before we start the next GC cycle.
	systemstack(func() {
		forEachP(func(_p_ *p) {
			_p_.mcache.prepareForSweep()
		})
	})

	// Print gctrace before dropping worldsema. As soon as we drop
	// worldsema another cycle could start and smash the stats
	// we're trying to print.
	if debug.gctrace > 0 {
		util := int(memstats.gc_cpu_fraction * 100)

		var sbuf [24]byte
		printlock()
		print("gc ", memstats.numgc,
			" @", string(itoaDiv(sbuf[:], uint64(work.tSweepTerm-runtimeInitTime)/1e6, 3)), "s ",
			util, "%: ")
		prev := work.tSweepTerm
		for i, ns := range []int64{work.tMark, work.tMarkTerm, work.tEnd} {
			if i != 0 {
				print("+")
			}
			print(string(fmtNSAsMS(sbuf[:], uint64(ns-prev))))
			prev = ns
		}
		print(" ms clock, ")
		for i, ns := range []int64{sweepTermCpu, gcController.assistTime, gcController.dedicatedMarkTime + gcController.fractionalMarkTime, gcController.idleMarkTime, markTermCpu} {
			if i == 2 || i == 3 {
				// Separate mark time components with /.
				print("/")
			} else if i != 0 {
				print("+")
			}
			print(string(fmtNSAsMS(sbuf[:], uint64(ns))))
		}
		print(" ms cpu, ",
			work.heap0>>20, "->", work.heap1>>20, "->", work.heap2>>20, " MB, ",
			work.heapGoal>>20, " MB goal, ",
			work.maxprocs, " P")
		if work.userForced {
			print(" (forced)")
		}
		print("\n")
		printunlock()
	}

	semrelease(&worldsema)
	semrelease(&gcsema)
	// Careful: another GC cycle may start now.

	releasem(mp)
	mp = nil

	// now that gc is done, kick off finalizer thread if needed
	if !concurrentSweep {
		// give the queued finalizers, if any, a chance to run
		Gosched()
	}
}

// gcBgMarkStartWorkers 准备后台标记 worker goroutines。
// 这些 goroutine 直到标记阶段才会运行，但它们必须在工作未停止时从常规 G 栈启动。调用方必须持有 worldsema。
func gcBgMarkStartWorkers() {
	// Background marking is performed by per-P G's. Ensure that
	// each P has a background GC G.
	for _, p := range allp {
		if p.gcBgMarkWorker == 0 {
			go gcBgMarkWorker(p)
			notetsleepg(&work.bgMarkReady, -1)
			noteclear(&work.bgMarkReady)
		}
	}
}

// gcBgMarkPrepare sets up state for background marking.
// Mutator assists must not yet be enabled.
func gcBgMarkPrepare() {
	// Background marking will stop when the work queues are empty
	// and there are no more workers (note that, since this is
	// concurrent, this may be a transient state, but mark
	// termination will clean it up). Between background workers
	// and assists, we don't really know how many workers there
	// will be, so we pretend to have an arbitrarily large number
	// of workers, almost all of which are "waiting". While a
	// worker is working it decrements nwait. If nproc == nwait,
	// there are no workers.
	work.nproc = ^uint32(0)
	work.nwait = ^uint32(0)
}

func gcBgMarkWorker(_p_ *p) {
	gp := getg()

	type parkInfo struct {
		m      muintptr // Release this m on park.
		attach puintptr // If non-nil, attach to this p on park.
	}
	// We pass park to a gopark unlock function, so it can't be on
	// the stack (see gopark). Prevent deadlock from recursively
	// starting GC by disabling preemption.
	gp.m.preemptoff = "GC worker init"
	park := new(parkInfo)
	gp.m.preemptoff = ""

	park.m.set(acquirem())
	park.attach.set(_p_)
	// Inform gcBgMarkStartWorkers that this worker is ready.
	// After this point, the background mark worker is scheduled
	// cooperatively by gcController.findRunnable. Hence, it must
	// never be preempted, as this would put it into _Grunnable
	// and put it on a run queue. Instead, when the preempt flag
	// is set, this puts itself into _Gwaiting to be woken up by
	// gcController.findRunnable at the appropriate time.
	notewakeup(&work.bgMarkReady)

	for {
		// Go to sleep until woken by gcController.findRunnable.
		// We can't releasem yet since even the call to gopark
		// may be preempted.
		gopark(func(g *g, parkp unsafe.Pointer) bool {
			park := (*parkInfo)(parkp)

			// The worker G is no longer running, so it's
			// now safe to allow preemption.
			releasem(park.m.ptr())

			// If the worker isn't attached to its P,
			// attach now. During initialization and after
			// a phase change, the worker may have been
			// running on a different P. As soon as we
			// attach, the owner P may schedule the
			// worker, so this must be done after the G is
			// stopped.
			if park.attach != 0 {
				p := park.attach.ptr()
				park.attach.set(nil)
				// cas the worker because we may be
				// racing with a new worker starting
				// on this P.
				if !p.gcBgMarkWorker.cas(0, guintptr(unsafe.Pointer(g))) {
					// The P got a new worker.
					// Exit this worker.
					return false
				}
			}
			return true
		}, unsafe.Pointer(park), waitReasonGCWorkerIdle, traceEvGoBlock, 0)

		// Loop until the P dies and disassociates this
		// worker (the P may later be reused, in which case
		// it will get a new worker) or we failed to associate.
		if _p_.gcBgMarkWorker.ptr() != gp {
			break
		}

		// Disable preemption so we can use the gcw. If the
		// scheduler wants to preempt us, we'll stop draining,
		// dispose the gcw, and then preempt.
		park.m.set(acquirem())

		if gcBlackenEnabled == 0 {
			throw("gcBgMarkWorker: blackening not enabled")
		}

		startTime := nanotime()
		_p_.gcMarkWorkerStartTime = startTime

		decnwait := atomic.Xadd(&work.nwait, -1)
		if decnwait == work.nproc {
			println("runtime: work.nwait=", decnwait, "work.nproc=", work.nproc)
			throw("work.nwait was > work.nproc")
		}

		systemstack(func() {
			// Mark our goroutine preemptible so its stack
			// can be scanned. This lets two mark workers
			// scan each other (otherwise, they would
			// deadlock). We must not modify anything on
			// the G stack. However, stack shrinking is
			// disabled for mark workers, so it is safe to
			// read from the G stack.
			casgstatus(gp, _Grunning, _Gwaiting)
			switch _p_.gcMarkWorkerMode {
			default:
				throw("gcBgMarkWorker: unexpected gcMarkWorkerMode")
			case gcMarkWorkerDedicatedMode:
				gcDrain(&_p_.gcw, gcDrainUntilPreempt|gcDrainFlushBgCredit)
				if gp.preempt {
					// We were preempted. This is
					// a useful signal to kick
					// everything out of the run
					// queue so it can run
					// somewhere else.
					lock(&sched.lock)
					for {
						gp, _ := runqget(_p_)
						if gp == nil {
							break
						}
						globrunqput(gp)
					}
					unlock(&sched.lock)
				}
				// Go back to draining, this time
				// without preemption.
				gcDrain(&_p_.gcw, gcDrainFlushBgCredit)
			case gcMarkWorkerFractionalMode:
				gcDrain(&_p_.gcw, gcDrainFractional|gcDrainUntilPreempt|gcDrainFlushBgCredit)
			case gcMarkWorkerIdleMode:
				gcDrain(&_p_.gcw, gcDrainIdle|gcDrainUntilPreempt|gcDrainFlushBgCredit)
			}
			casgstatus(gp, _Gwaiting, _Grunning)
		})

		// Account for time.
		duration := nanotime() - startTime
		switch _p_.gcMarkWorkerMode {
		case gcMarkWorkerDedicatedMode:
			atomic.Xaddint64(&gcController.dedicatedMarkTime, duration)
			atomic.Xaddint64(&gcController.dedicatedMarkWorkersNeeded, 1)
		case gcMarkWorkerFractionalMode:
			atomic.Xaddint64(&gcController.fractionalMarkTime, duration)
			atomic.Xaddint64(&_p_.gcFractionalMarkTime, duration)
		case gcMarkWorkerIdleMode:
			atomic.Xaddint64(&gcController.idleMarkTime, duration)
		}

		// Was this the last worker and did we run out
		// of work?
		incnwait := atomic.Xadd(&work.nwait, +1)
		if incnwait > work.nproc {
			println("runtime: p.gcMarkWorkerMode=", _p_.gcMarkWorkerMode,
				"work.nwait=", incnwait, "work.nproc=", work.nproc)
			throw("work.nwait > work.nproc")
		}

		// If this worker reached a background mark completion
		// point, signal the main GC goroutine.
		if incnwait == work.nproc && !gcMarkWorkAvailable(nil) {
			// Make this G preemptible and disassociate it
			// as the worker for this P so
			// findRunnableGCWorker doesn't try to
			// schedule it.
			_p_.gcBgMarkWorker.set(nil)
			releasem(park.m.ptr())

			gcMarkDone()

			// Disable preemption and prepare to reattach
			// to the P.
			//
			// We may be running on a different P at this
			// point, so we can't reattach until this G is
			// parked.
			park.m.set(acquirem())
			park.attach.set(_p_)
		}
	}
}

// gcMarkWorkAvailable reports whether executing a mark worker
// on p is potentially useful. p may be nil, in which case it only
// checks the global sources of work.
func gcMarkWorkAvailable(p *p) bool {
	if p != nil && !p.gcw.empty() {
		return true
	}
	if !work.full.empty() {
		return true // global work available
	}
	if work.markrootNext < work.markrootJobs {
		return true // root scan work available
	}
	return false
}

// gcMark runs the mark (or, for concurrent GC, mark termination)
// All gcWork caches must be empty.
// STW is in effect at this point.
func gcMark(start_time int64) {
	if debug.allocfreetrace > 0 {
		tracegc()
	}

	if gcphase != _GCmarktermination {
		throw("in gcMark expecting to see gcphase as _GCmarktermination")
	}
	work.tstart = start_time

	// Check that there's no marking work remaining.
	if work.full != 0 || work.markrootNext < work.markrootJobs {
		print("runtime: full=", hex(work.full), " next=", work.markrootNext, " jobs=", work.markrootJobs, " nDataRoots=", work.nDataRoots, " nBSSRoots=", work.nBSSRoots, " nSpanRoots=", work.nSpanRoots, " nStackRoots=", work.nStackRoots, "\n")
		panic("non-empty mark queue after concurrent mark")
	}

	if debug.gccheckmark > 0 {
		// This is expensive when there's a large number of
		// Gs, so only do it if checkmark is also enabled.
		gcMarkRootCheck()
	}
	if work.full != 0 {
		throw("work.full != 0")
	}

	// Clear out buffers and double-check that all gcWork caches
	// are empty. This should be ensured by gcMarkDone before we
	// enter mark termination.
	//
	// TODO: We could clear out buffers just before mark if this
	// has a non-negligible impact on STW time.
	for _, p := range allp {
		// The write barrier may have buffered pointers since
		// the gcMarkDone barrier. However, since the barrier
		// ensured all reachable objects were marked, all of
		// these must be pointers to black objects. Hence we
		// can just discard the write barrier buffer.
		if debug.gccheckmark > 0 || throwOnGCWork {
			// For debugging, flush the buffer and make
			// sure it really was all marked.
			wbBufFlush1(p)
		} else {
			p.wbBuf.reset()
		}

		gcw := &p.gcw
		if !gcw.empty() {
			printlock()
			print("runtime: P ", p.id, " flushedWork ", gcw.flushedWork)
			if gcw.wbuf1 == nil {
				print(" wbuf1=<nil>")
			} else {
				print(" wbuf1.n=", gcw.wbuf1.nobj)
			}
			if gcw.wbuf2 == nil {
				print(" wbuf2=<nil>")
			} else {
				print(" wbuf2.n=", gcw.wbuf2.nobj)
			}
			print("\n")
			throw("P has cached GC work at end of mark termination")
		}
		// There may still be cached empty buffers, which we
		// need to flush since we're going to free them. Also,
		// there may be non-zero stats because we allocated
		// black after the gcMarkDone barrier.
		gcw.dispose()
	}

	throwOnGCWork = false

	cachestats()

	// Update the marked heap stat.
	memstats.heap_marked = work.bytesMarked

	// 更新其他 GC 堆大小统计信息。此操作必须发生在 cachestats
	// (因为它会刷新这些值得局部统计) 和 flushallmcaches （会修改 heap_live） 之后
	memstats.heap_live = work.bytesMarked
	memstats.heap_scan = uint64(gcController.scanWork)

	if trace.enabled {
		traceHeapAlloc()
	}
}

// gcSweep 必须在系统栈上调用，因为它要求持有 heap.lock, 参见 mheap
//go:systemstack
func gcSweep(mode gcMode) {
	if gcphase != _GCoff {
		throw("gcSweep being done but phase is not GCoff")
	}

	lock(&mheap_.lock)
	mheap_.sweepgen += 2
	mheap_.sweepdone = 0
	if mheap_.sweepSpans[mheap_.sweepgen/2%2].index != 0 {
		// We should have drained this list during the last
		// sweep phase. We certainly need to start this phase
		// with an empty swept list.
		throw("non-empty swept list")
	}
	mheap_.pagesSwept = 0
	mheap_.sweepArenas = mheap_.allArenas
	mheap_.reclaimIndex = 0
	mheap_.reclaimCredit = 0
	unlock(&mheap_.lock)

	if !_ConcurrentSweep || mode == gcForceBlockMode {
		// Special case synchronous sweep.
		// Record that no proportional sweeping has to happen.
		lock(&mheap_.lock)
		mheap_.sweepPagesPerByte = 0
		unlock(&mheap_.lock)
		// Sweep all spans eagerly.
		for sweepone() != ^uintptr(0) {
			sweep.npausesweep++
		}
		// Free workbufs eagerly.
		prepareFreeWorkbufs()
		for freeSomeWbufs(false) {
		}
		// All "free" events for this mark/sweep cycle have
		// now happened, so we can make this profile cycle
		// available immediately.
		mProf_NextCycle()
		mProf_Flush()
		return
	}

	// Background sweep.
	lock(&sweep.lock)
	if sweep.parked {
		sweep.parked = false
		ready(sweep.g, 0, true)
	}
	unlock(&sweep.lock)
}

// gcResetMarkState resets global state prior to marking (concurrent
// or STW) and resets the stack scan state of all Gs.
//
// This is safe to do without the world stopped because any Gs created
// during or after this will start out in the reset state.
//
// gcResetMarkState must be called on the system stack because it acquires
// the heap lock. See mheap for details.
// gcResetMarkState 在标记（并发或 STW）之前重置全局状态，并重置所有 G 的堆栈扫描状态。
// 如果没有世界停止，这是安全的，因为在此期间或之后创建的任何 Gs 将在重置状态下开始。
// 必须在系统堆栈上调用 gcResetMarkState，因为它获取堆锁。 有关详细信息，请参阅 mheap。
//
//go:systemstack
func gcResetMarkState() {
	// This may be called during a concurrent phase, so make sure
	// allgs doesn't change.
	lock(&allglock)
	for _, gp := range allgs {
		gp.gcscandone = false // set to true in gcphasework
		gp.gcAssistBytes = 0
	}
	unlock(&allglock)

	// Clear page marks. This is just 1MB per 64GB of heap, so the
	// time here is pretty trivial.
	lock(&mheap_.lock)
	arenas := mheap_.allArenas
	unlock(&mheap_.lock)
	for _, ai := range arenas {
		ha := mheap_.arenas[ai.l1()][ai.l2()]
		for i := range ha.pageMarks {
			ha.pageMarks[i] = 0
		}
	}

	work.bytesMarked = 0
	work.initialHeapLive = atomic.Load64(&memstats.heap_live)
}

// Hooks for other packages

var poolcleanup func()

//go:linkname sync_runtime_registerPoolCleanup sync.runtime_registerPoolCleanup
func sync_runtime_registerPoolCleanup(f func()) {
	poolcleanup = f
}

func clearpools() {
	// clear sync.Pools
	if poolcleanup != nil {
		poolcleanup()
	}

	// Clear central sudog cache.
	// Leave per-P caches alone, they have strictly bounded size.
	// Disconnect cached list before dropping it on the floor,
	// so that a dangling ref to one entry does not pin all of them.
	lock(&sched.sudoglock)
	var sg, sgnext *sudog
	for sg = sched.sudogcache; sg != nil; sg = sgnext {
		sgnext = sg.next
		sg.next = nil
	}
	sched.sudogcache = nil
	unlock(&sched.sudoglock)

	// Clear central defer pools.
	// Leave per-P pools alone, they have strictly bounded size.
	lock(&sched.deferlock)
	for i := range sched.deferpool {
		// disconnect cached list before dropping it on the floor,
		// so that a dangling ref to one entry does not pin all of them.
		var d, dlink *_defer
		for d = sched.deferpool[i]; d != nil; d = dlink {
			dlink = d.link
			d.link = nil
		}
		sched.deferpool[i] = nil
	}
	unlock(&sched.deferlock)
}

// Timing

// itoaDiv formats val/(10**dec) into buf.
func itoaDiv(buf []byte, val uint64, dec int) []byte {
	i := len(buf) - 1
	idec := i - dec
	for val >= 10 || i >= idec {
		buf[i] = byte(val%10 + '0')
		i--
		if i == idec {
			buf[i] = '.'
			i--
		}
		val /= 10
	}
	buf[i] = byte(val + '0')
	return buf[i:]
}

// fmtNSAsMS nicely formats ns nanoseconds as milliseconds.
func fmtNSAsMS(buf []byte, ns uint64) []byte {
	if ns >= 10e6 {
		// Format as whole milliseconds.
		return itoaDiv(buf, ns/1e6, 0)
	}
	// Format two digits of precision, with at most three decimal places.
	x := ns / 1e3
	if x == 0 {
		buf[0] = '0'
		return buf[:1]
	}
	dec := 3
	for x >= 100 {
		x /= 10
		dec--
	}
	return itoaDiv(buf, x, dec)
}
