---
weight: 2303
title: "8.3 初始化"
---

# 8.3 初始化

到目前为止，我们已经累积了足够多的的理论知识，可以开始无障碍的阅读运行时 GC 的具体实现了。

## 引导阶段的 GC 初始化

```go
// src/runtime/proc.go
func schedinit() {
	(...)

	// 垃圾回收器初始化
	gcinit()
	(...)
}
// runtime/mgc.go
func gcinit() {
	(...)

	// 第一个周期没有清扫
	mheap_.sweepdone = 1

	// 设置合理的初始 GC 触发比率
	memstats.triggerRatio = 7 / 8.0

	// 伪造一个 heap_marked 值，
	// 使它看起来像一个触发器 heapminimum 是 heap_marked的 适当增长。
	// 这将用于计算初始 GC 目标。
	memstats.heap_marked = uint64(float64(heapminimum) / (1 + memstats.triggerRatio))

	// 从环境中设置 gcpercent。这也将计算并设置 GC 触发器和目标。
	_ = setGCPercent(readgogc()) // 读取 GOGC 全局变量 off/number[0~100]

	work.startSema = 1
	work.markDoneSema = 1
}
```

## GC 的后台工作

在分析调度器源码时我们就已看到，在用户代码开始执行之前，除了 `runtime.schedinit` 外，GC 还在 `runtime.main` 中做了部分准备工作了。
我们来看看他们都是些什么工作。在 `runtime.main` 开始执行时，我们知道它依次启动了以下几个关键组件：

```go
// src/runtime/proc.go
func main() {
	...

	// 系统后台监控
	// 在一个新的 m 的 g0 上执行系统监控
	systemstack(func() {
		newm(sysmon, nil)
	})
	// 执行 runtime.init
	doInit(&runtime_inittask)
	// 启动垃圾回收器后台
	gcenable()
	// 用户代码 main.init 和 main.main 入口
	doInit(&main_inittask)
	fn := main_main
	fn()
	(...)
}
```

可以看到，在用户代码执行前的三个关键部件分别是：运行时 init 函数、系统监控和垃圾回收后台。

先看第一个关键组件，系统监控：

```go
// src/runtime/proc.go
//go:nowritebarrierrec
func sysmon() {
	...
	for {
		...
		// delay 根据一定策略调整
		usleep(delay)

		// 1. 如果在 STW，则暂时休眠
		if debug.schedtrace <= 0 && (sched.gcwaiting != 0 || atomic.Load(&sched.npidle) == uint32(gomaxprocs)) {
			(...)
		}
		(...)

		// 2. 检查是否需要强制触发 GC
		if t := (gcTrigger{kind: gcTriggerTime, now: now}); t.test() && atomic.Load(&forcegc.idle) != 0 {
			lock(&forcegc.lock)
			forcegc.idle = 0
			var list gList
			list.push(forcegc.g)
			injectglist(&list)
			unlock(&forcegc.lock)
		}
		...
	}
}
```

这个循环中，不难看到 `sched.gcwaiting` 的初始值为 0，表示不需要进行垃圾回收，如果值为 1 则表明正在等待垃圾回收的完成，需要进入休眠状态。
因此在用户态代码开始时，会直接进入下一个条件。第二个条件需要检查 forcegc 这个全局变量：

```go
type forcegcstate struct {
	lock mutex
	g    *g
	idle uint32
}
var forcegc    forcegcstate
```

可以看到，forcegc 这个全局变量的初始值为 0，这时条件 `atomic.Load(&forcegc.idle) != 0` 为 `false`。
如果我们假设这个这个条件取得 `true` 且 `gcTrigger` 的测试也同意触发（我们在下一节中讨论它的具体细节），
这时 `injectlist` 会将 `forcegc.g` 强制加入调度器调度队列中，等待执行 GC 调度。那么，这个 `forcegc.g` 究竟会执行什么呢？

第二个启动的关键组件 `runtime.init` 解释了这个问题。在这个初始化函数中，我们可以看到强制 GC 的 `forcegc` 开始被初始化：

```go
// src/runtime/proc.go
func init() {
	go forcegchelper()
}
func forcegchelper() {
	forcegc.g = getg() // 指定 forcegc 的 goroutine
	for {
		lock(&forcegc.lock)
        (...)
        // 将 forcegc 设置为空闲状态，并进入休眠
		atomic.Store(&forcegc.idle, 1)
		goparkunlock(&forcegc.lock, waitReasonForceGGIdle, traceEvGoBlock, 1)
		(...)
		// 当 forcegc.g 被唤醒时，开始从此处进行调度完全并发
		gcStart(gcTrigger{kind: gcTriggerTime, now: nanotime()})
	}
}
```

由此我们可以看到，到目前为止，都只是在全局变量中设置 `forcegc.g` 这个 goroutine 的运行现场，并在触发 GC 前进行 `gopark`。
当下一次 GC 需要被触发时，调度器会重新调度休眠后的 `forcegc.g` 会从 `forcegchelper` 的 `gcStart` 开始执行。
如此反复。

第三个关键部分是 `runtime.gcenable` 将启动两个关键的清扫 goroutine，当然他们都有自己的初始化工作，
因此首先创建了一个大小为 2 的 channel 来确保首次初始化工作在用户态代码运行之前完成：

```go
func gcenable() {
	// 启动 bgsweep 和 bgscavenge
	c := make(chan int, 2)
	go bgsweep(c)
	go bgscavenge(c)
	<-c
	<-c
	memstats.enablegc = true // 现在运行时已经初始化完毕了，GC 已就绪
}
var sweep sweepdata
type sweepdata struct {
	lock    mutex
	g       *g
	parked  bool
	started bool

	nbgsweep    uint32
	npausesweep uint32
}
func bgsweep(c chan int) {
	sweep.g = getg()
	lock(&sweep.lock)
	sweep.parked = true
	c <- 1
	goparkunlock(&sweep.lock, waitReasonGCSweepWait, traceEvGoBlock, 1)
	(...)
}
var scavenge struct {
	lock   mutex
	g      *g
	parked bool
	timer  *timer
	gen    uint32 // read with either lock or mheap_.lock, write with both
}
func bgscavenge(c chan int) {
	scavenge.g = getg()
	lock(&scavenge.lock)
	scavenge.parked = true
	scavenge.timer = new(timer)
	scavenge.timer.f = func(_ interface{}, _ uintptr) {
		lock(&scavenge.lock)
		wakeScavengerLocked()
		unlock(&scavenge.lock)
	}
	c <- 1
	goparkunlock(&scavenge.lock, waitReasonGCScavengeWait, traceEvGoBlock, 1)
	(...)
}
func wakeScavengerLocked() {
	if scavenge.parked {
		// scavenger 处于 parked 状态，停止 timer 并 ready scavenger g
		stopTimer(scavenge.timer)
		scavenge.parked = false
		ready(scavenge.g, 0, true) // ready goroutine, waiting -> runnable
	}
}
```

这些初始化工作没有什么特别引人注目的东西，无非是将各自的 goroutine 记录到全局变量，通过 `park` 变量标记他们的执行状态，
以及设定 scavenger 能够被周期性唤醒的 timer。此外，从 `scavenger.lock` 可以看出，
该锁确保了 scavenger 不会被并发的被 timer 唤醒而执行。

## 小结

从两个初始化过程中我们可以明确知道，GC 的具体实现中，
在执行用户态代码时有以下几个辅助任务：

1. 初始化 GC 步调，即确定合适开始触发下一个 GC 周期;
2. 启动系统监控，用于监控必须强制执行的 GC；
3. 启动后台清扫器，与用户态代码并发被调度器调度，归还从内存分配器中申请的内存；
4. 启动后台清理器，与用户态代码并发被调度，归还从操作系统中申请的内存。

`gcStart` 是 GC 正式开始的地方，它有以下几种触发方式：

1. 强制被系统监控触发
2. 在 `mallocgc` 分配内存时触发
3. 通过 `runtime.GC()` 调用触发

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).