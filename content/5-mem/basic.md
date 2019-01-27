# 5 内存管理: 基本知识

到目前为止，我们已经分析了 Go 程序如何启动、初始化需要进行的关键步骤、初始化结束后，
主 goroutine 如何被调度器进行调度。现在我们来看 Go 中另一重要的关键组件：内存分配器。

Go 的内存分配器基于 Thread-Cache Malloc (tcmalloc) [1]，tcmalloc 为每个线程实现了一个本地缓存，区分了小对象（小于 32kb）
和大对象分配两种分配类型，其管理的内存单元称为 span。

我们不再介绍更多 tcmalloc 的具体细节，因为 Go 的内存分配器与 tcmalloc 存在一定差异。
这个差异来源于 Go 语言被设计为没有显式的内存分配与释放，
完全依靠编译器与运行时的配合来自动处理，因此也就造就为了内存分配器、垃圾回收器两大组件。

我们知道，在计算机领域中，无外乎时间换空间、空间换时间。统一管理内存会提前分配或一次性释放一大块内存，
进而减少与操作系统沟通造成的开销，进而提高程序的运行性能。
支持内存管理另一个优势就是能够更好的支持垃圾回收，这一点我们留到垃圾回收器一节中进行讨论。

## 内存分配器的主要结构

Go 的内存分配器主要包含以下几个核心组件：

- fixalloc：用于分配固定大小的堆外内存，基于自由表实现
- mheap：分配的堆，在页大小为 8KB 的粒度上进行管理
- mspan：是 mheap 上管理的一连串的页
- mcentral：搜集了给定大小等级的所有 span
- mcache：是一个 per-P 的缓存。
- mstats：用于分配器的统计

其中页是向操作系统申请内存的最小单位，目前设计为 8kb。

每一个结构虽然不都像是调度器 M/P/G 结构那样的大部头，
但初次阅读这些结构时想要理清他们之间的关系还是比较麻烦的。
图 1 展示了所有结构的关系。

![](../../images/mem-struct.png)

_图 1: Go 内存管理结构总览_

### Arena

#### heapArena

传统意义上的栈被 Go 的运行时霸占，不开放给用户态代码；
而传统意义上的堆内存，又被 Go 运行时划分为了两个部分，
一个是 Go 运行时自身所需的堆内存，即堆外内存；另一部分则用于 Go 用户态代码所使用的堆内存，也叫做 Go 堆。
Go 堆被视为由多个 arena 组成，每个 arena 在 64 位机器上位 64MB，且起始地址与 arena 的大小对齐，
所有的 arena 覆盖了整个 Go 堆的地址空间。

```go
const (
	pageSize             = 8192                       // 8kb
	heapArenaBytes       = 67108864                   // 64mb
	heapArenaBitmapBytes = heapArenaBytes / 32        // 2097152
	pagesPerArena        = heapArenaBytes / pageSize  // 8192
)

//go:notinheap
type heapArena struct {
	bitmap [heapArenaBitmapBytes]byte
	spans [pagesPerArena]*mspan
}
```

每个 arena 都包含一个 heapArena 对象，它内部的对象与堆外进行关联，
保存了 arena 的 metadata，这些 metadata 包括：

- arena 中所有字的 heap bitmap
- arena 中所有页的 span map

#### arenaHint

```go
//go:notinheap
type arenaHint struct {
	addr uintptr
	down bool
	next *arenaHint
}
```

### mspan

然而管理 arena 如此粒度的内存并不符合实践，相反，所有的堆对象都通过 span 按照预先设定好的
大小等级分别分配，小于 32kb 的小对象则分配在固定大小等级的 span 上，否则直接从 mheap 上进行分配。

`mspan` 是相同大小等级的 span 的双向链表的一个节点，每个节点还记录了自己的起始地址、
指向的 span 中页的数量。它要么位于 


```go
//go:notinheap
type mspan struct { // 双向链表
	next *mspan     // 链表中的下一个 span，如果为空则为 nil
	prev *mspan     // 链表中的前一个 span，如果为空则为 nil
	...
	startAddr uintptr // span 的第一个字节的地址，即 s.base()
	npages    uintptr // 一个 span 中的 page 数量
	...
	allocCount  uint16     // 分配对象的数量
	spanclass   spanClass  // 大小等级与 noscan (uint8)
	incache     bool       // 是否被 mcache 使用
	state       mSpanState // mspaninuse 等等信息
	...
}
```

### mcache

是一个 per-P 的缓存，它是一个包含不同大小等级的 span 链表的数组，其中 mcache.alloc 的每一个数组元素
都是某一个特定大小的 mspan 的链表头指针。

```go
//go:notinheap
type mcache struct {
	... 
	alloc [numSpanClasses]*mspan // 用来分配的 spans，由 spanClass 索引
	stackcache [_NumStackOrders]stackfreelist
	...
}
```

当 mcache 中 span 的数量不够使用时，会想 mcentral 的 nonempty 列表中获得新的 span。

### mcentral

mcentral 

```go
//go:notinheap
type mcentral struct {
	lock      mutex
	spanclass spanClass
	nonempty  mSpanList // 带有自由对象的 span 列表，即非空闲列表
	empty     mSpanList // 没有自由对象的 span 列表（或缓存在 mcache 中）

	// 假设 mcaches 中的所有 span 都已完全分配，则 nmalloc 是
	// 从此 mcentral 分配的对象的累积计数。原子地写，在 STW 下读。
	nmalloc uint64
}
```

当 mcentral 中 nonempty 列表中也没有 可分配的 span 时，则会向 mheap 提出请求，从而获得
新的 span，并进而交给 mcache。

### mheap

```go
//go:notinheap
type mheap struct {
	lock      mutex
	free      [_MaxMHeapList]mSpanList // 128, 给定 _MaxMHeapList 长度的自由列表
	freelarge mTreap                   // 长度大于 _MaxMHeapList 的空闲树堆 (treap)
	busy      [_MaxMHeapList]mSpanList // 128, 给定长度的大 span 的繁忙列表
	busylarge mSpanList                // 长度大于 _MaxMHeapList 的大 span 的繁忙列表
	...
	allspans []*mspan // 所有 spans 从这里分配出去
	...
	arenas [1 << arenaL1Bits]*[1 << arenaL2Bits]*heapArena
	...
	arenaHints *arenaHint
	...
	central [numSpanClasses]struct {
		mcentral mcentral
		pad      [sys.CacheLineSize - unsafe.Sizeof(mcentral{})%sys.CacheLineSize]byte
	}

	// 各种分配器
	spanalloc             fixalloc // span* 分配器
	cachealloc            fixalloc // mcache* 分配器
	treapalloc            fixalloc // treapNodes* 分配器，用于大对象
	specialfinalizeralloc fixalloc // specialfinalizer* 分配器
	specialprofilealloc   fixalloc // specialprofile* 分配器
	speciallock           mutex    // 特殊记录分配器的锁
	arenaHintAlloc        fixalloc // arenaHints 分配器
	...
}
```

## 进一步阅读的参考文献

1. [TCMalloc : Thread-Caching Malloc](http://goog-perftools.sourceforge.net/doc/tcmalloc.html)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
