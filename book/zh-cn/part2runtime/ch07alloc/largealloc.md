---
weight: 2204
title: "7.4 大对象分配"
---

# 7.4 大对象分配

大对象（large object）（>32kb）直接从 Go 堆上进行分配，不涉及 mcache/mcentral/mheap 之间的三级过程，也就相对简单。

## 从堆上分配

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
		s.state = mSpanManual
		h.scavengeLargest(s.npages * pageSize)
		s.state = mSpanFree
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

free 和 scav 均为树堆，其数据结构的性质我们已经很熟悉了。

## 从操作系统申请

而对栈进行增长则需要向操作系统申请：

```go
func (h *mheap) grow(npage uintptr) bool {
	ask := npage << _PageShift
	nBase := round(h.curArena.base+ask, physPageSize)
	if nBase > h.curArena.end {
		// Not enough room in the current arena. Allocate more
		// arena space. This may not be contiguous with the
		// current arena, so we have to request the full ask.
		av, asize := h.sysAlloc(ask)
		if av == nil {
			print("runtime: out of memory: cannot allocate ", ask, "-byte block (", memstats.heap_sys, " in use)\n")
			return false
		}

		if uintptr(av) == h.curArena.end {
			// The new space is contiguous with the old
			// space, so just extend the current space.
			h.curArena.end = uintptr(av) + asize
		} else {
			// The new space is discontiguous. Track what
			// remains of the current space and switch to
			// the new space. This should be rare.
			if size := h.curArena.end - h.curArena.base; size != 0 {
				h.growAddSpan(unsafe.Pointer(h.curArena.base), size)
			}
			// Switch to the new space.
			h.curArena.base = uintptr(av)
			h.curArena.end = uintptr(av) + asize
		}
		// The memory just allocated counts as both released
		// and idle, even though it's not yet backed by spans.
		//
		// The allocation is always aligned to the heap arena
		// size which is always > physPageSize, so its safe to
		// just add directly to heap_released. Coalescing, if
		// possible, will also always be correct in terms of
		// accounting, because s.base() must be a physical
		// page boundary.
		memstats.heap_released += uint64(asize)
		memstats.heap_idle += uint64(asize)

		// Recalculate nBase
		nBase = round(h.curArena.base+ask, physPageSize)
	}

	// Grow into the current arena.
	v := h.curArena.base
	h.curArena.base = nBase
	h.growAddSpan(unsafe.Pointer(v), nBase-v)
	return true
}

func (h *mheap) growAddSpan(v unsafe.Pointer, size uintptr) {
	// Scavenge some pages to make up for the virtual memory space
	// we just allocated, but only if we need to.
	h.scavengeIfNeededLocked(size)

	s := (*mspan)(h.spanalloc.alloc())
	s.init(uintptr(v), size/pageSize)
	h.setSpans(s.base(), s.npages, s)
	s.state = mSpanFree
	// [v, v+size) is always in the Prepared state. The new span
	// must be marked scavenged so the allocator transitions it to
	// Ready when allocating from it.
	s.scavenged = true
	// This span is both released and idle, but grow already
	// updated both memstats.
	h.coalesce(s)
	h.free.insert(s)
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

	// 正式开始使用保留的内存
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

		// 将 arena 添加到 arena 列表中
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

这个过程略显复杂：

1. 首先会通过现有的 arena 中获得已经保留的内存区域，如果能获取到，则直接对 arena 进行初始化；
2. 如果没有，则会通过 `sysReserve` 为 arena 保留新的内存区域，并通过 `sysReserveAligned` 对操作系统对齐的区域进行重排，而后使用 `sysMap` 正式使用所在区块的内存。
3. 在 arena 初始化阶段，本质上是为 arena 创建 metadata，这部分内存属于堆外内存，即不会被 GC 所追踪的内存，因而通过 persistentalloc 进行分配。

`persistentalloc` 是 `sysAlloc` 之上的一层封装，它分配到的内存用于不能被释放。

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
```

可以看到，这里申请到的内存会被记录到 `globalAlloc` 中：

```go
var globalAlloc struct {
	mutex
	persistentAlloc
}
type persistentAlloc struct {
	base *notInHeap // 空结构，内存首地址
	off  uintptr    // 偏移量
}
```

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
