// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// 页堆 page heap
//
// 见 malloc.go 了解综述.

package runtime

import (
	"internal/cpu"
	"runtime/internal/atomic"
	"runtime/internal/sys"
	"unsafe"
)

// minPhysPageSize 是物理页大小的一个下界。真正的物理页大小可能比这个大。
// 相比之下，sys.PhysPageSize 则是物理页大小的一个上界。
const minPhysPageSize = 4096

// 主分配堆
// 堆自身是 free 和 scav 树堆的组合，但其他全局数据也保存在这里。
//
// 因为 mheap 包含不能被 heap-allocated 的 mSpanLists，
// 因此 mheap 必须不能作为 heap-allocated
//
//go:notinheap
type mheap struct {
	// lock must only be acquired on the system stack, otherwise a g
	// could self-deadlock if its stack grows with the lock held.
	lock      mutex
	free      mTreap // free spans
	sweepgen  uint32 // sweep-generation, 参见 mspan 的注释
	sweepdone uint32 // 所有清扫过的 span
	sweepers  uint32 // 活跃的清扫调用数

	// allspans 是所有创建过的 mspans 的 slice。每个 mspan 只出现一次.
	//
	// allspans 的内存是手动管理的，且随着堆的增长被移动或被重新分配。
	//
	// 一般情况下，allspans 由 mheap_.lock 保护，用以避免并发访问及释放 backing store.
	// 在 STW 期间可能不会被锁住，但必须确保在其访问时不能发生分配（因为可能释放 backing store）
	allspans []*mspan // 所有 spans 从这里分配出去

	// sweepSpans 包含了两个 mspan 栈：
	// 一个用于扫描使用中的 span，另一个用于未扫描的 span。
	// 这两个身份位于 GC 的不同阶段。由于 sweepgen 在每个周期中增加 2，
	// 即扫描的 span 在 sweepSpan[sweepgen/2%2] 中
	// 未扫描的 span 在 sweepSpan[1-sweepgen/2%2] 中。
	// 扫描从 unswept 栈中出栈 span，并对仍在使用的 span 压入 swept 栈中。
	// 同样，分配一个使用中的 span 会被压入 swept 栈中。
	sweepSpans [2]gcSweepBuf

	_ uint32 // align uint64 fields on 32-bit for atomics

	// 成比例清扫 (propotional sweep)
	//
	// These parameters represent a linear function from heap_live
	// to page sweep count. The proportional sweep system works to
	// stay in the black by keeping the current page sweep count
	// above this line at the current heap_live.
	//
	// The line has slope sweepPagesPerByte and passes through a
	// basis point at (sweepHeapLiveBasis, pagesSweptBasis). At
	// any given time, the system is at (memstats.heap_live,
	// pagesSwept) in this space.
	//
	// It's important that the line pass through a point we
	// control rather than simply starting at a (0,0) origin
	// because that lets us adjust sweep pacing at any time while
	// accounting for current progress. If we could only adjust
	// the slope, it would create a discontinuity in debt if any
	// progress has already been made.
	pagesInUse         uint64  // pages of spans in stats mSpanInUse; R/W with mheap.lock
	pagesSwept         uint64  // pages swept this cycle; updated atomically
	pagesSweptBasis    uint64  // pagesSwept to use as the origin of the sweep ratio; updated atomically
	sweepHeapLiveBasis uint64  // value of heap_live to use as the origin of sweep ratio; written with lock, read without
	sweepPagesPerByte  float64 // proportional sweep ratio; written with lock, read without
	// TODO(austin): pagesInUse should be a uintptr, but the 386
	// compiler can't 8-byte align fields.

	// Scavenger pacing parameters
	//
	// The two basis parameters and the scavenge ratio parallel the proportional
	// sweeping implementation, the primary differences being that:
	//  * Scavenging concerns itself with RSS, estimated as heapRetained()
	//  * Rather than pacing the scavenger to the GC, it is paced to a
	//    time-based rate computed in gcPaceScavenger.
	//
	// scavengeRetainedGoal represents our goal RSS.
	//
	// All fields must be accessed with lock.
	//
	// TODO(mknyszek): Consider abstracting the basis fields and the scavenge ratio
	// into its own type so that this logic may be shared with proportional sweeping.
	scavengeTimeBasis     int64
	scavengeRetainedBasis uint64
	scavengeBytesPerNS    float64
	scavengeRetainedGoal  uint64

	// Page reclaimer state

	// reclaimIndex is the page index in allArenas of next page to
	// reclaim. Specifically, it refers to page (i %
	// pagesPerArena) of arena allArenas[i / pagesPerArena].
	//
	// If this is >= 1<<63, the page reclaimer is done scanning
	// the page marks.
	//
	// This is accessed atomically.
	reclaimIndex uint64
	// reclaimCredit is spare credit for extra pages swept. Since
	// the page reclaimer works in large chunks, it may reclaim
	// more than requested. Any spare pages released go to this
	// credit pool.
	//
	// This is accessed atomically.
	reclaimCredit uintptr

	// 内存分配统计
	largealloc  uint64                  // 分配给大对象的总字节数
	nlargealloc uint64                  // 进行大对象分配的次数
	largefree   uint64                  // 释放大对象的总字节数 (>maxsmallsize)
	nlargefree  uint64                  // 释放大对象的次数    (>maxsmallsize)
	nsmallfree  [_NumSizeClasses]uint64 // 释放小对象的次数    (<=maxsmallsize)

	// arenas is the heap arena map. It points to the metadata for
	// the heap for every arena frame of the entire usable virtual
	// address space.
	//
	// Use arenaIndex to compute indexes into this array.
	//
	// For regions of the address space that are not backed by the
	// Go heap, the arena map contains nil.
	//
	// Modifications are protected by mheap_.lock. Reads can be
	// performed without locking; however, a given entry can
	// transition from nil to non-nil at any time when the lock
	// isn't held. (Entries never transitions back to nil.)
	//
	// In general, this is a two-level mapping consisting of an L1
	// map and possibly many L2 maps. This saves space when there
	// are a huge number of arena frames. However, on many
	// platforms (even 64-bit), arenaL1Bits is 0, making this
	// effectively a single-level map. In this case, arenas[0]
	// will never be nil.
	arenas [1 << arenaL1Bits]*[1 << arenaL2Bits]*heapArena

	// heapArenaAlloc 是用于分配 heapArena 预留的空间。
	// 仅用于 32 位系统，保留这个空间用以避免堆本身的交错。
	heapArenaAlloc linearAlloc

	// arenaHints 是一个尝试添加更多堆 arena 的地址链表。
	// 它最初填充了一组通用的 hint 地址，并随着堆 arena 范围的实际边界而增长。
	arenaHints *arenaHint

	// arena 是一个提前预留的分配堆 arena （实际 arena）的空间，仅用于 32 位系统
	arena linearAlloc

	// allArenas is the arenaIndex of every mapped arena. This can
	// be used to iterate through the address space.
	//
	// Access is protected by mheap_.lock. However, since this is
	// append-only and old backing arrays are never freed, it is
	// safe to acquire mheap_.lock, copy the slice header, and
	// then release mheap_.lock.
	allArenas []arenaIdx

	// sweepArenas is a snapshot of allArenas taken at the
	// beginning of the sweep cycle. This can be read safely by
	// simply blocking GC (by disabling preemption).
	sweepArenas []arenaIdx

	_ uint32 // ensure 64-bit alignment of central

	// 用于大小较小的类的 central free lists
	// pad 保证了 mcentrals 的间隔为 CacheLinePadSize 字节，从而便于每个 mcentral.lock 获得自己的缓存行。
	// central 由 spanClass 进行索引
	central [numSpanClasses]struct {
		mcentral mcentral
		pad      [cpu.CacheLinePadSize - unsafe.Sizeof(mcentral{})%cpu.CacheLinePadSize]byte
	}

	spanalloc             fixalloc // span* 分配器
	cachealloc            fixalloc // mcache* 分配器
	treapalloc            fixalloc // treapNodes* 分配器
	specialfinalizeralloc fixalloc // specialfinalizer* 分配器
	specialprofilealloc   fixalloc // specialprofile* 分配器
	speciallock           mutex    // 特殊记录分配器的锁
	arenaHintAlloc        fixalloc // arenaHints 分配器

	unused *specialfinalizer // 从不设置，仅强制让 specialfinalizer 类型进入 DWARF
}

var mheap_ mheap

// heapArena 保存了 heap arena 的 metadata. heapArena 存储在 Go 堆之外，且通过 mheap_.arenas 访问
//
// 他们直接从 OS 进行分配，所以理论上他们应该是多个系统页的大小。例如，避免小字段
//
//go:notinheap
type heapArena struct {
	// bitmap 存储了这个 arena 中字的指针或标量的 bitmap。见 mbitmap.go 的描述
	// 使用 heapBits 类型来进行访问。
	bitmap [heapArenaBitmapBytes]byte

	// spans 将此 arena 中的虚拟地址页 ID 映射到 *mspan.
	// 对于已分配的 span, 它们的页映射到 span 自己
	// 对于空闲的 span，只有最低和最高的页会被映射到 span 自身，内部的页则会映射到任意的 span。
	// 对于从未被分配过的页，span 入口为 nil
	//
	// 修改由 mheap.lock 进行保护。读取可以在没有锁的情况下进行，
	// 但仅限于那些已知包含正在使用的 span 或栈 span。
	// 也就是说在确定地址是活跃的 和 在 span 数组中查找地址之间是不安全的。
	spans [pagesPerArena]*mspan

	// pageInUse is a bitmap that indicates which spans are in
	// state mSpanInUse. This bitmap is indexed by page number,
	// but only the bit corresponding to the first page in each
	// span is used.
	//
	// Writes are protected by mheap_.lock.
	pageInUse [pagesPerArena / 8]uint8

	// pageMarks is a bitmap that indicates which spans have any
	// marked objects on them. Like pageInUse, only the bit
	// corresponding to the first page in each span is used.
	//
	// Writes are done atomically during marking. Reads are
	// non-atomic and lock-free since they only occur during
	// sweeping (and hence never race with writes).
	//
	// This is used to quickly find whole spans that can be freed.
	//
	// TODO(austin): It would be nice if this was uint64 for
	// faster scanning, but we don't have 64-bit atomic bit
	// operations.
	pageMarks [pagesPerArena / 8]uint8
}

// arenaHint 是一个用于增长 heap arena 的 hint，见 mheap_.arenaHints
//
//go:notinheap
type arenaHint struct {
	addr uintptr
	down bool
	next *arenaHint
}

// 一个 mspan 是一系列 page
//
// 当一个 mspan 是 heap 中的树堆时， state == mspanFree
// 且 heapmap(s->start) == span, heapmap(s->start+s->npages-1) == span.
// If the mspan is in the heap scav treap, then in addition to the
// above scavenged == true. scavenged == false in all other cases.
//
// 当 mspan 被分配后, state == mspanInUse 或 mspanManual
// 且对于所有的 s->start <= i < s->start+s->npages，heapmap(i) == span。

// Every mspan is in one doubly-linked list, either in the mheap's
// busy list or one of the mcentral's span lists.

// An mspan representing actual memory has state mSpanInUse,
// mSpanManual, or mSpanFree. Transitions between these states are
// constrained as follows:
//
// * A span may transition from free to in-use or manual during any GC
//   phase.
//
// * During sweeping (gcphase == _GCoff), a span may transition from
//   in-use to free (as a result of sweeping) or manual to free (as a
//   result of stacks being freed).
//
// * During GC (gcphase != _GCoff), a span *must not* transition from
//   manual or in-use to free. Because concurrent GC may read a pointer
//   and then look up its span, the span state must be monotonic.
type mSpanState uint8

const (
	mSpanDead   mSpanState = iota
	mSpanInUse             // allocated for garbage collected heap
	mSpanManual            // allocated for manual management (e.g., stack allocator)
	mSpanFree
)

// mSpanStateNames are the names of the span states, indexed by
// mSpanState.
var mSpanStateNames = []string{
	"mSpanDead",
	"mSpanInUse",
	"mSpanManual",
	"mSpanFree",
}

// mSpanList 是一个 mspan 的双向链表
//
//go:notinheap
type mSpanList struct {
	first *mspan // first span in list, or nil if none
	last  *mspan // last span in list, or nil if none
}

// mspan 是 mSpanList 的一个节点
//go:notinheap
type mspan struct { // 双向链表
	next *mspan     // 链表中的下一个 span，如果为空则为 nil
	prev *mspan     // 链表中的前一个 span，如果为空则为 nil
	list *mSpanList // 用于调试

	startAddr uintptr // span 的第一个字节的地址，即 s.base()
	npages    uintptr // 一个 span 中的 page 数量

	manualFreeList gclinkptr // mSpanManual span 的释放对象链表

	// freeindex is the slot index between 0 and nelems at which to begin scanning
	// for the next free object in this span.
	// Each allocation scans allocBits starting at freeindex until it encounters a 0
	// indicating a free object. freeindex is then adjusted so that subsequent scans begin
	// just past the newly discovered free object.
	//
	// If freeindex == nelem, this span has no free objects.
	//
	// allocBits is a bitmap of objects in this span.
	// If n >= freeindex and allocBits[n/8] & (1<<(n%8)) is 0
	// then object n is free;
	// otherwise, object n is allocated. Bits starting at nelem are
	// undefined and should never be referenced.
	//
	// Object n starts at address n*elemsize + (start << pageShift).
	freeindex uintptr
	// TODO: Look up nelems from sizeclass and remove this field if it
	// helps performance.
	nelems uintptr // span 中对象的数量

	// freeindex 上的 allocBits 缓存。allocCache 进行了移位使其最低位对应于 freeindex 位。
	// allocCache 保存 allocBits 的补码，因此允许 ctz （计数尾零）直接使用它。
	// allocCache 可能包含 s.nelems 之外的位，调用者必须忽略它们。
	allocCache uint64

	// allocBits and gcmarkBits hold pointers to a span's mark and
	// allocation bits. The pointers are 8 byte aligned.
	// There are three arenas where this data is held.
	// free: Dirty arenas that are no longer accessed
	//       and can be reused.
	// next: Holds information to be used in the next GC cycle.
	// current: Information being used during this GC cycle.
	// previous: Information being used during the last GC cycle.
	// A new GC cycle starts with the call to finishsweep_m.
	// finishsweep_m moves the previous arena to the free arena,
	// the current arena to the previous arena, and
	// the next arena to the current arena.
	// The next arena is populated as the spans request
	// memory to hold gcmarkBits for the next GC cycle as well
	// as allocBits for newly allocated spans.
	//
	// The pointer arithmetic is done "by hand" instead of using
	// arrays to avoid bounds checks along critical performance
	// paths.
	// The sweep will free the old allocBits and set allocBits to the
	// gcmarkBits. The gcmarkBits are replaced with a fresh zeroed
	// out memory.
	allocBits  *gcBits
	gcmarkBits *gcBits

	// sweep 阶段:
	// 如果 sweepgen == h->sweepgen - 2, 则 span 需要扫描
	// 如果 sweepgen == h->sweepgen - 1, 则 span 正在被扫描
	// 如果 sweepgen == h->sweepgen, 则 span 已经被扫描可以被使用
	// if sweepgen == h->sweepgen + 1, span 在扫描开始之前被缓存并且仍然被缓存，需要扫描
	// if sweepgen == h->sweepgen + 3, span 已被清扫且被缓存并仍继续被缓存
	// h->sweepgen 每次 GC 后都增加 2

	sweepgen    uint32
	divMul      uint16     // for divide by elemsize - divMagic.mul
	baseMask    uint16     // if non-0, elemsize is a power of 2, & this will get object allocation base
	allocCount  uint16     // 分配对象的数量
	spanclass   spanClass  // 大小等级与 noscan (uint8)
	state       mSpanState // mspaninuse 等等信息
	needzero    uint8      // needs to be zeroed before allocation
	divShift    uint8      // for divide by elemsize - divMagic.shift
	divShift2   uint8      // for divide by elemsize - divMagic.shift2
	scavenged   bool       // whether this span has had its pages released to the OS
	elemsize    uintptr    // computed from sizeclass or from npages
	npreleased  uintptr    // number of pages released to the os
	limit       uintptr    // end of data in span
	speciallock mutex      // guards specials list
	specials    *special   // linked list of special records sorted by offset.
}

func (s *mspan) base() uintptr {
	return s.startAddr
}

func (s *mspan) layout() (size, n, total uintptr) {
	total = s.npages << _PageShift
	size = s.elemsize
	if size > 0 {
		n = total / size
	}
	return
}

// physPageBounds returns the start and end of the span
// rounded in to the physical page size.
func (s *mspan) physPageBounds() (uintptr, uintptr) {
	start := s.base()
	end := start + s.npages<<_PageShift
	if physPageSize > _PageSize {
		// Round start and end in.
		start = (start + physPageSize - 1) &^ (physPageSize - 1)
		end &^= physPageSize - 1
	}
	return start, end
}

func (h *mheap) coalesce(s *mspan) {
	// merge is a helper which merges other into s, deletes references to other
	// in heap metadata, and then discards it. other must be adjacent to s.
	merge := func(a, b, other *mspan) {
		// Caller must ensure a.startAddr < b.startAddr and that either a or
		// b is s. a and b must be adjacent. other is whichever of the two is
		// not s.

		if pageSize < physPageSize && a.scavenged && b.scavenged {
			// If we're merging two scavenged spans on systems where
			// pageSize < physPageSize, then their boundary should always be on
			// a physical page boundary, due to the realignment that happens
			// during coalescing. Throw if this case is no longer true, which
			// means the implementation should probably be changed to scavenge
			// along the boundary.
			_, start := a.physPageBounds()
			end, _ := b.physPageBounds()
			if start != end {
				println("runtime: a.base=", hex(a.base()), "a.npages=", a.npages)
				println("runtime: b.base=", hex(b.base()), "b.npages=", b.npages)
				println("runtime: physPageSize=", physPageSize, "pageSize=", pageSize)
				throw("neighboring scavenged spans boundary is not a physical page boundary")
			}
		}

		// Adjust s via base and npages and also in heap metadata.
		s.npages += other.npages
		s.needzero |= other.needzero
		if a == s {
			h.setSpan(s.base()+s.npages*pageSize-1, s)
		} else {
			s.startAddr = other.startAddr
			h.setSpan(s.base(), s)
		}

		// If before or s are scavenged, then we need to scavenge the final coalesced span.
		needsScavenge = needsScavenge || other.scavenged || s.scavenged
		prescavenged += other.released()

		// The size is potentially changing so the treap needs to delete adjacent nodes and
		// insert back as a combined node.
		h.free.removeSpan(other)
		other.state = mSpanDead
		h.spanalloc.free(unsafe.Pointer(other))
	}

	// realign is a helper which shrinks other and grows s such that their
	// boundary is on a physical page boundary.
	realign := func(a, b, other *mspan) {
		// Caller must ensure a.startAddr < b.startAddr and that either a or
		// b is s. a and b must be adjacent. other is whichever of the two is
		// not s.

		// If pageSize >= physPageSize then spans are always aligned
		// to physical page boundaries, so just exit.
		if pageSize >= physPageSize {
			return
		}
		// Since we're resizing other, we must remove it from the treap.
		h.free.removeSpan(other)

		// Round boundary to the nearest physical page size, toward the
		// scavenged span.
		boundary := b.startAddr
		if a.scavenged {
			boundary &^= (physPageSize - 1)
		} else {
			boundary = (boundary + physPageSize - 1) &^ (physPageSize - 1)
		}
		a.npages = (boundary - a.startAddr) / pageSize
		b.npages = (b.startAddr + b.npages*pageSize - boundary) / pageSize
		b.startAddr = boundary

		h.setSpan(boundary-1, a)
		h.setSpan(boundary, b)

		// Re-insert other now that it has a new size.
		h.free.insert(other)
	}

	hpMiddle := s.hugePages()

	// Coalesce with earlier, later spans.
	var hpBefore uintptr
	if before := spanOf(s.base() - 1); before != nil && before.state == mSpanFree {
		if s.scavenged == before.scavenged {
			hpBefore = before.hugePages()
			merge(before, s, before)
		} else {
			realign(before, s, before)
		}
	}

	// Now check to see if next (greater addresses) span is free and can be coalesced.
	var hpAfter uintptr
	if after := spanOf(s.base() + s.npages*pageSize); after != nil && after.state == mSpanFree {
		if s.scavenged == after.scavenged {
			hpAfter = after.hugePages()
			merge(s, after, after)
		} else {
			realign(s, after, after)
		}
	}

	if !s.scavenged && s.hugePages() > hpBefore+hpMiddle+hpAfter {
		// If s has grown such that it now may contain more huge pages than it
		// and its now-coalesced neighbors did before, then mark the whole region
		// as huge-page-backable.
		//
		// Otherwise, on systems where we break up huge pages (like Linux)
		// s may not be backed by huge pages because it could be made up of
		// pieces which are broken up in the underlying VMA. The primary issue
		// with this is that it can lead to a poor estimate of the amount of
		// free memory backed by huge pages for determining the scavenging rate.
		//
		// TODO(mknyszek): Measure the performance characteristics of sysHugePage
		// and determine whether it makes sense to only sysHugePage on the pages
		// that matter, or if it's better to just mark the whole region.
		sysHugePage(unsafe.Pointer(s.base()), s.npages*pageSize)
	}
}

// hugePages returns the number of aligned physical huge pages in the memory
// regioned owned by this mspan.
func (s *mspan) hugePages() uintptr {
	if physHugePageSize == 0 || s.npages < physHugePageSize/pageSize {
		return 0
	}
	start := s.base()
	end := start + s.npages*pageSize
	if physHugePageSize > pageSize {
		// Round start and end in.
		start = (start + physHugePageSize - 1) &^ (physHugePageSize - 1)
		end &^= physHugePageSize - 1
	}
	if start < end {
		return (end - start) >> physHugePageShift
	}
	return 0
}

func (s *mspan) scavenge() uintptr {
	// start and end must be rounded in, otherwise madvise
	// will round them *out* and release more memory
	// than we want.
	start, end := s.physPageBounds()
	if end <= start {
		// start and end don't span a whole physical page.
		return 0
	}
	released := end - start
	memstats.heap_released += uint64(released)
	s.scavenged = true
	sysUnused(unsafe.Pointer(start), released)
	return released
}

// released returns the number of bytes in this span
// which were returned back to the OS.
func (s *mspan) released() uintptr {
	if !s.scavenged {
		return 0
	}
	start, end := s.physPageBounds()
	return end - start
}

// recordspan 为 h.allspans 添加新分配的 span。
//
// 这仅在第一次从 mheap.spanalloc 分配 span 时发生（在重用 span 时不调用）。
//
// 这里不允许写入障碍，因为在分配新的 workbuf 时可以从 gcWork 调用它。
// 但是，因为它是来自 fixalloc 初始化程序的间接调用，所以编译器无法观察到这点。
//
//go:nowritebarrierrec
func recordspan(vh unsafe.Pointer, p unsafe.Pointer) {
	h := (*mheap)(vh)
	s := (*mspan)(p)
	if len(h.allspans) >= cap(h.allspans) {
		n := 64 * 1024 / sys.PtrSize
		if n < cap(h.allspans)*3/2 {
			n = cap(h.allspans) * 3 / 2
		}
		var new []*mspan
		sp := (*slice)(unsafe.Pointer(&new))
		sp.array = sysAlloc(uintptr(n)*sys.PtrSize, &memstats.other_sys)
		if sp.array == nil {
			throw("runtime: cannot allocate memory")
		}
		sp.len = len(h.allspans)
		sp.cap = n
		if len(h.allspans) > 0 {
			copy(new, h.allspans)
		}
		oldAllspans := h.allspans
		*(*notInHeapSlice)(unsafe.Pointer(&h.allspans)) = *(*notInHeapSlice)(unsafe.Pointer(&new))
		if len(oldAllspans) != 0 {
			sysFree(unsafe.Pointer(&oldAllspans[0]), uintptr(cap(oldAllspans))*unsafe.Sizeof(oldAllspans[0]), &memstats.other_sys)
		}
	}
	h.allspans = h.allspans[:len(h.allspans)+1]
	h.allspans[len(h.allspans)-1] = s
}

// A spanClass represents the size class and noscan-ness of a span.
//
// Each size class has a noscan spanClass and a scan spanClass. The
// noscan spanClass contains only noscan objects, which do not contain
// pointers and thus do not need to be scanned by the garbage
// collector.
type spanClass uint8

const (
	numSpanClasses = _NumSizeClasses << 1
	tinySpanClass  = spanClass(tinySizeClass<<1 | 1)
)

func makeSpanClass(sizeclass uint8, noscan bool) spanClass {
	return spanClass(sizeclass<<1) | spanClass(bool2int(noscan))
}

func (sc spanClass) sizeclass() int8 {
	return int8(sc >> 1)
}

func (sc spanClass) noscan() bool {
	return sc&1 != 0
}

// arenaIndex returns the index into mheap_.arenas of the arena
// containing metadata for p. This index combines of an index into the
// L1 map and an index into the L2 map and should be used as
// mheap_.arenas[ai.l1()][ai.l2()].
//
// If p is outside the range of valid heap addresses, either l1() or
// l2() will be out of bounds.
//
// It is nosplit because it's called by spanOf and several other
// nosplit functions.
//
//go:nosplit
func arenaIndex(p uintptr) arenaIdx {
	return arenaIdx((p + arenaBaseOffset) / heapArenaBytes)
}

// arenaBase returns the low address of the region covered by heap
// arena i.
func arenaBase(i arenaIdx) uintptr {
	return uintptr(i)*heapArenaBytes - arenaBaseOffset
}

type arenaIdx uint

func (i arenaIdx) l1() uint {
	if arenaL1Bits == 0 {
		// Let the compiler optimize this away if there's no
		// L1 map.
		return 0
	}
	return uint(i) >> arenaL1Shift
}

func (i arenaIdx) l2() uint {
	if arenaL1Bits == 0 {
		return uint(i)
	} else {
		return uint(i) & (1<<arenaL2Bits - 1)
	}
}

// inheap reports whether b is a pointer into a (potentially dead) heap object.
// It returns false for pointers into mSpanManual spans.
// Non-preemptible because it is used by write barriers.
//go:nowritebarrier
//go:nosplit
func inheap(b uintptr) bool {
	return spanOfHeap(b) != nil
}

// inHeapOrStack is a variant of inheap that returns true for pointers
// into any allocated heap span.
//
//go:nowritebarrier
//go:nosplit
func inHeapOrStack(b uintptr) bool {
	s := spanOf(b)
	if s == nil || b < s.base() {
		return false
	}
	switch s.state {
	case mSpanInUse, mSpanManual:
		return b < s.limit
	default:
		return false
	}
}

// spanOf returns the span of p. If p does not point into the heap
// arena or no span has ever contained p, spanOf returns nil.
//
// If p does not point to allocated memory, this may return a non-nil
// span that does *not* contain p. If this is a possibility, the
// caller should either call spanOfHeap or check the span bounds
// explicitly.
//
// Must be nosplit because it has callers that are nosplit.
//
//go:nosplit
func spanOf(p uintptr) *mspan {
	// This function looks big, but we use a lot of constant
	// folding around arenaL1Bits to get it under the inlining
	// budget. Also, many of the checks here are safety checks
	// that Go needs to do anyway, so the generated code is quite
	// short.
	ri := arenaIndex(p)
	if arenaL1Bits == 0 {
		// If there's no L1, then ri.l1() can't be out of bounds but ri.l2() can.
		if ri.l2() >= uint(len(mheap_.arenas[0])) {
			return nil
		}
	} else {
		// If there's an L1, then ri.l1() can be out of bounds but ri.l2() can't.
		if ri.l1() >= uint(len(mheap_.arenas)) {
			return nil
		}
	}
	l2 := mheap_.arenas[ri.l1()]
	if arenaL1Bits != 0 && l2 == nil { // Should never happen if there's no L1.
		return nil
	}
	ha := l2[ri.l2()]
	if ha == nil {
		return nil
	}
	return ha.spans[(p/pageSize)%pagesPerArena]
}

// spanOfUnchecked is equivalent to spanOf, but the caller must ensure
// that p points into an allocated heap arena.
//
// Must be nosplit because it has callers that are nosplit.
//
//go:nosplit
func spanOfUnchecked(p uintptr) *mspan {
	ai := arenaIndex(p)
	return mheap_.arenas[ai.l1()][ai.l2()].spans[(p/pageSize)%pagesPerArena]
}

// spanOfHeap is like spanOf, but returns nil if p does not point to a
// heap object.
//
// Must be nosplit because it has callers that are nosplit.
//
//go:nosplit
func spanOfHeap(p uintptr) *mspan {
	s := spanOf(p)
	// If p is not allocated, it may point to a stale span, so we
	// have to check the span's bounds and state.
	if s == nil || p < s.base() || p >= s.limit || s.state != mSpanInUse {
		return nil
	}
	return s
}

// pageIndexOf returns the arena, page index, and page mask for pointer p.
// The caller must ensure p is in the heap.
func pageIndexOf(p uintptr) (arena *heapArena, pageIdx uintptr, pageMask uint8) {
	ai := arenaIndex(p)
	arena = mheap_.arenas[ai.l1()][ai.l2()]
	pageIdx = ((p / pageSize) / 8) % uintptr(len(arena.pageInUse))
	pageMask = byte(1 << ((p / pageSize) % 8))
	return
}

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

// reclaim sweeps and reclaims at least npage pages into the heap.
// It is called before allocating npage pages to keep growth in check.
//
// reclaim implements the page-reclaimer half of the sweeper.
//
// h must NOT be locked.
func (h *mheap) reclaim(npage uintptr) {
	// This scans pagesPerChunk at a time. Higher values reduce
	// contention on h.reclaimPos, but increase the minimum
	// latency of performing a reclaim.
	//
	// Must be a multiple of the pageInUse bitmap element size.
	//
	// The time required by this can vary a lot depending on how
	// many spans are actually freed. Experimentally, it can scan
	// for pages at ~300 GB/ms on a 2.6GHz Core i7, but can only
	// free spans at ~32 MB/ms. Using 512 pages bounds this at
	// roughly 100µs.
	//
	// TODO(austin): Half of the time spent freeing spans is in
	// locking/unlocking the heap (even with low contention). We
	// could make the slow path here several times faster by
	// batching heap frees.
	const pagesPerChunk = 512

	// Bail early if there's no more reclaim work.
	if atomic.Load64(&h.reclaimIndex) >= 1<<63 {
		return
	}

	// Disable preemption so the GC can't start while we're
	// sweeping, so we can read h.sweepArenas, and so
	// traceGCSweepStart/Done pair on the P.
	mp := acquirem()

	if trace.enabled {
		traceGCSweepStart()
	}

	arenas := h.sweepArenas
	locked := false
	for npage > 0 {
		// Pull from accumulated credit first.
		if credit := atomic.Loaduintptr(&h.reclaimCredit); credit > 0 {
			take := credit
			if take > npage {
				// Take only what we need.
				take = npage
			}
			if atomic.Casuintptr(&h.reclaimCredit, credit, credit-take) {
				npage -= take
			}
			continue
		}

		// Claim a chunk of work.
		idx := uintptr(atomic.Xadd64(&h.reclaimIndex, pagesPerChunk) - pagesPerChunk)
		if idx/pagesPerArena >= uintptr(len(arenas)) {
			// Page reclaiming is done.
			atomic.Store64(&h.reclaimIndex, 1<<63)
			break
		}

		if !locked {
			// Lock the heap for reclaimChunk.
			lock(&h.lock)
			locked = true
		}

		// Scan this chunk.
		nfound := h.reclaimChunk(arenas, idx, pagesPerChunk)
		if nfound <= npage {
			npage -= nfound
		} else {
			// Put spare pages toward global credit.
			atomic.Xadduintptr(&h.reclaimCredit, nfound-npage)
			npage = 0
		}
	}
	if locked {
		unlock(&h.lock)
	}

	if trace.enabled {
		traceGCSweepDone()
	}
	releasem(mp)
}

// reclaimChunk sweeps unmarked spans that start at page indexes [pageIdx, pageIdx+n).
// It returns the number of pages returned to the heap.
//
// h.lock must be held and the caller must be non-preemptible.
func (h *mheap) reclaimChunk(arenas []arenaIdx, pageIdx, n uintptr) uintptr {
	// The heap lock must be held because this accesses the
	// heapArena.spans arrays using potentially non-live pointers.
	// In particular, if a span were freed and merged concurrently
	// with this probing heapArena.spans, it would be possible to
	// observe arbitrary, stale span pointers.
	n0 := n
	var nFreed uintptr
	sg := h.sweepgen
	for n > 0 {
		ai := arenas[pageIdx/pagesPerArena]
		ha := h.arenas[ai.l1()][ai.l2()]

		// Get a chunk of the bitmap to work on.
		arenaPage := uint(pageIdx % pagesPerArena)
		inUse := ha.pageInUse[arenaPage/8:]
		marked := ha.pageMarks[arenaPage/8:]
		if uintptr(len(inUse)) > n/8 {
			inUse = inUse[:n/8]
			marked = marked[:n/8]
		}

		// Scan this bitmap chunk for spans that are in-use
		// but have no marked objects on them.
		for i := range inUse {
			inUseUnmarked := inUse[i] &^ marked[i]
			if inUseUnmarked == 0 {
				continue
			}

			for j := uint(0); j < 8; j++ {
				if inUseUnmarked&(1<<j) != 0 {
					s := ha.spans[arenaPage+uint(i)*8+j]
					if atomic.Load(&s.sweepgen) == sg-2 && atomic.Cas(&s.sweepgen, sg-2, sg-1) {
						npages := s.npages
						unlock(&h.lock)
						if s.sweep(false) {
							nFreed += npages
						}
						lock(&h.lock)
						// Reload inUse. It's possible nearby
						// spans were freed when we dropped the
						// lock and we don't want to get stale
						// pointers from the spans array.
						inUseUnmarked = inUse[i] &^ marked[i]
					}
				}
			}
		}

		// Advance.
		pageIdx += uintptr(len(inUse) * 8)
		n -= uintptr(len(inUse) * 8)
	}
	if trace.enabled {
		// Account for pages scanned but not reclaimed.
		traceGCSweepSpan((n0 - nFreed) * pageSize)
	}
	return nFreed
}

// alloc_m is the internal implementation of mheap.alloc.
//
// alloc_m must run on the system stack because it locks the heap, so
// any stack growth during alloc_m would self-deadlock.
//
//go:systemstack
func (h *mheap) alloc_m(npage uintptr, spanclass spanClass, large bool) *mspan {
	_g_ := getg()

	// To prevent excessive heap growth, before allocating n pages
	// we need to sweep and reclaim at least n pages.
	if h.sweepdone == 0 {
		h.reclaim(npage)
	}

	lock(&h.lock)
	// transfer stats from cache to global
	memstats.heap_scan += uint64(_g_.m.mcache.local_scan)
	_g_.m.mcache.local_scan = 0
	memstats.tinyallocs += uint64(_g_.m.mcache.local_tinyallocs)
	_g_.m.mcache.local_tinyallocs = 0

	s := h.allocSpanLocked(npage, &memstats.heap_inuse)
	if s != nil {
		// Record span info, because gc needs to be
		// able to map interior pointer to containing span.
		atomic.Store(&s.sweepgen, h.sweepgen)
		h.sweepSpans[h.sweepgen/2%2].push(s) // Add to swept in-use list.
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
			memstats.heap_objects++
			mheap_.largealloc += uint64(s.elemsize)
			mheap_.nlargealloc++
			atomic.Xadd64(&memstats.heap_live, int64(npage<<_PageShift))
		}
	}
	// heap_scan and heap_live were updated.
	if gcBlackenEnabled != 0 {
		gcController.revise()
	}

	if trace.enabled {
		traceHeapAlloc()
	}

	// h.spans is accessed concurrently without synchronization
	// from other threads. Hence, there must be a store/store
	// barrier here to ensure the writes to h.spans above happen
	// before the caller can publish a pointer p to an object
	// allocated from s. As soon as this happens, the garbage
	// collector running on another processor could read p and
	// look up s in h.spans. The unlock acts as the barrier to
	// order these writes. On the read side, the data dependency
	// between p and the index in h.spans orders the reads.
	unlock(&h.lock)
	return s
}

// alloc allocates a new span of npage pages from the GC'd heap.
//
// Either large must be true or spanclass must indicates the span's
// size class and scannability.
//
// If needzero is true, the memory for the returned span will be zeroed.
func (h *mheap) alloc(npage uintptr, spanclass spanClass, large bool, needzero bool) *mspan {
	// Don't do any operations that lock the heap on the G stack.
	// It might trigger stack growth, and the stack growth code needs
	// to be able to allocate heap.
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

// allocManual allocates a manually-managed span of npage pages.
// allocManual returns nil if allocation fails.
// allocManual 分配一个具有 npage 页数的手动管理的 span。
//
// allocManual adds the bytes used to *stat, which should be a
// memstats in-use field. Unlike allocations in the GC'd heap, the
// allocation does *not* count toward heap_inuse or heap_sys.
// allocManual 会增加使用的字节数到 *stat, 也就是 memstats 中 in-used 字段
// 与 GC 堆中分配不同的是，这里的分配不会计入 heap_inuse 或者 heap_sys。
//
// The memory backing the returned span may not be zeroed if
// span.needzero is set.
// 内存
//
// allocManual must be called on the system stack because it acquires
// the heap lock. See mheap for details.
//
//go:systemstack
func (h *mheap) allocManual(npage uintptr, stat *uint64) *mspan {
	lock(&h.lock)
	s := h.allocSpanLocked(npage, stat)
	if s != nil {
		s.state = mSpanManual
		s.manualFreeList = 0
		s.allocCount = 0
		s.spanclass = 0
		s.nelems = 0
		s.elemsize = 0
		s.limit = s.base() + s.npages<<_PageShift
		// 手动管理的内存不会计入 heap_sys
		memstats.heap_sys -= uint64(s.npages << _PageShift)
	}

	// This unlock acts as a release barrier. See mheap.alloc_m.
	unlock(&h.lock)

	return s
}

// setSpan modifies the span map so spanOf(base) is s.
func (h *mheap) setSpan(base uintptr, s *mspan) {
	ai := arenaIndex(base)
	h.arenas[ai.l1()][ai.l2()].spans[(base/pageSize)%pagesPerArena] = s
}

// setSpans modifies the span map so [spanOf(base), spanOf(base+npage*pageSize))
// is s.
func (h *mheap) setSpans(base, npage uintptr, s *mspan) {
	p := base / pageSize
	ai := arenaIndex(base)
	ha := h.arenas[ai.l1()][ai.l2()]
	for n := uintptr(0); n < npage; n++ {
		i := (p + n) % pagesPerArena
		if i == 0 {
			ai = arenaIndex(base + n*pageSize)
			ha = h.arenas[ai.l1()][ai.l2()]
		}
		ha.spans[i] = s
	}
}

// Allocates a span of the given size.  h must be locked.
// The returned span has been removed from the
// free structures, but its state is still mSpanFree.
// 分配一个给定大小的 span。h 必须锁住
// 返回的 span 必须从 free 结构中移除，但它的状态仍然是 mSpanFree
func (h *mheap) allocSpanLocked(npage uintptr, stat *uint64) *mspan {
	t := h.free.find(npage)
	if t.valid() {
		goto HaveSpan
	}
	if !h.grow(npage) {
		return nil
	}
	t = h.free.find(npage)
	if t.valid() {
		goto HaveSpan
	}
	throw("grew heap, but no adequate free span found")

HaveSpan:
	s := t.span()
	if s.state != mSpanFree {
		throw("candidate mspan for allocation is not free")
	}
	if s.npages < npage {
		throw("candidate mspan for allocation is too small")
	}

	// First, subtract any memory that was released back to
	// the OS from s. We will add back what's left if necessary.
	memstats.heap_released -= uint64(s.released())

	if s.npages == npage {
		h.free.erase(t)
	} else if s.npages > npage {
		// Trim off the lower bits and make that our new span.
		// Do this in-place since this operation does not
		// affect the original span's location in the treap.
		n := (*mspan)(h.spanalloc.alloc())
		h.free.mutate(t, func(s *mspan) {
			n.init(s.base(), npage)
			s.npages -= npage
			s.startAddr = s.base() + npage*pageSize
			h.setSpan(s.base()-1, n)
			h.setSpan(s.base(), s)
			h.setSpan(n.base(), n)
			n.needzero = s.needzero
			// n may not be big enough to actually be scavenged, but that's fine.
			// We still want it to appear to be scavenged so that we can do the
			// right bookkeeping later on in this function (i.e. sysUsed).
			n.scavenged = s.scavenged
			// Check if s is still scavenged.
			if s.scavenged {
				start, end := s.physPageBounds()
				if start < end {
					memstats.heap_released += uint64(end - start)
				} else {
					s.scavenged = false
				}
			}
		})
		s = n
	} else {
		throw("candidate mspan for allocation is too small")
	}
	// "Unscavenge" s only AFTER splitting so that
	// we only sysUsed whatever we actually need.
	if s.scavenged {
		// sysUsed all the pages that are actually available
		// in the span. Note that we don't need to decrement
		// heap_released since we already did so earlier.
		sysUsed(unsafe.Pointer(s.base()), s.npages<<_PageShift)
		s.scavenged = false

		// Since we allocated out of a scavenged span, we just
		// grew the RSS. Mitigate this by scavenging enough free
		// space to make up for it but only if we need to.
		//
		// scavengeLocked may cause coalescing, so prevent
		// coalescing with s by temporarily changing its state.
		s.state = mSpanManual
		h.scavengeIfNeededLocked(s.npages * pageSize)
		s.state = mSpanFree
	}
	s.unusedsince = 0

	h.setSpans(s.base(), npage, s)

	*stat += uint64(npage << _PageShift)
	memstats.heap_idle -= uint64(npage << _PageShift)

	if s.inList() {
		throw("still in list")
	}
	return s
}

// Try to add at least npage pages of memory to the heap,
// returning whether it worked.
//
// h must be locked.
func (h *mheap) grow(npage uintptr) bool {
	ask := npage << _PageShift
	v, size := h.sysAlloc(ask)
	if v == nil {
		print("runtime: out of memory: cannot allocate ", ask, "-byte block (", memstats.heap_sys, " in use)\n")
		return false
	}

	// Create a fake "in use" span and free it, so that the
	// right accounting and coalescing happens.
	s := (*mspan)(h.spanalloc.alloc())
	s.init(uintptr(v), size/pageSize)
	h.setSpans(s.base(), s.npages, s)
	s.state = mSpanFree
	memstats.heap_idle += uint64(size)
	// (*mheap).sysAlloc returns untouched/uncommitted memory.
	s.scavenged = true
	// s is always aligned to the heap arena size which is always > physPageSize,
	// so its totally safe to just add directly to heap_released. Coalescing,
	// if possible, will also always be correct in terms of accounting, because
	// s.base() must be a physical page boundary.
	memstats.heap_released += uint64(size)
	h.coalesce(s)
	h.free.insert(s)
	return true
}

// Free the span back into the heap.
//
// large must match the value of large passed to mheap.alloc. This is
// used for accounting.
func (h *mheap) freeSpan(s *mspan, large bool) {
	systemstack(func() {
		mp := getg().m
		lock(&h.lock)
		memstats.heap_scan += uint64(mp.mcache.local_scan)
		mp.mcache.local_scan = 0
		memstats.tinyallocs += uint64(mp.mcache.local_tinyallocs)
		mp.mcache.local_tinyallocs = 0
		if msanenabled {
			// Tell msan that this entire span is no longer in use.
			base := unsafe.Pointer(s.base())
			bytes := s.npages << _PageShift
			msanfree(base, bytes)
		}
		if large {
			// Match accounting done in mheap.alloc.
			memstats.heap_objects--
		}
		if gcBlackenEnabled != 0 {
			// heap_scan changed.
			gcController.revise()
		}
		h.freeSpanLocked(s, true, true)
		unlock(&h.lock)
	})
}

// freeManual frees a manually-managed span returned by allocManual.
// stat must be the same as the stat passed to the allocManual that
// allocated s.
//
// This must only be called when gcphase == _GCoff. See mSpanState for
// an explanation.
//
// freeManual must be called on the system stack because it acquires
// the heap lock. See mheap for details.
//
//go:systemstack
func (h *mheap) freeManual(s *mspan, stat *uint64) {
	s.needzero = 1
	lock(&h.lock)
	*stat -= uint64(s.npages << _PageShift)
	memstats.heap_sys += uint64(s.npages << _PageShift)
	h.freeSpanLocked(s, false, true)
	unlock(&h.lock)
}

// s must be on the busy list or unlinked.
func (h *mheap) freeSpanLocked(s *mspan, acctinuse, acctidle bool) {
	switch s.state {
	case mSpanManual:
		if s.allocCount != 0 {
			throw("mheap.freeSpanLocked - invalid stack free")
		}
	case mSpanInUse:
		if s.allocCount != 0 || s.sweepgen != h.sweepgen {
			print("mheap.freeSpanLocked - span ", s, " ptr ", hex(s.base()), " allocCount ", s.allocCount, " sweepgen ", s.sweepgen, "/", h.sweepgen, "\n")
			throw("mheap.freeSpanLocked - invalid free")
		}
		h.pagesInUse -= uint64(s.npages)

		// Clear in-use bit in arena page bitmap.
		arena, pageIdx, pageMask := pageIndexOf(s.base())
		arena.pageInUse[pageIdx] &^= pageMask
	default:
		throw("mheap.freeSpanLocked - invalid span state")
	}

	if acctinuse {
		memstats.heap_inuse -= uint64(s.npages << _PageShift)
	}
	if acctidle {
		memstats.heap_idle += uint64(s.npages << _PageShift)
	}
	s.state = mSpanFree

	// Coalesce span with neighbors.
	h.coalesce(s)

	// Insert s into the treap.
	h.free.insert(s)
}

// scavengeSplit takes t.span() and attempts to split off a span containing size
// (in bytes) worth of physical pages from the back.
//
// The split point is only approximately defined by size since the split point
// is aligned to physPageSize and pageSize every time. If physHugePageSize is
// non-zero and the split point would break apart a huge page in the span, then
// the split point is also aligned to physHugePageSize.
//
// If the desired split point ends up at the base of s, or if size is obviously
// much larger than s, then a split is not possible and this method returns nil.
// Otherwise if a split occurred it returns the newly-created span.
func (h *mheap) scavengeSplit(t treapIter, size uintptr) *mspan {
	s := t.span()
	start, end := s.physPageBounds()
	if end <= start || end-start <= size {
		// Size covers the whole span.
		return nil
	}
	// The span is bigger than what we need, so compute the base for the new
	// span if we decide to split.
	base := end - size
	// Round down to the next physical or logical page, whichever is bigger.
	base &^= (physPageSize - 1) | (pageSize - 1)
	if base <= start {
		return nil
	}
	if physHugePageSize > pageSize && base&^(physHugePageSize-1) >= start {
		// We're in danger of breaking apart a huge page, so include the entire
		// huge page in the bound by rounding down to the huge page size.
		// base should still be aligned to pageSize.
		base &^= physHugePageSize - 1
	}
	if base == start {
		// After all that we rounded base down to s.base(), so no need to split.
		return nil
	}
	if base < start {
		print("runtime: base=", base, ", s.npages=", s.npages, ", s.base()=", s.base(), ", size=", size, "\n")
		print("runtime: physPageSize=", physPageSize, ", physHugePageSize=", physHugePageSize, "\n")
		throw("bad span split base")
	}

	// Split s in-place, removing from the back.
	n := (*mspan)(h.spanalloc.alloc())
	nbytes := s.base() + s.npages*pageSize - base
	h.free.mutate(t, func(s *mspan) {
		n.init(base, nbytes/pageSize)
		s.npages -= nbytes / pageSize
		h.setSpan(n.base()-1, s)
		h.setSpan(n.base(), n)
		h.setSpan(n.base()+nbytes-1, n)
		n.needzero = s.needzero
		n.state = s.state
	})
	return n
}

// scavengeLocked scavenges nbytes worth of spans in the free treap by
// starting from the span with the highest base address and working down.
// It then takes those spans and places them in scav.
//
// Returns the amount of memory scavenged in bytes. h must be locked.
func (h *mheap) scavengeLocked(nbytes uintptr) uintptr {
	released := uintptr(0)
	// Iterate over spans with huge pages first, then spans without.
	const mask = treapIterScav | treapIterHuge
	for _, match := range []treapIterType{treapIterHuge, 0} {
		// Iterate over the treap backwards (from highest address to lowest address)
		// scavenging spans until we've reached our quota of nbytes.
		for t := h.free.end(mask, match); released < nbytes && t.valid(); {
			s := t.span()
			start, end := s.physPageBounds()
			if start >= end {
				// This span doesn't cover at least one physical page, so skip it.
				t = t.prev()
				continue
			}
			n := t.prev()
			if span := h.scavengeSplit(t, nbytes-released); span != nil {
				s = span
			} else {
				h.free.erase(t)
			}
			released += s.scavenge()
			// Now that s is scavenged, we must eagerly coalesce it
			// with its neighbors to prevent having two spans with
			// the same scavenged state adjacent to each other.
			h.coalesce(s)
			t = n
			h.free.insert(s)
		}
	}
	return released
}

// scavengeIfNeededLocked calls scavengeLocked if we're currently above the
// scavenge goal in order to prevent the mutator from out-running the
// the scavenger.
//
// h must be locked.
func (h *mheap) scavengeIfNeededLocked(size uintptr) {
	if r := heapRetained(); r+uint64(size) > h.scavengeRetainedGoal {
		todo := uint64(size)
		// If we're only going to go a little bit over, just request what
		// we actually need done.
		if overage := r + uint64(size) - h.scavengeRetainedGoal; overage < todo {
			todo = overage
		}
		h.scavengeLocked(uintptr(todo))
	}
}

// scavengeAll visits each node in the free treap and scavenges the
// treapNode's span. It then removes the scavenged span from
// unscav and adds it into scav before continuing.
func (h *mheap) scavengeAll() {
	// Disallow malloc or panic while holding the heap lock. We do
	// this here because this is an non-mallocgc entry-point to
	// the mheap API.
	gp := getg()
	gp.m.mallocing++
	lock(&h.lock)
	released := h.scavengeLocked(^uintptr(0))
	unlock(&h.lock)
	gp.m.mallocing--

	if debug.gctrace > 0 {
		if released > 0 {
			print("forced scvg: ", released>>20, " MB released\n")
		}
		print("forced scvg: inuse: ", memstats.heap_inuse>>20, ", idle: ", memstats.heap_idle>>20, ", sys: ", memstats.heap_sys>>20, ", released: ", memstats.heap_released>>20, ", consumed: ", (memstats.heap_sys-memstats.heap_released)>>20, " (MB)\n")
	}
}

//go:linkname runtime_debug_freeOSMemory runtime/debug.freeOSMemory
func runtime_debug_freeOSMemory() {
	GC()
	systemstack(func() { mheap_.scavengeAll() })
}

// Initialize a new span with the given start and npages.
func (span *mspan) init(base uintptr, npages uintptr) {
	// span is *not* zeroed.
	span.next = nil
	span.prev = nil
	span.list = nil
	span.startAddr = base
	span.npages = npages
	span.allocCount = 0
	span.spanclass = 0
	span.elemsize = 0
	span.state = mSpanDead
	span.scavenged = false
	span.speciallock.key = 0
	span.specials = nil
	span.needzero = 0
	span.freeindex = 0
	span.allocBits = nil
	span.gcmarkBits = nil
}

func (span *mspan) inList() bool {
	return span.list != nil
}

// Initialize an empty doubly-linked list.
func (list *mSpanList) init() {
	list.first = nil
	list.last = nil
}

func (list *mSpanList) remove(span *mspan) {
	if span.list != list {
		print("runtime: failed mSpanList.remove span.npages=", span.npages,
			" span=", span, " prev=", span.prev, " span.list=", span.list, " list=", list, "\n")
		throw("mSpanList.remove")
	}
	if list.first == span {
		list.first = span.next
	} else {
		span.prev.next = span.next
	}
	if list.last == span {
		list.last = span.prev
	} else {
		span.next.prev = span.prev
	}
	span.next = nil
	span.prev = nil
	span.list = nil
}

func (list *mSpanList) isEmpty() bool {
	return list.first == nil
}

func (list *mSpanList) insert(span *mspan) {
	if span.next != nil || span.prev != nil || span.list != nil {
		println("runtime: failed mSpanList.insert", span, span.next, span.prev, span.list)
		throw("mSpanList.insert")
	}
	span.next = list.first
	if list.first != nil {
		// The list contains at least one span; link it in.
		// The last span in the list doesn't change.
		list.first.prev = span
	} else {
		// The list contains no spans, so this is also the last span.
		list.last = span
	}
	list.first = span
	span.list = list
}

func (list *mSpanList) insertBack(span *mspan) {
	if span.next != nil || span.prev != nil || span.list != nil {
		println("runtime: failed mSpanList.insertBack", span, span.next, span.prev, span.list)
		throw("mSpanList.insertBack")
	}
	span.prev = list.last
	if list.last != nil {
		// The list contains at least one span.
		list.last.next = span
	} else {
		// The list contains no spans, so this is also the first span.
		list.first = span
	}
	list.last = span
	span.list = list
}

// takeAll removes all spans from other and inserts them at the front
// of list.
func (list *mSpanList) takeAll(other *mSpanList) {
	if other.isEmpty() {
		return
	}

	// Reparent everything in other to list.
	for s := other.first; s != nil; s = s.next {
		s.list = list
	}

	// Concatenate the lists.
	if list.isEmpty() {
		*list = *other
	} else {
		// Neither list is empty. Put other before list.
		other.last.next = list.first
		list.first.prev = other.last
		list.first = other.first
	}

	other.first, other.last = nil, nil
}

const (
	_KindSpecialFinalizer = 1
	_KindSpecialProfile   = 2
	// Note: The finalizer special must be first because if we're freeing
	// an object, a finalizer special will cause the freeing operation
	// to abort, and we want to keep the other special records around
	// if that happens.
)

//go:notinheap
type special struct {
	next   *special // linked list in span
	offset uint16   // span offset of object
	kind   byte     // kind of special
}

// Adds the special record s to the list of special records for
// the object p. All fields of s should be filled in except for
// offset & next, which this routine will fill in.
// Returns true if the special was successfully added, false otherwise.
// (The add will fail only if a record with the same p and s->kind
//  already exists.)
func addspecial(p unsafe.Pointer, s *special) bool {
	span := spanOfHeap(uintptr(p))
	if span == nil {
		throw("addspecial on invalid pointer")
	}

	// Ensure that the span is swept.
	// Sweeping accesses the specials list w/o locks, so we have
	// to synchronize with it. And it's just much safer.
	mp := acquirem()
	span.ensureSwept()

	offset := uintptr(p) - span.base()
	kind := s.kind

	lock(&span.speciallock)

	// Find splice point, check for existing record.
	t := &span.specials
	for {
		x := *t
		if x == nil {
			break
		}
		if offset == uintptr(x.offset) && kind == x.kind {
			unlock(&span.speciallock)
			releasem(mp)
			return false // already exists
		}
		if offset < uintptr(x.offset) || (offset == uintptr(x.offset) && kind < x.kind) {
			break
		}
		t = &x.next
	}

	// Splice in record, fill in offset.
	s.offset = uint16(offset)
	s.next = *t
	*t = s
	unlock(&span.speciallock)
	releasem(mp)

	return true
}

// Removes the Special record of the given kind for the object p.
// Returns the record if the record existed, nil otherwise.
// The caller must FixAlloc_Free the result.
func removespecial(p unsafe.Pointer, kind uint8) *special {
	span := spanOfHeap(uintptr(p))
	if span == nil {
		throw("removespecial on invalid pointer")
	}

	// Ensure that the span is swept.
	// Sweeping accesses the specials list w/o locks, so we have
	// to synchronize with it. And it's just much safer.
	mp := acquirem()
	span.ensureSwept()

	offset := uintptr(p) - span.base()

	lock(&span.speciallock)
	t := &span.specials
	for {
		s := *t
		if s == nil {
			break
		}
		// This function is used for finalizers only, so we don't check for
		// "interior" specials (p must be exactly equal to s->offset).
		if offset == uintptr(s.offset) && kind == s.kind {
			*t = s.next
			unlock(&span.speciallock)
			releasem(mp)
			return s
		}
		t = &s.next
	}
	unlock(&span.speciallock)
	releasem(mp)
	return nil
}

// The described object has a finalizer set for it.
//
// specialfinalizer is allocated from non-GC'd memory, so any heap
// pointers must be specially handled.
//
//go:notinheap
type specialfinalizer struct {
	special special
	fn      *funcval // May be a heap pointer.
	nret    uintptr
	fint    *_type   // May be a heap pointer, but always live.
	ot      *ptrtype // May be a heap pointer, but always live.
}

// Adds a finalizer to the object p. Returns true if it succeeded.
func addfinalizer(p unsafe.Pointer, f *funcval, nret uintptr, fint *_type, ot *ptrtype) bool {
	lock(&mheap_.speciallock)
	s := (*specialfinalizer)(mheap_.specialfinalizeralloc.alloc())
	unlock(&mheap_.speciallock)
	s.special.kind = _KindSpecialFinalizer
	s.fn = f
	s.nret = nret
	s.fint = fint
	s.ot = ot
	if addspecial(p, &s.special) {
		// This is responsible for maintaining the same
		// GC-related invariants as markrootSpans in any
		// situation where it's possible that markrootSpans
		// has already run but mark termination hasn't yet.
		if gcphase != _GCoff {
			base, _, _ := findObject(uintptr(p), 0, 0)
			mp := acquirem()
			gcw := &mp.p.ptr().gcw
			// Mark everything reachable from the object
			// so it's retained for the finalizer.
			scanobject(base, gcw)
			// Mark the finalizer itself, since the
			// special isn't part of the GC'd heap.
			scanblock(uintptr(unsafe.Pointer(&s.fn)), sys.PtrSize, &oneptrmask[0], gcw, nil)
			releasem(mp)
		}
		return true
	}

	// There was an old finalizer
	lock(&mheap_.speciallock)
	mheap_.specialfinalizeralloc.free(unsafe.Pointer(s))
	unlock(&mheap_.speciallock)
	return false
}

// Removes the finalizer (if any) from the object p.
func removefinalizer(p unsafe.Pointer) {
	s := (*specialfinalizer)(unsafe.Pointer(removespecial(p, _KindSpecialFinalizer)))
	if s == nil {
		return // there wasn't a finalizer to remove
	}
	lock(&mheap_.speciallock)
	mheap_.specialfinalizeralloc.free(unsafe.Pointer(s))
	unlock(&mheap_.speciallock)
}

// The described object is being heap profiled.
//
//go:notinheap
type specialprofile struct {
	special special
	b       *bucket
}

// Set the heap profile bucket associated with addr to b.
func setprofilebucket(p unsafe.Pointer, b *bucket) {
	lock(&mheap_.speciallock)
	s := (*specialprofile)(mheap_.specialprofilealloc.alloc())
	unlock(&mheap_.speciallock)
	s.special.kind = _KindSpecialProfile
	s.b = b
	if !addspecial(p, &s.special) {
		throw("setprofilebucket: profile already set")
	}
}

// Do whatever cleanup needs to be done to deallocate s. It has
// already been unlinked from the mspan specials list.
func freespecial(s *special, p unsafe.Pointer, size uintptr) {
	switch s.kind {
	case _KindSpecialFinalizer:
		sf := (*specialfinalizer)(unsafe.Pointer(s))
		queuefinalizer(p, sf.fn, sf.nret, sf.fint, sf.ot)
		lock(&mheap_.speciallock)
		mheap_.specialfinalizeralloc.free(unsafe.Pointer(sf))
		unlock(&mheap_.speciallock)
	case _KindSpecialProfile:
		sp := (*specialprofile)(unsafe.Pointer(s))
		mProf_Free(sp.b, size)
		lock(&mheap_.speciallock)
		mheap_.specialprofilealloc.free(unsafe.Pointer(sp))
		unlock(&mheap_.speciallock)
	default:
		throw("bad special kind")
		panic("not reached")
	}
}

// gcBits is an alloc/mark bitmap. This is always used as *gcBits.
//
//go:notinheap
type gcBits uint8

// bytep returns a pointer to the n'th byte of b.
func (b *gcBits) bytep(n uintptr) *uint8 {
	return addb((*uint8)(b), n)
}

// bitp returns a pointer to the byte containing bit n and a mask for
// selecting that bit from *bytep.
func (b *gcBits) bitp(n uintptr) (bytep *uint8, mask uint8) {
	return b.bytep(n / 8), 1 << (n % 8)
}

const gcBitsChunkBytes = uintptr(64 << 10)
const gcBitsHeaderBytes = unsafe.Sizeof(gcBitsHeader{})

type gcBitsHeader struct {
	free uintptr // free is the index into bits of the next free byte.
	next uintptr // *gcBits triggers recursive type bug. (issue 14620)
}

//go:notinheap
type gcBitsArena struct {
	// gcBitsHeader // side step recursive type bug (issue 14620) by including fields by hand.
	free uintptr // free is the index into bits of the next free byte; read/write atomically
	next *gcBitsArena
	bits [gcBitsChunkBytes - gcBitsHeaderBytes]gcBits
}

var gcBitsArenas struct {
	lock     mutex
	free     *gcBitsArena
	next     *gcBitsArena // Read atomically. Write atomically under lock.
	current  *gcBitsArena
	previous *gcBitsArena
}

// tryAlloc allocates from b or returns nil if b does not have enough room.
// This is safe to call concurrently.
func (b *gcBitsArena) tryAlloc(bytes uintptr) *gcBits {
	if b == nil || atomic.Loaduintptr(&b.free)+bytes > uintptr(len(b.bits)) {
		return nil
	}
	// Try to allocate from this block.
	end := atomic.Xadduintptr(&b.free, bytes)
	if end > uintptr(len(b.bits)) {
		return nil
	}
	// There was enough room.
	start := end - bytes
	return &b.bits[start]
}

// newMarkBits returns a pointer to 8 byte aligned bytes
// to be used for a span's mark bits.
func newMarkBits(nelems uintptr) *gcBits {
	blocksNeeded := uintptr((nelems + 63) / 64)
	bytesNeeded := blocksNeeded * 8

	// Try directly allocating from the current head arena.
	head := (*gcBitsArena)(atomic.Loadp(unsafe.Pointer(&gcBitsArenas.next)))
	if p := head.tryAlloc(bytesNeeded); p != nil {
		return p
	}

	// There's not enough room in the head arena. We may need to
	// allocate a new arena.
	lock(&gcBitsArenas.lock)
	// Try the head arena again, since it may have changed. Now
	// that we hold the lock, the list head can't change, but its
	// free position still can.
	if p := gcBitsArenas.next.tryAlloc(bytesNeeded); p != nil {
		unlock(&gcBitsArenas.lock)
		return p
	}

	// Allocate a new arena. This may temporarily drop the lock.
	fresh := newArenaMayUnlock()
	// If newArenaMayUnlock dropped the lock, another thread may
	// have put a fresh arena on the "next" list. Try allocating
	// from next again.
	if p := gcBitsArenas.next.tryAlloc(bytesNeeded); p != nil {
		// Put fresh back on the free list.
		// TODO: Mark it "already zeroed"
		fresh.next = gcBitsArenas.free
		gcBitsArenas.free = fresh
		unlock(&gcBitsArenas.lock)
		return p
	}

	// Allocate from the fresh arena. We haven't linked it in yet, so
	// this cannot race and is guaranteed to succeed.
	p := fresh.tryAlloc(bytesNeeded)
	if p == nil {
		throw("markBits overflow")
	}

	// Add the fresh arena to the "next" list.
	fresh.next = gcBitsArenas.next
	atomic.StorepNoWB(unsafe.Pointer(&gcBitsArenas.next), unsafe.Pointer(fresh))

	unlock(&gcBitsArenas.lock)
	return p
}

// newAllocBits returns a pointer to 8 byte aligned bytes
// to be used for this span's alloc bits.
// newAllocBits is used to provide newly initialized spans
// allocation bits. For spans not being initialized the
// mark bits are repurposed as allocation bits when
// the span is swept.
func newAllocBits(nelems uintptr) *gcBits {
	return newMarkBits(nelems)
}

// nextMarkBitArenaEpoch establishes a new epoch for the arenas
// holding the mark bits. The arenas are named relative to the
// current GC cycle which is demarcated by the call to finishweep_m.
//
// All current spans have been swept.
// During that sweep each span allocated room for its gcmarkBits in
// gcBitsArenas.next block. gcBitsArenas.next becomes the gcBitsArenas.current
// where the GC will mark objects and after each span is swept these bits
// will be used to allocate objects.
// gcBitsArenas.current becomes gcBitsArenas.previous where the span's
// gcAllocBits live until all the spans have been swept during this GC cycle.
// The span's sweep extinguishes all the references to gcBitsArenas.previous
// by pointing gcAllocBits into the gcBitsArenas.current.
// The gcBitsArenas.previous is released to the gcBitsArenas.free list.
func nextMarkBitArenaEpoch() {
	lock(&gcBitsArenas.lock)
	if gcBitsArenas.previous != nil {
		if gcBitsArenas.free == nil {
			gcBitsArenas.free = gcBitsArenas.previous
		} else {
			// Find end of previous arenas.
			last := gcBitsArenas.previous
			for last = gcBitsArenas.previous; last.next != nil; last = last.next {
			}
			last.next = gcBitsArenas.free
			gcBitsArenas.free = gcBitsArenas.previous
		}
	}
	gcBitsArenas.previous = gcBitsArenas.current
	gcBitsArenas.current = gcBitsArenas.next
	atomic.StorepNoWB(unsafe.Pointer(&gcBitsArenas.next), nil) // newMarkBits calls newArena when needed
	unlock(&gcBitsArenas.lock)
}

// newArenaMayUnlock allocates and zeroes a gcBits arena.
// The caller must hold gcBitsArena.lock. This may temporarily release it.
func newArenaMayUnlock() *gcBitsArena {
	var result *gcBitsArena
	if gcBitsArenas.free == nil {
		unlock(&gcBitsArenas.lock)
		result = (*gcBitsArena)(sysAlloc(gcBitsChunkBytes, &memstats.gc_sys))
		if result == nil {
			throw("runtime: cannot allocate memory")
		}
		lock(&gcBitsArenas.lock)
	} else {
		result = gcBitsArenas.free
		gcBitsArenas.free = gcBitsArenas.free.next
		memclrNoHeapPointers(unsafe.Pointer(result), gcBitsChunkBytes)
	}
	result.next = nil
	// If result.bits is not 8 byte aligned adjust index so
	// that &result.bits[result.free] is 8 byte aligned.
	if uintptr(unsafe.Offsetof(gcBitsArena{}.bits))&7 == 0 {
		result.free = 0
	} else {
		result.free = 8 - (uintptr(unsafe.Pointer(&result.bits[0])) & 7)
	}
	return result
}
