# 4 内存管理: 初始化

在第二节中，我们已经看到栈和内存分配器是最先完成初始化的。我们先来看这两个初始化的过程。

### 栈初始化

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

TODO:

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

TODO: sdf

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)