---
weight: 2208
title: "7.8 内存统计"
---


# 7.8 内存统计

Go 运行时对用户提供只读的内存统计信息，通过 `runtime.MemStats` 支持。
公共方法只有一个：`ReadMemStats`。但调用这个方法的代价非常之大：

```go
func ReadMemStats(m *MemStats) {
	stopTheWorld("read mem stats")

	systemstack(func() {
		readmemstats_m(m)
	})

	startTheWorld()
}
```

读取前后需要付出 STW 的成本。对于 `readmemstats_m` 而言，是将运行时用于内存统计的
变量 `memstats` 中的值拷贝到用户态的 `MemStats` 中，不过这样进行 `memove` 操作
是发生在系统栈上的，因此这部分的内存实际上是 OS 栈上的内存，因此最后还给用户加上
`stats.StackInuse` 的值来保证完整性：

```go
func readmemstats_m(stats *MemStats) {
	updatememstats()

	// 将运行时 memstats 变量拷贝到 stats 中
	memmove(unsafe.Pointer(stats), unsafe.Pointer(&memstats), sizeof_C_MStats)

	// 因为 memstats.stacks_sys 是唯一直接映射到 OS 栈的内存。
	// 所以这里加上了堆分配的栈内存以供用户使用。
	stats.StackSys += stats.StackInuse
}
```

而上方拷贝前的 `updatememstats` 是为了将 STW 之后未完整统计的内存信息统一更新到 `memstats` 中：

```go
//go:nowritebarrier
func updatememstats() {
	memstats.mcache_inuse = uint64(mheap_.cachealloc.inuse)
	memstats.mspan_inuse = uint64(mheap_.spanalloc.inuse)
	memstats.sys = memstats.heap_sys + memstats.stacks_sys + memstats.mspan_sys +
		memstats.mcache_sys + memstats.buckhash_sys + memstats.gc_sys + memstats.other_sys

	// 将 stacks_inuse 作为系统内存进行计算
	memstats.sys += memstats.stacks_inuse

	// 计算内存分配器统计信息。
	// 在程序执行期间，运行时只计算释放的数量和释放的内存量。
	// 堆中当前活动对象的数量和活动堆内存的数量
	// 通过扫描所有 span 计算。
	// malloc 的总数计算为 frees 数和活动对象数。
	// 类似地，分配的内存总量计算为释放的内存量
	// 加上活跃堆内存的数量。
	memstats.alloc = 0
	memstats.total_alloc = 0
	memstats.nmalloc = 0
	memstats.nfree = 0
	for i := 0; i < len(memstats.by_size); i++ {
		memstats.by_size[i].nmalloc = 0
		memstats.by_size[i].nfree = 0
	}

	// Flush mcaches 到 mcentral, TODO: 这个地方不是很明白为什么还要切一次系统栈？
	systemstack(flushallmcaches)

	// 汇总本地统计数据。
	cachestats()

	// 统计分配信息，因为 STW 所以安全
	var smallFree, totalAlloc, totalFree uint64
	// 搜集每个 span 等级的统计
	for spc := range mheap_.central {
		// mcaches 现在为空，因此 mcentral 统计已经是最新的了
		c := &mheap_.central[spc].mcentral
		memstats.nmalloc += c.nmalloc
		i := spanClass(spc).sizeclass()
		memstats.by_size[i].nmalloc += c.nmalloc
		totalAlloc += c.nmalloc * uint64(class_to_size[i])
	}
	// 收集每个大小等级的信息
	for i := 0; i < _NumSizeClasses; i++ {
		if i == 0 {
			memstats.nmalloc += mheap_.nlargealloc
			totalAlloc += mheap_.largealloc
			totalFree += mheap_.largefree
			memstats.nfree += mheap_.nlargefree
			continue
		}

		// The mcache stats have been flushed to mheap_.
		memstats.nfree += mheap_.nsmallfree[i]
		memstats.by_size[i].nfree = mheap_.nsmallfree[i]
		smallFree += mheap_.nsmallfree[i] * uint64(class_to_size[i])
	}
	totalFree += smallFree

	memstats.nfree += memstats.tinyallocs
	memstats.nmalloc += memstats.tinyallocs

	// 计算派生数据
	memstats.total_alloc = totalAlloc
	memstats.alloc = totalAlloc - totalFree
	memstats.heap_alloc = memstats.alloc
	memstats.heap_objects = memstats.nmalloc - memstats.nfree
}
```

```go
//go:nowritebarrier
func flushallmcaches() {
	for i := 0; i < int(gomaxprocs); i++ {
		flushmcache(i)
	}
}
//go:nowritebarrier
func flushmcache(i int) {
	p := allp[i]
	c := p.mcache
	if c == nil {
		return
	}
	c.releaseAll()
	stackcache_clear(c)
}
//go:systemstack
func stackcache_clear(c *mcache) {
	(...)
	lock(&stackpoolmu)
	for order := uint8(0); order < _NumStackOrders; order++ {
		x := c.stackcache[order].list
		for x.ptr() != nil {
			y := x.ptr().next
			stackpoolfree(x, order)
			x = y
		}
		c.stackcache[order].list = 0
		c.stackcache[order].size = 0
	}
	unlock(&stackpoolmu)
}
```

```go
//go:nowritebarrier
func cachestats() {
	for _, p := range allp {
		c := p.mcache
		if c == nil {
			continue
		}
		purgecachedstats(c)
	}
}
//go:nosplit
func purgecachedstats(c *mcache) {
	// Protected by either heap or GC lock.
	h := &mheap_
	memstats.heap_scan += uint64(c.local_scan)
	c.local_scan = 0
	memstats.tinyallocs += uint64(c.local_tinyallocs)
	c.local_tinyallocs = 0
	h.largefree += uint64(c.local_largefree)
	c.local_largefree = 0
	h.nlargefree += uint64(c.local_nlargefree)
	c.local_nlargefree = 0
	for i := 0; i < len(c.local_nsmallfree); i++ {
		h.nsmallfree[i] += uint64(c.local_nsmallfree[i])
		c.local_nsmallfree[i] = 0
	}
}
```

这里只是读取时候对全部信息进行的同步，在分配的过程中还有很多直接统计的代码。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
