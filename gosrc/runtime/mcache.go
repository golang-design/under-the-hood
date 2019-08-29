// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

import (
	"runtime/internal/atomic"
	"unsafe"
)

// 小对象的 Per-thread (per-M) 缓存
// 无需加锁，因为是 per-thread (per-M) 的
//
// mcache 从非 GC 内存上分配，因此任何堆指针必须进行特殊处理
//
//go:notinheap
type mcache struct {
	// 下面的成员在每次 malloc 时都会被访问
	// 因此将它们放到一起来利用缓存的局部性原理
	next_sample uintptr	// 分配这么多字节后触发堆样本
	local_scan  uintptr // 分配的可扫描堆的字节数

	// 没有指针的微小对象的分配器缓存。
	// 请参考 malloc.go 中的 "小型分配器" 注释。
	//
	// tiny 指向当前 tiny 块的起始位置，或当没有 tiny 块时候为 nil
	// tiny 是一个堆指针。由于 mcache 在非 GC 内存中，我们通过在
	// mark termination 期间在 releaseAll 中清除它来处理它。
	tiny             uintptr
	tinyoffset       uintptr
	local_tinyallocs uintptr // 不计入其他统计的极小分配的数量

	// 下面的不在每个 malloc 时被访问

	alloc [numSpanClasses]*mspan // 用来分配的 spans，由 spanClass 索引

	stackcache [_NumStackOrders]stackfreelist

	// 本地分配器统计，在 GC 期间被刷新
	local_largefree  uintptr                  // bytes freed for large objects (>maxsmallsize)
	local_nlargefree uintptr                  // number of frees for large objects (>maxsmallsize)
	local_nsmallfree [_NumSizeClasses]uintptr // number of frees for small objects (<=maxsmallsize)

	// flushGen indicates the sweepgen during which this mcache
	// was last flushed. If flushGen != mheap_.sweepgen, the spans
	// in this mcache are stale and need to the flushed so they
	// can be swept. This is done in acquirep.
	flushGen uint32
}

// A gclink is a node in a linked list of blocks, like mlink,
// but it is opaque to the garbage collector.
// The GC does not trace the pointers during collection,
// and the compiler does not emit write barriers for assignments
// of gclinkptr values. Code should store references to gclinks
// as gclinkptr, not as *gclink.
type gclink struct {
	next gclinkptr
}

// gclinkptr 是指向 gclink 的指针，但它对垃圾收集器是不透明的。
type gclinkptr uintptr

// ptr returns the *gclink form of p.
// The result should be used for accessing fields, not stored
// in other data structures.
func (p gclinkptr) ptr() *gclink {
	return (*gclink)(unsafe.Pointer(p))
}

type stackfreelist struct {
	list gclinkptr // linked list of free stacks
	size uintptr   // total size of stacks in list
}

// 虚拟的 mspan，不包含任何对象。
var emptymspan mspan

func allocmcache() *mcache {
	var c *mcache
	systemstack(func() {
		lock(&mheap_.lock)
		c = (*mcache)(mheap_.cachealloc.alloc())
		c.flushGen = mheap_.sweepgen
		unlock(&mheap_.lock)
	}
	for i := range c.alloc {
		c.alloc[i] = &emptymspan // 暂时指向虚拟的 mspan 中
	}
	// 返回下一个采样点，是服从泊松过程的随机数
	c.next_sample = nextSample()
	return c
}

func freemcache(c *mcache) {
	systemstack(func() {
		// 归还 span
		c.releaseAll()
		// 释放 stack
		stackcache_clear(c)

		lock(&mheap_.lock)
		// 记录局部统计
		purgecachedstats(c)
		// 将 mcache 释放
		mheap_.cachealloc.free(unsafe.Pointer(c))
		unlock(&mheap_.lock)
	})
}

// refill为 c 获取 span class spc 的新 span。此 span 将至少有一个自由对象。
// c 中的当前 span 必须已满。
// 必须在非可抢占的上下文中运行，否则 c 的所有者可能会更改。
func (c *mcache) refill(spc spanClass) {
	_g_ := getg()

	_g_.m.locks++
	// Return the current cached span to the central lists.
	s := c.alloc[spc]

	if uintptr(s.allocCount) != s.nelems {
		throw("refill of span with free space remaining")
	}
	if s != &emptymspan {
		// Mark this span as no longer cached.
		if s.sweepgen != mheap_.sweepgen+3 {
			throw("bad sweepgen in refill")
		}
		atomic.Store(&s.sweepgen, mheap_.sweepgen)
	}

	// Get a new cached span from the central lists.
	s = mheap_.central[spc].mcentral.cacheSpan()
	if s == nil {
		throw("out of memory")
	}

	if uintptr(s.allocCount) == s.nelems {
		throw("span has no free space")
	}
	// Indicate that this span is cached and prevent asynchronous
	// sweeping in the next sweep phase.
	s.sweepgen = mheap_.sweepgen + 3

	c.alloc[spc] = s
}

func (c *mcache) releaseAll() {
	for i := range c.alloc {
		s := c.alloc[i]
		if s != &emptymspan {
			// 将 span 归还
			mheap_.central[i].mcentral.uncacheSpan(s)
			c.alloc[i] = &emptymspan
		}
	}
	// 清空 tinyalloc 池.
	c.tiny = 0
	c.tinyoffset = 0
}

// prepareForSweep flushes c if the system has entered a new sweep phase
// since c was populated. This must happen between the sweep phase
// starting and the first allocation from c.
func (c *mcache) prepareForSweep() {
	// Alternatively, instead of making sure we do this on every P
	// between starting the world and allocating on that P, we
	// could leave allocate-black on, allow allocation to continue
	// as usual, use a ragged barrier at the beginning of sweep to
	// ensure all cached spans are swept, and then disable
	// allocate-black. However, with this approach it's difficult
	// to avoid spilling mark bits into the *next* GC cycle.
	sg := mheap_.sweepgen
	if c.flushGen == sg {
		return
	} else if c.flushGen != sg-2 {
		println("bad flushGen", c.flushGen, "in prepareForSweep; sweepgen", sg)
		throw("bad flushGen")
	}
	c.releaseAll()
	stackcache_clear(c)
	atomic.Store(&c.flushGen, mheap_.sweepgen) // 与 gcStart 同步
}
