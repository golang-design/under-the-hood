# 垃圾回收器: 并发标记清扫

[TOC]

## 并发标记

并发标记的思想可以简要描述如下：

```go
func markSome() bool {
    if worklist.empty() {       // 初始化回收过程
        scan(Roots)             // 赋值器不持有任何白色对象的引用
        if worklist.empty() {   // 此时灰色对象已经全部处理完毕
            sweep()             // 标记结束，立即清扫
            return false
        }
    }
    // 回收过程尚未完成，后续过程仍需标记
    ref = worklist.remove()
    scan(ref)
    return true
}

func scan(ref interface{}) {
    for fld := range Pointers(ref) {
        child := *fld
        if child != nil {
            shade(child)
        }
    }
}

func shade(ref interface{}) {
    if !isMarked(ref) {
        setMarked(ref)
        worklist.add(ref)
    }
}
```

在这个过程中，回收器会首先扫描 worklist，而后对根集合进行扫描并重新建立 worklist。
在根集合扫描过程中赋值器现场被挂起时，扫描完成后则不会再存在白色对象。

## 并发清扫

并发清扫的思想可以简要描述如下：

```go
func New() (interface{}, error) {
    collectEnough()
    ref := allocate()
    if ref == nil {
        return nil, errors.New("Out of memory")
    }
    return ref, nil
}

func collectEnough() {
    stopTheWorld()
    defer startTheWorld()
    
    for behind() { // behind() 控制回收工作每次的执行量
        if !markSome() {
            return
        }
    }
}
```


## 并行三色标记

Go 的 GC 与 mutator 线程同时运行，并允许多个 GC 线程并行运行。
它通过写屏障来并发的标记和扫描，是非分代式、非紧凑式 GC。
使用 per-P 分配区隔离的大小来完成分配，从而最小化碎片的产生，也用于消除大部分情况下的锁。


TODO: 混合屏障栈重扫

TODO: go1.12 mark2 stw

### GC 的早期任务

到目前为止，我们已经累积了足够多的的理论知识，可以开始无障碍的阅读运行时 GC 的具体实现了。
在分析调度器源码时我们就已看到，在用户代码开始执行之前，GC 就已经开始在做准备工作了。我们来看看他们都是些什么工作。
在 `runtime.main` 开始执行时，我们知道它依次启动了以下几个关键组件：

```go
// 主 goroutine
func main() {
	(...)

	// 系统后台监控
	// 在一个新的 m 的 g0 上执行系统监控
	systemstack(func() {
		newm(sysmon, nil)
	})
	(...)

	// 执行 runtime.init
	doInit(&runtime_inittask)
	(...)

	// 启动垃圾回收器后台
	gcenable()
	(...)

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
//go:nowritebarrierrec
func sysmon() {
	(...)
	for {
		(...)
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
		(...)
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
如果我们假设这个这个条件取得 `true` 且 `gcTrigger` 的测试也同意触发（我们还没有介绍这个测试具体是什么），这时 `injectlist` 会将 `forcegc.g` 强制加入调度器调度队列中，等待执行 GC 调度。那么，这个 `forcegc.g` 究竟会执行什么呢？

第二个启动的关键组件 `runtime.init` 解释了这个问题。在这个初始化函数中，我们可以看到强制 GC 的 `forcegc` 开始被初始化：

```go
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

第三个关键部分是 `runtime.gcenable`：

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
```

TODO:


## 进一步阅读的参考文献

1. [Getting to Go: The Journey of Go's Garbage Collector](https://blog.golang.org/ismmkeynote)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
