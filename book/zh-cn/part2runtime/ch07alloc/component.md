---
weight: 2202
title: "7.2 组件"
---

# 7.2 组件

本节独立地讨论内存分配器中的几个组件：`fixalloc`、`linearAlloc`、`mcache`。

## fixalloc

`fixalloc` 是一个基于自由列表的固定大小的分配器。其核心原理是将若干未分配的内存块连接起来，
将未分配的区域的第一个字为指向下一个未分配区域的指针使用。

Go 的主分配堆中 malloc（span、cache、treap、finalizer、profile、arena hint 等） 均
围绕它为实体进行固定分配和回收。

fixalloc 作为抽象，非常简洁，只包含三个基本操作：初始化、分配、回收

### 结构

```go
// fixalloc 是一个简单的固定大小对象的自由表内存分配器。
// Malloc 使用围绕 sysAlloc 的 fixalloc 来管理其 MCache 和 MSpan 对象。
//
// fixalloc.alloc 返回的内存默认为零，但调用者可以通过将 zero 标志设置为 false
// 来自行负责将分配归零。如果这部分内存永远不包含堆指针，则这样的操作是安全的。
//
// 调用方负责锁定 fixalloc 调用。调用方可以在对象中保持状态，
// 但当释放和重新分配时第一个字会被破坏。
//
// 考虑使 fixalloc 的类型变为 go:notinheap.
type fixalloc struct {
	size   uintptr
	first  func(arg, p unsafe.Pointer) // 首次调用时返回 p
	arg    unsafe.Pointer
	list   *mlink
	chunk  uintptr // 使用 uintptr 而非 unsafe.Pointer 来避免 write barrier
	nchunk uint32
	inuse  uintptr // 正在使用的字节
	stat   *uint64
	zero   bool // 归零的分配
}
```

### 初始化

Go 语言对于零值有自己的规定，自然也就体现在内存分配器上。而 `fixalloc` 作为内存分配器内部组件的来源于
操作系统的内存，自然需要自行初始化，因此，`fixalloc` 的初始化也就不可避免的需要将自身的各个字段归零：

```go
// 初始化 f 来分配给定大小的对象。
// 使用分配器来按 chunk 获取
func (f *fixalloc) init(size uintptr, first func(arg, p unsafe.Pointer), arg unsafe.Pointer, stat *uint64) {
	f.size = size
	f.first = first
	f.arg = arg
	f.list = nil
	f.chunk = 0
	f.nchunk = 0
	f.inuse = 0
	f.stat = stat
	f.zero = true
}
```

### 分配

`fixalloc` 基于自由表策略进行实现，分为两种情况：

1. 存在被释放、可复用的内存
2. 不存在可复用的内存

对于第一种情况，也就是在运行时内存被释放，但这部分内存并不会被立即回收给操作系统，
我们直接从自由表中获得即可，但需要注意按需将这部分内存进行清零操作。

对于第二种情况，我们直接向操作系统申请固定大小的内存，然后扣除分配的大小即可。

```go
const 	_FixAllocChunk = 16 << 10               // FixAlloc 一个 Chunk 的大小

func (f *fixalloc) alloc() unsafe.Pointer {
	// fixalloc 的个字段必须先被 init
	if f.size == 0 {
		print("runtime: use of FixAlloc_Alloc before FixAlloc_Init\n")
		throw("runtime: internal error")
	}

	// 如果 f.list 不是 nil, 则说明还存在已经释放、可复用的内存，直接将其分配
	if f.list != nil {
		// 取出 f.list
		v := unsafe.Pointer(f.list)
		// 并将其指向下一段区域
		f.list = f.list.next
		// 增加使用的(分配)大小
		f.inuse += f.size
		// 如果需要对内存清零，则对取出的内存执行初始化
		if f.zero {
			memclrNoHeapPointers(v, f.size)
		}
		// 返回分配的内存
		return v
	}

	// f.list 中没有可复用的内存

	// 如果此时 nchunk 不足以分配一个 size
	if uintptr(f.nchunk) < f.size {
		// 则向操作系统申请内存，大小为 16 << 10 pow(2,14)
		f.chunk = uintptr(persistentalloc(_FixAllocChunk, 0, f.stat))
		f.nchunk = _FixAllocChunk
	}

	// 指向申请好的内存
	v := unsafe.Pointer(f.chunk)
	if f.first != nil { // first 只有在 fixalloc 作为 spanalloc 时候，才会被设置为 recordspan
		f.first(f.arg, v) // 用于为 heap.allspans 添加新的 span
	}
	// 扣除并保留 size 大小的空间
	f.chunk = f.chunk + f.size
	f.nchunk -= uint32(f.size)
	f.inuse += f.size // 记录已经使用的大小
	return v
}
```

我们在稍后讨论 `memclrNoHeapPointers` 和 `persistentalloc`。

### 回收

回收就更加简单了，直接将回收的地址指针放回到自由表中即可：

```go
func (f *fixalloc) free(p unsafe.Pointer) {
	// 减少使用的字节数
	f.inuse -= f.size
	// 将要释放的内存地址作为 mlink 指针插入到 f.list 内，完成回收
	v := (*mlink)(p)
	v.next = f.list
	f.list = v
}
```

## linearAlloc

`linearAlloc` 是一个基于线性分配策略的分配器，但由于它只作为 `mheap_.heapArenaAlloc` 和 `mheap_.arena`
在 32 位系统上使用，这里不做详细分析。

```go
// linearAlloc 是一个简单的线性分配器，它预留一块内存区域并按需将其映射到 Ready 状态。
// 调用方有责任对齐进行加锁。
type linearAlloc struct {
	next   uintptr // 下一个可用的字节
	mapped uintptr // 映射空间后的一个字节
	end    uintptr // 保留空间的末尾
}

func (l *linearAlloc) init(base, size uintptr) {
	l.next, l.mapped = base, base
	l.end = base + size
}

func (l *linearAlloc) alloc(size, align uintptr, sysStat *uint64) unsafe.Pointer {
	p := round(l.next, align)
	if p+size > l.end {
		return nil
	}
	l.next = p + size
	if pEnd := round(l.next-1, physPageSize); pEnd > l.mapped {
		// We need to map more of the reserved space.
		sysMap(unsafe.Pointer(l.mapped), pEnd-l.mapped, sysStat)
		l.mapped = pEnd
	}
	return unsafe.Pointer(p)
}
```

## mcache

`mcache` 是一个 per-P 的缓存，因此每个线程都只访问自身的 `mcache`，因此也就不会出现
并发，也就省去了对其进行加锁步骤。

```go
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
```

### 分配

运行时的 `runtime.allocmcache` 从 `mheap` 上分配一个 `mcache`。
由于 `mheap` 是全局的，因此在分配期必须对其进行加锁，而分配通过 fixAlloc 组件完成：

```go
// 虚拟的MSpan，不包含任何对象。
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
```

由于运行时提供了采样过程堆分析的支持，
由于我们的采样的目标是平均每个 `MemProfileRate` 字节对分配进行采样，
显然，在整个时间线上的分配情况应该是完全随机分布的，这是一个泊松过程。
因此最佳的采样点应该是服从指数分布 `exp(MemProfileRate)` 的随机数，其中
`MemProfileRate` 为均值。

```go
func nextSample() uintptr {
	if GOOS == "plan9" {
		// Plan 9 doesn't support floating point in note handler.
		if g := getg(); g == g.m.gsignal {
			return nextSampleNoFP()
		}
	}

	return uintptr(fastexprand(MemProfileRate))
}
```

`MemProfileRate` 是一个公共变量，可以在用户态代码进行修改：

```go
var MemProfileRate int = 512 * 1024
```

### 释放

由于 `mcache` 从非 GC 内存上进行分配，因此出现的任何堆指针都必须进行特殊处理。
所以在释放前，需要调用 `mcache.releaseAll` 将堆指针进行处理：

```go
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
```

```go
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
```

### per-P? per-M?

mcache 其实早在 [调度器: 调度循环](../../part2runtime/ch06sched/exec.md) 中与 mcache 打过照面了。

首先，mcache 是一个 per-P 的 mcache，我们很自然的疑问就是，这个 mcache 在 p/m 这两个结构体上都有成员：

```go
type p struct {
	(...)
	mcache      *mcache
	(...)
}
type m struct {
	(...)
	mcache      *mcache
	(...)
}
```

那么 mcache 是跟着谁跑的？结合调度器的知识不难发现，m 在执行时需要持有一个 p 才具备执行能力。
有利的证据是，当调用 `runtime.procresize` 时，初始化新的 P 时，mcache 是直接分配到 p 的；
回收 p 时，mcache 是直接从 p 上获取：

```go
func procresize(nprocs int32) *p {
	(...)
	// 初始化新的 P
	for i := int32(0); i < nprocs; i++ {
		pp := allp[i]
		(...)
		// 为 P 分配 cache 对象
		if pp.mcache == nil {
			if old == 0 && i == 0 {
				if getg().m.mcache == nil {
					throw("missing mcache?")
				}
				pp.mcache = getg().m.mcache
			} else {
				// 创建 cache
				pp.mcache = allocmcache()
			}
		}

		(...)
	}

	// 释放未使用的 P
	for i := nprocs; i < old; i++ {
		p := allp[i]
		(...)
		// 释放当前 P 绑定的 cache
		freemcache(p.mcache)
		p.mcache = nil
		(...)
	}
	(...)
}
```

因而我们可以明确：

- mcache 会被 P 持有，当 M 和 P 绑定时，M 同样会保留 mcache 的指针
- mcache 直接向操作系统申请内存，且常驻运行时
- P 通过 make 命令进行分配，会分配在 Go 堆上

## 其他

### memclrNoHeapPointers

`memclrNoHeapPointers` 用于清理不包含堆指针的内存区块：

```go
// memclrNoHeapPointers 清除从 ptr 开始的 n 个字节
// 通常情况下你应该使用 typedmemclr，而 memclrNoHeapPointers 应该仅在调用方知道 *ptr
// 不包含堆指针的情况下使用，因为 *ptr 只能是下面两种情况：
// 1. *ptr 是初始化过的内存，且其类型不是指针。
// 2. *ptr 是未初始化的内存（例如刚被新分配时使用的内存），则指包含 "junk" 垃圾内存
// 见 memclr_*.s
//
//go:noescape
func memclrNoHeapPointers(ptr unsafe.Pointer, n uintptr)
```

清理过程是汇编实现的，就是一些内存的归零工作，简单浏览一下：

```asm
TEXT runtime·memclrNoHeapPointers(SB), NOSPLIT, $0-8
	MOVL	ptr+0(FP), DI
	MOVL	n+4(FP), BX
	XORL	AX, AX

	// MOVOU 好像总是比 REP STOSL 快
tail:
	(...)

loop:
	MOVOU	X0, 0(DI)
	MOVOU	X0, 16(DI)
	MOVOU	X0, 32(DI)
	MOVOU	X0, 48(DI)
	MOVOU	X0, 64(DI)
	MOVOU	X0, 80(DI)
	MOVOU	X0, 96(DI)
	(...)
```

## 系统级内存管理调用

系统级的内存管理调用是平台相关的，这里以 Linux 为例，运行时的 `sysAlloc`、`sysUnused`、`sysUsed`、`sysFree`、`sysReserve`、`sysMap` 和 `sysFault` 都是系统级的调用。

其中 `sysAlloc`、`sysReserve` 和 `sysMap` 都是向操作系统申请内存的操作，他们均涉及关于内存分配的系统调用就是 `mmap`，区别在于：

- `sysAlloc` 是从操作系统上申请清零后的内存，调用参数是 `_PROT_READ|_PROT_WRITE, _MAP_ANON|_MAP_PRIVATE`；
- `sysReserve` 是从操作系统中保留内存的地址空间，并未直接分配内存，调用参数是 `_PROT_NONE, _MAP_ANON|_MAP_PRIVATE`，；
- `sysMap` 则是用于通知操作系统使用先前已经保留好的空间，参数是 `_PROT_READ|_PROT_WRITE, _MAP_ANON|_MAP_FIXED|_MAP_PRIVATE`。

不过 `sysAlloc` 和 `sysReserve` 都是操作系统对齐的内存，但堆分配器可能使用更大的对齐方式，因此这部分获得的内存都需要额外进行一些重排的工作。

```go
// runtime/mem_linux.go

//go:nosplit
func sysAlloc(n uintptr, sysStat *uint64) unsafe.Pointer {
	p, err := mmap(nil, n, _PROT_READ|_PROT_WRITE, _MAP_ANON|_MAP_PRIVATE, -1, 0)
	if err != 0 {
		if err == _EACCES {
			print("runtime: mmap: access denied\n")
			exit(2)
		}
		if err == _EAGAIN {
			print("runtime: mmap: too much locked memory (check 'ulimit -l').\n")
			exit(2)
		}
		return nil
	}
	(...)
	return p
}
func sysReserve(v unsafe.Pointer, n uintptr) unsafe.Pointer {
	p, err := mmap(v, n, _PROT_NONE, _MAP_ANON|_MAP_PRIVATE, -1, 0)
	if err != 0 {
		return nil
	}
	return p
}
func sysMap(v unsafe.Pointer, n uintptr, sysStat *uint64) {
	(...)
	p, err := mmap(v, n, _PROT_READ|_PROT_WRITE, _MAP_ANON|_MAP_FIXED|_MAP_PRIVATE, -1, 0)
	if err == _ENOMEM {
		throw("runtime: out of memory")
	}
	if p != v || err != 0 {
		throw("runtime: cannot map pages in arena address space")
	}
}
```

Linux 下内存分配调用有多个：

- brk: 可以让进程的堆指针增长，从逻辑上消耗一块虚拟地址空间
- mmap: 可以让进程的虚拟地址空间切分出一块指定大小的虚拟地址空间，mmap 映射返回的地址也是从逻辑上被消耗的，需要通过 unmap 进行回收。

熟悉 C 语言的读者应该知道 malloc，它只是 C 语言的标准库函数，本质上是通过上述两个系统调用完成，
当分配内存较小时调用 brk，反之则会调用 mmap。不过 64 位系统上的 Go 运行时并没有使用 brk，目的很明显，
是为了能够更加灵活的控制虚拟地址空间。

而对于 unmap 操作，它被封装在了 `sysFree` 中：

```go
//go:nosplit
func sysFree(v unsafe.Pointer, n uintptr, sysStat *uint64) {
	(...)
	munmap(v, n)
}
```

`sysUnused`、`sysUsed` 是 `madvice` 的封装，我们知道 `madvice` 用于向操作系统通知某段内存区域是否被应用所使用。`sysFault` 用于将 `sysAlloc` 获得的内存区域标记为故障，只用于运行时调试。

最后我们来理一下这些系统级调用的关系：

1. 当开始保留内存地址时，调用 `sysReserve`；
2. 当需要使用或不适用保留的内存区域时通知操作系统，调用 `sysUnused`、`sysUsed`；
3. 正式使用保留的地址，使用 `sysMap`；
4. 释放时使用 `sysFree` 以及调试时使用 `sysFault`；
5. 非用户态的调试、堆外内存则使用 `sysAlloc` 直接向操作系统获得清零的内存。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
