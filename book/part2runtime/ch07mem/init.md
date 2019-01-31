# 内存管理: 初始化

[TOC]

栈和内存分配器是最先完成初始化的，我们先来看这两个初始化的过程。

### 栈初始化

```go
// runtime/internal/sys/stubs.go
const PtrSize = 4 << (^uintptr(0) >> 63) // unsafe.Sizeof(uintptr(0)) 理想情况下为常量 8

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
	// 10 0000 0000 0000 & 01 1111 1111 1111 = 0，理论上应该等于 0
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

### 内存分配初始化

内存分配器的初始化除去一些例行的检查之外，就是对堆的初始化了：

```go
func mallocinit() {
	// 一些涉及内存分配器的常量的检查，包括
	// heapArenaBitmapBytes, physPageSize 等等
	...

	// 初始化堆
	mheap_.init()
	_g_ := getg()
	_g_.m.mcache = allocmcache()

	// 创建初始的 arena 增长 hint
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
		// 并且他们尽可能的离 ff （像一个通用的 byte）远。如果失败，我们尝试 0xXXc0 地址。
		// 早些时候尝试使用 0x11f8 会在 OS X 上当执行线程分配时导致内存不足错误。
		// 0c00c0 会与 AddressSanitizer 产生冲突，后者保留从起开始到 0x0100 的所有内存。
		// 这些选择降低了一个保守型垃圾回收器不回收内存的概率，因为某些非指针内存块具有与
		// 内存地址相匹配的位模式。
		//
		// 但是，在 arm64 中，当使用 4K 大小具有三级的转换缓冲区的页（page）时，用户地址空间
		// 被限制在了 39 bit，因此我们忽略了上面所有的建议并强制分配在 0x40 << 32 上。
		// 在 darwin/arm64 中，地址空间甚至更小。
		// 在 AIX 64 位系统中, mmaps 从 0x0A00000000000000 开始处理。
		//
		// 从 0xc000000000 开始设置保留地址
		// 如果失败，则尝试 0x1c000000000 ~ 0x7fc000000000
		for i := 0x7f; i >= 0; i-- {
			var p uintptr
			switch {
			case GOARCH == "arm64" && GOOS == "darwin":
				p = uintptr(i)<<40 | uintptrMask&(0x0013<<28)
			(...)
			default:
				p = uintptr(i)<<40 | uintptrMask&(0x00c0<<32)
			}
			hint := (*arenaHint)(mheap_.arenaHintAlloc.alloc())
			hint.addr = p
			hint.next, mheap_.arenaHints = mheap_.arenaHints, hint
		}
	} else {
		// 32 位机器，不关心
		(...)
	}
}
```

堆的初始化：

```go
// 堆初始化
func (h *mheap) init() {
	// 初始化堆中各个组件的分配器
	h.treapalloc.init(unsafe.Sizeof(treapNode{}), nil, nil, &memstats.other_sys)
	h.spanalloc.init(unsafe.Sizeof(mspan{}), recordspan, unsafe.Pointer(h), &memstats.mspan_sys)
	h.cachealloc.init(unsafe.Sizeof(mcache{}), nil, nil, &memstats.mcache_sys)
	h.specialfinalizeralloc.init(unsafe.Sizeof(specialfinalizer{}), nil, nil, &memstats.other_sys)
	h.specialprofilealloc.init(unsafe.Sizeof(specialprofile{}), nil, nil, &memstats.other_sys)
	h.arenaHintAlloc.init(unsafe.Sizeof(arenaHint{}), nil, nil, &memstats.other_sys)

	// 不对 mspan 的分配清零，后台扫描可以通过分配它来并发的检查一个 span
	// 因此 span 的 sweepgen 在释放和重新分配时候能存活，从而可以防止后台扫描
	// 不正确的将其从 0 进行 CAS。
	//
	// 因为 mspan 不包含堆指针，因此它是安全的
	h.spanalloc.zero = false

	// h->mapcache 不需要初始化
	for i := range h.central {
		h.central[i].mcentral.init(spanClass(i))
	}
}
```

在这个过程中还包含对 mcache 初始化 `allocmcache()`，这个 mcache 会在 `procresize` 中将 mcache
转移到 P 的门下，而并非属于 M，这个我们在 [内存管理: 分配器组件](./component.md) 中会讨论。

TODO:

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)