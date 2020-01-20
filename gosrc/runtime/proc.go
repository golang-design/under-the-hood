// Copyright 2014 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

import (
	"internal/cpu"
	"runtime/internal/atomic"
	"runtime/internal/sys"
	"unsafe"
)

var buildVersion = sys.TheVersion

// set using cmd/go/internal/modload.ModInfoProg
var modinfo string

// Goroutine 调度器
// 调度器的任务是给不同的工作线程 (worker thread) 分发 ready-to-run goroutine。
//
// 主要概念:
// G - goroutine.
// M - worker thread, 或 machine.
// P - processor，一种执行 Go 代码被要求资源。M 必须关联一个 P 才能执行 Go 代码，
//      但它可以被阻塞或在一个系统调用中没有关联的 P。
//
// 设计文档：https://golang.org/s/go11sched

// 工作线程的 park/unpark
//
// 我们需要在保持足够的运行 worker thread 来利用有效硬件并发资源，和 park 运行
// 过多的 worker thread 来节约 CPU 能耗之间进行权衡。这个权衡并不简单，有以下两点原因：
// 1. 调度器状态是有意分布的（具体而言，是一个 per-P 的 work 队列），因此在快速路径
// （fast path）计算出全局谓词 (global predicates) 是不可能的。
// 2. 为了获得最佳的线程管理，我们必须知道未来的情况（当一个新的 goroutine 会
// 在不久的将来 ready，不再 park 一个 worker thread）
//
// 这三种被驳回的方法很糟糕:
// 1. 集中式管理所有调度器状态（会将限制可扩展性）
// 2. 直接切换 goroutine。也就是说，当我们 ready 一个新的 goroutine 时，让出一个 P，
//    unpark 一个线程并切换到这个线程运行 goroutine。因为 ready 的 goroutine 线程可能
//    在下一个瞬间 out of work，从而导致线程 thrashing（当计算机虚拟内存饱和时会发生
//    thrashing，最终导致分页调度状态不再变化。这个状态会一直持续，知道用户关闭一些运行的
//    应用或者活跃进程释放一些虚拟内存资源），因此我们需要 park 这个线程。同样，我们
//    希望在相同的线程内保存维护 goroutine，这种方式还会摧毁计算的局部性原理。
// 3. 任何时候 ready 一个 goroutine 时也存在一个空闲的 P 时，都 unpark 一个额外的线程，
//    但不进行切换。因为额外线程会在没有检查任何 work 的情况下立即 park ，最终导致大量线程的
//    parking/unparking。

// 目前方法:
//
// 如果存在一个空闲的 P 并且没有 spinning 状态的工作线程，当 ready 一个 goroutine 时，
// 就 unpark 一个额外的线程。如果一个工作线程的本地队列里没有 work ，且在全局运行队列或 netpoller
// 中也没有 work，则称一个工作线程被称之为 spinning；spinning 状态由 sched.nmspinning 和
// m.spinning 表示。
// 这种方式下被 unpark 的线程同样也成为 spinning，我们也不对这种线程进行 goroutine 切换，
// 因此这类线程最初就是 out of work。spinning 线程会在 park 前，从 per-P 中运行队列中寻找 work。
// 如果一个 spinning 进程发现 work，就会将自身切换出 spinning 状态，并且开始执行。
// 如果它没有发现 work 则会将自己带 spinning 转状态然后进行 park。
//
// 如果至少有一个 spinning 进程（sched.nmspinning>1），则 ready 一个 goroutine 时，
// 不会去 unpark 一个新的线程。作为补偿，如果最后一个 spinning 线程发现 work 并且停止 spinning，
// 则必须 unpark 一个新的 spinning 线程。这个方法消除了不合理的线程 unpark 峰值，
// 且同时保证最终的最大 CPU 并行度利用率。
//
// 主要的实现复杂性表现为当进行 spinning->non-spinning 线程转换时必须非常小心。这种转换在提交一个
// 新的 goroutine ，并且任何一个部分都需要取消另一个工作线程会发生竞争。如果双方均失败，则会以半静态
// CPU 利用不足而结束。ready 一个 goroutine 的通用范式为：提交一个 goroutine 到 per-P 的局部 work 队列，
// #StoreLoad-style 内存屏障，检查 sched.nmspinning。从 spinning->non-spinning 转换的一般模式为：
// 减少 nmspinning, #StoreLoad-style 内存屏障，在所有 per-P 工作队列检查新的 work。注意，此种复杂性
// 并不适用于全局工作队列，因为我们不会蠢到当给一个全局队列提交 work 时进行线程 unpark。更多细节参见
// nmspinning 操作。

var (
	m0           m
	g0           g
	raceprocctx0 uintptr
)

//go:linkname runtime_inittask runtime..inittask
var runtime_inittask initTask

//go:linkname main_inittask main..inittask
var main_inittask initTask

// main_init_done is a signal used by cgocallbackg that initialization
// has been completed. It is made before _cgo_notify_runtime_init_done,
// so all cgo calls can rely on it existing. When main_init is complete,
// it is closed, meaning cgocallbackg can reliably receive from it.
var main_init_done chan bool

//go:linkname main_main main.main
func main_main()

// mainStarted 表示主 M 是否已经开始运行
var mainStarted bool

// runtimeInitTime 是运行时启动的 nanotime()
var runtimeInitTime int64

// 用于新创建的 M 的信号掩码 signal mask 的值。
var initSigmask sigset

// 主 goroutine
func main() {
	g := getg()

	// race 检测有关，不关心
	g.m.g0.racectx = 0

	// 执行栈最大限制：1GB（64位系统）或者 250MB（32位系统）
	// 这里使用十进制而非二进制的 GB 和 MB 因为在栈溢出失败消息中好看一些
	if sys.PtrSize == 8 {
		maxstacksize = 1000000000
	} else {
		maxstacksize = 250000000
	}

	// 允许 newproc 启动新的 m
	mainStarted = true

	if GOARCH != "wasm" { // 1.11 新引入的 web assembly, 目前 wasm 不支持线程，无系统监控

		// 启动系统后台监控（定期垃圾回收、并发任务调度）
		systemstack(func() {
			newm(sysmon, nil)
		})

	}

	// 将主 goroutine 锁在主 OS 线程下进行初始化工作
	// 大部分程序并不关心这一点，但是有一些图形库（基本上属于 cgo 调用）
	// 会要求在主线程下进行初始化工作。
	// 即便是在 main.main 下仍然可以通过公共方法 runtime.LockOSThread
	// 来强制将一些特殊的需要主 OS 线程的调用锁在主 OS 线程下执行初始化
	lockOSThread()

	if g.m != &m0 {
		throw("runtime.main not on m0")
	}

	// 执行 runtime.init
	doInit(&runtime_inittask) // defer 必须在此调用结束后才能使用

	if nanotime() == 0 {
		throw("nanotime returning zero")
	}

	// defer unlock，从而在 init 期间 runtime.Goexit 来 unlock
	needUnlock := true
	defer func() {
		if needUnlock {
			unlockOSThread()
		}
	}()

	// 记录程序的启动时间
	runtimeInitTime = nanotime()

	// 启动垃圾回收器后台操作
	gcenable()

	main_init_done = make(chan bool)
	if iscgo {
		if _cgo_thread_start == nil {
			throw("_cgo_thread_start missing")
		}
		if GOOS != "windows" {
			if _cgo_setenv == nil {
				throw("_cgo_setenv missing")
			}
			if _cgo_unsetenv == nil {
				throw("_cgo_unsetenv missing")
			}
		}
		if _cgo_notify_runtime_init_done == nil {
			throw("_cgo_notify_runtime_init_done missing")
		}
		// 启动模板线程来处理从 C 创建的线程进入 Go 时需要创建一个新的线程的情况。
		startTemplateThread()
		cgocall(_cgo_notify_runtime_init_done, nil)
	}

	doInit(&main_inittask)
	close(main_init_done) // main.init 执行完毕

	needUnlock = false
	unlockOSThread()

	// 如果是基础库则不需要执行 main 函数了
	if isarchive || islibrary {
		// 由 -buildmode=c-archive 或 c-shared 但不会执行的程序
		return
	}

	// 执行用户 main 包中的 main 函数
	// 处理为非间接调用，因为链接器在设定运行时不知道 main 包的地址
	fn := main_main
	fn()

	// race 相关
	if raceenabled {
		racefini()
	}

	// 使客户端程序可行：如果在其他 goroutine 上 panic 、与此同时
	// main 返回，也让其他 goroutine 能够完成 panic trace 的打印。
	// 打印完成后，立即退出。见 issue 3934 和 20018
	if atomic.Load(&runningPanicDefers) != 0 {
		// 运行包含 defer 的函数不会花太长时间
		for c := 0; c < 1000; c++ {
			if atomic.Load(&runningPanicDefers) == 0 {
				break
			}
			Gosched()
		}
	}
	if atomic.Load(&panicking) != 0 {
		gopark(nil, nil, waitReasonPanicWait, traceEvGoStop, 1)
	}

	// 退出执行，返回退出状态码
	exit(0)

	// 如果 exit 没有被正确实现，则下面的代码能够强制退出程序，因为 *nil (nil deref) 会崩溃。
	// http://golang.org/ref/spec#Terminating_statements
	// https://github.com/golang/go/commit/c81a0ed3c50606d1ada0fd9b571611b3687c90e1
	for {
		var x *int32
		*x = 0
	}
}

// os_beforeExit is called from os.Exit(0).
//go:linkname os_beforeExit os.runtime_beforeExit
func os_beforeExit() {
	if raceenabled {
		racefini()
	}
}

// 启动 forcegc helper goroutine
func init() {
	go forcegchelper()
}

func forcegchelper() {
	forcegc.g = getg()
	for {
		lock(&forcegc.lock)
		if forcegc.idle != 0 {
			throw("forcegc: phase error")
		}
		atomic.Store(&forcegc.idle, 1)
		goparkunlock(&forcegc.lock, waitReasonForceGGIdle, traceEvGoBlock, 1)
		// this goroutine is explicitly resumed by sysmon
		if debug.gctrace > 0 {
			println("GC forced")
		}
		// Time-triggered, fully concurrent.
		gcStart(gcTrigger{kind: gcTriggerTime, now: nanotime()})
	}
}

//go:nosplit

// Gosched 会让出当前的 P，并允许其他 goroutine 运行。它不会推迟当前的 goroutine，因此执行会被自动恢复
func Gosched() {
	checkTimeouts()
	mcall(gosched_m)
}

// goschedguarded yields the processor like gosched, but also checks
// for forbidden states and opts out of the yield in those cases.
//go:nosplit
func goschedguarded() {
	mcall(goschedguarded_m)
}

// Puts the current goroutine into a waiting state and calls unlockf.
// If unlockf returns false, the goroutine is resumed.
// unlockf must not access this G's stack, as it may be moved between
// the call to gopark and the call to unlockf.
// Reason explains why the goroutine has been parked.
// It is displayed in stack traces and heap dumps.
// Reasons should be unique and descriptive.
// Do not re-use reasons, add new ones.
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer, reason waitReason, traceEv byte, traceskip int) {
	if reason != waitReasonSleep {
		checkTimeouts() // timeouts may expire while two goroutines keep the scheduler busy
	}
	mp := acquirem()
	gp := mp.curg
	status := readgstatus(gp)
	if status != _Grunning && status != _Gscanrunning {
		throw("gopark: bad g status")
	}
	mp.waitlock = lock
	mp.waitunlockf = unlockf
	gp.waitreason = reason
	mp.waittraceev = traceEv
	mp.waittraceskip = traceskip
	releasem(mp)
	// can't do anything that might move the G between Ms here.
	mcall(park_m) // 切换到 waiting 状态并重新进入调度循环
}

// 将当前 goroutine 置于等待状态并解锁 lock。
// 通过调用 goready(gp) 可让 goroutine 再次 runnable
func goparkunlock(lock *mutex, reason waitReason, traceEv byte, traceskip int) {
	gopark(parkunlock_c, unsafe.Pointer(lock), reason, traceEv, traceskip)
}

func goready(gp *g, traceskip int) {
	systemstack(func() {
		ready(gp, traceskip, true)
	})
}

//go:nosplit
func acquireSudog() *sudog {
	// Delicate dance: the semaphore implementation calls
	// acquireSudog, acquireSudog calls new(sudog),
	// new calls malloc, malloc can call the garbage collector,
	// and the garbage collector calls the semaphore implementation
	// in stopTheWorld.
	// Break the cycle by doing acquirem/releasem around new(sudog).
	// The acquirem/releasem increments m.locks during new(sudog),
	// which keeps the garbage collector from being invoked.
	mp := acquirem()
	pp := mp.p.ptr()
	if len(pp.sudogcache) == 0 {
		lock(&sched.sudoglock)
		// First, try to grab a batch from central cache.
		for len(pp.sudogcache) < cap(pp.sudogcache)/2 && sched.sudogcache != nil {
			s := sched.sudogcache
			sched.sudogcache = s.next
			s.next = nil
			pp.sudogcache = append(pp.sudogcache, s)
		}
		unlock(&sched.sudoglock)
		// If the central cache is empty, allocate a new one.
		if len(pp.sudogcache) == 0 {
			pp.sudogcache = append(pp.sudogcache, new(sudog))
		}
	}
	n := len(pp.sudogcache)
	s := pp.sudogcache[n-1]
	pp.sudogcache[n-1] = nil
	pp.sudogcache = pp.sudogcache[:n-1]
	if s.elem != nil {
		throw("acquireSudog: found s.elem != nil in cache")
	}
	releasem(mp)
	return s
}

//go:nosplit
func releaseSudog(s *sudog) {
	if s.elem != nil {
		throw("runtime: sudog with non-nil elem")
	}
	if s.isSelect {
		throw("runtime: sudog with non-false isSelect")
	}
	if s.next != nil {
		throw("runtime: sudog with non-nil next")
	}
	if s.prev != nil {
		throw("runtime: sudog with non-nil prev")
	}
	if s.waitlink != nil {
		throw("runtime: sudog with non-nil waitlink")
	}
	if s.c != nil {
		throw("runtime: sudog with non-nil c")
	}
	gp := getg()
	if gp.param != nil {
		throw("runtime: releaseSudog with non-nil gp.param")
	}
	mp := acquirem() // avoid rescheduling to another P
	pp := mp.p.ptr()
	if len(pp.sudogcache) == cap(pp.sudogcache) {
		// Transfer half of local cache to the central cache.
		var first, last *sudog
		for len(pp.sudogcache) > cap(pp.sudogcache)/2 {
			n := len(pp.sudogcache)
			p := pp.sudogcache[n-1]
			pp.sudogcache[n-1] = nil
			pp.sudogcache = pp.sudogcache[:n-1]
			if first == nil {
				first = p
			} else {
				last.next = p
			}
			last = p
		}
		lock(&sched.sudoglock)
		last.next = sched.sudogcache
		sched.sudogcache = first
		unlock(&sched.sudoglock)
	}
	pp.sudogcache = append(pp.sudogcache, s)
	releasem(mp)
}

// funcPC 返回函数 f 的入口 PC。
// 它假设 f 是一个 func 值。否则行为是未定义的。
// 小心：在包含插件的程序中，funcPC 可以对相同的函数返回不同的值（因为在地址空间中相同的函数可能有多个副本）
// 为安全起见，不要在任何 == 表达式中使用此函数。它只在作为地址用于执行代码时是安全的。
//go:nosplit
func funcPC(f interface{}) uintptr {
	return *(*uintptr)(efaceOf(&f).data)
}

// called from assembly
func badmcall(fn func(*g)) {
	throw("runtime: mcall called on m->g0 stack")
}

func badmcall2(fn func(*g)) {
	throw("runtime: mcall function returned")
}

func badreflectcall() {
	panic(plainError("arg size to reflect.call more than 1GB"))
}

var badmorestackg0Msg = "fatal: morestack on g0\n"

//go:nosplit
//go:nowritebarrierrec
func badmorestackg0() {
	sp := stringStructOf(&badmorestackg0Msg)
	write(2, sp.str, int32(sp.len))
}

var badmorestackgsignalMsg = "fatal: morestack on gsignal\n"

//go:nosplit
//go:nowritebarrierrec
func badmorestackgsignal() {
	sp := stringStructOf(&badmorestackgsignalMsg)
	write(2, sp.str, int32(sp.len))
}

//go:nosplit
func badctxt() {
	throw("ctxt != 0")
}

func lockedOSThread() bool {
	gp := getg()
	return gp.lockedm != 0 && gp.m.lockedg != 0
}

var (
	allgs    []*g
	allglock mutex
)

func allgadd(gp *g) {
	if readgstatus(gp) == _Gidle {
		throw("allgadd: bad status Gidle")
	}

	lock(&allglock)
	allgs = append(allgs, gp)
	allglen = uintptr(len(allgs))
	unlock(&allglock)
}

const (
	// Number of goroutine ids to grab from sched.goidgen to local per-P cache at once.
	// 16 seems to provide enough amortization, but other than that it's mostly arbitrary number.
	_GoidCacheBatch = 16
)

// cpuinit 提取环境变量 GODEBUGCPU，如果 GOEXPERIMENT debugcpu 被设置，则还会调用 internal/cpu.initialize
func cpuinit() {
	const prefix = "GODEBUG="
	var env string

	switch GOOS {
	case "aix", "darwin", "dragonfly", "freebsd", "netbsd", "openbsd", "illumos", "solaris", "linux":
		cpu.DebugOptions = true

		// 类似于 goenv_unix 但为 GODEBUG 直接提取了环境变量
		// TODO(moehrmann): remove when general goenvs() can be called before cpuinit()
		n := int32(0)
		for argv_index(argv, argc+1+n) != nil {
			n++
		}

		for i := int32(0); i < n; i++ {
			p := argv_index(argv, argc+1+i)
			s := *(*string)(unsafe.Pointer(&stringStruct{unsafe.Pointer(p), findnull(p)}))

			if hasprefix(s, prefix) {
				env = gostring(p)[len(prefix):]
				break
			}
		}
	}

	cpu.Initialize(env)

	// 支持 CPU 特性的变量由编译器生成的代码来阻止指令的执行，从而不能假设总是支持的
	x86HasPOPCNT = cpu.X86.HasPOPCNT
	x86HasSSE41 = cpu.X86.HasSSE41
	x86HasFMA = cpu.X86.HasFMA

	armHasVFPv4 = cpu.ARM.HasVFPv4
	arm64HasATOMICS = cpu.ARM64.HasATOMICS
}

// 启动顺序
//
//	调用 osinit
//	调用 schedinit
//	make & queue new G
//	调用 runtime·mstart
//
// 创建 G 的调用 runtime·main.
func schedinit() {
	_g_ := getg()

	// 不重要，race 检查有关
	// raceinit 必须受限调用竞争检查器 race detector
	// 特别的，它必须在 mallocinit 下面的 racemapshadow 之前完成。
	if raceenabled {
		_g_.racectx, raceprocctx0 = raceinit()
	}

	// 最大系统线程数量（即 M），参考标准库 runtime/debug.SetMaxThreads
	sched.maxmcount = 10000

	// 不重要，与 trace 有关
	tracebackinit()

	// 模块数据验证
	moduledataverify()

	// 栈、内存分配器、调度器相关初始化。
	// 栈初始化，复用管理链表
	stackinit()
	// 必须在 mcommoninit 之前运行
	fastrandinit()
	// 内存分配器初始化
	mallocinit()
	// 初始化当前 M
	mcommoninit(_g_.m)

	// cpu 相关的初始化
	cpuinit() // 必须在 alginit 之前运行
	alginit() // maps 不能在此调用之前使用，从 CPU 指令集初始化哈希算法

	// 模块加载相关的初始化
	modulesinit()   // 模块链接，提供 activeModules
	typelinksinit() // 使用 maps, activeModules
	itabsinit()     // 初始化 interface table，使用 activeModules

	msigsave(_g_.m)
	initSigmask = _g_.m.sigmask

	// 处理y命令行用户参数和环境变量
	goargs()
	goenvs()

	// 处理 GODEBUG、GOTRACEBACK 调试相关的环境变量设置
	parsedebugvars()

	// 垃圾回收器初始化
	gcinit()

	// 网络的上次轮询时间
	sched.lastpoll = uint64(nanotime())

	// 通过 CPU 核心数和 GOMAXPROCS 环境变量确定 P 的数量
	procs := ncpu
	if n, ok := atoi32(gogetenv("GOMAXPROCS")); ok && n > 0 {
		procs = n
	}

	// 调整 P 的数量
	// 这时所有 P 均为新建的 P，因此不能返回有本地任务的 P
	if procresize(procs) != nil {
		throw("unknown runnable goroutine during bootstrap")
	}

	// 不重要，调试相关
	// For cgocheck > 1, we turn on the write barrier at all times
	// and check all pointer writes. We can't do this until after
	// procresize because the write barrier needs a P.
	if debug.cgocheck > 1 {
		writeBarrier.cgo = true
		writeBarrier.enabled = true
		for _, p := range allp {
			p.wbBuf.reset()
		}
	}

	if buildVersion == "" {
		// 该条件永远不会被触发，此处只是为了防止 buildVersion 被编译器优化移除掉。
		buildVersion = "unknown"
	}
	if len(modinfo) == 1 {
		// Condition should never trigger. This code just serves
		// to ensure runtime·modinfo is kept in the resulting binary.
		modinfo = ""
	}
}

func dumpgstatus(gp *g) {
	_g_ := getg()
	print("runtime: gp: gp=", gp, ", goid=", gp.goid, ", gp->atomicstatus=", readgstatus(gp), "\n")
	print("runtime:  g:  g=", _g_, ", goid=", _g_.goid, ",  g->atomicstatus=", readgstatus(_g_), "\n")
}

// 检查 m 的数量是否太多
func checkmcount() {
	// 此时 sched 是锁住的
	if mcount() > sched.maxmcount {
		print("runtime: program exceeds ", sched.maxmcount, "-thread limit\n")
		throw("thread exhaustion")
	}
}

func mcommoninit(mp *m) {
	_g_ := getg()

	// 检查当前 g 是否是 g0
	// g0 栈对用户而言是没有意义的（且不是不可避免的）
	if _g_ != _g_.m.g0 {
		callers(1, mp.createstack[:])
	}

	// 锁住调度器
	lock(&sched.lock)
	// 确保线程数量不会太多而溢出
	if sched.mnext+1 < sched.mnext {
		throw("runtime: thread ID overflow")
	}
	// mnext 表示当前 m 的数量，还表示下一个 m 的 id
	mp.id = sched.mnext
	// 增加 m 的数量
	sched.mnext++
	// 检查 m 的数量不会太多
	checkmcount()

	// 用于 fastrand 快速取随机数
	mp.fastrand[0] = uint32(int64Hash(uint64(mp.id), fastrandseed))
	mp.fastrand[1] = uint32(int64Hash(uint64(cputicks()), ^fastrandseed))
	if mp.fastrand[0]|mp.fastrand[1] == 0 {
		mp.fastrand[1] = 1
	}

	// 初始化 gsignal，用于处理 m 上的信号。
	mpreinit(mp)

	// gsignal 的运行栈边界处理
	if mp.gsignal != nil {
		mp.gsignal.stackguard1 = mp.gsignal.stack.lo + _StackGuard
	}

	// 添加到 allm 中，从而当它刚保存到寄存器或本地线程存储时候 GC 不会释放 g->m
	// 每一次调用都会讲 allm 给 alllink，给完之后自身被 mp 替换，在下一次的时候由给 alllink
	// 从而形成链表
	mp.alllink = allm

	// NumCgoCall() 会在没有使用 schedlock 时遍历 allm
	// 等价于 allm = mp
	atomicstorep(unsafe.Pointer(&allm), unsafe.Pointer(mp))

	// m 的通用初始化完成，解锁调度器
	unlock(&sched.lock)

	// 分配内存来保存当 cgo 调用崩溃时候的回溯
	if iscgo || GOOS == "solaris" || GOOS == "illumos" || GOOS == "windows" {
		mp.cgoCallers = new(cgoCallers)
	}
}

var fastrandseed uintptr

func fastrandinit() {
	s := (*[unsafe.Sizeof(fastrandseed)]byte)(unsafe.Pointer(&fastrandseed))[:]
	getRandomData(s)
}

// 将 gp 标记为 ready 来运行
func ready(gp *g, traceskip int, next bool) {
	if trace.enabled {
		traceGoUnpark(gp, traceskip)
	}

	status := readgstatus(gp)

	// 标记为 runnable.
	_g_ := getg()
	mp := acquirem() // 禁止抢占，因为它可以在局部变量中保存 p
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
	releasem(mp)
}

// freezeStopWait is a large value that freezetheworld sets
// sched.stopwait to in order to request that all Gs permanently stop.
const freezeStopWait = 0x7fffffff

// freezing is set to non-zero if the runtime is trying to freeze the
// world.
var freezing uint32

// Similar to stopTheWorld but best-effort and can be called several times.
// There is no reverse operation, used during crashing.
// This function must not lock any mutexes.
func freezetheworld() {
	atomic.Store(&freezing, 1)
	// stopwait and preemption requests can be lost
	// due to races with concurrently executing threads,
	// so try several times
	for i := 0; i < 5; i++ {
		// this should tell the scheduler to not start any new goroutines
		sched.stopwait = freezeStopWait
		atomic.Store(&sched.gcwaiting, 1)
		// this should stop running goroutines
		if !preemptall() {
			break // no running goroutines
		}
		usleep(1000)
	}
	// to be sure
	usleep(1000)
	preemptall()
	usleep(1000)
}

// All reads and writes of g's status go through readgstatus, casgstatus
// castogscanstatus, casfrom_Gscanstatus.
//go:nosplit
func readgstatus(gp *g) uint32 {
	return atomic.Load(&gp.atomicstatus)
}

// The Gscanstatuses are acting like locks and this releases them.
// If it proves to be a performance hit we should be able to make these
// simple atomic stores but for now we are going to throw if
// we see an inconsistent state.
func casfrom_Gscanstatus(gp *g, oldval, newval uint32) {
	success := false

	// Check that transition is valid.
	switch oldval {
	default:
		print("runtime: casfrom_Gscanstatus bad oldval gp=", gp, ", oldval=", hex(oldval), ", newval=", hex(newval), "\n")
		dumpgstatus(gp)
		throw("casfrom_Gscanstatus:top gp->status is not in scan state")
	case _Gscanrunnable,
		_Gscanwaiting,
		_Gscanrunning,
		_Gscansyscall,
		_Gscanpreempted:
		if newval == oldval&^_Gscan {
			success = atomic.Cas(&gp.atomicstatus, oldval, newval)
		}
	}
	if !success {
		print("runtime: casfrom_Gscanstatus failed gp=", gp, ", oldval=", hex(oldval), ", newval=", hex(newval), "\n")
		dumpgstatus(gp)
		throw("casfrom_Gscanstatus: gp->status is not in scan state")
	}
}

// This will return false if the gp is not in the expected status and the cas fails.
// This acts like a lock acquire while the casfromgstatus acts like a lock release.
func castogscanstatus(gp *g, oldval, newval uint32) bool {
	switch oldval {
	case _Grunnable,
		_Grunning,
		_Gwaiting,
		_Gsyscall:
		if newval == oldval|_Gscan {
			return atomic.Cas(&gp.atomicstatus, oldval, newval)
		}
	}
	print("runtime: castogscanstatus oldval=", hex(oldval), " newval=", hex(newval), "\n")
	throw("castogscanstatus")
	panic("not reached")
}

// If asked to move to or from a Gscanstatus this will throw. Use the castogscanstatus
// and casfrom_Gscanstatus instead.
// casgstatus will loop if the g->atomicstatus is in a Gscan status until the routine that
// put it in the Gscan state is finished.
//go:nosplit
func casgstatus(gp *g, oldval, newval uint32) {
	if (oldval&_Gscan != 0) || (newval&_Gscan != 0) || oldval == newval {
		systemstack(func() {
			print("runtime: casgstatus: oldval=", hex(oldval), " newval=", hex(newval), "\n")
			throw("casgstatus: bad incoming values")
		})
	}

	// See https://golang.org/cl/21503 for justification of the yield delay.
	const yieldDelay = 5 * 1000
	var nextYield int64

	// loop if gp->atomicstatus is in a scan state giving
	// GC time to finish and change the state to oldval.
	for i := 0; !atomic.Cas(&gp.atomicstatus, oldval, newval); i++ {
		if oldval == _Gwaiting && gp.atomicstatus == _Grunnable {
			throw("casgstatus: waiting for Gwaiting but is Grunnable")
		}
		if i == 0 {
			nextYield = nanotime() + yieldDelay
		}
		if nanotime() < nextYield {
			for x := 0; x < 10 && gp.atomicstatus != oldval; x++ {
				procyield(1)
			}
		} else {
			osyield()
			nextYield = nanotime() + yieldDelay/2
		}
	}
}

// casgstatus(gp, oldstatus, Gcopystack), assuming oldstatus is Gwaiting or Grunnable.
// Returns old status. Cannot call casgstatus directly, because we are racing with an
// async wakeup that might come in from netpoll. If we see Gwaiting from the readgstatus,
// it might have become Grunnable by the time we get to the cas. If we called casgstatus,
// it would loop waiting for the status to go back to Gwaiting, which it never will.
//go:nosplit
func casgcopystack(gp *g) uint32 {
	for {
		oldstatus := readgstatus(gp) &^ _Gscan
		if oldstatus != _Gwaiting && oldstatus != _Grunnable {
			throw("copystack: bad status, not Gwaiting or Grunnable")
		}
		if atomic.Cas(&gp.atomicstatus, oldstatus, _Gcopystack) {
			return oldstatus
		}
	}
}

// casGToPreemptScan transitions gp from _Grunning to _Gscan|_Gpreempted.
//
// TODO(austin): This is the only status operation that both changes
// the status and locks the _Gscan bit. Rethink this.
func casGToPreemptScan(gp *g, old, new uint32) {
	if old != _Grunning || new != _Gscan|_Gpreempted {
		throw("bad g transition")
	}
	for !atomic.Cas(&gp.atomicstatus, _Grunning, _Gscan|_Gpreempted) {
	}
}

// casGFromPreempted attempts to transition gp from _Gpreempted to
// _Gwaiting. If successful, the caller is responsible for
// re-scheduling gp.
func casGFromPreempted(gp *g, old, new uint32) bool {
	if old != _Gpreempted || new != _Gwaiting {
		throw("bad g transition")
	}
	return atomic.Cas(&gp.atomicstatus, _Gpreempted, _Gwaiting)
}

// stopTheWorld 从正在执行的 goroutine 中停止所有的 P，在 GC 安全点 safe point
// 打断所有 goroutine 并记录打断的原因。作为结果，只有当前 goroutine 的 P 正在运行。
// stopTheWorld 不能再系统栈上调用，调用方也不能持有 worldsema。调用放必须在其他 P
// 应该恢复执行的时候调用 startTheWorld。
//
// stopTheWorld 在多个 goroutine 间同时调用时安全的。每个 goroutine 都会执行自己
// 的 stop，所有的 stop 都会被有序的执行。
//
// 这个函数也会被 stack dump 的 routine 使用。如果系统处于 panic 或 exit 状态，
// 这可能无法可靠地停止所有的 goroutine。
func stopTheWorld(reason string) {
	// 抢占 worldsema
	semacquire(&worldsema)
	gp := getg()
	gp.m.preemptoff = reason
	systemstack(func() {
		// Mark the goroutine which called stopTheWorld preemptible so its
		// stack may be scanned.
		// This lets a mark worker scan us while we try to stop the world
		// since otherwise we could get in a mutual preemption deadlock.
		// We must not modify anything on the G stack because a stack shrink
		// may occur. A stack shrink is otherwise OK though because in order
		// to return from this function (and to leave the system stack) we
		// must have preempted all goroutines, including any attempting
		// to scan our stack, in which case, any stack shrinking will
		// have already completed by the time we exit.
		casgstatus(gp, _Grunning, _Gwaiting)
		stopTheWorldWithSema()
		casgstatus(gp, _Gwaiting, _Grunning)
	})
}

// startTheWorld undoes the effects of stopTheWorld.
func startTheWorld() {
	systemstack(func() { startTheWorldWithSema(false) })
	// worldsema must be held over startTheWorldWithSema to ensure
	// gomaxprocs cannot change while worldsema is held.
	semrelease(&worldsema)
	getg().m.preemptoff = ""
}

// until the GC is not running. It also blocks a GC from starting
// until startTheWorldGC is called.
func stopTheWorldGC(reason string) {
	semacquire(&gcsema)
	stopTheWorld(reason)
}

// startTheWorldGC undoes the effects of stopTheWorldGC.
func startTheWorldGC() {
	startTheWorld()
	semrelease(&gcsema)
}

// 持有 worldsema 会授权 M stop the world 的权利。
var worldsema uint32 = 1

// Holding gcsema grants the M the right to block a GC, and blocks
// until the current GC is done. In particular, it prevents gomaxprocs
// from changing concurrently.
//
// TODO(mknyszek): Once gomaxprocs and the execution tracer can handle
// being changed/enabled during a GC, remove this.
var gcsema uint32 = 1

// stopTheWorldWithSema 是 stopTheWorld 的核心实现。调用方负责抢占 worldsema
// 并经用其可抢占的属性，然后再系统栈上调用 stopTheWorldWithSema：
//
//	semacquire(&worldsema, 0)
//	m.preemptoff = "reason"
//	systemstack(stopTheWorldWithSema)
//
// 当完成时，调用方必须调用 startTheWorld ，或者分别撤销刚才的三个操作：
//
//	m.preemptoff = ""
//	systemstack(startTheWorldWithSema)
//	semrelease(&worldsema)
//
// 占有 worldsema 后可以多次执行 startTheWorldWithSema/stopTheWorldWithSema 对；
// 其他的 P 可以在连续调用 startTheWorldWithSema 和 stopTheWorldWithSema 间进行执行。
// 持有 worldsema 会导致其他 goroutine 调用的 stopTheWorld 阻塞。
func stopTheWorldWithSema() {
	_g_ := getg()

	// If we hold a lock, then we won't be able to stop another M
	// that is blocked trying to acquire the lock.
	if _g_.m.locks > 0 {
		throw("stopTheWorld: holding locks")
	}

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

	// sanity checks
	bad := ""
	if sched.stopwait != 0 {
		bad = "stopTheWorld: not stopped (stopwait != 0)"
	} else {
		for _, p := range allp {
			if p.status != _Pgcstop {
				bad = "stopTheWorld: not stopped (status != _Pgcstop)"
			}
		}
	}
	if atomic.Load(&freezing) != 0 {
		// Some other thread is panicking. This can cause the
		// sanity checks above to fail if the panic happens in
		// the signal handler on a stopped thread. Either way,
		// we should halt this thread.
		lock(&deadlock)
		lock(&deadlock)
	}
	if bad != "" {
		throw(bad)
	}
}

func startTheWorldWithSema(emitTraceEvent bool) int64 {
	mp := acquirem() // disable preemption because it can be holding p in a local var
	if netpollinited() {
		list := netpoll(0) // non-blocking
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
			if mp.nextp != 0 {
				throw("startTheWorld: inconsistent mp->nextp")
			}
			mp.nextp.set(p)
			notewakeup(&mp.park)
		} else {
			// Start M to run P.  Do not start another M below.
			newm(nil, p)
		}
	}

	// Capture start-the-world time before doing clean-up tasks.
	startTime := nanotime()
	if emitTraceEvent {
		traceGCSTWDone()
	}

	// Wakeup an additional proc in case we have excessive runnable goroutines
	// in local queues or in the global queue. If we don't, the proc will park itself.
	// If we have lots of excessive work, resetspinning will unpark additional procs as necessary.
	// 如果我们在本地队列或全局队列中有过多的可运行的 goroutine，则唤醒一个额外的 proc。
	// 如果我们不这样做，那么过程就会停止。
	// 如果我们有大量过多的工作，重新设置将取消必要的额外过程。
	if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 {
		wakep()
	}

	releasem(mp)
	return startTime
}

// mstart is the entry-point for new Ms.
//
// 该函数不允许分段栈，因为我们甚至还没有设置栈的边界
//
// 它可能会在 STW 阶段运行（因为它还没有 P），所以 write barrier 也是不允许的
//
//go:nosplit
//go:nowritebarrierrec
func mstart() {
	_g_ := getg()

	// 终于开始确定执行栈的边界了
	// 通过检查 g 执行占的边界来确定是否为系统栈
	osStack := _g_.stack.lo == 0
	if osStack {
		// 根据系统栈初始化执行栈的边界
		// cgo 可能会离开 stack.hi
		// minit 可能会更新栈的边界
		size := _g_.stack.hi
		if size == 0 {
			size = 8192 * sys.StackGuardMultiplier
		}
		_g_.stack.hi = uintptr(noescape(unsafe.Pointer(&size)))
		_g_.stack.lo = _g_.stack.hi - size + 1024
	}
	// Initialize stack guard so that we can start calling regular
	// Go code.
	_g_.stackguard0 = _g_.stack.lo + _StackGuard
	// This is the g0, so we can also call go:systemstack
	// functions, which check stackguard1.
	_g_.stackguard1 = _g_.stackguard0

	// 启动！
	mstart1()

	// 退出线程
	switch GOOS {
	case "windows", "solaris", "illumos", "plan9", "darwin", "aix":
		// 由于 windows, solaris, illumos, darwin, aix 和 plan9 总是系统分配的栈，在在 mstart 之前放进 _g_.stack 的
		// 因此上面的逻辑还没有设置 osStack。
		osStack = true
	}

	// 退出线程
	mexit(osStack)
}

func mstart1() {
	_g_ := getg()

	// 检查当前执行的 g 是不是 g0
	if _g_ != _g_.m.g0 {
		throw("bad runtime·mstart")
	}

	// 为了在 mcall 的栈顶使用调用方来结束当前线程，做记录
	// 当进入 schedule 之后，我们再也不会回到 mstart1，所以其他调用可以复用当前帧。
	save(getcallerpc(), getcallersp())
	asminit()
	minit()

	// 设置信号 handler；在 minit 之后，因为 minit 可以准备处理信号的的线程
	if _g_.m == &m0 {
		mstartm0()
	}

	// 执行启动函数
	if fn := _g_.m.mstartfn; fn != nil {
		fn()
	}

	// 如果当前 m 并非 m0，则要求绑定 p
	if _g_.m != &m0 {
		acquirep(_g_.m.nextp.ptr())
		_g_.m.nextp = 0
	}

	// 彻底准备好，开始调度，永不返回
	schedule()
}

// mstartm0 实现了一部分 mstart1，只运行在 m0 上
//
// 允许 write barrier，因为我们知道 GC 此时还不能运行，因此他们没有 op。
//
//go:yeswritebarrierrec
func mstartm0() {
	// 创建一个额外的 M 服务 non-Go 线程（cgo 调用中产生的线程）的回调，并且只创建一个
	// windows 上也需要额外 M 来服务 syscall.NewCallback 产生的回调，见 issue #6751
	if (iscgo || GOOS == "windows") && !cgoHasExtraM {
		cgoHasExtraM = true
		newextram()
	}
	initsig(false)
}

// mexit 销毁并退出当前线程
//
// 请不要直接调用来退出线程，因为它必须在线程栈顶上运行。
// 相反，请使用 gogo(&_g_.m.g0.sched) 来解除栈并退出线程。
//
// 当调用时，m.p != nil。因此可以使用 write barrier。
// 在退出前它会释放当前绑定的 P。
//
//go:yeswritebarrierrec
func mexit(osStack bool) {
	g := getg()
	m := g.m

	if m == &m0 {
		// 主线程
		//
		// 在 linux 中，退出主线程会导致进程变为僵尸进程。
		// 在 plan 9 中，退出主线程将取消阻塞等待，及时其他线程仍在运行。
		// 在 Solaris 中我们既不能 exitThread 也不能返回到 mstart 中。
		// 其他系统上可能发生别的糟糕的事情。
		//
		// 我们可以尝试退出之前清理当前 M ，但信号处理非常复杂
		handoffp(releasep()) // 让出 P
		lock(&sched.lock)    // 锁住调度器
		sched.nmfreed++
		checkdead()
		unlock(&sched.lock)
		notesleep(&m.park) // park 主线程，在此阻塞
		throw("locked m0 woke up")
	}

	sigblock()
	unminit()

	// 释放 gsignal 栈
	if m.gsignal != nil {
		stackfree(m.gsignal.stack)
		// On some platforms, when calling into VDSO (e.g. nanotime)
		// we store our g on the gsignal stack, if there is one.
		// Now the stack is freed, unlink it from the m, so we
		// won't write to it when calling VDSO code.
		m.gsignal = nil
	}

	// 将 m 从 allm 中移除
	lock(&sched.lock)
	for pprev := &allm; *pprev != nil; pprev = &(*pprev).alllink {
		if *pprev == m {
			*pprev = m.alllink
			goto found
		}
	}
	// 如果没找到则是异常状态，说明 allm 管理出错
	throw("m not found in allm")
found:

	//
	if !osStack {
		// Delay reaping m until it's done with the stack.
		//
		// If this is using an OS stack, the OS will free it
		// so there's no need for reaping.
		atomic.Store(&m.freeWait, 1)
		// Put m on the free list, though it will not be reaped until
		// freeWait is 0. Note that the free list must not be linked
		// through alllink because some functions walk allm without
		// locking, so may be using alllink.
		m.freelink = sched.freem
		sched.freem = m
	}
	unlock(&sched.lock)

	// 让出当前的 P
	handoffp(releasep())
	// 从此刻开始我们必须没有 write barrier

	// 检查 deadlock。必须在让出 P 之后执行，因为它可能启动一个新的 M 并
	// 拿走 P 的 work
	lock(&sched.lock)
	sched.nmfreed++
	checkdead()
	unlock(&sched.lock)

	if osStack {
		// Return from mstart and let the system thread
		// library free the g0 stack and terminate the thread.
		return
	}

	// mstart is the thread's entry point, so there's nothing to
	// return to. Exit the thread directly. exitThread will clear
	// m.freeWait when it's done with the stack and the m can be
	// reaped.
	exitThread(&m.freeWait)
}

// forEachP calls fn(p) for every P p when p reaches a GC safe point.
// If a P is currently executing code, this will bring the P to a GC
// safe point and execute fn on that P. If the P is not executing code
// (it is idle or in a syscall), this will call fn(p) directly while
// preventing the P from exiting its state. This does not ensure that
// fn will run on every CPU executing Go code, but it acts as a global
// memory barrier. GC uses this as a "ragged barrier."
//
// The caller must hold worldsema.
//
//go:systemstack
func forEachP(fn func(*p)) {
	mp := acquirem()
	_p_ := getg().m.p.ptr()

	lock(&sched.lock)
	if sched.safePointWait != 0 {
		throw("forEachP: sched.safePointWait != 0")
	}
	sched.safePointWait = gomaxprocs - 1
	sched.safePointFn = fn

	// Ask all Ps to run the safe point function.
	for _, p := range allp {
		if p != _p_ {
			atomic.Store(&p.runSafePointFn, 1)
		}
	}
	preemptall()

	// Any P entering _Pidle or _Psyscall from now on will observe
	// p.runSafePointFn == 1 and will call runSafePointFn when
	// changing its status to _Pidle/_Psyscall.

	// Run safe point function for all idle Ps. sched.pidle will
	// not change because we hold sched.lock.
	for p := sched.pidle.ptr(); p != nil; p = p.link.ptr() {
		if atomic.Cas(&p.runSafePointFn, 1, 0) {
			fn(p)
			sched.safePointWait--
		}
	}

	wait := sched.safePointWait > 0
	unlock(&sched.lock)

	// Run fn for the current P.
	fn(_p_)

	// Force Ps currently in _Psyscall into _Pidle and hand them
	// off to induce safe point function execution.
	for _, p := range allp {
		s := p.status
		if s == _Psyscall && p.runSafePointFn == 1 && atomic.Cas(&p.status, s, _Pidle) {
			if trace.enabled {
				traceGoSysBlock(p)
				traceProcStop(p)
			}
			p.syscalltick++
			handoffp(p)
		}
	}

	// Wait for remaining Ps to run fn.
	if wait {
		for {
			// Wait for 100us, then try to re-preempt in
			// case of any races.
			//
			// Requires system stack.
			if notetsleep(&sched.safePointNote, 100*1000) {
				noteclear(&sched.safePointNote)
				break
			}
			preemptall()
		}
	}
	if sched.safePointWait != 0 {
		throw("forEachP: not done")
	}
	for _, p := range allp {
		if p.runSafePointFn != 0 {
			throw("forEachP: P did not run fn")
		}
	}

	lock(&sched.lock)
	sched.safePointFn = nil
	unlock(&sched.lock)
	releasem(mp)
}

// runSafePointFn runs the safe point function, if any, for this P.
// This should be called like
//
//     if getg().m.p.runSafePointFn != 0 {
//         runSafePointFn()
//     }
//
// runSafePointFn must be checked on any transition in to _Pidle or
// _Psyscall to avoid a race where forEachP sees that the P is running
// just before the P goes into _Pidle/_Psyscall and neither forEachP
// nor the P run the safe-point function.
func runSafePointFn() {
	p := getg().m.p.ptr()
	// Resolve the race between forEachP running the safe-point
	// function on this P's behalf and this P running the
	// safe-point function directly.
	if !atomic.Cas(&p.runSafePointFn, 1, 0) {
		return
	}
	sched.safePointFn(p)
	lock(&sched.lock)
	sched.safePointWait--
	if sched.safePointWait == 0 {
		notewakeup(&sched.safePointNote)
	}
	unlock(&sched.lock)
}

// When running with cgo, we call _cgo_thread_start
// to start threads for us so that we can play nicely with
// foreign code.
var cgoThreadStart unsafe.Pointer

type cgothreadstart struct {
	g   guintptr
	tls *uint64
	fn  unsafe.Pointer
}

// Allocate a new m unassociated with any thread.
// Can use p for allocation context if needed.
// fn is recorded as the new m's m.mstartfn.
//
// This function is allowed to have write barriers even if the caller
// isn't because it borrows _p_.
//
//go:yeswritebarrierrec
func allocm(_p_ *p, fn func()) *m {
	_g_ := getg()
	acquirem() // disable GC because it can be called from sysmon
	if _g_.m.p == 0 {
		acquirep(_p_) // temporarily borrow p for mallocs in this function
	}

	// Release the free M list. We need to do this somewhere and
	// this may free up a stack we can use.
	if sched.freem != nil {
		lock(&sched.lock)
		var newList *m
		for freem := sched.freem; freem != nil; {
			if freem.freeWait != 0 {
				next := freem.freelink
				freem.freelink = newList
				newList = freem
				freem = next
				continue
			}
			stackfree(freem.g0.stack)
			freem = freem.freelink
		}
		sched.freem = newList
		unlock(&sched.lock)
	}

	mp := new(m)
	mp.mstartfn = fn
	mcommoninit(mp)

	// In case of cgo or Solaris or illumos or Darwin, pthread_create will make us a stack.
	// Windows and Plan 9 will layout sched stack on OS stack.
	if iscgo || GOOS == "solaris" || GOOS == "illumos" || GOOS == "windows" || GOOS == "plan9" || GOOS == "darwin" {
		mp.g0 = malg(-1)
	} else {
		mp.g0 = malg(8192 * sys.StackGuardMultiplier)
	}
	mp.g0.m = mp

	if _p_ == _g_.m.p.ptr() {
		releasep()
	}
	releasem(_g_.m)

	return mp
}

// needm is called when a cgo callback happens on a
// thread without an m (a thread not created by Go).
// In this case, needm is expected to find an m to use
// and return with m, g initialized correctly.
// Since m and g are not set now (likely nil, but see below)
// needm is limited in what routines it can call. In particular
// it can only call nosplit functions (textflag 7) and cannot
// do any scheduling that requires an m.
//
// In order to avoid needing heavy lifting here, we adopt
// the following strategy: there is a stack of available m's
// that can be stolen. Using compare-and-swap
// to pop from the stack has ABA races, so we simulate
// a lock by doing an exchange (via Casuintptr) to steal the stack
// head and replace the top pointer with MLOCKED (1).
// This serves as a simple spin lock that we can use even
// without an m. The thread that locks the stack in this way
// unlocks the stack by storing a valid stack head pointer.
//
// In order to make sure that there is always an m structure
// available to be stolen, we maintain the invariant that there
// is always one more than needed. At the beginning of the
// program (if cgo is in use) the list is seeded with a single m.
// If needm finds that it has taken the last m off the list, its job
// is - once it has installed its own m so that it can do things like
// allocate memory - to create a spare m and put it on the list.
//
// Each of these extra m's also has a g0 and a curg that are
// pressed into service as the scheduling stack and current
// goroutine for the duration of the cgo callback.
//
// When the callback is done with the m, it calls dropm to
// put the m back on the list.
//go:nosplit
func needm(x byte) {
	if (iscgo || GOOS == "windows") && !cgoHasExtraM {
		// Can happen if C/C++ code calls Go from a global ctor.
		// Can also happen on Windows if a global ctor uses a
		// callback created by syscall.NewCallback. See issue #6751
		// for details.
		//
		// Can not throw, because scheduler is not initialized yet.
		write(2, unsafe.Pointer(&earlycgocallback[0]), int32(len(earlycgocallback)))
		exit(1)
	}

	// Lock extra list, take head, unlock popped list.
	// nilokay=false is safe here because of the invariant above,
	// that the extra list always contains or will soon contain
	// at least one m.
	mp := lockextra(false)

	// Set needextram when we've just emptied the list,
	// so that the eventual call into cgocallbackg will
	// allocate a new m for the extra list. We delay the
	// allocation until then so that it can be done
	// after exitsyscall makes sure it is okay to be
	// running at all (that is, there's no garbage collection
	// running right now).
	mp.needextram = mp.schedlink == 0
	extraMCount--
	unlockextra(mp.schedlink.ptr())

	// Save and block signals before installing g.
	// Once g is installed, any incoming signals will try to execute,
	// but we won't have the sigaltstack settings and other data
	// set up appropriately until the end of minit, which will
	// unblock the signals. This is the same dance as when
	// starting a new m to run Go code via newosproc.
	msigsave(mp)
	sigblock()

	// Install g (= m->g0) and set the stack bounds
	// to match the current stack. We don't actually know
	// how big the stack is, like we don't know how big any
	// scheduling stack is, but we assume there's at least 32 kB,
	// which is more than enough for us.
	setg(mp.g0)
	_g_ := getg()
	_g_.stack.hi = uintptr(noescape(unsafe.Pointer(&x))) + 1024
	_g_.stack.lo = uintptr(noescape(unsafe.Pointer(&x))) - 32*1024
	_g_.stackguard0 = _g_.stack.lo + _StackGuard

	// Initialize this thread to use the m.
	asminit()
	minit()

	// mp.curg is now a real goroutine.
	casgstatus(mp.curg, _Gdead, _Gsyscall)
	atomic.Xadd(&sched.ngsys, -1)
}

var earlycgocallback = []byte("fatal error: cgo callback before cgo call\n")

// newextram 分配一个 m 并将其放入 extra 列表中
// 它会被工作中的本地 m 调用，因此它能够做一些调用 schedlock 和 allocate 类似的事情。
func newextram() {
	c := atomic.Xchg(&extraMWaiters, 0)
	if c > 0 {
		for i := uint32(0); i < c; i++ {
			oneNewExtraM()
		}
	} else {
		// 确保至少有一个额外的 M
		mp := lockextra(true)
		unlockextra(mp)
		if mp == nil {
			oneNewExtraM()
		}
	}
}

// onNewExtraM 分配一个 m 并将其放入 extra list 中
func oneNewExtraM() {
	// Create extra goroutine locked to extra m.
	// The goroutine is the context in which the cgo callback will run.
	// The sched.pc will never be returned to, but setting it to
	// goexit makes clear to the traceback routines where
	// the goroutine stack ends.
	mp := allocm(nil, nil)
	gp := malg(4096)
	gp.sched.pc = funcPC(goexit) + sys.PCQuantum
	gp.sched.sp = gp.stack.hi
	gp.sched.sp -= 4 * sys.RegSize // extra space in case of reads slightly beyond frame
	gp.sched.lr = 0
	gp.sched.g = guintptr(unsafe.Pointer(gp))
	gp.syscallpc = gp.sched.pc
	gp.syscallsp = gp.sched.sp
	gp.stktopsp = gp.sched.sp
	gp.gcscanvalid = true
	gp.gcscandone = true
	// malg returns status as _Gidle. Change to _Gdead before
	// adding to allg where GC can see it. We use _Gdead to hide
	// this from tracebacks and stack scans since it isn't a
	// "real" goroutine until needm grabs it.
	casgstatus(gp, _Gidle, _Gdead)
	gp.m = mp
	mp.curg = gp
	mp.lockedInt++
	mp.lockedg.set(gp)
	gp.lockedm.set(mp)
	gp.goid = int64(atomic.Xadd64(&sched.goidgen, 1))
	if raceenabled {
		gp.racectx = racegostart(funcPC(newextram) + sys.PCQuantum)
	}
	// put on allg for garbage collector
	allgadd(gp)

	// gp is now on the allg list, but we don't want it to be
	// counted by gcount. It would be more "proper" to increment
	// sched.ngfree, but that requires locking. Incrementing ngsys
	// has the same effect.
	atomic.Xadd(&sched.ngsys, +1)

	// Add m to the extra list.
	mnext := lockextra(true)
	mp.schedlink.set(mnext)
	extraMCount++
	unlockextra(mp)
}

// dropm is called when a cgo callback has called needm but is now
// done with the callback and returning back into the non-Go thread.
// It puts the current m back onto the extra list.
//
// The main expense here is the call to signalstack to release the
// m's signal stack, and then the call to needm on the next callback
// from this thread. It is tempting to try to save the m for next time,
// which would eliminate both these costs, but there might not be
// a next time: the current thread (which Go does not control) might exit.
// If we saved the m for that thread, there would be an m leak each time
// such a thread exited. Instead, we acquire and release an m on each
// call. These should typically not be scheduling operations, just a few
// atomics, so the cost should be small.
//
// TODO(rsc): An alternative would be to allocate a dummy pthread per-thread
// variable using pthread_key_create. Unlike the pthread keys we already use
// on OS X, this dummy key would never be read by Go code. It would exist
// only so that we could register at thread-exit-time destructor.
// That destructor would put the m back onto the extra list.
// This is purely a performance optimization. The current version,
// in which dropm happens on each cgo call, is still correct too.
// We may have to keep the current version on systems with cgo
// but without pthreads, like Windows.
func dropm() {
	// Clear m and g, and return m to the extra list.
	// After the call to setg we can only call nosplit functions
	// with no pointer manipulation.
	mp := getg().m

	// Return mp.curg to dead state.
	casgstatus(mp.curg, _Gsyscall, _Gdead)
	mp.curg.preemptStop = false
	atomic.Xadd(&sched.ngsys, +1)

	// Block signals before unminit.
	// Unminit unregisters the signal handling stack (but needs g on some systems).
	// Setg(nil) clears g, which is the signal handler's cue not to run Go handlers.
	// It's important not to try to handle a signal between those two steps.
	sigmask := mp.sigmask
	sigblock()
	unminit()

	mnext := lockextra(true)
	extraMCount++
	mp.schedlink.set(mnext)

	setg(nil)

	// Commit the release of mp.
	unlockextra(mp)

	msigrestore(sigmask)
}

// A helper function for EnsureDropM.
func getm() uintptr {
	return uintptr(unsafe.Pointer(getg().m))
}

var extram uintptr
var extraMCount uint32 // Protected by lockextra
var extraMWaiters uint32

// lockextra locks the extra list and returns the list head.
// The caller must unlock the list by storing a new list head
// to extram. If nilokay is true, then lockextra will
// return a nil list head if that's what it finds. If nilokay is false,
// lockextra will keep waiting until the list head is no longer nil.
//go:nosplit
func lockextra(nilokay bool) *m {
	const locked = 1

	incr := false
	for {
		old := atomic.Loaduintptr(&extram)
		if old == locked {
			yield := osyield
			yield()
			continue
		}
		if old == 0 && !nilokay {
			if !incr {
				// Add 1 to the number of threads
				// waiting for an M.
				// This is cleared by newextram.
				atomic.Xadd(&extraMWaiters, 1)
				incr = true
			}
			usleep(1)
			continue
		}
		if atomic.Casuintptr(&extram, old, locked) {
			return (*m)(unsafe.Pointer(old))
		}
		yield := osyield
		yield()
		continue
	}
}

//go:nosplit
func unlockextra(mp *m) {
	atomic.Storeuintptr(&extram, uintptr(unsafe.Pointer(mp)))
}

// execLock 序列化 exec 和 clone 以避免在创建/销毁线程时执行错误或未指定的行为。见 issue #19546。
var execLock rwmutex

// newmHandoff 包含需要新 OS 线程的 m 的列表。
// 在 newm 本身无法安全启动 OS 线程的情况下，newm 会使用它。
var newmHandoff struct {
	lock mutex

	// newm 指向需要新 OS 线程的M结构列表。 该列表通过 m.schedlink 链接。
	newm muintptr

	// waiting 表示当 m 列入列表时需要通知唤醒。
	waiting bool
	wake    note

	// haveTemplateThread 表示 templateThread 已经启动。没有锁保护，使用 cas 设置为 1。
	haveTemplateThread uint32
}

// 创建一个新的 m. 它会启动并调用 fn 或调度器
// fn 必须是静态、非堆上分配的闭包
// 它可能在 m.p==nil 时运行，因此不允许 write barrier
//go:nowritebarrierrec
func newm(fn func(), _p_ *p) {

	// 分配一个 m
	mp := allocm(_p_, fn)

	// 设置 p 用于后续绑定
	mp.nextp.set(_p_)

	// 设置 signal mask
	mp.sigmask = initSigmask

	if gp := getg(); gp != nil && gp.m != nil && (gp.m.lockedExt != 0 || gp.m.incgo) && GOOS != "plan9" {
		// 我们处于一个锁定的 M 或可能由 C 启动的线程。这个线程的内核状态可能
		// 很奇怪（用户可能已将其锁定）。我们不想将其克隆到另一个线程。
		// 相反，请求一个已知状态良好的线程来创建给我们的线程。
		//
		// 在 plan9 上禁用，见 golang.org/issue/22227
		//
		// TODO: This may be unnecessary on Windows, which
		// doesn't model thread creation off fork.
		lock(&newmHandoff.lock)
		if newmHandoff.haveTemplateThread == 0 {
			throw("on a locked thread with no template thread")
		}
		mp.schedlink = newmHandoff.newm
		newmHandoff.newm.set(mp)
		if newmHandoff.waiting {
			newmHandoff.waiting = false
			// 唤醒 m, spinning -> non-spinning
			notewakeup(&newmHandoff.wake)
		}
		unlock(&newmHandoff.lock)
		return
	}
	newm1(mp)
}

func newm1(mp *m) {
	if iscgo {
		var ts cgothreadstart
		if _cgo_thread_start == nil {
			throw("_cgo_thread_start missing")
		}
		ts.g.set(mp.g0)
		ts.tls = (*uint64)(unsafe.Pointer(&mp.tls[0]))
		ts.fn = unsafe.Pointer(funcPC(mstart))
		if msanenabled {
			msanwrite(unsafe.Pointer(&ts), unsafe.Sizeof(ts))
		}
		execLock.rlock() // Prevent process clone.
		asmcgocall(_cgo_thread_start, unsafe.Pointer(&ts))
		execLock.runlock()
		return
	}
	execLock.rlock() // Prevent process clone.
	newosproc(mp)
	execLock.runlock()
}

// 如果模板线程尚未运行，则startTemplateThread将启动它。
//
// 调用线程本身必须处于已知良好状态。
func startTemplateThread() {
	if GOARCH == "wasm" { // no threads on wasm yet
		return
	}
	if !atomic.Cas(&newmHandoff.haveTemplateThread, 0, 1) {
		return
	}
	newm(templateThread, nil)
}

// templateThread是处于已知良好状态的线程，仅当调用线程可能不是良好状态时，
// 该线程仅用于在已知良好状态下启动新线程。
//
// 许多程序不需要这个，所以当我们第一次进入可能导致在未知状态的线程上运行的状态时，
// templateThread 会懒启动。
//
// templateThread 在没有 P 的 M 上运行，因此它必须没有写障碍。
//
//go:nowritebarrierrec
func templateThread() {
	lock(&sched.lock)
	sched.nmsys++
	checkdead()
	unlock(&sched.lock)

	for {
		lock(&newmHandoff.lock)
		for newmHandoff.newm != 0 {
			newm := newmHandoff.newm.ptr()
			newmHandoff.newm = 0
			unlock(&newmHandoff.lock)
			for newm != nil {
				next := newm.schedlink.ptr()
				newm.schedlink = 0
				newm1(newm)
				newm = next
			}
			lock(&newmHandoff.lock)
		}

		// 等待新的创建请求
		newmHandoff.waiting = true
		noteclear(&newmHandoff.wake)
		unlock(&newmHandoff.lock)
		notesleep(&newmHandoff.wake)
	}
}

// 停止当前 m 的执行，直到新的 work 有效
// 在包含要求的 P 下返回
func stopm() {
	_g_ := getg()

	if _g_.m.locks != 0 {
		throw("stopm holding locks")
	}
	if _g_.m.p != 0 {
		throw("stopm holding p")
	}
	if _g_.m.spinning {
		throw("stopm spinning")
	}

	// 将 m 放回到 空闲列表中，因为我们马上就要 park 了
	lock(&sched.lock)
	mput(_g_.m)
	unlock(&sched.lock)

	// park 当前的 M，在此阻塞，直到被 unpark
	notesleep(&_g_.m.park)

	// 清除 unpark 的 note
	noteclear(&_g_.m.park)
	// 此时已经被 unpark，说明有任务要执行
	// 立即 acquire P
	acquirep(_g_.m.nextp.ptr())
	_g_.m.nextp = 0
}

func mspinning() {
	// startm's caller incremented nmspinning. Set the new M's spinning.
	getg().m.spinning = true
}

// Schedules some M to run the p (creates an M if necessary).
// If p==nil, tries to get an idle P, if no idle P's does nothing.
// May run with m.p==nil, so write barriers are not allowed.
// If spinning is set, the caller has incremented nmspinning and startm will
// either decrement nmspinning or set m.spinning in the newly started M.
//go:nowritebarrierrec
func startm(_p_ *p, spinning bool) {
	lock(&sched.lock)
	if _p_ == nil {
		_p_ = pidleget()
		if _p_ == nil {
			unlock(&sched.lock)
			if spinning {
				// The caller incremented nmspinning, but there are no idle Ps,
				// so it's okay to just undo the increment and give up.
				if int32(atomic.Xadd(&sched.nmspinning, -1)) < 0 {
					throw("startm: negative nmspinning")
				}
			}
			return
		}
	}
	mp := mget()
	unlock(&sched.lock)
	if mp == nil {
		var fn func()
		if spinning {
			// The caller incremented nmspinning, so set m.spinning in the new M.
			fn = mspinning
		}
		newm(fn, _p_)
		return
	}
	if mp.spinning {
		throw("startm: m is spinning")
	}
	if mp.nextp != 0 {
		throw("startm: m has p")
	}
	if spinning && !runqempty(_p_) {
		throw("startm: p has runnable gs")
	}
	// The caller incremented nmspinning, so set m.spinning in the new M.
	mp.spinning = spinning
	mp.nextp.set(_p_)
	notewakeup(&mp.park)
}

// 从 syscall 或 locked M 传递 P
// 总是在没有 P 下运行，所以不允许 write barrier
//go:nowritebarrierrec
func handoffp(_p_ *p) {
	// handoffp must start an M in any situation where
	// findrunnable would return a G to run on _p_.

	// if it has local work, start it straight away
	if !runqempty(_p_) || sched.runqsize != 0 {
		startm(_p_, false)
		return
	}
	// if it has GC work, start it straight away
	if gcBlackenEnabled != 0 && gcMarkWorkAvailable(_p_) {
		startm(_p_, false)
		return
	}
	// no local work, check that there are no spinning/idle M's,
	// otherwise our help is not required
	if atomic.Load(&sched.nmspinning)+atomic.Load(&sched.npidle) == 0 && atomic.Cas(&sched.nmspinning, 0, 1) { // TODO: fast atomic
		startm(_p_, true)
		return
	}
	lock(&sched.lock)
	if sched.gcwaiting != 0 {
		_p_.status = _Pgcstop
		sched.stopwait--
		if sched.stopwait == 0 {
			notewakeup(&sched.stopnote)
		}
		unlock(&sched.lock)
		return
	}
	if _p_.runSafePointFn != 0 && atomic.Cas(&_p_.runSafePointFn, 1, 0) {
		sched.safePointFn(_p_)
		sched.safePointWait--
		if sched.safePointWait == 0 {
			notewakeup(&sched.safePointNote)
		}
	}
	if sched.runqsize != 0 {
		unlock(&sched.lock)
		startm(_p_, false)
		return
	}
	// If this is the last running P and nobody is polling network,
	// need to wakeup another M to poll network.
	if sched.npidle == uint32(gomaxprocs-1) && atomic.Load64(&sched.lastpoll) != 0 {
		unlock(&sched.lock)
		startm(_p_, false)
		return
	}
	if when := nobarrierWakeTime(_p_); when != 0 {
		wakeNetPoller(when)
	}
	pidleput(_p_)
	unlock(&sched.lock)
}

// 尝试将一个或多个 P 唤醒来执行 G
// 当 G 可能运行时（newproc, ready）时调用该函数
func wakep() {
	// 对 spinning 线程保守一些，必要时只增加一个
	// 如果失败，则立即返回
	if !atomic.Cas(&sched.nmspinning, 0, 1) {
		return
	}
	startm(nil, true)
}

// 停止当前正在执行锁住的 g 的 m 的执行，直到 g 重新变为 runnable。
// 返回获得的 P
func stoplockedm() {
	_g_ := getg()

	if _g_.m.lockedg == 0 || _g_.m.lockedg.ptr().lockedm.ptr() != _g_.m {
		throw("stoplockedm: inconsistent locking")
	}
	if _g_.m.p != 0 {
		// 调度其他 M 来运行此 P
		_p_ := releasep()
		handoffp(_p_)
	}
	incidlelocked(1)
	// 等待直到其他线程可以再次调度 lockedg
	notesleep(&_g_.m.park)
	noteclear(&_g_.m.park)
	status := readgstatus(_g_.m.lockedg.ptr())
	if status&^_Gscan != _Grunnable {
		print("runtime:stoplockedm: g is not Grunnable or Gscanrunnable\n")
		dumpgstatus(_g_)
		throw("stoplockedm: not runnable")
	}
	acquirep(_g_.m.nextp.ptr())
	_g_.m.nextp = 0
}

// Schedules the locked m to run the locked gp.
// May run during STW, so write barriers are not allowed.
//go:nowritebarrierrec
func startlockedm(gp *g) {
	_g_ := getg()

	mp := gp.lockedm.ptr()
	if mp == _g_.m {
		throw("startlockedm: locked to me")
	}
	if mp.nextp != 0 {
		throw("startlockedm: m has p")
	}
	// directly handoff current P to the locked m
	incidlelocked(-1)
	_p_ := releasep()
	mp.nextp.set(_p_)
	notewakeup(&mp.park)
	stopm()
}

// 为 stopTheWorld 停止当前的 m
// 当 world 重启完成后返回
func gcstopm() {
	_g_ := getg()

	if sched.gcwaiting == 0 {
		throw("gcstopm: not waiting for gc")
	}
	if _g_.m.spinning {
		_g_.m.spinning = false
		// OK to just drop nmspinning here,
		// startTheWorld will unpark threads as necessary.
		if int32(atomic.Xadd(&sched.nmspinning, -1)) < 0 {
			throw("gcstopm: negative nmspinning")
		}
	}
	_p_ := releasep()
	lock(&sched.lock)
	_p_.status = _Pgcstop
	sched.stopwait--
	if sched.stopwait == 0 {
		notewakeup(&sched.stopnote)
	}
	unlock(&sched.lock)
	stopm()
}

// 在当前 M 上调度 gp。
// 如果 inheritTime 为 true，则 gp 继承剩余的时间片。否则从一个新的时间片开始
// 永不返回。
//
// 该函数允许 write barrier 因为它是在 acquire P 之后的调用的。
//
//go:yeswritebarrierrec
func execute(gp *g, inheritTime bool) {
	_g_ := getg()

	// Assign gp.m before entering _Grunning so running Gs have an
	// M.
	_g_.m.curg = gp
	gp.m = _g_.m
	// 将 g 正式切换为 _Grunning 状态
	casgstatus(gp, _Grunnable, _Grunning)
	gp.waitsince = 0
	gp.preempt = false
	gp.stackguard0 = gp.stack.lo + _StackGuard
	if !inheritTime {
		_g_.m.p.ptr().schedtick++
	}
	_g_.m.curg = gp
	gp.m = _g_.m

	// profiling 相关
	hz := sched.profilehz
	if _g_.m.profilehz != hz {
		setThreadCPUProfiler(hz)
	}

	// trace 相关
	if trace.enabled {
		// GoSysExit has to happen when we have a P, but before GoStart.
		// So we emit it here.
		if gp.syscallsp != 0 && gp.sysblocktraced {
			traceGoSysExit(gp.sysexitticks)
		}
		traceGoStart()
	}

	// 终于开始执行了
	gogo(&gp.sched)
}

// 寻找一个可运行的 goroutine 来执行。
// 尝试从其他的 P 偷取、从本地或者全局队列中获取、poll 网络
func findrunnable() (gp *g, inheritTime bool) {
	_g_ := getg()

	// 这里的条件与 handoffp 中的条件必须一致：
	// 如果 findrunnable 将返回 G 运行，handoffp 必须启动 M.

top:
	_p_ := _g_.m.p.ptr()

	// 如果在 gc，则 park 当前 m，直到被 unpark 后回到 top
	if sched.gcwaiting != 0 {
		gcstopm()
		goto top
	}
	if _p_.runSafePointFn != 0 {
		runSafePointFn()
	}

	now, pollUntil, _ := checkTimers(_p_, 0)

	if fingwait && fingwake {
		if gp := wakefing(); gp != nil {
			ready(gp, 0, true)
		}
	}

	// cgo 调用被终止，继续进入
	if *cgo_yield != nil {
		asmcgocall(*cgo_yield, nil)
	}

	// 取本地队列 local runq，如果已经拿到，立刻返回
	if gp, inheritTime := runqget(_p_); gp != nil {
		return gp, inheritTime
	}

	// 全局队列 global runq，如果已经拿到，立刻返回
	if sched.runqsize != 0 {
		lock(&sched.lock)
		gp := globrunqget(_p_, 0)
		unlock(&sched.lock)
		if gp != nil {
			return gp, false
		}
	}

	// Poll 网络，优先级比从其他 P 中偷要高。
	// 在我们尝试去其他 P 偷之前，这个 netpoll 只是一个优化。
	// 如果没有 waiter 或 netpoll 中的线程已被阻塞，则可以安全地跳过它。
	// 如果有任何类型的逻辑竞争与被阻塞的线程（例如它已经从 netpoll 返回，但尚未设置 lastpoll）
	// 该线程无论如何都将阻塞 netpoll。
	if netpollinited() && atomic.Load(&netpollWaiters) > 0 && atomic.Load64(&sched.lastpoll) != 0 {
		if list := netpoll(0); !list.empty() { // 无阻塞
			gp := list.pop()
			injectglist(&list)
			casgstatus(gp, _Gwaiting, _Grunnable)
			if trace.enabled {
				traceGoUnpark(gp, 0)
			}
			return gp, false
		}
	}

	// 从其他 P 中偷 work
	procs := uint32(gomaxprocs) // 获得 p 的数量
	ranTimer := false
	// 如果 spinning 状态下 m 的数量 >= busy 状态下 p 的数量，直接进入阻塞
	// 该步骤是有必要的，它用于当 GOMAXPROCS>>1 时但程序的并行机制很慢时
	// 昂贵的 CPU 消耗。
	if !_g_.m.spinning && 2*atomic.Load(&sched.nmspinning) >= procs-atomic.Load(&sched.npidle) {
		goto stop
	}

	// 如果 m 是 non-spinning 状态，切换为 spinning
	if !_g_.m.spinning {
		_g_.m.spinning = true
		atomic.Xadd(&sched.nmspinning, 1)
	}

	for i := 0; i < 4; i++ {
		// 随机偷
		for enum := stealOrder.start(fastrand()); !enum.done(); enum.next() {
			// 已经进入了 GC? 回到顶部，park 当前的 m
			if sched.gcwaiting != 0 {
				goto top
			}
			stealRunNextG := i > 2 // 如果偷了两轮都偷不到，便优先查找 ready 队列
			p2 := allp[enum.position()]
			if _p_ == p2 {
				continue
			}
			if gp := runqsteal(_p_, p2, stealRunNextG); gp != nil {
				// 总算偷到了，立即返回
				return gp, false
			}

			// Consider stealing timers from p2.
			// This call to checkTimers is the only place where
			// we hold a lock on a different P's timers.
			// Lock contention can be a problem here, so avoid
			// grabbing the lock if p2 is running and not marked
			// for preemption. If p2 is running and not being
			// preempted we assume it will handle its own timers.
			if i > 2 && shouldStealTimers(p2) {
				tnow, w, ran := checkTimers(p2, now)
				now = tnow
				if w != 0 && (pollUntil == 0 || w < pollUntil) {
					pollUntil = w
				}
				if ran {
					// Running the timers may have
					// made an arbitrary number of G's
					// ready and added them to this P's
					// local run queue. That invalidates
					// the assumption of runqsteal
					// that is always has room to add
					// stolen G's. So check now if there
					// is a local G to run.
					if gp, inheritTime := runqget(_p_); gp != nil {
						return gp, inheritTime
					}
					ranTimer = true
				}
			}
		}
	}
	if ranTimer {
		// Running a timer may have made some goroutine ready.
		goto top
	}

stop:

	// 没有任何 work 可做。
	// 如果我们在 GC mark 阶段，则可以安全的扫描并 blacken 对象
	// 然后便有 work 可做，运行 idle-time 标记而非直接放弃当前的 P。
	if gcBlackenEnabled != 0 && _p_.gcBgMarkWorker != 0 && gcMarkWorkAvailable(_p_) {
		_p_.gcMarkWorkerMode = gcMarkWorkerIdleMode
		gp := _p_.gcBgMarkWorker.ptr()
		casgstatus(gp, _Gwaiting, _Grunnable)
		if trace.enabled {
			traceGoUnpark(gp, 0)
		}
		return gp, false
	}

	delta := int64(-1)
	if pollUntil != 0 {
		// checkTimers ensures that polluntil > now.
		delta = pollUntil - now
	}

	// 仅限于 wasm
	// 如果一个回调返回后没有其他 goroutine 是苏醒的
	// 则暂停执行直到回调被触发。
	if beforeIdle(delta) {
		// 至少一个 goroutine 被唤醒
		goto top
	}

	// 放弃当前的 P 之前，对 allp 做一个快照
	// 一旦我们不再阻塞在 safe-point 时候，可以立刻在下面进行修改
	allpSnapshot := allp

	// 准备归还 p，对调度器加锁
	lock(&sched.lock)
	// 进入了 gc，回到顶部 park m
	if sched.gcwaiting != 0 || _p_.runSafePointFn != 0 {
		unlock(&sched.lock)
		goto top
	}

	// 全局队列中又发现了任务
	if sched.runqsize != 0 {
		gp := globrunqget(_p_, 0)
		unlock(&sched.lock)
		// 赶紧偷掉返回
		return gp, false
	}

	// 归还当前的 p
	if releasep() != _p_ {
		throw("findrunnable: wrong p")
	}

	// 将 p 放入 idle 链表
	pidleput(_p_)

	// 完成归还，解锁
	unlock(&sched.lock)

	// 这里要非常小心:
	// 线程从 spinning 到 non-spinning 状态的转换，可能与新 goroutine 的提交同时发生。
	// 我们必须首先降低 nmspinning，然后再次检查所有的 per-P 队列（并在期间伴随 #StoreLoad 内存屏障）
	// 如果反过来，其他线程可以在我们检查了所有的队列、然后提交一个 goroutine、再降低 nmspinning
	// 进而导致无法 unpark 一个线程来运行那个 goroutine 了。
	// 如果我们发现下面的新 work，我们需要恢复 m.spinning 作为重置的信号，
	// 以取消 park 新的工作线程（因为可能有多个 starving 的 goroutine）。
	// 但是，如果在发现新 work 后我们也观察到没有空闲 P，可以暂停当前线程
	// 因为系统已满载，因此不需要 spinning 线程。
	// 请参考此文件顶部 "工作线程 parking/unparking" 的注释
	wasSpinning := _g_.m.spinning
	if _g_.m.spinning {
		_g_.m.spinning = false
		if int32(atomic.Xadd(&sched.nmspinning, -1)) < 0 {
			throw("findrunnable: negative nmspinning")
		}
	}

	// 再次检查所有的 runqueue
	for _, _p_ := range allpSnapshot {
		// 如果这时本地队列不空
		if !runqempty(_p_) {
			// 重新获取 p
			lock(&sched.lock)
			_p_ = pidleget()
			unlock(&sched.lock)

			// 如果能获取到 p
			if _p_ != nil {

				// 绑定 p
				acquirep(_p_)

				// 如果此前已经被切换为 spinning
				if wasSpinning {
					// 重新切换回 non-spinning
					_g_.m.spinning = true
					atomic.Xadd(&sched.nmspinning, 1)
				}

				// 这时候是有 work 的，回到顶部重新 find g
				goto top
			}

			// 看来没有 idle 的 p，不需要重新 find g 了
			break
		}
	}

	// 再次检查 idle-priority GC work
	// 和上面重新找 runqueue 的逻辑类似
	if gcBlackenEnabled != 0 && gcMarkWorkAvailable(nil) {
		lock(&sched.lock)
		_p_ = pidleget()
		if _p_ != nil && _p_.gcBgMarkWorker == 0 {
			pidleput(_p_)
			_p_ = nil
		}
		unlock(&sched.lock)
		if _p_ != nil {
			acquirep(_p_)
			if wasSpinning {
				_g_.m.spinning = true
				atomic.Xadd(&sched.nmspinning, 1)
			}
			// Go back to idle GC check.
			goto stop
		}
	}

	// poll 网络
	// 和上面重新找 runqueue 的逻辑类似
	if netpollinited() && (atomic.Load(&netpollWaiters) > 0 || pollUntil != 0) && atomic.Xchg64(&sched.lastpoll, 0) != 0 {
		atomic.Store64(&sched.pollUntil, uint64(pollUntil))
		if _g_.m.p != 0 {
			throw("findrunnable: netpoll with p")
		}
		if _g_.m.spinning {
			throw("findrunnable: netpoll with spinning")
		}
		if faketime != 0 {
			// When using fake time, just poll.
			delta = 0
		}
		list := netpoll(delta) // block until new work is available
		atomic.Store64(&sched.pollUntil, 0)
		atomic.Store64(&sched.lastpoll, uint64(nanotime()))
		if faketime != 0 && list.empty() {
			// Using fake time and nothing is ready; stop M.
			// When all M's stop, checkdead will call timejump.
			stopm()
			goto top
		}
		lock(&sched.lock)
		_p_ = pidleget()
		unlock(&sched.lock)
		if _p_ == nil {
			injectglist(&list)
		} else {
			acquirep(_p_)
			if !list.empty() {
				gp := list.pop()
				injectglist(&list)
				casgstatus(gp, _Gwaiting, _Grunnable)
				if trace.enabled {
					traceGoUnpark(gp, 0)
				}
				return gp, false
			}
			if wasSpinning {
				_g_.m.spinning = true
				atomic.Xadd(&sched.nmspinning, 1)
			}
			goto top
		}
	} else if pollUntil != 0 && netpollinited() {
		pollerPollUntil := int64(atomic.Load64(&sched.pollUntil))
		if pollerPollUntil == 0 || pollerPollUntil > pollUntil {
			netpollBreak()
		}
	}

	// 真的什么都没找到
	// park 当前的 m
	stopm()
	goto top
}

// pollWork reports whether there is non-background work this P could
// be doing. This is a fairly lightweight check to be used for
// background work loops, like idle GC. It checks a subset of the
// conditions checked by the actual scheduler.
func pollWork() bool {
	if sched.runqsize != 0 {
		return true
	}
	p := getg().m.p.ptr()
	if !runqempty(p) {
		return true
	}
	if netpollinited() && atomic.Load(&netpollWaiters) > 0 && sched.lastpoll != 0 {
		if list := netpoll(0); !list.empty() {
			injectglist(&list)
			return true
		}
	}
	return false
}

// wakeNetPoller wakes up the thread sleeping in the network poller,
// if there is one, and if it isn't going to wake up anyhow before
// the when argument.
// 如果有，并且在 when 参数之前无论如何都不会唤醒 wakeNetPoller，它将唤醒睡眠在网络轮询器中的线程。
func wakeNetPoller(when int64) {
	if atomic.Load64(&sched.lastpoll) == 0 {
		// In findrunnable we ensure that when polling the pollUntil
		// field is either zero or the time to which the current
		// poll is expected to run. This can have a spurious wakeup
		// but should never miss a wakeup.
		pollerPollUntil := int64(atomic.Load64(&sched.pollUntil))
		if pollerPollUntil == 0 || pollerPollUntil > when {
			netpollBreak()
		}
	}
}

func resetspinning() {
	_g_ := getg()
	if !_g_.m.spinning {
		throw("resetspinning: not a spinning m")
	}
	_g_.m.spinning = false
	nmspinning := atomic.Xadd(&sched.nmspinning, -1)
	if int32(nmspinning) < 0 {
		throw("findrunnable: negative nmspinning")
	}
	// M wakeup policy is deliberately somewhat conservative, so check if we
	// need to wakeup another P here. See "Worker thread parking/unparking"
	// comment at the top of the file for details.
	if nmspinning == 0 && atomic.Load(&sched.npidle) > 0 {
		wakep()
	}
}

// 将 runnable g 列表插入到调度器中，并清空 glist
// 可以与 gc 并发运行
func injectglist(glist *gList) {
	if glist.empty() {
		return
	}
	if trace.enabled {
		for gp := glist.head.ptr(); gp != nil; gp = gp.schedlink.ptr() {
			traceGoUnpark(gp, 0)
		}
	}
	lock(&sched.lock)
	var n int
	for n = 0; !glist.empty(); n++ {
		gp := glist.pop()
		casgstatus(gp, _Gwaiting, _Grunnable)
		globrunqput(gp)
	}
	unlock(&sched.lock)
	for ; n != 0 && sched.npidle != 0; n-- {
		startm(nil, false)
	}
	*glist = gList{}
}

// 调度器的一轮：找到 runnable goroutine 并进行执行且永不返回
func schedule() {
	_g_ := getg()

	if _g_.m.locks != 0 {
		throw("schedule: holding locks")
	}

	// m.lockedg 会在 lockosthread 下变为非零
	if _g_.m.lockedg != 0 {
		stoplockedm()
		execute(_g_.m.lockedg.ptr(), false) // 永不返回
	}

	// 我们不应该调度一个正在执行 cgo 调用的 g
	// 因为 cgo 在使用当前 m 的 g0 栈
	if _g_.m.incgo {
		throw("schedule: in cgo")
	}

top:
	pp := _g_.m.p.ptr()
	pp.preempt = false

	if sched.gcwaiting != 0 {
		// 如果还在等待 gc，则
		gcstopm()
		goto top
	}
	if pp.runSafePointFn != 0 {
		runSafePointFn()
	}

	// Sanity check: if we are spinning, the run queue should be empty.
	// Check this before calling checkTimers, as that might call
	// goready to put a ready goroutine on the local run queue.
	if _g_.m.spinning && (pp.runnext != 0 || pp.runqhead != pp.runqtail) {
		throw("schedule: spinning with local work")
	}

	checkTimers(pp, 0)

	var gp *g
	var inheritTime bool

	// Normal goroutines will check for need to wakeP in ready,
	// but GCworkers and tracereaders will not, so the check must
	// be done here instead.
	tryWakeP := false
	if trace.enabled || trace.shutdown {
		gp = traceReader()
		if gp != nil {
			casgstatus(gp, _Gwaiting, _Grunnable)
			traceGoUnpark(gp, 0)
			tryWakeP = true
		}
	}

	// 正在 gc，去找 gc 的 g
	if gp == nil && gcBlackenEnabled != 0 {
		gp = gcController.findRunnableGCWorker(_g_.m.p.ptr())
		tryWakeP = tryWakeP || gp != nil
	}

	if gp == nil {
		// 说明不在 gc
		//
		// 每调度 61 次，就检查一次全局队列，保证公平性
		// 否则两个 goroutine 可以通过互相 respawn 一直占领本地的 runqueue
		if _g_.m.p.ptr().schedtick%61 == 0 && sched.runqsize > 0 {
			lock(&sched.lock)
			// 从全局队列中偷 g
			gp = globrunqget(_g_.m.p.ptr(), 1)
			unlock(&sched.lock)
		}
	}
	if gp == nil {
		// 说明不在 gc
		// 两种情况：
		//  1. 普通取
		//  2. 全局队列中偷不到的取
		// 从本地队列中取
		gp, inheritTime = runqget(_g_.m.p.ptr())
		// We can see gp != nil here even if the M is spinning,
		// if checkTimers added a local goroutine via goready.
	}
	if gp == nil {
		// 如果偷都偷不到，则休眠，在此阻塞
		gp, inheritTime = findrunnable()
	}

	// 这个时候一定取到 g 了

	if _g_.m.spinning {
		// 如果 m 是 spinning 状态，则
		//   1. 从 spinning -> non-spinning
		//   2. 在没有 spinning 的 m 的情况下，再多创建一个新的 spinning m
		resetspinning()
	}

	if sched.disable.user && !schedEnabled(gp) {
		// Scheduling of this goroutine is disabled. Put it on
		// the list of pending runnable goroutines for when we
		// re-enable user scheduling and look again.
		lock(&sched.lock)
		if schedEnabled(gp) {
			// Something re-enabled scheduling while we
			// were acquiring the lock.
			unlock(&sched.lock)
		} else {
			sched.disable.runnable.pushBack(gp)
			sched.disable.n++
			unlock(&sched.lock)
			goto top
		}
	}

	// If about to schedule a not-normal goroutine (a GCworker or tracereader),
	// wake a P if there is one.
	if tryWakeP {
		if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 {
			wakep()
		}
	}
	if gp.lockedm != 0 {
		// 如果 g 需要 lock 到 m 上，则会将当前的 p
		// 给这个要 lock 的 g
		// 然后阻塞等待一个新的 p
		startlockedm(gp)
		goto top
	}

	// 开始执行
	execute(gp, inheritTime)
}

// dropg 移除 m 与当前 goroutine m->curg（简称 gp ）之间的关联。
// 通常，调用方将 gp 的状态设置为非 _Grunning 后立即调用 dropg 完成工作。
// 调用方也有责任在 gp 将使用 ready 时重新启动时进行相关安排。
// 在调用 dropg 并安排 gp ready 好后，调用者可以做其他工作，但最终应该
// 调用 schedule 来重新启动此 m 上的 goroutine 的调度。
func dropg() {
	_g_ := getg()

	setMNoWB(&_g_.m.curg.m, nil)
	setGNoWB(&_g_.m.curg, nil)
}

// checkTimers runs any timers for the P that are ready.
// If now is not 0 it is the current time.
// It returns the current time or 0 if it is not known,
// and the time when the next timer should run or 0 if there is no next timer,
// and reports whether it ran any timers.
// If the time when the next timer should run is not 0,
// it is always larger than the returned time.
// We pass now in and out to avoid extra calls of nanotime.
//go:yeswritebarrierrec
func checkTimers(pp *p, now int64) (rnow, pollUntil int64, ran bool) {
	// If there are no timers to adjust, and the first timer on
	// the heap is not yet ready to run, then there is nothing to do.
	if atomic.Load(&pp.adjustTimers) == 0 {
		next := int64(atomic.Load64(&pp.timer0When))
		if next == 0 {
			return now, 0, false
		}
		if now == 0 {
			now = nanotime()
		}
		if now < next {
			return now, next, false
		}
	}

	lock(&pp.timersLock)

	adjusttimers(pp)

	rnow = now
	if len(pp.timers) > 0 {
		if rnow == 0 {
			rnow = nanotime()
		}
		for len(pp.timers) > 0 {
			// Note that runtimer may temporarily unlock
			// pp.timersLock.
			if tw := runtimer(pp, rnow); tw != 0 {
				if tw > 0 {
					pollUntil = tw
				}
				break
			}
			ran = true
		}
	}

	// If this is the local P, and there are a lot of deleted timers,
	// clear them out. We only do this for the local P to reduce
	// lock contention on timersLock.
	if pp == getg().m.p.ptr() && int(atomic.Load(&pp.deletedTimers)) > len(pp.timers)/4 {
		clearDeletedTimers(pp)
	}

	unlock(&pp.timersLock)

	return rnow, pollUntil, ran
}

// shouldStealTimers reports whether we should try stealing the timers from p2.
// We don't steal timers from a running P that is not marked for preemption,
// on the assumption that it will run its own timers. This reduces
// contention on the timers lock.
func shouldStealTimers(p2 *p) bool {
	if p2.status != _Prunning {
		return true
	}
	mp := p2.m.ptr()
	if mp == nil || mp.locks > 0 {
		return false
	}
	gp := mp.curg
	if gp == nil || gp.atomicstatus != _Grunning || !gp.preempt {
		return false
	}
	return true
}

func parkunlock_c(gp *g, lock unsafe.Pointer) bool {
	unlock((*mutex)(lock))
	return true
}

// park continuation on g0.
func park_m(gp *g) {
	_g_ := getg()

	if trace.enabled {
		traceGoPark(_g_.m.waittraceev, _g_.m.waittraceskip)
	}

	casgstatus(gp, _Grunning, _Gwaiting)
	dropg()

	if fn := _g_.m.waitunlockf; fn != nil {
		ok := fn(gp, _g_.m.waitlock)
		_g_.m.waitunlockf = nil
		_g_.m.waitlock = nil
		if !ok {
			if trace.enabled {
				traceGoUnpark(gp, 2)
			}
			casgstatus(gp, _Gwaiting, _Grunnable)
			execute(gp, true) // Schedule it back, never returns.
		}
	}
	schedule()
}

func goschedImpl(gp *g) {
	// 放弃当前 g 的运行状态
	status := readgstatus(gp)
	if status&^_Gscan != _Grunning {
		dumpgstatus(gp)
		throw("bad g status")
	}
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

// Gosched 在 g0 上继续执行
func gosched_m(gp *g) {
	if trace.enabled {
		traceGoSched()
	}
	goschedImpl(gp)
}

// goschedguarded is a forbidden-states-avoided version of gosched_m
func goschedguarded_m(gp *g) {

	if !canPreemptM(gp.m) {
		gogo(&gp.sched) // never return
	}

	if trace.enabled {
		traceGoSched()
	}
	goschedImpl(gp)
}

func gopreempt_m(gp *g) {
	if trace.enabled {
		traceGoPreempt()
	}
	goschedImpl(gp)
}

// preemptPark parks gp and puts it in _Gpreempted.
//
//go:systemstack
func preemptPark(gp *g) {
	if trace.enabled {
		traceGoPark(traceEvGoBlock, 0)
	}
	status := readgstatus(gp)
	if status&^_Gscan != _Grunning {
		dumpgstatus(gp)
		throw("bad g status")
	}
	gp.waitreason = waitReasonPreempted
	// Transition from _Grunning to _Gscan|_Gpreempted. We can't
	// be in _Grunning when we dropg because then we'd be running
	// without an M, but the moment we're in _Gpreempted,
	// something could claim this G before we've fully cleaned it
	// up. Hence, we set the scan bit to lock down further
	// transitions until we can dropg.
	casGToPreemptScan(gp, _Grunning, _Gscan|_Gpreempted)
	dropg()
	casfrom_Gscanstatus(gp, _Gscan|_Gpreempted, _Gpreempted)
	schedule()
}

// goyield is like Gosched, but it:
// - emits a GoPreempt trace event instead of a GoSched trace event
// - puts the current G on the runq of the current P instead of the globrunq
func goyield() {
	checkTimeouts()
	mcall(goyield_m)
}

func goyield_m(gp *g) {
	if trace.enabled {
		traceGoPreempt()
	}
	pp := gp.m.p.ptr()
	casgstatus(gp, _Grunning, _Grunnable)
	dropg()
	runqput(pp, gp, false)
	schedule()
}

// 完成当前 goroutine 的执行
func goexit1() {

	// race 和 trace 相关
	if raceenabled {
		racegoend()
	}
	if trace.enabled {
		traceGoEnd()
	}

	// 开始收尾工作
	mcall(goexit0)
}

// goexit 继续在 g0 上执行
func goexit0(gp *g) {
	_g_ := getg()

	// 切换当前的 g 为 _Gdead
	casgstatus(gp, _Grunning, _Gdead)
	if isSystemGoroutine(gp, false) {
		atomic.Xadd(&sched.ngsys, -1)
	}

	// 清理
	gp.m = nil
	locked := gp.lockedm != 0
	gp.lockedm = 0
	_g_.m.lockedg = 0
	gp.preemptStop = false
	gp.paniconfault = false
	gp._defer = nil // 应该已经为 true，但以防万一
	gp._panic = nil // Goexit 中 panic 则不为 nil， 指向栈分配的数据
	gp.writebuf = nil
	gp.waitreason = 0
	gp.param = nil
	gp.labels = nil
	gp.timer = nil

	if gcBlackenEnabled != 0 && gp.gcAssistBytes > 0 {
		// 刷新 assist credit 到全局池。
		// 如果应用在快速创建 goroutine，这可以为 pacing 提供更好的信息。
		scanCredit := int64(gcController.assistWorkPerByte * float64(gp.gcAssistBytes))
		atomic.Xaddint64(&gcController.bgScanCredit, scanCredit)
		gp.gcAssistBytes = 0
	}

	// 解绑 m 和 g
	dropg()

	if GOARCH == "wasm" { // wasm 目前还没有线程支持
		// 将 g 扔进 gfree 链表中等待复用
		gfput(_g_.m.p.ptr(), gp)
		// 再次进行调度
		schedule() // 永不返回
	}

	if _g_.m.lockedInt != 0 {
		print("invalid m->lockedInt = ", _g_.m.lockedInt, "\n")
		throw("internal lockOSThread error")
	}

	// 将 g 扔进 gfree 链表中等待复用
	gfput(_g_.m.p.ptr(), gp)

	if locked {
		// 该 goroutine 可能在当前线程上锁住，因为它可能导致了不正常的内核状态
		// 这时候 kill 该线程，而非将 m 放回到线程池。

		// 此举会返回到 mstart，从而释放当前的 P 并退出该线程
		if GOOS != "plan9" { // See golang.org/issue/22227.
			gogo(&_g_.m.g0.sched)
		} else {
			// 因为我们可能已重用此线程结束，在 plan9 上清除 lockedExt
			_g_.m.lockedExt = 0
		}
	}

	// 再次进行调度
	schedule()
}

// save 更新了 getg().sched 的 pc 和 sp 的指向，并允许 gogo 能够恢复到 pc 和 sp
//
// save 不允许 write barrier 因为 write barrier 会破坏 getg().sched
//
//go:nosplit
//go:nowritebarrierrec
func save(pc, sp uintptr) {
	_g_ := getg()

	// 保存当前运行现场
	_g_.sched.pc = pc
	_g_.sched.sp = sp
	_g_.sched.lr = 0
	_g_.sched.ret = 0

	// 保存 g
	_g_.sched.g = guintptr(unsafe.Pointer(_g_))

	// 我们必须确保 ctxt 为零，但这里不允许 write barrier。
	// 所以这里只是做一个断言
	if _g_.sched.ctxt != nil {
		badctxt()
	}
}

// goroutine g 即将进入系统调用。记录它不再使用 cpu 了。
// 此函数只能从 go syscall 库和 cgocall 调用，而不是从运行时使用的低级系统调用中调用。
//
// Entersyscall不允许分段栈：gosave必须使得 g.sched 指的是调用者的栈段，
// 因为 enteryscall 将在之后立即返回。
//
// 没有任何 enteryscall 调用可以对栈分段。
// 在对 syscall 的活动调用期间，我们无法安全地移动栈，因为我们不知道哪个 uintptr 参数
// 确实是指针（返回栈）。
// 在实践中，这意味着我们使 fast path 通过 enteryscall 执行无分段事务，而 slow path
// 必须使用 systemstack 在系统堆栈上运行更大的东西。
//
// reentersyscall 是 cgo 回调使用的入口点，其中显式保存的 SP 和 PC 已恢复。
// 当从调用栈中的函数调用 exitsyscall 而不是父函数时，需要这样做，因为 g.syscallsp
// 必须始终指向有效的堆栈帧。下面的 enteryscall 是系统调用的正常入口点，它从调用者获取 SP 和 PC。
//
// Syscall tracing:
// At the start of a syscall we emit traceGoSysCall to capture the stack trace.
// If the syscall does not block, that is it, we do not emit any other events.
// If the syscall blocks (that is, P is retaken), retaker emits traceGoSysBlock;
// when syscall returns we emit traceGoSysExit and when the goroutine starts running
// (potentially instantly, if exitsyscallfast returns true) we emit traceGoStart.
// To ensure that traceGoSysExit is emitted strictly after traceGoSysBlock,
// we remember current value of syscalltick in m (_g_.m.syscalltick = _g_.m.p.ptr().syscalltick),
// whoever emits traceGoSysBlock increments p.syscalltick afterwards;
// and we wait for the increment before emitting traceGoSysExit.
// Note that the increment is done even if tracing is not enabled,
// because tracing can be enabled in the middle of syscall. We don't want the wait to hang.
//
//go:nosplit
func reentersyscall(pc, sp uintptr) {
	_g_ := getg()

	// Disable preemption because during this function g is in Gsyscall status,
	// but can have inconsistent g->sched, do not let GC observe it.
	_g_.m.locks++

	// Entersyscall must not call any function that might split/grow the stack.
	// (See details in comment above.)
	// Catch calls that might, by replacing the stack guard with something that
	// will trip any stack check and leaving a flag to tell newstack to die.
	_g_.stackguard0 = stackPreempt
	_g_.throwsplit = true

	// Leave SP around for GC and traceback.
	save(pc, sp)
	_g_.syscallsp = sp
	_g_.syscallpc = pc
	casgstatus(_g_, _Grunning, _Gsyscall)
	if _g_.syscallsp < _g_.stack.lo || _g_.stack.hi < _g_.syscallsp {
		systemstack(func() {
			print("entersyscall inconsistent ", hex(_g_.syscallsp), " [", hex(_g_.stack.lo), ",", hex(_g_.stack.hi), "]\n")
			throw("entersyscall")
		})
	}

	if trace.enabled {
		systemstack(traceGoSysCall)
		// systemstack itself clobbers g.sched.{pc,sp} and we might
		// need them later when the G is genuinely blocked in a
		// syscall
		save(pc, sp)
	}

	if atomic.Load(&sched.sysmonwait) != 0 {
		systemstack(entersyscall_sysmon)
		save(pc, sp)
	}

	if _g_.m.p.ptr().runSafePointFn != 0 {
		// runSafePointFn may stack split if run on this stack
		systemstack(runSafePointFn)
		save(pc, sp)
	}

	_g_.m.syscalltick = _g_.m.p.ptr().syscalltick
	_g_.sysblocktraced = true
	_g_.m.mcache = nil
	pp := _g_.m.p.ptr()
	pp.m = 0
	_g_.m.oldp.set(pp)
	_g_.m.p = 0
	atomic.Store(&pp.status, _Psyscall)
	if sched.gcwaiting != 0 {
		systemstack(entersyscall_gcwait)
		save(pc, sp)
	}

	_g_.m.locks--
}

// 标准系统调用入口，用于 go syscall 库以及普通的 cgo 调用
//
// This is exported via linkname to assembly in the syscall package.
//
//go:nosplit
//go:linkname entersyscall
func entersyscall() {
	reentersyscall(getcallerpc(), getcallersp())
}

func entersyscall_sysmon() {
	lock(&sched.lock)
	if atomic.Load(&sched.sysmonwait) != 0 {
		atomic.Store(&sched.sysmonwait, 0)
		notewakeup(&sched.sysmonnote)
	}
	unlock(&sched.lock)
}

func entersyscall_gcwait() {
	_g_ := getg()
	_p_ := _g_.m.oldp.ptr()

	lock(&sched.lock)
	if sched.stopwait > 0 && atomic.Cas(&_p_.status, _Psyscall, _Pgcstop) {
		if trace.enabled {
			traceGoSysBlock(_p_)
			traceProcStop(_p_)
		}
		_p_.syscalltick++
		if sched.stopwait--; sched.stopwait == 0 {
			notewakeup(&sched.stopnote)
		}
	}
	unlock(&sched.lock)
}

// The same as entersyscall(), but with a hint that the syscall is blocking.
//go:nosplit
func entersyscallblock() {
	_g_ := getg()

	_g_.m.locks++ // see comment in entersyscall
	_g_.throwsplit = true
	_g_.stackguard0 = stackPreempt // see comment in entersyscall
	_g_.m.syscalltick = _g_.m.p.ptr().syscalltick
	_g_.sysblocktraced = true
	_g_.m.p.ptr().syscalltick++

	// Leave SP around for GC and traceback.
	pc := getcallerpc()
	sp := getcallersp()
	save(pc, sp)
	_g_.syscallsp = _g_.sched.sp
	_g_.syscallpc = _g_.sched.pc
	if _g_.syscallsp < _g_.stack.lo || _g_.stack.hi < _g_.syscallsp {
		sp1 := sp
		sp2 := _g_.sched.sp
		sp3 := _g_.syscallsp
		systemstack(func() {
			print("entersyscallblock inconsistent ", hex(sp1), " ", hex(sp2), " ", hex(sp3), " [", hex(_g_.stack.lo), ",", hex(_g_.stack.hi), "]\n")
			throw("entersyscallblock")
		})
	}
	casgstatus(_g_, _Grunning, _Gsyscall)
	if _g_.syscallsp < _g_.stack.lo || _g_.stack.hi < _g_.syscallsp {
		systemstack(func() {
			print("entersyscallblock inconsistent ", hex(sp), " ", hex(_g_.sched.sp), " ", hex(_g_.syscallsp), " [", hex(_g_.stack.lo), ",", hex(_g_.stack.hi), "]\n")
			throw("entersyscallblock")
		})
	}

	systemstack(entersyscallblock_handoff)

	// Resave for traceback during blocked call.
	save(getcallerpc(), getcallersp())

	_g_.m.locks--
}

func entersyscallblock_handoff() {
	if trace.enabled {
		traceGoSysCall()
		traceGoSysBlock(getg().m.p.ptr())
	}
	handoffp(releasep())
}

// goroutine g 退出其系统调用。
// 为其再次安排一个 cpu。
// 这个调用只从 go syscall 库调用，不能从运行时其他低级系统调用使用。
//
// write barrier 不被允许，因为我们的 P 可能已经被偷走了
//
// This is exported via linkname to assembly in the syscall package.
//
//go:nosplit
//go:nowritebarrierrec
//go:linkname exitsyscall
func exitsyscall() {
	_g_ := getg()

	_g_.m.locks++ // see comment in entersyscall
	if getcallersp() > _g_.syscallsp {
		throw("exitsyscall: syscall frame is no longer valid")
	}

	_g_.waitsince = 0
	oldp := _g_.m.oldp.ptr()
	_g_.m.oldp = 0
	if exitsyscallfast(oldp) {
		if _g_.m.mcache == nil {
			throw("lost mcache")
		}
		if trace.enabled {
			if oldp != _g_.m.p.ptr() || _g_.m.syscalltick != _g_.m.p.ptr().syscalltick {
				systemstack(traceGoStart)
			}
		}
		// There's a cpu for us, so we can run.
		_g_.m.p.ptr().syscalltick++
		// We need to cas the status and scan before resuming...
		casgstatus(_g_, _Gsyscall, _Grunning)

		// Garbage collector isn't running (since we are),
		// so okay to clear syscallsp.
		_g_.syscallsp = 0
		_g_.m.locks--
		if _g_.preempt {
			// restore the preemption request in case we've cleared it in newstack
			_g_.stackguard0 = stackPreempt
		} else {
			// otherwise restore the real _StackGuard, we've spoiled it in entersyscall/entersyscallblock
			_g_.stackguard0 = _g_.stack.lo + _StackGuard
		}
		_g_.throwsplit = false

		if sched.disable.user && !schedEnabled(_g_) {
			// Scheduling of this goroutine is disabled.
			Gosched()
		}

		return
	}

	_g_.sysexitticks = 0
	if trace.enabled {
		// Wait till traceGoSysBlock event is emitted.
		// This ensures consistency of the trace (the goroutine is started after it is blocked).
		for oldp != nil && oldp.syscalltick == _g_.m.syscalltick {
			osyield()
		}
		// We can't trace syscall exit right now because we don't have a P.
		// Tracing code can invoke write barriers that cannot run without a P.
		// So instead we remember the syscall exit time and emit the event
		// in execute when we have a P.
		_g_.sysexitticks = cputicks()
	}

	_g_.m.locks--

	// 调用调度器
	mcall(exitsyscall0)

	if _g_.m.mcache == nil {
		throw("lost mcache")
	}

	// Scheduler returned, so we're allowed to run now.
	// Delete the syscallsp information that we left for
	// the garbage collector during the system call.
	// Must wait until now because until gosched returns
	// we don't know for sure that the garbage collector
	// is not running.
	_g_.syscallsp = 0
	_g_.m.p.ptr().syscalltick++
	_g_.throwsplit = false
}

//go:nosplit
func exitsyscallfast(oldp *p) bool {
	_g_ := getg()

	// Freezetheworld sets stopwait but does not retake P's.
	if sched.stopwait == freezeStopWait {
		return false
	}

	// Try to re-acquire the last P.
	if oldp != nil && oldp.status == _Psyscall && atomic.Cas(&oldp.status, _Psyscall, _Pidle) {
		// There's a cpu for us, so we can run.
		wirep(oldp)
		exitsyscallfast_reacquired()
		return true
	}

	// Try to get any other idle P.
	if sched.pidle != 0 {
		var ok bool
		systemstack(func() {
			ok = exitsyscallfast_pidle()
			if ok && trace.enabled {
				if oldp != nil {
					// Wait till traceGoSysBlock event is emitted.
					// This ensures consistency of the trace (the goroutine is started after it is blocked).
					for oldp.syscalltick == _g_.m.syscalltick {
						osyield()
					}
				}
				traceGoSysExit(0)
			}
		})
		if ok {
			return true
		}
	}
	return false
}

// exitsyscallfast_reacquired is the exitsyscall path on which this G
// has successfully reacquired the P it was running on before the
// syscall.
//
//go:nosplit
func exitsyscallfast_reacquired() {
	_g_ := getg()
	if _g_.m.syscalltick != _g_.m.p.ptr().syscalltick {
		if trace.enabled {
			// The p was retaken and then enter into syscall again (since _g_.m.syscalltick has changed).
			// traceGoSysBlock for this syscall was already emitted,
			// but here we effectively retake the p from the new syscall running on the same p.
			systemstack(func() {
				// Denote blocking of the new syscall.
				traceGoSysBlock(_g_.m.p.ptr())
				// Denote completion of the current syscall.
				traceGoSysExit(0)
			})
		}
		_g_.m.p.ptr().syscalltick++
	}
}

func exitsyscallfast_pidle() bool {
	lock(&sched.lock)
	_p_ := pidleget()
	if _p_ != nil && atomic.Load(&sched.sysmonwait) != 0 {
		atomic.Store(&sched.sysmonwait, 0)
		notewakeup(&sched.sysmonnote)
	}
	unlock(&sched.lock)
	if _p_ != nil {
		acquirep(_p_)
		return true
	}
	return false
}

// exitsyscall slow path on g0.
// Failed to acquire P, enqueue gp as runnable.
//
//go:nowritebarrierrec
func exitsyscall0(gp *g) {
	_g_ := getg()

	casgstatus(gp, _Gsyscall, _Grunnable)
	dropg()
	lock(&sched.lock)
	var _p_ *p
	if schedEnabled(_g_) {
		_p_ = pidleget()
	}
	if _p_ == nil {
		globrunqput(gp)
	} else if atomic.Load(&sched.sysmonwait) != 0 {
		atomic.Store(&sched.sysmonwait, 0)
		notewakeup(&sched.sysmonnote)
	}
	unlock(&sched.lock)
	if _p_ != nil {
		acquirep(_p_)
		execute(gp, false) // Never returns.
	}
	if _g_.m.lockedg != 0 {
		// Wait until another thread schedules gp and so m again.
		stoplockedm()
		execute(gp, false) // Never returns.
	}
	stopm()
	schedule() // Never returns.
}

func beforefork() {
	gp := getg().m.curg

	// Block signals during a fork, so that the child does not run
	// a signal handler before exec if a signal is sent to the process
	// group. See issue #18600.
	gp.m.locks++
	msigsave(gp.m)
	sigblock()

	// This function is called before fork in syscall package.
	// Code between fork and exec must not allocate memory nor even try to grow stack.
	// Here we spoil g->_StackGuard to reliably detect any attempts to grow stack.
	// runtime_AfterFork will undo this in parent process, but not in child.
	gp.stackguard0 = stackFork
}

// Called from syscall package before fork.
//go:linkname syscall_runtime_BeforeFork syscall.runtime_BeforeFork
//go:nosplit
func syscall_runtime_BeforeFork() {
	systemstack(beforefork)
}

func afterfork() {
	gp := getg().m.curg

	// See the comments in beforefork.
	gp.stackguard0 = gp.stack.lo + _StackGuard

	msigrestore(gp.m.sigmask)

	gp.m.locks--
}

// Called from syscall package after fork in parent.
//go:linkname syscall_runtime_AfterFork syscall.runtime_AfterFork
//go:nosplit
func syscall_runtime_AfterFork() {
	systemstack(afterfork)
}

// inForkedChild 在处理子进程中的信号时是正确的。
// 这用于避免在我们使用 vfork 时调用 libc 函数。
var inForkedChild bool

// 在 syscall 包 fork 之后从子进程中调用。
// 它将非 sigignored 信号重置为默认处理程序，并恢复信号掩码以准备 exec。
// 因为这可能在 vfork 期间调用，因此可能暂时与父进程共享地址空间，
// 所以这不能更改任何全局变量或调用可能执行此操作的 C 代码。
//go:linkname syscall_runtime_AfterForkInChild syscall.runtime_AfterForkInChild
//go:nosplit
//go:nowritebarrierrec
func syscall_runtime_AfterForkInChild() {
	// 可以在这里更改 inForkedChild 中的全局变量，因为我们要将其更改回来。
	// 这里没有竞争，因为如果我们与父进程共享地址空间，则父进程不能同时运行。
	inForkedChild = true

	clearSignalHandlers()

	// 因为我们是子进程且是唯一运行的线程，所以我们知道没有其他任何方式修改 gp.m.sigmask。
	msigrestore(getg().m.sigmask)

	inForkedChild = false
}

// 从 syscall.Exec 开始前调用
//go:linkname syscall_runtime_BeforeExec syscall.runtime_BeforeExec
func syscall_runtime_BeforeExec() {
	// 在exec期间阻止创建线程。
	execLock.lock()
}

// 从 syscall.Exec 结束后调用
//go:linkname syscall_runtime_AfterExec syscall.runtime_AfterExec
func syscall_runtime_AfterExec() {
	execLock.unlock()
}

// 分配一个新的 g 结构, 包含一个 stacksize 字节的的栈
func malg(stacksize int32) *g {
	newg := new(g)
	if stacksize >= 0 {
		// 将 stacksize 舍入为 2 的指数
		stacksize = round2(_StackSystem + stacksize)

		systemstack(func() {
			newg.stack = stackalloc(uint32(stacksize))
		})
		newg.stackguard0 = newg.stack.lo + _StackGuard
		newg.stackguard1 = ^uintptr(0)
		// Clear the bottom word of the stack. We record g
		// there on gsignal stack during VDSO on ARM and ARM64.
		*(*uintptr)(unsafe.Pointer(newg.stack.lo)) = 0
	}
	return newg
}

// 创建一个 G 运行函数 fn，参数大小为 biz 字节
// 将其放至 G 队列等待运行
// 编译器会将 go 语句转化为该调用。
// 这时不能将栈进行分段，因为它假设了参数在 &fn 之后顺序有效；如果 stack 进行了分段
// 则他们不无法被拷贝
//go:nosplit
func newproc(siz int32, fn *funcval) {
	// 从 fn 的地址增加一个指针的长度，从而获取第一参数地址
	argp := add(unsafe.Pointer(&fn), sys.PtrSize)
	gp := getg()
	// 获取调用方 PC/IP 寄存器值
	pc := getcallerpc()

	// 用 g0 系统栈创建 goroutine 对象
	// 传递的参数包括 fn 函数入口地址, argp 参数起始地址, siz 参数长度, gp（g0），调用方 pc（goroutine）
	systemstack(func() {
		newproc1(fn, argp, siz, gp, pc)
	})
}

// 创建一个运行 fn 的新 g，具有 narg 字节大小的参数，从 argp 开始。
// callerps 是 go 语句的起始地址。新创建的 g 会被放入 g 的队列中等待运行。
func newproc1(fn *funcval, argp unsafe.Pointer, narg int32, callergp *g, callerpc uintptr) {
	_g_ := getg() // 因为是在系统栈运行所以此时的 g 为 g0

	if fn == nil {
		_g_.m.throwing = -1 // do not dump full stacks
		throw("go of nil func value")
	}

	acquirem() // 禁止这时 g 的 m 被抢占因为它可以在一个局部变量中保存 p
	siz := narg
	siz = (siz + 7) &^ 7

	// 必要时，可以分配并初始化一个更大的栈
	// 不值得：这几乎总是一个错误
	// 4*sizeof(uintreg): 在下方增加的额外空间
	// sizeof(uintreg): 调用者 LR (非 x86) 返回的地址 (x86 在 gostartcall 中)
	if siz >= _StackMin-4*sys.RegSize-sys.RegSize {
		throw("newproc: function arguments too large for new goroutine")
	}

	// 获得 p
	_p_ := _g_.m.p.ptr()
	// 根据 p 获得一个新的 g
	newg := gfget(_p_)

	// 初始化阶段，gfget 是不可能找到 g 的
	// 也可能运行中本来就已经耗尽了
	if newg == nil {
		// 创建一个拥有 _StackMin 大小的栈的 g
		newg = malg(_StackMin)
		// 将新创建的 g 从 _Gidle 更新为 _Gdead 状态
		casgstatus(newg, _Gidle, _Gdead)
		allgadd(newg) // 将 Gdead 状态的 g 添加到 allg，这样 GC 不会扫描未初始化的栈
	}
	// 检查新 g 的执行栈
	if newg.stack.hi == 0 {
		throw("newproc1: newg missing stack")
	}

	// 无论是取到的 g 还是新创建的 g，都应该是 _Gdead 状态
	if readgstatus(newg) != _Gdead {
		throw("newproc1: new g is not Gdead")
	}

	// 计算运行空间大小，对齐
	totalSize := 4*sys.RegSize + uintptr(siz) + sys.MinFrameSize // extra space in case of reads slightly beyond frame
	totalSize += -totalSize & (sys.SpAlign - 1)                  // align to spAlign

	// 确定 sp 和参数入栈位置
	sp := newg.stack.hi - totalSize
	spArg := sp

	// 非 x86 架构，不关心（见 traceback.go）
	if usesLR {
		// 调用方的 LR 寄存器
		*(*uintptr)(unsafe.Pointer(sp)) = 0
		prepGoExitFrame(sp)
		spArg += sys.MinFrameSize
	}

	// 处理参数，当有参数时，将参数拷贝到 goroutine 的执行栈中
	if narg > 0 {
		// 从 argp 参数开始的位置，复制 narg 个字节到 spArg（参数拷贝）
		memmove(unsafe.Pointer(spArg), argp, uintptr(narg))
		// 栈到栈的拷贝。
		// 如果启用了 write barrier 并且 源栈为灰色（目标始终为黑色），
		// 则执行 barrier 拷贝。
		// 因为目标栈上可能有垃圾，我们在 memmove 之后执行此操作。
		if writeBarrier.needed && !_g_.m.curg.gcscandone {
			f := findfunc(fn.fn)
			stkmap := (*stackmap)(funcdata(f, _FUNCDATA_ArgsPointerMaps))
			if stkmap.nbit > 0 {
				// 我们正位于序言部分，因此栈 map 索引总是 0
				bv := stackmapdata(stkmap, 0)
				bulkBarrierBitmap(spArg, spArg, uintptr(bv.n)*sys.PtrSize, 0, bv.bytedata)
			}
		}
	}

	// 清理、创建并初始化的 g 的运行现场
	memclrNoHeapPointers(unsafe.Pointer(&newg.sched), unsafe.Sizeof(newg.sched))
	newg.sched.sp = sp
	newg.stktopsp = sp
	newg.sched.pc = funcPC(goexit) + sys.PCQuantum // +PCQuantum 从而前一个指令还在相同的函数内
	newg.sched.g = guintptr(unsafe.Pointer(newg))
	gostartcallfn(&newg.sched, fn)

	// 初始化 g 的基本状态
	newg.gopc = callerpc
	newg.ancestors = saveAncestors(callergp) // 调试相关，追踪调用方
	newg.startpc = fn.fn                     // 入口 pc
	if _g_.m.curg != nil {
		newg.labels = _g_.m.curg.labels // 增加 profiler 标签
	}

	// 调试相关
	if isSystemGoroutine(newg, false) {
		atomic.Xadd(&sched.ngsys, +1)
	}
	// 现在将 g 更换为 _Grunnable 状态
	casgstatus(newg, _Gdead, _Grunnable)

	// 分配 goid
	if _p_.goidcache == _p_.goidcacheend {
		// Sched.goidgen 为最后一个分配的 id，相当于一个全局计数器
		// 这一批必须为 [sched.goidgen+1, sched.goidgen+GoidCacheBatch].
		// 启动时 sched.goidgen=0, 因此主 goroutine 的 goid 为 1
		_p_.goidcache = atomic.Xadd64(&sched.goidgen, _GoidCacheBatch)
		_p_.goidcache -= _GoidCacheBatch - 1
		_p_.goidcacheend = _p_.goidcache + _GoidCacheBatch
	}
	newg.goid = int64(_p_.goidcache)
	_p_.goidcache++

	// race / trace 相关
	if raceenabled {
		newg.racectx = racegostart(callerpc)
	}
	if trace.enabled {
		traceGoCreate(newg, newg.startpc)
	}

	// 将这里新创建的 g 放入 p 的本地队列或直接放入全局队列
	// true 表示放入执行队列的下一个，false 表示放入队尾
	runqput(_p_, newg, true)

	// 如果有空闲的 P、且 spinning 的 M 数量为 0，且主 goroutine 已经开始运行，则进行唤醒 p
	// 初始化阶段 mainStarted 为 false，所以 p 不会被唤醒
	if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 && mainStarted {
		wakep()
	}
	releasem(_g_.m)
}

// saveAncestors 复制给定调用者 g 的先前 ancestors
// 并将当前调用者的信息包含到正在创建的g的一组新追溯中
func saveAncestors(callergp *g) *[]ancestorInfo {
	// Copy all prior info, except for the root goroutine (goid 0).
	if debug.tracebackancestors <= 0 || callergp.goid == 0 {
		return nil
	}
	var callerAncestors []ancestorInfo
	if callergp.ancestors != nil {
		callerAncestors = *callergp.ancestors
	}
	n := int32(len(callerAncestors)) + 1
	if n > debug.tracebackancestors {
		n = debug.tracebackancestors
	}
	ancestors := make([]ancestorInfo, n)
	copy(ancestors[1:], callerAncestors)

	var pcs [_TracebackMaxFrames]uintptr
	npcs := gcallers(callergp, 0, pcs[:])
	ipcs := make([]uintptr, npcs)
	copy(ipcs, pcs[:])
	ancestors[0] = ancestorInfo{
		pcs:  ipcs,
		goid: callergp.goid,
		gopc: callergp.gopc,
	}

	ancestorsp := new([]ancestorInfo)
	*ancestorsp = ancestors
	return ancestorsp
}

// Put on gfree list.
// If local list is too long, transfer a batch to the global list.
func gfput(_p_ *p, gp *g) {
	if readgstatus(gp) != _Gdead {
		throw("gfput: bad status (not Gdead)")
	}

	stksize := gp.stack.hi - gp.stack.lo

	if stksize != _FixedStack {
		// non-standard stack size - free it.
		stackfree(gp.stack)
		gp.stack.lo = 0
		gp.stack.hi = 0
		gp.stackguard0 = 0
	}

	_p_.gFree.push(gp)
	_p_.gFree.n++
	if _p_.gFree.n >= 64 {
		lock(&sched.gFree.lock)
		for _p_.gFree.n >= 32 {
			_p_.gFree.n--
			gp = _p_.gFree.pop()
			if gp.stack.lo == 0 {
				sched.gFree.noStack.push(gp)
			} else {
				sched.gFree.stack.push(gp)
			}
			sched.gFree.n++
		}
		unlock(&sched.gFree.lock)
	}
}

// 从 gfree 链表中获取 g
// 如果 P 本地 gfree 链表为空，从调度器的全局 gfree 链表中取
func gfget(_p_ *p) *g {
retry:
	if _p_.gFree.empty() && (!sched.gFree.stack.empty() || !sched.gFree.noStack.empty()) {
		lock(&sched.gFree.lock)
		// 将一批空闲的 G 移动到 P
		for _p_.gFree.n < 32 {
			// 倾向于有栈的 G
			gp := sched.gFree.stack.pop()
			if gp == nil {
				gp = sched.gFree.noStack.pop()
				if gp == nil {
					break
				}
			}
			sched.gFree.n--
			_p_.gFree.push(gp)
			_p_.gFree.n++
		}
		unlock(&sched.gFree.lock)
		goto retry
	}
	gp := _p_.gFree.pop()
	if gp == nil {
		return nil
	}
	// 拿到一个 g
	_p_.gFree.n--
	// 查看是否需要分配运行栈
	if gp.stack.lo == 0 {
		// 栈可能从全局 gfree 链表中取得，栈已被 gfput 给释放，所以需要分配一个新的栈。
		// 栈分配发生在系统栈上
		systemstack(func() {
			gp.stack = stackalloc(_FixedStack)
		})
		// 计算栈边界
		gp.stackguard0 = gp.stack.lo + _StackGuard
	} else {
		if raceenabled {
			racemalloc(unsafe.Pointer(gp.stack.lo), gp.stack.hi-gp.stack.lo)
		}
		if msanenabled {
			msanmalloc(unsafe.Pointer(gp.stack.lo), gp.stack.hi-gp.stack.lo)
		}
	}
	return gp
}

// Purge all cached G's from gfree list to the global list.
func gfpurge(_p_ *p) {
	lock(&sched.gFree.lock)
	for !_p_.gFree.empty() {
		gp := _p_.gFree.pop()
		_p_.gFree.n--
		if gp.stack.lo == 0 {
			sched.gFree.noStack.push(gp)
		} else {
			sched.gFree.stack.push(gp)
		}
		sched.gFree.n++
	}
	unlock(&sched.gFree.lock)
}

// Breakpoint executes a breakpoint trap.
func Breakpoint() {
	breakpoint()
}

// dolockOSThread 在修改 m.locked 后由 LockOSThread 和 lockOSThread 调用。
// 在此调用期间不允许抢占，否则此函数中的 m 可能与调用者中的 m 不同。
//go:nosplit
func dolockOSThread() {
	if GOARCH == "wasm" {
		return // no threads on wasm yet
	}
	_g_ := getg()
	_g_.m.lockedg.set(_g_)
	_g_.lockedm.set(_g_.m)
}

//go:nosplit

// LockOSThread wires the calling goroutine to its current operating system thread.
// The calling goroutine will always execute in that thread,
// and no other goroutine will execute in it,
// until the calling goroutine has made as many calls to
// UnlockOSThread as to LockOSThread.
// If the calling goroutine exits without unlocking the thread,
// the thread will be terminated.
//
// All init functions are run on the startup thread. Calling LockOSThread
// from an init function will cause the main function to be invoked on
// that thread.
//
// A goroutine should call LockOSThread before calling OS services or
// non-Go library functions that depend on per-thread state.
func LockOSThread() {
	if atomic.Load(&newmHandoff.haveTemplateThread) == 0 && GOOS != "plan9" {
		// 如果我们需要从锁定的线程启动一个新线程，我们需要模板线程。
		// 当我们处于一个已知良好的状态时，立即启动它。
		startTemplateThread()
	}
	_g_ := getg()
	_g_.m.lockedExt++
	if _g_.m.lockedExt == 0 {
		_g_.m.lockedExt--
		panic("LockOSThread nesting overflow")
	}
	dolockOSThread()
}

//go:nosplit
func lockOSThread() {
	getg().m.lockedInt++
	dolockOSThread()
}

// dounlockOSThread 在更新 m->locked 后由 UnlockOSThread 和 unlockOSThread 调用。
// 在此调用期间不允许抢占，否则此函数中的 m 可能与调用者中的 m 不同。
//go:nosplit
func dounlockOSThread() {
	if GOARCH == "wasm" {
		return // no threads on wasm yet
	}
	_g_ := getg()
	if _g_.m.lockedInt != 0 || _g_.m.lockedExt != 0 {
		return
	}
	_g_.m.lockedg = 0
	_g_.lockedm = 0
}

//go:nosplit

// UnlockOSThread undoes an earlier call to LockOSThread.
// If this drops the number of active LockOSThread calls on the
// calling goroutine to zero, it unwires the calling goroutine from
// its fixed operating system thread.
// If there are no active LockOSThread calls, this is a no-op.
//
// Before calling UnlockOSThread, the caller must ensure that the OS
// thread is suitable for running other goroutines. If the caller made
// any permanent changes to the state of the thread that would affect
// other goroutines, it should not call this function and thus leave
// the goroutine locked to the OS thread until the goroutine (and
// hence the thread) exits.
func UnlockOSThread() {
	_g_ := getg()
	if _g_.m.lockedExt == 0 {
		return
	}
	_g_.m.lockedExt--
	dounlockOSThread()
}

//go:nosplit
func unlockOSThread() {
	_g_ := getg()
	if _g_.m.lockedInt == 0 {
		systemstack(badunlockosthread)
	}
	_g_.m.lockedInt--
	dounlockOSThread()
}

func badunlockosthread() {
	throw("runtime: internal error: misuse of lockOSThread/unlockOSThread")
}

func gcount() int32 {
	n := int32(allglen) - sched.gFree.n - int32(atomic.Load(&sched.ngsys))
	for _, _p_ := range allp {
		n -= _p_.gFree.n
	}

	// All these variables can be changed concurrently, so the result can be inconsistent.
	// But at least the current goroutine is running.
	if n < 1 {
		n = 1
	}
	return n
}

func mcount() int32 {
	return int32(sched.mnext - sched.nmfreed)
}

var prof struct {
	signalLock uint32
	hz         int32
}

func _System()                    { _System() }
func _ExternalCode()              { _ExternalCode() }
func _LostExternalCode()          { _LostExternalCode() }
func _GC()                        { _GC() }
func _LostSIGPROFDuringAtomic64() { _LostSIGPROFDuringAtomic64() }
func _VDSO()                      { _VDSO() }

// Called if we receive a SIGPROF signal.
// Called by the signal handler, may run during STW.
//go:nowritebarrierrec
func sigprof(pc, sp, lr uintptr, gp *g, mp *m) {
	if prof.hz == 0 {
		return
	}

	// On mips{,le}, 64bit atomics are emulated with spinlocks, in
	// runtime/internal/atomic. If SIGPROF arrives while the program is inside
	// the critical section, it creates a deadlock (when writing the sample).
	// As a workaround, create a counter of SIGPROFs while in critical section
	// to store the count, and pass it to sigprof.add() later when SIGPROF is
	// received from somewhere else (with _LostSIGPROFDuringAtomic64 as pc).
	if GOARCH == "mips" || GOARCH == "mipsle" || GOARCH == "arm" {
		if f := findfunc(pc); f.valid() {
			if hasPrefix(funcname(f), "runtime/internal/atomic") {
				cpuprof.lostAtomic++
				return
			}
		}
	}

	// Profiling runs concurrently with GC, so it must not allocate.
	// Set a trap in case the code does allocate.
	// Note that on windows, one thread takes profiles of all the
	// other threads, so mp is usually not getg().m.
	// In fact mp may not even be stopped.
	// See golang.org/issue/17165.
	getg().m.mallocing++

	// Define that a "user g" is a user-created goroutine, and a "system g"
	// is one that is m->g0 or m->gsignal.
	//
	// We might be interrupted for profiling halfway through a
	// goroutine switch. The switch involves updating three (or four) values:
	// g, PC, SP, and (on arm) LR. The PC must be the last to be updated,
	// because once it gets updated the new g is running.
	//
	// When switching from a user g to a system g, LR is not considered live,
	// so the update only affects g, SP, and PC. Since PC must be last, there
	// the possible partial transitions in ordinary execution are (1) g alone is updated,
	// (2) both g and SP are updated, and (3) SP alone is updated.
	// If SP or g alone is updated, we can detect the partial transition by checking
	// whether the SP is within g's stack bounds. (We could also require that SP
	// be changed only after g, but the stack bounds check is needed by other
	// cases, so there is no need to impose an additional requirement.)
	//
	// There is one exceptional transition to a system g, not in ordinary execution.
	// When a signal arrives, the operating system starts the signal handler running
	// with an updated PC and SP. The g is updated last, at the beginning of the
	// handler. There are two reasons this is okay. First, until g is updated the
	// g and SP do not match, so the stack bounds check detects the partial transition.
	// Second, signal handlers currently run with signals disabled, so a profiling
	// signal cannot arrive during the handler.
	//
	// When switching from a system g to a user g, there are three possibilities.
	//
	// First, it may be that the g switch has no PC update, because the SP
	// either corresponds to a user g throughout (as in asmcgocall)
	// or because it has been arranged to look like a user g frame
	// (as in cgocallback_gofunc). In this case, since the entire
	// transition is a g+SP update, a partial transition updating just one of
	// those will be detected by the stack bounds check.
	//
	// Second, when returning from a signal handler, the PC and SP updates
	// are performed by the operating system in an atomic update, so the g
	// update must be done before them. The stack bounds check detects
	// the partial transition here, and (again) signal handlers run with signals
	// disabled, so a profiling signal cannot arrive then anyway.
	//
	// Third, the common case: it may be that the switch updates g, SP, and PC
	// separately. If the PC is within any of the functions that does this,
	// we don't ask for a traceback. C.F. the function setsSP for more about this.
	//
	// There is another apparently viable approach, recorded here in case
	// the "PC within setsSP function" check turns out not to be usable.
	// It would be possible to delay the update of either g or SP until immediately
	// before the PC update instruction. Then, because of the stack bounds check,
	// the only problematic interrupt point is just before that PC update instruction,
	// and the sigprof handler can detect that instruction and simulate stepping past
	// it in order to reach a consistent state. On ARM, the update of g must be made
	// in two places (in R10 and also in a TLS slot), so the delayed update would
	// need to be the SP update. The sigprof handler must read the instruction at
	// the current PC and if it was the known instruction (for example, JMP BX or
	// MOV R2, PC), use that other register in place of the PC value.
	// The biggest drawback to this solution is that it requires that we can tell
	// whether it's safe to read from the memory pointed at by PC.
	// In a correct program, we can test PC == nil and otherwise read,
	// but if a profiling signal happens at the instant that a program executes
	// a bad jump (before the program manages to handle the resulting fault)
	// the profiling handler could fault trying to read nonexistent memory.
	//
	// To recap, there are no constraints on the assembly being used for the
	// transition. We simply require that g and SP match and that the PC is not
	// in gogo.
	traceback := true
	if gp == nil || sp < gp.stack.lo || gp.stack.hi < sp || setsSP(pc) || (mp != nil && mp.vdsoSP != 0) {
		traceback = false
	}
	var stk [maxCPUProfStack]uintptr
	n := 0
	if mp.ncgo > 0 && mp.curg != nil && mp.curg.syscallpc != 0 && mp.curg.syscallsp != 0 {
		cgoOff := 0
		// Check cgoCallersUse to make sure that we are not
		// interrupting other code that is fiddling with
		// cgoCallers.  We are running in a signal handler
		// with all signals blocked, so we don't have to worry
		// about any other code interrupting us.
		if atomic.Load(&mp.cgoCallersUse) == 0 && mp.cgoCallers != nil && mp.cgoCallers[0] != 0 {
			for cgoOff < len(mp.cgoCallers) && mp.cgoCallers[cgoOff] != 0 {
				cgoOff++
			}
			copy(stk[:], mp.cgoCallers[:cgoOff])
			mp.cgoCallers[0] = 0
		}

		// Collect Go stack that leads to the cgo call.
		n = gentraceback(mp.curg.syscallpc, mp.curg.syscallsp, 0, mp.curg, 0, &stk[cgoOff], len(stk)-cgoOff, nil, nil, 0)
		if n > 0 {
			n += cgoOff
		}
	} else if traceback {
		n = gentraceback(pc, sp, lr, gp, 0, &stk[0], len(stk), nil, nil, _TraceTrap|_TraceJumpStack)
	}

	if n <= 0 {
		// Normal traceback is impossible or has failed.
		// See if it falls into several common cases.
		n = 0
		if (GOOS == "windows" || GOOS == "solaris" || GOOS == "illumos" || GOOS == "darwin" || GOOS == "aix") && mp.libcallg != 0 && mp.libcallpc != 0 && mp.libcallsp != 0 {
			// Libcall, i.e. runtime syscall on windows.
			// Collect Go stack that leads to the call.
			n = gentraceback(mp.libcallpc, mp.libcallsp, 0, mp.libcallg.ptr(), 0, &stk[0], len(stk), nil, nil, 0)
		}
		if n == 0 && mp != nil && mp.vdsoSP != 0 {
			n = gentraceback(mp.vdsoPC, mp.vdsoSP, 0, gp, 0, &stk[0], len(stk), nil, nil, _TraceTrap|_TraceJumpStack)
		}
		if n == 0 {
			// If all of the above has failed, account it against abstract "System" or "GC".
			n = 2
			if inVDSOPage(pc) {
				pc = funcPC(_VDSO) + sys.PCQuantum
			} else if pc > firstmoduledata.etext {
				// "ExternalCode" is better than "etext".
				pc = funcPC(_ExternalCode) + sys.PCQuantum
			}
			stk[0] = pc
			if mp.preemptoff != "" {
				stk[1] = funcPC(_GC) + sys.PCQuantum
			} else {
				stk[1] = funcPC(_System) + sys.PCQuantum
			}
		}
	}

	if prof.hz != 0 {
		cpuprof.add(gp, stk[:n])
	}
	getg().m.mallocing--
}

// If the signal handler receives a SIGPROF signal on a non-Go thread,
// it tries to collect a traceback into sigprofCallers.
// sigprofCallersUse is set to non-zero while sigprofCallers holds a traceback.
var sigprofCallers cgoCallers
var sigprofCallersUse uint32

// sigprofNonGo is called if we receive a SIGPROF signal on a non-Go thread,
// and the signal handler collected a stack trace in sigprofCallers.
// When this is called, sigprofCallersUse will be non-zero.
// g is nil, and what we can do is very limited.
//go:nosplit
//go:nowritebarrierrec
func sigprofNonGo() {
	if prof.hz != 0 {
		n := 0
		for n < len(sigprofCallers) && sigprofCallers[n] != 0 {
			n++
		}
		cpuprof.addNonGo(sigprofCallers[:n])
	}

	atomic.Store(&sigprofCallersUse, 0)
}

// sigprofNonGoPC is called when a profiling signal arrived on a
// non-Go thread and we have a single PC value, not a stack trace.
// g is nil, and what we can do is very limited.
//go:nosplit
//go:nowritebarrierrec
func sigprofNonGoPC(pc uintptr) {
	if prof.hz != 0 {
		stk := []uintptr{
			pc,
			funcPC(_ExternalCode) + sys.PCQuantum,
		}
		cpuprof.addNonGo(stk)
	}
}

// Reports whether a function will set the SP
// to an absolute value. Important that
// we don't traceback when these are at the bottom
// of the stack since we can't be sure that we will
// find the caller.
//
// If the function is not on the bottom of the stack
// we assume that it will have set it up so that traceback will be consistent,
// either by being a traceback terminating function
// or putting one on the stack at the right offset.
func setsSP(pc uintptr) bool {
	f := findfunc(pc)
	if !f.valid() {
		// couldn't find the function for this PC,
		// so assume the worst and stop traceback
		return true
	}
	switch f.funcID {
	case funcID_gogo, funcID_systemstack, funcID_mcall, funcID_morestack:
		return true
	}
	return false
}

// setcpuprofilerate sets the CPU profiling rate to hz times per second.
// If hz <= 0, setcpuprofilerate turns off CPU profiling.
func setcpuprofilerate(hz int32) {
	// Force sane arguments.
	if hz < 0 {
		hz = 0
	}

	// Disable preemption, otherwise we can be rescheduled to another thread
	// that has profiling enabled.
	_g_ := getg()
	_g_.m.locks++

	// Stop profiler on this thread so that it is safe to lock prof.
	// if a profiling signal came in while we had prof locked,
	// it would deadlock.
	setThreadCPUProfiler(0)

	for !atomic.Cas(&prof.signalLock, 0, 1) {
		osyield()
	}
	if prof.hz != hz {
		setProcessCPUProfiler(hz)
		prof.hz = hz
	}
	atomic.Store(&prof.signalLock, 0)

	lock(&sched.lock)
	sched.profilehz = hz
	unlock(&sched.lock)

	if hz != 0 {
		setThreadCPUProfiler(hz)
	}

	_g_.m.locks--
}

// init initializes pp, which may be a freshly allocated p or a
// previously destroyed p, and transitions it to status _Pgcstop.
// 初始化 pp，
func (pp *p) init(id int32) {
	// p 的 id 就是它在 allp 中的索引
	pp.id = id
	// 新创建的 p 处于 _Pgcstop 状态
	pp.status = _Pgcstop
	pp.sudogcache = pp.sudogbuf[:0]
	for i := range pp.deferpool {
		pp.deferpool[i] = pp.deferpoolbuf[i][:0]
	}
	pp.wbBuf.reset()

	// 为 P 分配 cache 对象
	if pp.mcache == nil {
		// 如果 old == 0 且 i == 0 说明这是引导阶段初始化第一个 p
		if id == 0 {
			// 确认当前 g 的 m 的 mcache 分空
			if getg().m.mcache == nil {
				throw("missing mcache?")
			}
			pp.mcache = getg().m.mcache // bootstrap
		} else {
			pp.mcache = allocmcache()
		}
	}
	if raceenabled && pp.raceprocctx == 0 {
		if id == 0 {
			pp.raceprocctx = raceprocctx0
			raceprocctx0 = 0 // bootstrap
		} else {
			pp.raceprocctx = raceproccreate()
		}
	}
}

// destroy releases all of the resources associated with pp and
// transitions it to status _Pdead.
//
// sched.lock must be held and the world must be stopped.
// 释放未使用的 P，一般情况下不会执行这段代码
func (pp *p) destroy() {
	// 将所有 runnable goroutine 移动至全局队列
	for pp.runqhead != pp.runqtail {
		// 从本地队列中 pop
		pp.runqtail--
		gp := pp.runq[pp.runqtail%uint32(len(pp.runq))].ptr()
		// push 到全局队列中
		globrunqputhead(gp)
	}
	if pp.runnext != 0 {
		globrunqputhead(pp.runnext.ptr())
		pp.runnext = 0
	}
	if len(pp.timers) > 0 {
		plocal := getg().m.p.ptr()
		// The world is stopped, but we acquire timersLock to
		// protect against sysmon calling timeSleepUntil.
		// This is the only case where we hold the timersLock of
		// more than one P, so there are no deadlock concerns.
		lock(&plocal.timersLock)
		lock(&pp.timersLock)
		moveTimers(plocal, pp.timers)
		pp.timers = nil
		pp.adjustTimers = 0
		pp.deletedTimers = 0
		atomic.Store64(&pp.timer0When, 0)
		unlock(&pp.timersLock)
		unlock(&plocal.timersLock)
	}
	// 如果存在 gc 后台 worker，则让其 runnable 并将其放到全局队列中从而可以让其对自身进行清理
	if gp := pp.gcBgMarkWorker.ptr(); gp != nil {
		casgstatus(gp, _Gwaiting, _Grunnable)
		if trace.enabled {
			traceGoUnpark(gp, 0)
		}
		globrunqput(gp)
		// 此赋值不会发生竞争，因为此时已经 STW
		pp.gcBgMarkWorker.set(nil)
	}
	// 刷新 p 的写屏障缓存
	if gcphase != _GCoff {
		wbBufFlush1(pp)
		pp.gcw.dispose()
	}
	for i := range pp.sudogbuf {
		pp.sudogbuf[i] = nil
	}
	pp.sudogcache = pp.sudogbuf[:0]
	for i := range pp.deferpool {
		for j := range pp.deferpoolbuf[i] {
			pp.deferpoolbuf[i][j] = nil
		}
		pp.deferpool[i] = pp.deferpoolbuf[i][:0]
	}
	systemstack(func() {
		for i := 0; i < pp.mspancache.len; i++ {
			// Safe to call since the world is stopped.
			mheap_.spanalloc.free(unsafe.Pointer(pp.mspancache.buf[i]))
		}
		pp.mspancache.len = 0
		pp.pcache.flush(&mheap_.pages)
	})
	// 释放当前 P 绑定的 cache
	freemcache(pp.mcache)
	pp.mcache = nil
	// 将当前 P 的 G 复链转移到全局
	gfpurge(pp)
	traceProcFree(pp)
	if raceenabled {
		if pp.timerRaceCtx != 0 {
			// The race detector code uses a callback to fetch
			// the proc context, so arrange for that callback
			// to see the right thing.
			// This hack only works because we are the only
			// thread running.
			mp := getg().m
			phold := mp.p.ptr()
			mp.p.set(pp)

			racectxend(pp.timerRaceCtx)
			pp.timerRaceCtx = 0

			mp.p.set(phold)
		}
		raceprocdestroy(pp.raceprocctx)
		pp.raceprocctx = 0
	}
	pp.gcAssistTime = 0
	pp.status = _Pdead
}

// 修改 P 的数量，此时所有工作均被停止 STW，sched 被锁定
// gcworkbufs 既不会被 GC 修改，也不会被 write barrier 修改
// 返回带有 local work 的 P 列表，他们需要被调用方调度
func procresize(nprocs int32) *p {
	// 获取先前的 P 个数
	old := gomaxprocs
	// 边界检查
	if old < 0 || nprocs <= 0 {
		throw("procresize: invalid arg")
	}
	// trace 相关
	if trace.enabled {
		traceGomaxprocs(nprocs)
	}

	// 更新统计信息，记录此次修改 gomaxprocs 的时间
	now := nanotime()
	if sched.procresizetime != 0 {
		sched.totaltime += int64(old) * (now - sched.procresizetime)
	}
	sched.procresizetime = now

	// 必要时增加 allp
	// 这个时候本质上是在检查用户代码是否有调用过 runtime.MAXGOPROCS 调整 p 的数量
	// 此处多一步检查是为了避免内部的锁，如果 nprocs 明显小于 allp 的可见数量（因为 len）
	// 则不需要进行加锁
	if nprocs > int32(len(allp)) {
		// 此处与 retake 同步，它可以同时运行，因为它不会在 P 上运行。
		lock(&allpLock)
		// 如果 nprocs 被调小了
		if nprocs <= int32(cap(allp)) {
			// 扔掉多余的 p
			allp = allp[:nprocs]
		} else {
			// 否则（调大了）创建更多的 p
			nallp := make([]*p, nprocs)
			// 将原有的 p 复制到新创建的 new all p 中，不浪费旧的 p
			copy(nallp, allp[:cap(allp)])
			allp = nallp
		}
		unlock(&allpLock)
	}

	// 初始化新的 P
	for i := old; i < nprocs; i++ {
		pp := allp[i]

		// 如果 p 是新创建的(新创建的 p 在数组中为 nil)，则申请新的 P 对象
		if pp == nil {
			pp = new(p)
		}
		pp.init(i)
		atomicstorep(unsafe.Pointer(&allp[i]), unsafe.Pointer(pp))
	}

	_g_ := getg()
	// 如果当前正在使用的 P 应该被释放，则更换为 allp[0]
	// 否则是初始化阶段，没有 P 绑定当前 P allp[0]
	if _g_.m.p != 0 && _g_.m.p.ptr().id < nprocs {
		// 继续使用当前 P
		_g_.m.p.ptr().status = _Prunning
		_g_.m.p.ptr().mcache.prepareForSweep()
	} else {
		// release the current P and acquire allp[0].
		//
		// We must do this before destroying our current P
		// because p.destroy itself has write barriers, so we
		// need to do that from a valid P.
		// 释放当前 P，因为已失效
		if _g_.m.p != 0 {
			if trace.enabled {
				// Pretend that we were descheduled
				// and then scheduled again to keep
				// the trace sane.
				traceGoSched()
				traceProcStop(_g_.m.p.ptr())
			}
			_g_.m.p.ptr().m = 0
		}
		_g_.m.p = 0
		_g_.m.mcache = nil

		// 更换到 allp[0]
		p := allp[0]
		p.m = 0
		p.status = _Pidle
		acquirep(p) // 直接将 allp[0] 绑定到当前的 M

		// trace 相关
		if trace.enabled {
			traceGoStart()
		}
	}

	// release resources from unused P's
	for i := nprocs; i < old; i++ {
		p := allp[i]
		p.destroy()
		// can't free P itself because it can be referenced by an M in syscall
	}

	// Trim allp.
	if int32(len(allp)) != nprocs {
		lock(&allpLock)
		allp = allp[:nprocs]
		unlock(&allpLock)
	}

	// 将没有本地任务的 P 放到空闲链表中
	var runnablePs *p
	for i := nprocs - 1; i >= 0; i-- {
		// 挨个检查 p
		p := allp[i]

		// 确保不是当前正在使用的 P
		if _g_.m.p.ptr() == p {
			continue
		}

		// 将 p 设为 idel
		p.status = _Pidle
		if runqempty(p) {
			// 放入 idle 链表
			pidleput(p)
		} else {
			// 如果有本地任务，则为其绑定一个 M
			p.m.set(mget())
			// 第一个循环为 nil，后续则为上一个 p
			// 此处即为构建可运行的 p 链表
			p.link.set(runnablePs)
			runnablePs = p
		}
	}
	stealOrder.reset(uint32(nprocs))
	var int32p *int32 = &gomaxprocs                                 // 让编译器检查 gomaxprocs 是 int32 类型
	atomic.Store((*uint32)(unsafe.Pointer(int32p)), uint32(nprocs)) // *int32p = nprocs
	// 返回所有包含本地任务的 P 链表
	return runnablePs
}

// 将 p 关联到当前的 m
//
// 因为该函数会立即 acquire P，因此即使调用方不允许 write barrier，
// 此函数仍然允许 write barrier。
//
//go:yeswritebarrierrec
func acquirep(_p_ *p) {
	// 此处不允许 write barrier
	wirep(_p_)

	// 已经获取了 p，因此之后允许 write barrier
	//
	// 在 P 可以从一个潜在设置的 mcache 分配前执行偏好的 mcache flush
	_p_.mcache.prepareForSweep()

	if trace.enabled {
		traceProcStart()
	}
}

// wirep 为 acquirep 的实际获取 p 的第一步，它关联了当前的 M 到 P 上。
// 之所以不允许分段是因为我们可以为这个部分驳回 write barrier
//go:nowritebarrierrec
//go:nosplit
func wirep(_p_ *p) {
	_g_ := getg()

	// 检查 确实没有 p
	if _g_.m.p != 0 || _g_.m.mcache != nil {
		throw("wirep: already in go")
	}

	// 检查 m 是否正常，并检查要获取的 p 的状态
	if _p_.m != 0 || _p_.status != _Pidle {
		id := int64(0)
		if _p_.m != 0 {
			id = _p_.m.ptr().id
		}
		print("wirep: p->m=", _p_.m, "(", id, ") p->status=", _p_.status, "\n")
		throw("wirep: invalid p state")
	}

	// 正式获取 p
	_g_.m.p.set(_p_)

	// 将 p 绑定到 m
	_p_.m.set(_g_.m)

	// 修改 p 的状态
	_p_.status = _Prunning
}

// p 与当前 m 解绑
func releasep() *p {
	_g_ := getg()

	if _g_.m.p == 0 || _g_.m.mcache == nil {
		throw("releasep: invalid arg")
	}
	_p_ := _g_.m.p.ptr()
	if _p_.m.ptr() != _g_.m || _p_.mcache != _g_.m.mcache || _p_.status != _Prunning {
		print("releasep: m=", _g_.m, " m->p=", _g_.m.p.ptr(), " p->m=", hex(_p_.m), " m->mcache=", _g_.m.mcache, " p->mcache=", _p_.mcache, " p->status=", _p_.status, "\n")
		throw("releasep: invalid p state")
	}
	if trace.enabled {
		traceProcStop(_g_.m.p.ptr())
	}
	_g_.m.p = 0
	_g_.m.mcache = nil
	_p_.m = 0
	_p_.status = _Pidle
	return _p_
}

func incidlelocked(v int32) {
	lock(&sched.lock)
	sched.nmidlelocked += v
	if v > 0 {
		checkdead()
	}
	unlock(&sched.lock)
}

// 检查死锁情况
// 检查基于当前运行的 M 的数量，如果 0 则表示死锁
// 必须持有 sched.lock 情况下才能执行此调用
func checkdead() {
	// For -buildmode=c-shared or -buildmode=c-archive it's OK if
	// there are no running goroutines. The calling program is
	// assumed to be running.
	if islibrary || isarchive {
		return
	}

	// If we are dying because of a signal caught on an already idle thread,
	// freezetheworld will cause all running threads to block.
	// And runtime will essentially enter into deadlock state,
	// except that there is a thread that will call exit soon.
	if panicking > 0 {
		return
	}

	// If we are not running under cgo, but we have an extra M then account
	// for it. (It is possible to have an extra M on Windows without cgo to
	// accommodate callbacks created by syscall.NewCallback. See issue #6751
	// for details.)
	var run0 int32
	if !iscgo && cgoHasExtraM {
		mp := lockextra(true)
		haveExtraM := extraMCount > 0
		unlockextra(mp)
		if haveExtraM {
			run0 = 1
		}
	}

	// 总共的 m 的数量 - 等待 work 的空闲 m 的数量 - 等待 work 的锁住的 m 的数量 - 不计入死锁的系统 m 的数量
	run := mcount() - sched.nmidle - sched.nmidlelocked - sched.nmsys
	// 正常
	if run > run0 {
		return
	}
	// 计数错误
	if run < 0 {
		print("runtime: checkdead: nmidle=", sched.nmidle, " nmidlelocked=", sched.nmidlelocked, " mcount=", mcount(), " nmsys=", sched.nmsys, "\n")
		throw("checkdead: inconsistent counts")
	}

	grunning := 0
	lock(&allglock)
	for i := 0; i < len(allgs); i++ {
		gp := allgs[i]
		if isSystemGoroutine(gp, false) {
			continue
		}
		s := readgstatus(gp)
		switch s &^ _Gscan {
		case _Gwaiting, _Gpreempted:
			grunning++
		case _Grunnable,
			_Grunning,
			_Gsyscall:
			unlock(&allglock)
			print("runtime: checkdead: find g ", gp.goid, " in status ", s, "\n")
			throw("checkdead: runnable g")
		}
	}
	unlock(&allglock)
	if grunning == 0 { // 如果 main goroutine 调用 runtime·Goexit()
		unlock(&sched.lock) // unlock so that GODEBUG=scheddetail=1 doesn't hang
		throw("no goroutines (main called runtime.Goexit) - deadlock!")
	}

	// Maybe jump time forward for playground.
	if faketime != 0 {
		when, _p_ := timeSleepUntil()
		if _p_ != nil {
			faketime = when
			for pp := &sched.pidle; *pp != 0; pp = &(*pp).ptr().link {
				if (*pp).ptr() == _p_ {
					*pp = _p_.link
					break
				}
			}
			mp := mget()
			if mp == nil {
				// There should always be a free M since
				// nothing is running.
				throw("checkdead: no m for timer")
			}
			mp.nextp.set(_p_)
			notewakeup(&mp.park)
			return
		}
	}

	// There are no goroutines running, so we can look at the P's.
	for _, _p_ := range allp {
		if len(_p_.timers) > 0 {
			return
		}
	}

	getg().m.throwing = -1 // do not dump full stacks
	unlock(&sched.lock)    // unlock so that GODEBUG=scheddetail=1 doesn't hang
	throw("all goroutines are asleep - deadlock!")
}

// forcegcperiod is the maximum time in nanoseconds between garbage
// collections. If we go this long without a garbage collection, one
// is forced to run.
//
// This is a variable for testing purposes. It normally doesn't change.
var forcegcperiod int64 = 2 * 60 * 1e9

// 系统监控在一个独立的 m 上运行
//
// 总是在没有 P 的情况下运行，因此 write barrier 是不允许的
//go:nowritebarrierrec
func sysmon() {
	lock(&sched.lock)
	// 不计入死锁的系统 m 的数量
	sched.nmsys++
	// 死锁检查
	checkdead()
	unlock(&sched.lock)

	lasttrace := int64(0)
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
		next, _ := timeSleepUntil()

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
					next, _ = timeSleepUntil()
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

		// trace 相关
		if debug.schedtrace > 0 && lasttrace+int64(debug.schedtrace)*1000000 <= now {
			lasttrace = now
			schedtrace(debug.scheddetail > 0)
		}
	}
}

type sysmontick struct {
	schedtick   uint32
	schedwhen   int64
	syscalltick uint32
	syscallwhen int64
}

// forcePreemptNS 是抢占给 G 之前的时间片。
// is the time slice given to a G before it is
// preempted.
const forcePreemptNS = 10 * 1000 * 1000 // 10ms

func retake(now int64) uint32 {
	n := 0
	// 防止 allp 数组发生变化，除非我们已经 STW，此锁将完全没有人竞争
	lock(&allpLock)
	// 不能使用 range 循环，因为 range 可能临时性的放弃 allpLock。
	// 所以每轮循环中都需要重新获取 allp
	for i := 0; i < len(allp); i++ {
		_p_ := allp[i]
		if _p_ == nil {
			// 这是可能的，如果 procresize 已经增长 allp 但还没有创建新的 P
			continue
		}
		pd := &_p_.sysmontick
		s := _p_.status
		sysretake := false
		if s == _Prunning || s == _Psyscall {
			// Preempt G if it's running for too long.
			t := int64(_p_.schedtick)
			if int64(pd.schedtick) != t {
				pd.schedtick = uint32(t)
				pd.schedwhen = now
			} else if pd.schedwhen+forcePreemptNS <= now {
				preemptone(_p_)
				// 对于 syscall 的情况，因为 M 没有与 P 绑定，
				// preemptone() 不工作
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
				if trace.enabled {
					traceGoSysBlock(_p_)
					traceProcStop(_p_)
				}
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

// Tell all goroutines that they have been preempted and they should stop.
// This function is purely best-effort. It can fail to inform a goroutine if a
// processor just started running it.
// No locks need to be held.
// Returns true if preemption request was issued to at least one goroutine.
func preemptall() bool {
	res := false
	for _, _p_ := range allp {
		if _p_.status != _Prunning {
			continue
		}
		if preemptone(_p_) {
			res = true
		}
	}
	return res
}

// 通知运行 goroutine 的 P 停止
// 该函数仅仅只是尽力而为。他完全有可能通知到错误的 goroutine 上。
// 即使它通知到了正确的 goroutine，这个 goroutine 也可能无视这个请求，如果它此时正在执行 newstack。
// 不需要持有锁
// 如果抢占请发送成功，则返回真
// 实际抢占会发生在未来发生，并通过 gp.status 来指明不再为 Grunning 状态
func preemptone(_p_ *p) bool {
	mp := _p_.m.ptr()
	if mp == nil || mp == getg().m {
		return false
	}
	gp := mp.curg
	if gp == nil || gp == mp.g0 {
		return false
	}

	// 设置抢占标记
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

var starttime int64

func schedtrace(detailed bool) {
	now := nanotime()
	if starttime == 0 {
		starttime = now
	}

	lock(&sched.lock)
	print("SCHED ", (now-starttime)/1e6, "ms: gomaxprocs=", gomaxprocs, " idleprocs=", sched.npidle, " threads=", mcount(), " spinningthreads=", sched.nmspinning, " idlethreads=", sched.nmidle, " runqueue=", sched.runqsize)
	if detailed {
		print(" gcwaiting=", sched.gcwaiting, " nmidlelocked=", sched.nmidlelocked, " stopwait=", sched.stopwait, " sysmonwait=", sched.sysmonwait, "\n")
	}
	// We must be careful while reading data from P's, M's and G's.
	// Even if we hold schedlock, most data can be changed concurrently.
	// E.g. (p->m ? p->m->id : -1) can crash if p->m changes from non-nil to nil.
	for i, _p_ := range allp {
		mp := _p_.m.ptr()
		h := atomic.Load(&_p_.runqhead)
		t := atomic.Load(&_p_.runqtail)
		if detailed {
			id := int64(-1)
			if mp != nil {
				id = mp.id
			}
			print("  P", i, ": status=", _p_.status, " schedtick=", _p_.schedtick, " syscalltick=", _p_.syscalltick, " m=", id, " runqsize=", t-h, " gfreecnt=", _p_.gFree.n, " timerslen=", len(_p_.timers), "\n")
		} else {
			// In non-detailed mode format lengths of per-P run queues as:
			// [len1 len2 len3 len4]
			print(" ")
			if i == 0 {
				print("[")
			}
			print(t - h)
			if i == len(allp)-1 {
				print("]\n")
			}
		}
	}

	if !detailed {
		unlock(&sched.lock)
		return
	}

	for mp := allm; mp != nil; mp = mp.alllink {
		_p_ := mp.p.ptr()
		gp := mp.curg
		lockedg := mp.lockedg.ptr()
		id1 := int32(-1)
		if _p_ != nil {
			id1 = _p_.id
		}
		id2 := int64(-1)
		if gp != nil {
			id2 = gp.goid
		}
		id3 := int64(-1)
		if lockedg != nil {
			id3 = lockedg.goid
		}
		print("  M", mp.id, ": p=", id1, " curg=", id2, " mallocing=", mp.mallocing, " throwing=", mp.throwing, " preemptoff=", mp.preemptoff, ""+" locks=", mp.locks, " dying=", mp.dying, " spinning=", mp.spinning, " blocked=", mp.blocked, " lockedg=", id3, "\n")
	}

	lock(&allglock)
	for gi := 0; gi < len(allgs); gi++ {
		gp := allgs[gi]
		mp := gp.m
		lockedm := gp.lockedm.ptr()
		id1 := int64(-1)
		if mp != nil {
			id1 = mp.id
		}
		id2 := int64(-1)
		if lockedm != nil {
			id2 = lockedm.id
		}
		print("  G", gp.goid, ": status=", readgstatus(gp), "(", gp.waitreason.String(), ") m=", id1, " lockedm=", id2, "\n")
	}
	unlock(&allglock)
	unlock(&sched.lock)
}

// schedEnableUser enables or disables the scheduling of user
// goroutines.
//
// This does not stop already running user goroutines, so the caller
// should first stop the world when disabling user goroutines.
func schedEnableUser(enable bool) {
	lock(&sched.lock)
	if sched.disable.user == !enable {
		unlock(&sched.lock)
		return
	}
	sched.disable.user = !enable
	if enable {
		n := sched.disable.n
		sched.disable.n = 0
		globrunqputbatch(&sched.disable.runnable, n)
		unlock(&sched.lock)
		for ; n != 0 && sched.npidle != 0; n-- {
			startm(nil, false)
		}
	} else {
		unlock(&sched.lock)
	}
}

// schedEnabled reports whether gp should be scheduled. It returns
// false is scheduling of gp is disabled.
func schedEnabled(gp *g) bool {
	if sched.disable.user {
		return isSystemGoroutine(gp, true)
	}
	return true
}

// 将 mp 放至空闲列表
// 调用此调用必须将调度器锁住
// 可能在 STW 期间运行，因此不允许 write barrier
//go:nowritebarrierrec
func mput(mp *m) {
	mp.schedlink = sched.midle
	sched.midle.set(mp)
	sched.nmidle++
	checkdead()
}

// 尝试从 midel 列表中获取一个 M
// 调度器必须锁住
// 可能在 STW 期间运行，故不允许 write barrier
//go:nowritebarrierrec
func mget() *m {
	mp := sched.midle.ptr()
	if mp != nil {
		sched.midle = mp.schedlink
		sched.nmidle--
	}
	return mp
}

// Put gp on the global runnable queue.
// Sched must be locked.
// May run during STW, so write barriers are not allowed.
//go:nowritebarrierrec
func globrunqput(gp *g) {
	sched.runq.pushBack(gp)
	sched.runqsize++
}

// Put gp at the head of the global runnable queue.
// Sched must be locked.
// May run during STW, so write barriers are not allowed.
//go:nowritebarrierrec
func globrunqputhead(gp *g) {
	sched.runq.pushBack(gp)
	sched.runqsize++
}

// 将一批 runnable goroutine 放入全局 runnable 队列中
// 它会清楚 *batch
// 调度器必须锁住才可调用
func globrunqputbatch(ghead *g, gtail *g, n int32) {
	sched.runq.pushBackAll(*batch)
	sched.runqsize += n
	*batch = gQueue{}
}

// 从全局队列中偷取，调用时必须锁住调度器
func globrunqget(_p_ *p, max int32) *g {
	// 如果全局队列中没有 g 直接返回
	if sched.runqsize == 0 {
		return nil
	}

	// per-P 的部分，如果只有一个 P 的全部取
	n := sched.runqsize/gomaxprocs + 1
	if n > sched.runqsize {
		n = sched.runqsize
	}

	// 不能超过取的最大个数
	if max > 0 && n > max {
		n = max
	}

	// 计算能不能在本地队列中放下 n 个
	if n > int32(len(_p_.runq))/2 {
		n = int32(len(_p_.runq)) / 2
	}

	// 修改本地队列的剩余空间
	sched.runqsize -= n
	// 拿到全局队列队头 g
	gp := sched.runq.pop()
	// 计数
	n--

	// 继续取剩下的 n-1 个全局队列放入本地队列
	for ; n > 0; n-- {
		gp1 := sched.runq.pop()
		runqput(_p_, gp1, false)
	}
	return gp
}

// 将 p 放入 _Pidle 列表
// 此时调度器必须被锁住
// 可能在 STW 期间运行，所以不允许 write barrier
//go:nowritebarrierrec
func pidleput(_p_ *p) {
	if !runqempty(_p_) {
		throw("pidleput: P has non-empty run queue")
	}
	_p_.link = sched.pidle
	sched.pidle.set(_p_)
	atomic.Xadd(&sched.npidle, 1) // TODO: fast atomic
}

// Try get a p from _Pidle list.
// Sched must be locked.
// May run during STW, so write barriers are not allowed.
//go:nowritebarrierrec
func pidleget() *p {
	_p_ := sched.pidle.ptr()
	if _p_ != nil {
		sched.pidle = _p_.link
		atomic.Xadd(&sched.npidle, -1) // TODO: fast atomic
	}
	return _p_
}

// runqempty 返回 true，如果 _p_ 的本地队列没有 G
// 它永远不会错误的返回 true
func runqempty(_p_ *p) bool {
	// Defend against a race where 1) _p_ has G1 in runqnext but runqhead == runqtail,
	// 2) runqput on _p_ kicks G1 to the runq, 3) runqget on _p_ empties runqnext.
	// Simply observing that runqhead == runqtail and then observing that runqnext == nil
	// does not mean the queue is empty.
	for {
		head := atomic.Load(&_p_.runqhead)
		tail := atomic.Load(&_p_.runqtail)
		runnext := atomic.Loaduintptr((*uintptr)(unsafe.Pointer(&_p_.runnext)))
		if tail == atomic.Load(&_p_.runqtail) {
			return head == tail && runnext == 0
		}
	}
}

// To shake out latent assumptions about scheduling order,
// we introduce some randomness into scheduling decisions
// when running with the race detector.
// The need for this was made obvious by changing the
// (deterministic) scheduling order in Go 1.5 and breaking
// many poorly-written tests.
// With the randomness here, as long as the tests pass
// consistently with -race, they shouldn't have latent scheduling
// assumptions.
const randomizeScheduler = raceenabled

// runqput 尝试将 g 放入本地可运行队列中
// 如果 next 为 false，则 runqput 会将 g 放到可运行队列的尾部
// 如果 next 为 true，则 runqput 会将 g 放入 _p_.runnext 槽内
// 如果运行队列已满，则runnext 会放到全局队列中去
// 仅在所有 P 下执行。
func runqput(_p_ *p, gp *g, next bool) {
	if randomizeScheduler && next && fastrand()%2 == 0 {
		next = false
	}

	if next {
	retryNext:
		oldnext := _p_.runnext
		if !_p_.runnext.cas(oldnext, guintptr(unsafe.Pointer(gp))) {
			goto retryNext
		}
		if oldnext == 0 {
			return
		}
		// 将原先的 runnext 踢出普通运行队列
		gp = oldnext.ptr()
	}

retry:
	h := atomic.LoadAcq(&_p_.runqhead) // load-acquire, 与 consumer 进行同步
	t := _p_.runqtail
	// 如果 P 的本地队列没有满，入队
	if t-h < uint32(len(_p_.runq)) {
		_p_.runq[t%uint32(len(_p_.runq))].set(gp)
		atomic.StoreRel(&_p_.runqtail, t+1) // store-release, 使 consumer 可以开始消费这个 item
		return
	}
	// 可运行队列已经满了，只能扔给全局队列了
	if runqputslow(_p_, gp, h, t) {
		return
	}
	// 如果队列不空则上面已经返回
	goto retry
}

// 将 g 和一批 work 从本地 runnable 队列放入全局队列
// 由拥有 P 的 M 执行
func runqputslow(_p_ *p, gp *g, h, t uint32) bool {
	var batch [len(_p_.runq)/2 + 1]*g

	// 首先，从本地队列中抓取一半 work
	n := t - h
	n = n / 2
	if n != uint32(len(_p_.runq)/2) {
		throw("runqputslow: queue is not full")
	}
	for i := uint32(0); i < n; i++ {
		batch[i] = _p_.runq[(h+i)%uint32(len(_p_.runq))].ptr()
	}
	if !atomic.CasRel(&_p_.runqhead, h, h+n) { // cas-release, commits consume
		return false
	}
	batch[n] = gp

	// 打乱顺序
	if randomizeScheduler {
		for i := uint32(1); i <= n; i++ {
			j := fastrandn(i + 1)
			batch[i], batch[j] = batch[j], batch[i]
		}
	}

	// 将 goroutine 彼此连接
	for i := uint32(0); i < n; i++ {
		batch[i].schedlink.set(batch[i+1])
	}
	var q gQueue
	q.head.set(batch[0])
	q.tail.set(batch[n])

	// 将这批 work 放到全局队列中去
	lock(&sched.lock)
	globrunqputbatch(&q, int32(n+1))
	unlock(&sched.lock)
	return true
}

// 从本地可运行队列中获取 g
// 如果 inheritTime 为 true，则 g 继承剩余的时间片
// 否则开始一个新的时间片。在所有者 P 上执行
func runqget(_p_ *p) (gp *g, inheritTime bool) {
	// 如果有 runnext，则为下一个要运行的 g
	for {
		// 下一个 g
		next := _p_.runnext
		// 没有，break
		if next == 0 {
			break
		}
		// 如果 cas 成功，则 g 继承剩余时间片执行
		if _p_.runnext.cas(next, 0) {
			return next.ptr(), true
		}
	}

	// 没有 next
	for {
		// 本地队列是空，返回 nil
		h := atomic.LoadAcq(&_p_.runqhead) // load-acquire, 与其他消费者同步
		t := _p_.runqtail
		if t == h {
			return nil, false
		}

		// 从本地队列中以 cas 方式拿一个
		gp := _p_.runq[h%uint32(len(_p_.runq))].ptr()
		if atomic.CasRel(&_p_.runqhead, h, h+1) { // cas-release, 提交消费
			return gp, false
		}
	}
}

// Grabs a batch of goroutines from _p_'s runnable queue into batch.
// Batch is a ring buffer starting at batchHead.
// Returns number of grabbed goroutines.
// Can be executed by any P.
func runqgrab(_p_ *p, batch *[256]guintptr, batchHead uint32, stealRunNextG bool) uint32 {
	for {
		h := atomic.LoadAcq(&_p_.runqhead) // load-acquire, synchronize with other consumers
		t := atomic.LoadAcq(&_p_.runqtail) // load-acquire, synchronize with the producer
		n := t - h
		n = n - n/2
		if n == 0 {
			if stealRunNextG {
				// Try to steal from _p_.runnext.
				if next := _p_.runnext; next != 0 {
					if _p_.status == _Prunning {
						// Sleep to ensure that _p_ isn't about to run the g
						// we are about to steal.
						// The important use case here is when the g running
						// on _p_ ready()s another g and then almost
						// immediately blocks. Instead of stealing runnext
						// in this window, back off to give _p_ a chance to
						// schedule runnext. This will avoid thrashing gs
						// between different Ps.
						// A sync chan send/recv takes ~50ns as of time of
						// writing, so 3us gives ~50x overshoot.
						if GOOS != "windows" {
							usleep(3)
						} else {
							// On windows system timer granularity is
							// 1-15ms, which is way too much for this
							// optimization. So just yield.
							osyield()
						}
					}
					if !_p_.runnext.cas(next, 0) {
						continue
					}
					batch[batchHead%uint32(len(batch))] = next
					return 1
				}
			}
			return 0
		}
		if n > uint32(len(_p_.runq)/2) { // read inconsistent h and t
			continue
		}
		for i := uint32(0); i < n; i++ {
			g := _p_.runq[(h+i)%uint32(len(_p_.runq))]
			batch[(batchHead+i)%uint32(len(batch))] = g
		}
		if atomic.CasRel(&_p_.runqhead, h, h+n) { // cas-release, commits consume
			return n
		}
	}
}

// 从 p2 runnable 队列中偷取一般的元素并将其放入 p 的 runnable 队列中
// 返回其中一个偷取的元素（如果失败则返回 nil）
func runqsteal(_p_, p2 *p, stealRunNextG bool) *g {
	t := _p_.runqtail

	// p2 里也偷不到，返回 nil
	n := runqgrab(p2, &_p_.runq, t, stealRunNextG)
	if n == 0 {
		return nil
	}

	// 将剩余的偷到 p 的 runnable 队列下
	n--
	gp := _p_.runq[(t+n)%uint32(len(_p_.runq))].ptr()
	if n == 0 {
		return gp
	}
	h := atomic.LoadAcq(&_p_.runqhead) // load-acquire, synchronize with consumers
	if t-h+n >= uint32(len(_p_.runq)) {
		throw("runqsteal: runq overflow")
	}
	atomic.StoreRel(&_p_.runqtail, t+n) // store-release, makes the item available for consumption
	return gp
}

// A gQueue is a dequeue of Gs linked through g.schedlink. A G can only
// be on one gQueue or gList at a time.
type gQueue struct {
	head guintptr
	tail guintptr
}

// empty reports whether q is empty.
func (q *gQueue) empty() bool {
	return q.head == 0
}

// push adds gp to the head of q.
func (q *gQueue) push(gp *g) {
	gp.schedlink = q.head
	q.head.set(gp)
	if q.tail == 0 {
		q.tail.set(gp)
	}
}

// pushBack adds gp to the tail of q.
func (q *gQueue) pushBack(gp *g) {
	gp.schedlink = 0
	if q.tail != 0 {
		q.tail.ptr().schedlink.set(gp)
	} else {
		q.head.set(gp)
	}
	q.tail.set(gp)
}

// pushBackAll adds all Gs in l2 to the tail of q. After this q2 must
// not be used.
func (q *gQueue) pushBackAll(q2 gQueue) {
	if q2.tail == 0 {
		return
	}
	q2.tail.ptr().schedlink = 0
	if q.tail != 0 {
		q.tail.ptr().schedlink = q2.head
	} else {
		q.head = q2.head
	}
	q.tail = q2.tail
}

// pop removes and returns the head of queue q. It returns nil if
// q is empty.
func (q *gQueue) pop() *g {
	gp := q.head.ptr()
	if gp != nil {
		q.head = gp.schedlink
		if q.head == 0 {
			q.tail = 0
		}
	}
	return gp
}

// popList takes all Gs in q and returns them as a gList.
func (q *gQueue) popList() gList {
	stack := gList{q.head}
	*q = gQueue{}
	return stack
}

// A gList is a list of Gs linked through g.schedlink. A G can only be
// on one gQueue or gList at a time.
type gList struct {
	head guintptr
}

// empty reports whether l is empty.
func (l *gList) empty() bool {
	return l.head == 0
}

// push adds gp to the head of l.
func (l *gList) push(gp *g) {
	gp.schedlink = l.head
	l.head.set(gp)
}

// pushAll prepends all Gs in q to l.
func (l *gList) pushAll(q gQueue) {
	if !q.empty() {
		q.tail.ptr().schedlink = l.head
		l.head = q.head
	}
}

// pop removes and returns the head of l. If l is empty, it returns nil.
func (l *gList) pop() *g {
	gp := l.head.ptr()
	if gp != nil {
		l.head = gp.schedlink
	}
	return gp
}

//go:linkname setMaxThreads runtime/debug.setMaxThreads
func setMaxThreads(in int) (out int) {
	lock(&sched.lock)
	out = int(sched.maxmcount)
	if in > 0x7fffffff { // MaxInt32
		sched.maxmcount = 0x7fffffff
	} else {
		sched.maxmcount = int32(in)
	}
	checkmcount()
	unlock(&sched.lock)
	return
}

func haveexperiment(name string) bool {
	if name == "framepointer" {
		return framepointer_enabled // 通过链接器设置
	}
	x := sys.Goexperiment
	for x != "" {
		xname := ""
		i := index(x, ",")
		if i < 0 {
			xname, x = x, ""
		} else {
			xname, x = x[:i], x[i+1:]
		}
		if xname == name {
			return true
		}
		if len(xname) > 2 && xname[:2] == "no" && xname[2:] == name {
			return false
		}
	}
	return false
}

//go:nosplit
func procPin() int {
	_g_ := getg()
	mp := _g_.m

	mp.locks++
	return int(mp.p.ptr().id)
}

//go:nosplit
func procUnpin() {
	_g_ := getg()
	_g_.m.locks--
}

//go:linkname sync_runtime_procPin sync.runtime_procPin
//go:nosplit
func sync_runtime_procPin() int {
	return procPin()
}

//go:linkname sync_runtime_procUnpin sync.runtime_procUnpin
//go:nosplit
func sync_runtime_procUnpin() {
	procUnpin()
}

//go:linkname sync_atomic_runtime_procPin sync/atomic.runtime_procPin
//go:nosplit
func sync_atomic_runtime_procPin() int {
	return procPin()
}

//go:linkname sync_atomic_runtime_procUnpin sync/atomic.runtime_procUnpin
//go:nosplit
func sync_atomic_runtime_procUnpin() {
	procUnpin()
}

// Active spinning for sync.Mutex.
//go:linkname sync_runtime_canSpin sync.runtime_canSpin
//go:nosplit
func sync_runtime_canSpin(i int) bool {
	// sync.Mutex is cooperative, so we are conservative with spinning.
	// Spin only few times and only if running on a multicore machine and
	// GOMAXPROCS>1 and there is at least one other running P and local runq is empty.
	// As opposed to runtime mutex we don't do passive spinning here,
	// because there can be work on global runq or on other Ps.
	if i >= active_spin || ncpu <= 1 || gomaxprocs <= int32(sched.npidle+sched.nmspinning)+1 {
		return false
	}
	if p := getg().m.p.ptr(); !runqempty(p) {
		return false
	}
	return true
}

//go:linkname sync_runtime_doSpin sync.runtime_doSpin
//go:nosplit
func sync_runtime_doSpin() {
	procyield(active_spin_cnt)
}

var stealOrder randomOrder

// randomOrder/randomEnum are helper types for randomized work stealing.
// They allow to enumerate all Ps in different pseudo-random orders without repetitions.
// The algorithm is based on the fact that if we have X such that X and GOMAXPROCS
// are coprime, then a sequences of (i + X) % GOMAXPROCS gives the required enumeration.
type randomOrder struct {
	count    uint32
	coprimes []uint32
}

type randomEnum struct {
	i     uint32
	count uint32
	pos   uint32
	inc   uint32
}

func (ord *randomOrder) reset(count uint32) {
	ord.count = count
	ord.coprimes = ord.coprimes[:0]
	for i := uint32(1); i <= count; i++ {
		if gcd(i, count) == 1 {
			ord.coprimes = append(ord.coprimes, i)
		}
	}
}

func (ord *randomOrder) start(i uint32) randomEnum {
	return randomEnum{
		count: ord.count,
		pos:   i % ord.count,
		inc:   ord.coprimes[i%uint32(len(ord.coprimes))],
	}
}

func (enum *randomEnum) done() bool {
	return enum.i == enum.count
}

func (enum *randomEnum) next() {
	enum.i++
	enum.pos = (enum.pos + enum.inc) % enum.count
}

func (enum *randomEnum) position() uint32 {
	return enum.pos
}

func gcd(a, b uint32) uint32 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

// An initTask represents the set of initializations that need to be done for a package.
// Keep in sync with ../../test/initempty.go:initTask
type initTask struct {
	// TODO: pack the first 3 fields more tightly?
	state uintptr // 0 = uninitialized, 1 = in progress, 2 = done
	ndeps uintptr
	nfns  uintptr
	// followed by ndeps instances of an *initTask, one per package depended on
	// followed by nfns pcs, one per init function to run
}

func doInit(t *initTask) {
	switch t.state {
	case 2: // fully initialized
		return
	case 1: // initialization in progress
		throw("recursive call during initialization - linker skew")
	default: // not initialized yet
		t.state = 1 // initialization in progress
		for i := uintptr(0); i < t.ndeps; i++ {
			p := add(unsafe.Pointer(t), (3+i)*sys.PtrSize)
			t2 := *(**initTask)(p)
			doInit(t2)
		}
		for i := uintptr(0); i < t.nfns; i++ {
			p := add(unsafe.Pointer(t), (3+t.ndeps+i)*sys.PtrSize)
			f := *(*func())(unsafe.Pointer(&p))
			f()
		}
		t.state = 2 // initialization done
	}
}
