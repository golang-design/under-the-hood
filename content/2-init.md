# 2 初始化概览

本节简单讨论程序初始化工作，即 `runtime·schedinit`。

```go
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
	// raceinit must be the first call to race detector.
	// In particular, it must be done before mallocinit below calls racemapshadow.
	if raceenabled {
		_g_.racectx, raceprocctx0 = raceinit()
	}

	// 最大系统线程数量（即 M），参考标准库 runtime/debug.SetMaxThreads
	sched.maxmcount = 10000

	// 不重要，与 trace 有关
	tracebackinit()
	moduledataverify()

	// 栈、内存分配器、调度器相关初始化。
	// 栈初始化，复用管理链表
	stackinit()
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
	itabsinit()     // 使用 activeModules

	msigsave(_g_.m)
	initSigmask = _g_.m.sigmask

	// 处理命令行参数和环境变量
	goargs()
	goenvs()

	// 处理 GODEBUG、GOTRACEBACK 调试相关的环境变量设置
	parsedebugvars()

	// 垃圾回收器初始化
	gcinit()

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
		// 该条件永远不会被触发，此处只是为了防止 buildVersion 不会被编译器优化移除掉。
		buildVersion = "unknown"
	}
}
```

我们来收紧一下这个函数中的关注点：

首先 `sched` 会获取 G，通过 `stackinit()` 初始化程序栈、`mallocinit()` 初始化
内存分配器、通过 `mcommoninit()` 初始化与 G 关联的 M。
然后初始化一些与 CPU 相关的值，获取 CPU 指令集相关支持，然后通过 `alginit()` 来根据
所提供的 CPU 指令集，进而初始化 hash 算法，用于 map 结构。再接下来初始化一些与模块加载
相关的内容、保存 M 的 signal mask，处理入口参数和环境变量。
再初始化垃圾回收器涉及的数据。根据 CPU 的参数信息，初始化对应的 P 数，再调用 
`procresize()` 来动态的调整 P 的个数，只不过这个时候所有的 P 都是新建的。

即我们感兴趣的调用包括：

- 栈初始化 `stackinit()`
- 内存分配 `mallocinit()`
- M 初始化 `mcommoninit()`
- 垃圾回收 `gcinit()`
- P 初始化 `procresize()`

## 栈初始化

栈就是传统程序的栈内存的概念。传统程序的内存区块包含三个部分：静态内存、栈内存和堆内存。

```go
// runtime/internal/sys/stubs.go
const PtrSize = 4 << (^uintptr(0) >> 63)           // unsafe.Sizeof(uintptr(0)) 理想情况下为常量

// runtime/malloc.go
// 获得缓存的 order 数。order 0 为 FixedStack，每个后序都是前一个的两倍
// 我们需要缓存 2KB, 4KB, 8KB 和 16KB 的栈，更大的栈则会直接分配.
// 由于 FixedStack 与操作系统相关，必须动态的计算 NumStackOrders 来保证相同的最大缓存大小
//   OS               | FixedStack | NumStackOrders
//   -----------------+------------+---------------
//   linux/darwin/bsd | 2KB        | 4
//   windows/32       | 4KB        | 3
//   windows/64       | 8KB        | 2
//   plan9            | 4KB        | 3
// sys.GoosWindows 当操作系统为 windows 时会被设置为 1
const _NumStackOrders = 4 - sys.PtrSize/4*sys.GoosWindows - 1*sys.GoosPlan9

// 具有可用栈的 span 的全局池
// 每个栈均根据其大小会被分配一个 order
//     order = log_2(size/FixedStack)
// 每个 order 都包含一个可用链表
// TODO: one lock per order?
var stackpool [_NumStackOrders]mSpanList
var stackpoolmu mutex

// 大小较大的栈 span 的全局池
var stackLarge struct {
	lock mutex
	free [heapAddrBits - pageShift]mSpanList // free lists by log_2(s.npages)
}

// 初始化栈空间复用管理链表
func stackinit() {
	// 10 0000 0000 0000 & 01 1111 1111 1111 = 0
	if _StackCacheSize&_PageMask != 0 {
		throw("cache size must be a multiple of page size")
	}
	for i := range stackpool {
		stackpool[i].init()
	}
	for i := range stackLarge.free {
		stackLarge.free[i].init()
	}
}

// 初始化空双向链表
func (list *mSpanList) init() {
	list.first = nil
	list.last = nil
}
```

## 内存分配初始化

```go
func mallocinit() {
	if class_to_size[_TinySizeClass] != _TinySize {
		throw("bad TinySizeClass")
	}

	testdefersizes()

	if heapArenaBitmapBytes&(heapArenaBitmapBytes-1) != 0 {
		// heapBits expects modular arithmetic on bitmap
		// addresses to work.
		throw("heapArenaBitmapBytes not a power of 2")
	}

	// 将 class size 复制到统计表中
	for i := range class_to_size {
		memstats.by_size[i].size = uint32(class_to_size[i])
	}

	// 检查 physPageSize
	if physPageSize == 0 {
		// 获取系统物理 page 大小失败
		throw("failed to get system page size")
	}
	// 如果 page 太小也失败 4KB
	if physPageSize < minPhysPageSize {
		print("system page size (", physPageSize, ") is smaller than minimum page size (", minPhysPageSize, ")\n")
		throw("bad system page size")
	}
	// 系统 page 大小必须是 2 的任意指数大小
	if physPageSize&(physPageSize-1) != 0 {
		print("system page size (", physPageSize, ") must be a power of 2\n")
		throw("bad system page size")
	}

	// 初始化堆
	mheap_.init()
	_g_ := getg()
	_g_.m.mcache = allocmcache()

	// Create initial arena growth hints.
	if sys.PtrSize == 8 && GOARCH != "wasm" {
		// 64 位机器上，我们选取下面的 hint，因为：
		//
		// 1.从地址空间的中间开始，可以更容易地扩展连续范围，而无需进入其他映射。
		//
		// 2. 这使得 Go 堆地址在调试时更容易识别。
		//
		// 3. gccgo 中的堆栈扫描仍然是保守型（conservative）的，因此地址与其他数据的区别开来非常重要。
		//
		// 从 0x00c0 开始表示有效内存地址从 0x00c0, 0x00c1, ...
		// 在小端（little-endian）表示中，即为 c0 00, c1 00, ... 这些都是无效的 UTF-8 序列，
		// 并且他们尽可能的里 ff （像一个通用的 byte）远。如果失败，我们尝试 0xXXc0 地址。
		// 早些时候尝试使用 0x11f8 会在 OS X 上当执行线程分配时导致内存不足错误。
		// 0c00c0 会与 AddressSanitizer 产生冲突，后者保留从起开始到 0x0100 的所有内存。
		// 这些选择降低了一个保守型垃圾回收器不回收内存的概率，因为某些非指针内存块具有与
		// 内存地址相匹配的位模式。
		//
		// 但是，在 arm64 中，当使用 4K 大小具有三级的转换缓冲区的页（page）时，用户地址空间
		// 被限制在了 39 bit，因此我们忽略了上面所有的建议并强制分配在 0x40 << 32 上。
		// 在 darwin/arm64 中，地址空间甚至更小。
		//
		// 从 0xc000000000 开始设置保留地址
		// 如果失败，则尝试 0x1c000000000 ~ 0x7fc000000000
		for i := 0x7f; i >= 0; i-- {
			var p uintptr
			switch {
			case GOARCH == "arm64" && GOOS == "darwin":
				p = uintptr(i)<<40 | uintptrMask&(0x0013<<28)
			case GOARCH == "arm64":
				p = uintptr(i)<<40 | uintptrMask&(0x0040<<32)
			case raceenabled:
				// The TSAN runtime requires the heap
				// to be in the range [0x00c000000000,
				// 0x00e000000000).
				p = uintptr(i)<<32 | uintptrMask&(0x00c0<<32)
				if p >= uintptrMask&0x00e000000000 {
					continue
				}
			default:
				p = uintptr(i)<<40 | uintptrMask&(0x00c0<<32)
			}
			hint := (*arenaHint)(mheap_.arenaHintAlloc.alloc())
			hint.addr = p
			hint.next, mheap_.arenaHints = mheap_.arenaHints, hint
		}
	} else {
		// 32 位机器，我们不关心
		(...)
	}
}
```

在这个过程中还包含 `allocmcache()`：

```go
func allocmcache() *mcache {
	lock(&mheap_.lock)
	c := (*mcache)(mheap_.cachealloc.alloc())
	unlock(&mheap_.lock)
	for i := range c.alloc {
		c.alloc[i] = &emptymspan
	}
	c.next_sample = nextSample()
	return c
}
```

## 调度器初始化

```go
func mcommoninit(mp *m) {
	_g_ := getg()

	// g0 stack won't make sense for user (and is not necessary unwindable).
	if _g_ != _g_.m.g0 {
		callers(1, mp.createstack[:])
	}

	lock(&sched.lock)
	if sched.mnext+1 < sched.mnext {
		throw("runtime: thread ID overflow")
	}
	mp.id = sched.mnext
	sched.mnext++
	checkmcount()

	mp.fastrand[0] = 1597334677 * uint32(mp.id)
	mp.fastrand[1] = uint32(cputicks())
	if mp.fastrand[0]|mp.fastrand[1] == 0 {
		mp.fastrand[1] = 1
	}

	mpreinit(mp)
	if mp.gsignal != nil {
		mp.gsignal.stackguard1 = mp.gsignal.stack.lo + _StackGuard
	}

	// Add to allm so garbage collector doesn't free g->m
	// when it is just in a register or thread-local storage.
	mp.alllink = allm

	// NumCgoCall() iterates over allm w/o schedlock,
	// so we need to publish it safely.
	atomicstorep(unsafe.Pointer(&allm), unsafe.Pointer(mp))
	unlock(&sched.lock)

	// Allocate memory to hold a cgo traceback if the cgo call crashes.
	if iscgo || GOOS == "solaris" || GOOS == "windows" {
		mp.cgoCallers = new(cgoCallers)
	}
}
```

## 垃圾回收初始化

```go
const (
	_WorkbufSize = 2048 // in bytes; larger values result in less contention

	// workbufAlloc is the number of bytes to allocate at a time
	// for new workbufs. This must be a multiple of pageSize and
	// should be a multiple of _WorkbufSize.
	//
	// Larger values reduce workbuf allocation overhead. Smaller
	// values reduce heap fragmentation.
	workbufAlloc = 32 << 10
)
//go:notinheap
type workbuf struct {
	workbufhdr
	// account for the above fields
	obj [(_WorkbufSize - unsafe.Sizeof(workbufhdr{})) / sys.PtrSize]uintptr
}
func gcinit() {
	if unsafe.Sizeof(workbuf{}) != _WorkbufSize {
		throw("size of Workbuf is suboptimal")
	}

	// No sweep on the first cycle.
	mheap_.sweepdone = 1

	// Set a reasonable initial GC trigger.
	memstats.triggerRatio = 7 / 8.0

	// Fake a heap_marked value so it looks like a trigger at
	// heapminimum is the appropriate growth from heap_marked.
	// This will go into computing the initial GC goal.
	memstats.heap_marked = uint64(float64(heapminimum) / (1 + memstats.triggerRatio))

	// Set gcpercent from the environment. This will also compute
	// and set the GC trigger and goal.
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
	// Update pacing in response to gcpercent change.
	gcSetTriggerRatio(memstats.triggerRatio)
	unlock(&mheap_.lock)

	// If we just disabled GC, wait for any concurrent GC mark to
	// finish so we always return with no GC running.
	if in < 0 {
		gcWaitOnMark(atomic.Load(&work.cycles))
	}

	return out
}
```