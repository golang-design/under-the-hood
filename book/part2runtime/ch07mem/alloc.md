# 5 内存管理: 分配过程

在分析具体的分配过程之前，我们需要搞清楚究竟什么时候会发生分配。

Go 程序的执行是基于 goroutine 的，goroutine 和传统意义上的程序一样，也有栈和堆的概念。只不过
Go 的运行时帮我们屏蔽掉了这两个概念，只在运行时内部区分并分别对应：goroutine 执行栈以及 Go 堆。

goroutine 的执行栈与传统意义上的栈一样，当函数返回时，在栈就会被回收，栈中的对象都会被回收，从而
无需 GC 的标记；而堆则麻烦一些，由于 Go 支持垃圾回收，只要对象生存在堆上，Go 的运行时 GC 就会在
后台将对应的内存进行标记从而能够在垃圾回收的时候将对应的内存回收，进而增加了开销。

下面这个程序给出了四种情况：

```go
package main

type smallobj struct {
	arr [1 << 10]byte
}

type largeobj struct {
	arr [1 << 26]byte
}

func f1() int {
	x := 1
	return x
}

func f2() *int {
	y := 2
	return &y
}

func f3() {
	large := largeobj{}
	println(&large)
}

func f4() {
	small := smallobj{}
	print(&small)
}

func main() {
	x := f1()
	y := f2()
	f3()
	f4()
	println(x, y)
}
```

我们使用 `-gcflags "-N -l -m"` 编译这段代码能够禁用编译器与内联优化并进行逃逸分析：

```bash
# alloc.go
# go build -gcflags "-N -l -m" -ldflags=-compressdwarf=false -o alloc.out alloc.go
# command-line-arguments
./alloc.go:18:9: &y escapes to heap
./alloc.go:17:2: moved to heap: y
./alloc.go:22:2: moved to heap: large
./alloc.go:23:10: f3 &large does not escape
./alloc.go:28:8: f4 &small does not escape
```

- 情况1: `f1` 中 `x` 的变量被返回，没有发生逃逸；
- 情况2: `f2` 中 `y` 的指针被返回，进而发生了逃逸；
- 情况3: `f3` 中 `large` 无法被一个执行栈装下，即便没有返回，也会直接在堆上分配；
- 情况4: `f4` 中 `small` 对象能够被一个执行栈装下，变量没有返回到栈外，进而没有发生逃逸。

如果我们再仔细检查一下他们的汇编：

```asm
TEXT main.f2(SB) /Users/changkun/dev/go-under-the-hood/demo/4-mem/alloc/alloc.go
  (...)
  alloc.go:17		0x104e086		488d05939f0000		LEAQ type.*+40256(SB), AX		
  alloc.go:17		0x104e08d		48890424		MOVQ AX, 0(SP)				
  alloc.go:17		0x104e091		e8cabffbff		CALL runtime.newobject(SB)		
  alloc.go:17		0x104e096		488b442408		MOVQ 0x8(SP), AX			
  alloc.go:17		0x104e09b		4889442410		MOVQ AX, 0x10(SP)			
  alloc.go:17		0x104e0a0		48c70002000000		MOVQ $0x2, 0(AX)			
  (...)

TEXT main.f3(SB) /Users/changkun/dev/go-under-the-hood/demo/4-mem/alloc/alloc.go
  (...)
  alloc.go:22		0x104e0ed		488d05ecf60000		LEAQ type.*+62720(SB), AX		
  alloc.go:22		0x104e0f4		48890424		MOVQ AX, 0(SP)				
  alloc.go:22		0x104e0f8		e863bffbff		CALL runtime.newobject(SB)		
  alloc.go:22		0x104e0fd		488b7c2408		MOVQ 0x8(SP), DI			
  alloc.go:22		0x104e102		48897c2418		MOVQ DI, 0x18(SP)			
  alloc.go:22		0x104e107		b900008000		MOVL $0x800000, CX			
  alloc.go:22		0x104e10c		31c0			XORL AX, AX				
  alloc.go:22		0x104e10e		f348ab			REP; STOSQ AX, ES:0(DI)			
  (...)
```

就会发现，对于产生在 Go 堆上分配对象的情况，均调用了运行时的 `runtime.newobject` 方法。
当然，关键字 `new` 同样也会被编译器翻译为此函数，这个我们已经在实践知道了。
所以 `runtime.newobject` 就是内存分配的核心入口了。

## 分配入口

单看 `runtime.newobject` 其实非常简单，他只是简单的调用了 `mallocgc`：

```go
// 创建一个新的对象
func newobject(typ *_type) unsafe.Pointer {
	return mallocgc(typ.size, typ, true) // true 内存清零
}
```

其中 `_type` 为 Go 类型的实现，通过其成员变量 `size` 能够获得该类型所需要的大小。

```go
func mallocgc(size uintptr, typ *_type, needzero bool) unsafe.Pointer {
	(...)
	// 创建大小为零的对象，例如空结构体
	if size == 0 {
		return unsafe.Pointer(&zerobase)
	}
	(...)
	mp := acquirem()
	(...)
	mp.mallocing = 1
	(...)
	// 获取当前 g 所在 M 所绑定 P 的 mcache
	c := gomcache()
	var x unsafe.Pointer
	noscan := typ == nil || typ.kind&kindNoPointers != 0
	if size <= maxSmallSize {
		if noscan && size < maxTinySize {
			// 微对象分配
			off := c.tinyoffset
			if size&7 == 0 {
				off = round(off, 8)
			} else if size&3 == 0 {
				off = round(off, 4)
			} else if size&1 == 0 {
				off = round(off, 2)
			}
			if off+size <= maxTinySize && c.tiny != 0 {
				// The object fits into existing tiny block.
				x = unsafe.Pointer(c.tiny + off)
				c.tinyoffset = off + size
				c.local_tinyallocs++
				mp.mallocing = 0
				releasem(mp)
				return x
			}
			span := c.alloc[tinySpanClass]
			v := nextFreeFast(span)
			if v == 0 {
				v, _, shouldhelpgc = c.nextFree(tinySpanClass)
			}
			x = unsafe.Pointer(v)
			(*[2]uint64)(x)[0] = 0
			(*[2]uint64)(x)[1] = 0
			if size < c.tinyoffset || c.tiny == 0 {
				c.tiny = uintptr(x)
				c.tinyoffset = size
			}
			size = maxTinySize
		} else {
			// 小对象分配
			var sizeclass uint8
			if size <= smallSizeMax-8 {
				sizeclass = size_to_class8[(size+smallSizeDiv-1)/smallSizeDiv]
			} else {
				sizeclass = size_to_class128[(size-smallSizeMax+largeSizeDiv-1)/largeSizeDiv]
			}
			size = uintptr(class_to_size[sizeclass])
			spc := makeSpanClass(sizeclass, noscan)
			span := c.alloc[spc]
			v := nextFreeFast(span)
			if v == 0 {
				v, span, shouldhelpgc = c.nextFree(spc)
			}
			x = unsafe.Pointer(v)
			if needzero && span.needzero != 0 {
				memclrNoHeapPointers(unsafe.Pointer(v), size)
			}
		}
	} else {
		// 大对象分配
		var s *mspan
		shouldhelpgc = true
		systemstack(func() {
			s = largeAlloc(size, needzero, noscan)
		})
		s.freeindex = 1
		s.allocCount = 1
		x = unsafe.Pointer(s.base())
		size = s.elemsize
	}
	(...)
	mp.mallocing = 0
	releasem(mp)
	(...)
	return x
```

我们接下来分别来分析这三个过程。

## 大对象分配

大对象（large object）（>32kb）直接从 Go 堆上进行分配，不涉及 mcache/mcentral/mheap 之间的三级过程，也就相对简单。

```go
// 大对象分配
var s *mspan
(...)
systemstack(func() {
	s = largeAlloc(size, needzero, noscan)
})
s.freeindex = 1
s.allocCount = 1
x = unsafe.Pointer(s.base())
size = s.elemsize
```

可以看到，大对象所分配的 mspan 是直接通过 `largeAlloc` 进行分配的。

```go
func largeAlloc(size uintptr, needzero bool, noscan bool) *mspan {
	// 对象太大，溢出
	if size+_PageSize < size {
		throw("out of memory")
	}

	// 根据分配的大小计算需要分配的页数
	npages := size >> _PageShift
	if size&_PageMask != 0 {
		npages++
	}

    (...)

	// 从堆上分配
	s := mheap_.alloc(npages, makeSpanClass(0, noscan), true, needzero)
	if s == nil {
		throw("out of memory")
	}
	s.limit = s.base() + size

	(...)

	return s
}
```

从堆上分配调用了 `alloc` 方法，这个方法需要指明要分配的页数、span 的大小等级、是否为大对象、是否清零：

```go
func (h *mheap) alloc(npage uintptr, spanclass spanClass, large bool, needzero bool) *mspan {
	var s *mspan
	systemstack(func() {
		s = h.alloc_m(npage, spanclass, large)
	})

	if s != nil {
		// 需要清零时，对分配的 span 进行清零
		if needzero && s.needzero != 0 {
			memclrNoHeapPointers(unsafe.Pointer(s.base()), s.npages<<_PageShift)
		}
		// 标记已经清零
		s.needzero = 0
	}
	return s
}
```

`alloc_m` 是实际实现，在系统栈上执行：

```go
//go:systemstack
func (h *mheap) alloc_m(npage uintptr, spanclass spanClass, large bool) *mspan {
	_g_ := getg()

	(...)

    lock(&h.lock)
    (...)
    _g_.m.mcache.local_scan = 0
    (...)
	_g_.m.mcache.local_tinyallocs = 0

	s := h.allocSpanLocked(npage, &memstats.heap_inuse)
	if s != nil {
		(...)
		s.state = mSpanInUse
		s.allocCount = 0
		s.spanclass = spanclass
		if sizeclass := spanclass.sizeclass(); sizeclass == 0 {
			s.elemsize = s.npages << _PageShift
			s.divShift = 0
			s.divMul = 0
			s.divShift2 = 0
			s.baseMask = 0
		} else {
			s.elemsize = uintptr(class_to_size[sizeclass])
			m := &class_to_divmagic[sizeclass]
			s.divShift = m.shift
			s.divMul = m.mul
			s.divShift2 = m.shift2
			s.baseMask = m.baseMask
		}

		// Mark in-use span in arena page bitmap.
		arena, pageIdx, pageMask := pageIndexOf(s.base())
		arena.pageInUse[pageIdx] |= pageMask

		// update stats, sweep lists
		h.pagesInUse += uint64(npage)
		if large {
			(...)
			mheap_.largealloc += uint64(s.elemsize)
			mheap_.nlargealloc++
			(...)
		}
	}
	(...)
	unlock(&h.lock)
	return s
}
```

`allocSpanlocked` 用来从堆上根据页数来进行实际的分配工作：

```go
func (h *mheap) allocSpanLocked(npage uintptr, stat *uint64) *mspan {
	var s *mspan
    // 从堆中获取 span
	s = h.pickFreeSpan(npage)
	if s != nil {
		goto HaveSpan
	}
	// 堆中没无法获取到 span，这时需要对堆进行增长
	if !h.grow(npage) {
		return nil
	}
	// 再获取一次
	s = h.pickFreeSpan(npage)
	if s != nil {
		goto HaveSpan
	}
	throw("grew heap, but no adequate free span found")

HaveSpan:
	(...)

	if s.npages > npage {
		t := (*mspan)(h.spanalloc.alloc())
		t.init(s.base()+npage<<_PageShift, s.npages-npage)
		s.npages = npage
		h.setSpan(t.base()-1, s)
		h.setSpan(t.base(), t)
		h.setSpan(t.base()+t.npages*pageSize-1, t)
		t.needzero = s.needzero
		start, end := t.physPageBounds()
		if s.scavenged && start < end {
			memstats.heap_released += uint64(end - start)
			t.scavenged = true
		}
		s.state = mSpanManual
		t.state = mSpanManual
		h.freeSpanLocked(t, false, false, s.unusedsince)
		s.state = mSpanFree
	}
	if s.scavenged {
		sysUsed(unsafe.Pointer(s.base()), s.npages<<_PageShift)
		s.scavenged = false
	}
	s.unusedsince = 0

	h.setSpans(s.base(), npage, s)
	(...)
	if s.inList() {
		throw("still in list")
	}
	return s
}
```

从堆上获取 span 会同时检查 `free` 和 `scav` 树堆：

```go
func (h *mheap) pickFreeSpan(npage uintptr) *mspan {
	tf := h.free.find(npage)
	ts := h.scav.find(npage)
	var s *mspan
	// 选择更小的 span，然后返回
	if tf != nil && (ts == nil || tf.spanKey.npages <= ts.spanKey.npages) {
		s = tf.spanKey
		h.free.removeNode(tf)
	} else if ts != nil && (tf == nil || tf.spanKey.npages > ts.spanKey.npages) {
		s = ts.spanKey
		h.scav.removeNode(ts)
	}
	return s
}
```

而对栈进行增长则需要向操作系统申请：

```go
func (h *mheap) grow(npage uintptr) bool {
	ask := npage << _PageShift
	v, size := h.sysAlloc(ask)
	if v == nil {
		print("runtime: out of memory: cannot allocate ", ask, "-byte block (", memstats.heap_sys, " in use)\n")
		return false
	}

	h.scavengeLargest(size)

	s := (*mspan)(h.spanalloc.alloc())
	s.init(uintptr(v), size/pageSize)
	h.setSpans(s.base(), s.npages, s)
	(...)
	s.state = mSpanInUse
	h.pagesInUse += uint64(s.npages)
	h.freeSpanLocked(s, false, true, 0)
	return true
}
```

通过 `h.sysAlloc` 获取从操作系统申请而来的内存，首先尝试
从已经保留的 arena 中获得内存，无法获取到合适的内存后，才会正式向操作系统申请，而后对其进行初始化：

```go
func (h *mheap) sysAlloc(n uintptr) (v unsafe.Pointer, size uintptr) {
	n = round(n, heapArenaBytes)

	// 优先从已经保留的 arena 中获取
	v = h.arena.alloc(n, heapArenaBytes, &memstats.heap_sys)
	if v != nil {
		size = n
		goto mapped
	}

	// 如果获取不到，再尝试增长 arena hint
	for h.arenaHints != nil {
		hint := h.arenaHints
		p := hint.addr
		if hint.down {
			p -= n
		}
		if p+n < p { // 溢出
			v = nil
		} else if arenaIndex(p+n-1) >= 1<<arenaBits { // 溢出
			v = nil
		} else {
			v = sysReserve(unsafe.Pointer(p), n)
		}
		if p == uintptr(v) {
			// 获取成功，更新 arena hint
			if !hint.down {
				p += n
			}
			hint.addr = p
			size = n
			break
		}
		// 失败，丢弃并重新尝试
		if v != nil {
			sysFree(v, n, nil)
		}
		h.arenaHints = hint.next
		h.arenaHintAlloc.free(unsafe.Pointer(hint))
	}

	if size == 0 {
		(...)
		v, size = sysReserveAligned(nil, n, heapArenaBytes)
		if v == nil {
			return nil, 0
		}

		// 创建新的 hint 来增长此区域
		hint := (*arenaHint)(h.arenaHintAlloc.alloc())
		hint.addr, hint.down = uintptr(v), true
		hint.next, mheap_.arenaHints = mheap_.arenaHints, hint
		hint = (*arenaHint)(h.arenaHintAlloc.alloc())
		hint.addr = uintptr(v) + size
		hint.next, mheap_.arenaHints = mheap_.arenaHints, hint
	}

	// 检查不能使用的指针
	(...)

	// 归还保留的内存
	sysMap(v, size, &memstats.heap_sys)

mapped:
	// 创建 arena 的 metadata
	for ri := arenaIndex(uintptr(v)); ri <= arenaIndex(uintptr(v)+size-1); ri++ {
		l2 := h.arenas[ri.l1()]
		if l2 == nil {
			// 分配 L2 arena map
			l2 = (*[1 << arenaL2Bits]*heapArena)(persistentalloc(unsafe.Sizeof(*l2), sys.PtrSize, nil))
			if l2 == nil {
				throw("out of memory allocating heap arena map")
			}
			(...)
		}

		if l2[ri.l2()] != nil {
			throw("arena already initialized")
		}
		var r *heapArena
		r = (*heapArena)(h.heapArenaAlloc.alloc(unsafe.Sizeof(*r), sys.PtrSize, &memstats.gc_sys))
		if r == nil {
			r = (*heapArena)(persistentalloc(unsafe.Sizeof(*r), sys.PtrSize, &memstats.gc_sys))
			if r == nil {
				throw("out of memory allocating heap arena metadata")
			}
		}

		// Add the arena to the arenas list.
		if len(h.allArenas) == cap(h.allArenas) {
			size := 2 * uintptr(cap(h.allArenas)) * sys.PtrSize
			if size == 0 {
				size = physPageSize
			}
			newArray := (*notInHeap)(persistentalloc(size, sys.PtrSize, &memstats.gc_sys))
			if newArray == nil {
				throw("out of memory allocating allArenas")
			}
			oldSlice := h.allArenas
			*(*notInHeapSlice)(unsafe.Pointer(&h.allArenas)) = notInHeapSlice{newArray, len(h.allArenas), int(size / sys.PtrSize)}
			copy(h.allArenas, oldSlice)
		}
		h.allArenas = h.allArenas[:len(h.allArenas)+1]
		h.allArenas[len(h.allArenas)-1] = ri

		(...)
	}

	(...)

	return
}
```

这个过程涉及关于内存分配的系统调用就是 `mmap`：

```go
func sysReserve(v unsafe.Pointer, n uintptr) unsafe.Pointer {
	flags := int32(_MAP_ANON | _MAP_PRIVATE)
	(...)
	p, err := mmap(v, n, _PROT_NONE, flags, -1, 0)
	if err != 0 {
		return nil
	}
	return p
}
```

```go
func persistentalloc(size, align uintptr, sysStat *uint64) unsafe.Pointer {
	var p *notInHeap
	systemstack(func() {
		p = persistentalloc1(size, align, sysStat)
	})
	return unsafe.Pointer(p)
}
//go:systemstack
func persistentalloc1(size, align uintptr, sysStat *uint64) *notInHeap {
	const (
		maxBlock = 64 << 10 // VM reservation granularity is 64K on windows
	)

	// 不允许分配大小为 0 的空间
	if size == 0 {
		throw("persistentalloc: size == 0")
	}
	// 对齐数必须为 2 的指数、且不大于 PageSize
	if align != 0 {
		if align&(align-1) != 0 {
			throw("persistentalloc: align is not a power of 2")
		}
		if align > _PageSize {
			throw("persistentalloc: align is too large")
		}
	} else {
		// 若未指定则默认为 8
		align = 8
	}

	// 分配大内存：分配的大小如果超过最大的 block 大小，则直接调用 sysAlloc 进行分配
	if size >= maxBlock {
		return (*notInHeap)(sysAlloc(size, sysStat))
	}

	// 分配小内存：在 m 上进行
	// 先获取 m
	mp := acquirem()
	var persistent *persistentAlloc
	if mp != nil && mp.p != 0 { // 如果能够获取到 m 且同时持有 p，则直接分配到 p 的 palloc 上
		persistent = &mp.p.ptr().palloc
	} else { // 否则就分配到全局的 globalAlloc.persistentAlloc 上
		lock(&globalAlloc.mutex)
		persistent = &globalAlloc.persistentAlloc
	}
	// 四舍五入 off 到 align 的倍数
	persistent.off = round(persistent.off, align)
	if persistent.off+size > persistentChunkSize || persistent.base == nil {
		persistent.base = (*notInHeap)(sysAlloc(persistentChunkSize, &memstats.other_sys))
		if persistent.base == nil {
			if persistent == &globalAlloc.persistentAlloc {
				unlock(&globalAlloc.mutex)
			}
			throw("runtime: cannot allocate memory")
		}

		for {
			chunks := uintptr(unsafe.Pointer(persistentChunks))
			*(*uintptr)(unsafe.Pointer(persistent.base)) = chunks
			if atomic.Casuintptr((*uintptr)(unsafe.Pointer(&persistentChunks)), chunks, uintptr(unsafe.Pointer(persistent.base))) {
				break
			}
		}
		persistent.off = sys.PtrSize
	}
	p := persistent.base.add(persistent.off)
	persistent.off += size
	releasem(mp)
	if persistent == &globalAlloc.persistentAlloc {
		unlock(&globalAlloc.mutex)
	}

	(...)
	return p
}
//go:nosplit
func sysAlloc(n uintptr, sysStat *uint64) unsafe.Pointer {
	v, err := mmap(nil, n, _PROT_READ|_PROT_WRITE, _MAP_ANON|_MAP_PRIVATE, -1, 0)
	if err != 0 {
		return nil
	}
	mSysStatInc(sysStat, n)
	return v
}
```

Linux 下内存分配调用有多个：

- brk: 可以让进程的堆指针增长，从逻辑上消耗一块虚拟地址空间
- mmap: 可以让进程的虚拟地址空间切分出一块指定大小的虚拟地址空间，mmap 映射返回的地址也是从逻辑上被消耗的，需要通过 unmap 进行回收。

熟悉 C 语言的读者应该知道 malloc，它只是 C 语言的标准库函数，本质上是通过上述两个系统调用完成，
当分配内存较小时调用 brk，反之则会调用 mmap。不过 Go 运行时并没有使用 brk，目的很明显，是为了能够更加灵活
的控制虚拟地址空间。

## 微对象分配

微对象（tiny object）是指那些小于 16 byte 的对象分配，微对象分配会将多个对象存放到
一起：

```go
// 偏移量
off := c.tinyoffset
// 将微型指针对齐以进行所需（保守）对齐。
if size&7 == 0 {
	off = round(off, 8)
} else if size&3 == 0 {
	off = round(off, 4)
} else if size&1 == 0 {
	off = round(off, 2)
}

if off+size <= maxTinySize && c.tiny != 0 {
	// 能直接被当前的内存块容纳
	x = unsafe.Pointer(c.tiny + off)
	// 增加 offset
	c.tinyoffset = off + size
	// 统计数量
	c.local_tinyallocs++
	// 完成分配，释放 m
	mp.mallocing = 0
	releasem(mp)
	return x
}
// 根据 tinySpan 的大小等级获得对应的 span 链表
// 从而用于分配一个新的 maxTinySize 块
span := c.alloc[tinySpanClass]
v := nextFreeFast(span)
if v == 0 {
	v, _, shouldhelpgc = c.nextFree(tinySpanClass)
}
x = unsafe.Pointer(v)
(*[2]uint64)(x)[0] = 0
(*[2]uint64)(x)[1] = 0
// 看看我们是否需要根据剩余可用空间量替换现有的小块
if size < c.tinyoffset || c.tiny == 0 {
	c.tiny = uintptr(x)
	c.tinyoffset = size
}
size = maxTinySize
```

微型对象的分配过程比较简单，实际分配主要是基于 `nextFreeFast` 和 `nextFree` 两个调用。
`nextFreeFast` 不涉及正式的分配过程，只是简单的寻找一个能够容纳当前微型对象的 span：

```go
func nextFreeFast(s *mspan) gclinkptr {
	// 检查莫为零的个数
	theBit := sys.Ctz64(s.allocCache)
	// 如果小于 64 则说明可以直接使用
	if theBit < 64 {
		result := s.freeindex + uintptr(theBit)
		if result < s.nelems {
			freeidx := result + 1
			if freeidx%64 == 0 && freeidx != s.nelems {
				return 0
			}
			s.allocCache >>= uint(theBit + 1)
			s.freeindex = freeidx
			s.allocCount++
			return gclinkptr(result*s.elemsize + s.base())
		}
	}
	return 0
}
```

`allocCache` 字段用于计算 `freeindex` 上的 `allocBits` 缓存，`allocCache` 进行了移位使其最低位对应于
freeindex 位。allocCache 保存 allocBits 的补码，从而尾零计数可以直接使用它。

## 小对象分配

TODO:

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
