---
weight: 2201
title: "7.1 设计原则"
---

# 7.1 设计原则

到目前为止，我们已经分析了 Go 程序如何启动、初始化需要进行的关键步骤、初始化结束后，
主 goroutine 如何被调度器进行调度。现在我们来看 Go 中另一重要的关键组件：内存分配器。

Go 的内存分配器基于 Thread-Cache Malloc (tcmalloc) [1]，tcmalloc 为每个线程实现了一个本地缓存，
区分了小对象（小于 32kb）和大对象分配两种分配类型，其管理的内存单元称为 span。

我们不再介绍更多 tcmalloc 的具体细节，因为 Go 的内存分配器与 tcmalloc 存在一定差异。
这个差异来源于 Go 语言被设计为没有显式的内存分配与释放，
完全依靠编译器与运行时的配合来自动处理，因此也就造就了内存分配器、垃圾回收器两大组件。

我们知道，在计算机领域中，无外乎时间换空间、空间换时间。统一管理内存会提前分配或一次性释放一大块内存，
进而减少与操作系统沟通造成的开销，进而提高程序的运行性能。
支持内存管理另一个优势就是能够更好的支持垃圾回收，这一点我们留到垃圾回收器一节中进行讨论。

## 主要结构

Go 的内存分配器主要包含以下几个核心组件：

- heapArena: 保留整个虚拟地址空间
- mheap：分配的堆，在页大小为 8KB 的粒度上进行管理
- mspan：是 mheap 上管理的一连串的页
- mcentral：收集了给定大小等级的所有 span
- mcache：为 per-P 的缓存。

其中页是向操作系统申请内存的最小单位，目前设计为 8KB。

每一个结构虽然不都像是调度器 M/P/G 结构那样的大部头，但初次阅读这些结构时想要理清他们之间的关系还是比较麻烦的。
传统意义上的栈被 Go 的运行时霸占，不开放给用户态代码；而传统意义上的堆内存，又被 Go 运行时划分为了两个部分，
一个是 Go 运行时自身所需的堆内存，即堆外内存；另一部分则用于 Go 用户态代码所使用的堆内存，也叫做 Go 堆。
Go 堆负责了用户态对象的存放以及 goroutine 的执行栈。

### Arena

#### heapArena

Go 堆被视为由多个 arena 组成，每个 arena 在 64 位机器上为 64MB，且起始地址与 arena 的大小对齐，
所有的 arena 覆盖了整个 Go 堆的地址空间。

```go
const (
	pageSize             = 8192                       // 8KB
	heapArenaBytes       = 67108864                   // 64MB
	heapArenaBitmapBytes = heapArenaBytes / 32        // 2097152
	pagesPerArena        = heapArenaBytes / pageSize  // 8192
)

//go:notinheap
type heapArena struct {
	bitmap     [heapArenaBitmapBytes]byte
	spans      [pagesPerArena]*mspan
	pageInUse  [pagesPerArena / 8]uint8
	pageMarks  [pagesPerArena / 8]uint8
	zeroedBase uintptr
}
```

#### arenaHint

结构比较简单，是 arenaHint 链表的节点结构，保存了 arena 的起始地址、是否为最后一个 arena，以及下一个 arenaHint 指针。

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
大小等级分别分配，小于 32KB 的小对象则分配在固定大小等级的 span 上，否则直接从 mheap 上进行分配。

`mspan` 是相同大小等级的 span 的双向链表的一个节点，每个节点还记录了自己的起始地址、
指向的 span 中页的数量。它要么位于 


```go
//go:notinheap
type mspan struct { // 双向链表
	next *mspan     // 链表中的下一个 span，如果为空则为 nil
	prev *mspan     // 链表中的前一个 span，如果为空则为 nil
	...
	startAddr      uintptr // span 的第一个字节的地址，即 s.base()
	npages         uintptr // 一个 span 中的 page 数量
	manualFreeList gclinkptr // mSpanManual span 的释放对象链表
	...
	freeindex  uintptr
	nelems     uintptr // span 中对象的数量
	allocCache uint64
	allocBits  *gcBits
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
	tiny             uintptr
	tinyoffset       uintptr
	local_tinyallocs uintptr
	alloc            [numSpanClasses]*mspan // 用来分配的 spans，由 spanClass 索引
	stackcache       [_NumStackOrders]stackfreelist
	...
}
```

当 mcache 中 span 的数量不够使用时，会向 mcentral 的 nonempty 列表中获得新的 span。

### mcentral

mcentral 

```go
//go:notinheap
type mcentral struct {
	lock      mutex
	spanclass spanClass
	nonempty  mSpanList // 带有自由对象的 span 列表，即非空闲列表
	empty     mSpanList // 没有自由对象的 span 列表（或缓存在 mcache 中）
	...
}
```

当 mcentral 中 nonempty 列表中也没有可分配的 span 时，则会向 mheap 提出请求，从而获得
新的 span，并进而交给 mcache。

### mheap

```go
//go:notinheap
type mheap struct {
	lock           mutex
	pages          pageAlloc
	...
	allspans       []*mspan // 所有 spans 从这里分配出去
	scavengeGoal   uint64
	reclaimIndex   uint64
	reclaimCredit  uintptr
	arenas         [1 << arenaL1Bits]*[1 << arenaL2Bits]*heapArena
	heapArenaAlloc linearAlloc
	arenaHints     *arenaHint
	arena          linearAlloc
	allArenas      []arenaIdx
	curArena       struct {
		base, end uintptr
	}
	central       [numSpanClasses]struct {
		mcentral mcentral
		pad      [cpu.CacheLinePadSize - unsafe.Sizeof(mcentral{})%cpu.CacheLinePadSize]byte
	}
	...

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

<!-- TODO: L1/L2 arena purpose -->
<!-- https://github.com/golang/go/commit/ec25210564562571aeb39cdfd6e02270d7f3fb1d -->

## 分配概览

在分析具体的分配过程之前，我们需要搞清楚究竟什么时候会发生分配。

Go 程序的执行是基于 goroutine 的，goroutine 和传统意义上的程序一样，也有栈和堆的概念。只不过
Go 的运行时帮我们屏蔽掉了这两个概念，只在运行时内部区分并分别对应：goroutine 执行栈以及 Go 堆。

goroutine 的执行栈与传统意义上的栈一样，当函数返回时，在栈上就会被回收，栈中的对象都会被回收，从而
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
  ...
  alloc.go:17		0x104e086		488d05939f0000		LEAQ type.*+40256(SB), AX		
  alloc.go:17		0x104e08d		48890424		MOVQ AX, 0(SP)				
  alloc.go:17		0x104e091		e8cabffbff		CALL runtime.newobject(SB)		
  alloc.go:17		0x104e096		488b442408		MOVQ 0x8(SP), AX			
  alloc.go:17		0x104e09b		4889442410		MOVQ AX, 0x10(SP)			
  alloc.go:17		0x104e0a0		48c70002000000		MOVQ $0x2, 0(AX)			
  ...

TEXT main.f3(SB) /Users/changkun/dev/go-under-the-hood/demo/4-mem/alloc/alloc.go
  ...
  alloc.go:22		0x104e0ed		488d05ecf60000		LEAQ type.*+62720(SB), AX		
  alloc.go:22		0x104e0f4		48890424		MOVQ AX, 0(SP)				
  alloc.go:22		0x104e0f8		e863bffbff		CALL runtime.newobject(SB)		
  alloc.go:22		0x104e0fd		488b7c2408		MOVQ 0x8(SP), DI			
  alloc.go:22		0x104e102		48897c2418		MOVQ DI, 0x18(SP)			
  alloc.go:22		0x104e107		b900008000		MOVL $0x800000, CX			
  alloc.go:22		0x104e10c		31c0			XORL AX, AX				
  alloc.go:22		0x104e10e		f348ab			REP; STOSQ AX, ES:0(DI)			
  ...
```

就会发现，对于产生在 Go 堆上分配对象的情况，均调用了运行时的 `runtime.newobject` 方法。
当然，关键字 `new` 同样也会被编译器翻译为此函数，这个我们已经在实践中知道了。
所以 `runtime.newobject` 就是内存分配的核心入口了。

### 分配入口

单看 `runtime.newobject` 其实非常简单，他只是简单的调用了 `mallocgc`：

```go
// 创建一个新的对象
func newobject(typ *_type) unsafe.Pointer {
	return mallocgc(typ.size, typ, true) // true 内存清零
}
```

其中 `_type` 为 Go 类型的实现，通过其 `size` 属性能够获得该类型所需要的大小。

```go
func mallocgc(size uintptr, typ *_type, needzero bool) unsafe.Pointer {
	// 创建大小为零的对象，例如空结构体
	if size == 0 {
		return unsafe.Pointer(&zerobase)
	}
	mp := acquirem()
	mp.mallocing = 1
	...

	// 获取当前 g 所在 M 所绑定 P 的 mcache
	c := gomcache()
	var x unsafe.Pointer
	noscan := typ == nil || typ.kind&kindNoPointers != 0
	if size <= maxSmallSize {
		if noscan && size < maxTinySize {
			// 微对象分配
			...
		} else {
			// 小对象分配
			...
		}
	} else {
		// 大对象分配
		...
	}
	...
	mp.mallocing = 0
	releasem(mp)
	...
	return x
```

在分配过程中，我们会发现需要持有 M 才可进行分配，这是因为分配不仅可能涉及 mcache，还需要将正在分配的 M 标记为 `mallocing`，用于记录当前 M 的分配状态。

### 小对象分配

当对一个小对象（<32KB）分配内存时，会将该对象所需的内存大小调整到某个能够容纳该对象的大小等级（size class），
并查看 mcache 中对应等级的 mspan，通过扫描 mspan 的 `freeindex` 来确定是否能够进行分配。

当没有可分配的 mspan 时，会从 mcentral 中获取一个所需大小空间的新的 mspan，从 mcentral 中分配会对其进行加锁，
但一次性获取整个 span 的过程均摊了对 mcentral 加锁的成本。

如果 mcentral 的 mspan 也为空时，则它也会发生增长，从而从 mheap 中获取一连串的页，作为一个新的 mspan 进行提供。
而如果 mheap 仍然为空，或者没有足够大的对象来进行分配时，则会从操作系统中分配一组新的页（至少 1MB），
从而均摊与操作系统沟通的成本。

### 微对象分配

对于过小的微对象（<16B），它们的分配过程与小对象的分配过程基本类似，但是是直接存储在 mcache 上，并由其以 16B 的块大小直接进行管理和释放。

### 大对象分配

大对象分配非常粗暴，不与 mcache 和 mcentral 沟通，直接绕过并通过 mheap 进行分配。

## 小结

图 1 展示了所有结构的关系。

<div class="img-center">
<img src="../../../assets/mem-struct.png"/>
<strong>图 1: Go 内存管理结构总览</strong>
</div>

heap 最中间的灰色区域 arena 覆盖了 Go 程序的整个虚拟内存，
每个 arena 包括一段 bitmap 和一段指向连续 span 的指针；
每个 span 由一串连续的页组成；每个 arena 的起始位置通过 arenaHint 进行记录。

分配的顺序从右向左，代价也就越来越大。
小对象和微对象优先从白色区域 per-P 的 mcache 分配 span，这个过程不需要加锁（白色）；
若失败则会从 mheap 持有的 mcentral 加锁获得新的 span，这个过程需要加锁，但只是局部（灰色）；
若仍失败则会从右侧的 free 或 scav 进行分配，这个过程需要对整个 heap 进行加锁，代价最大（黑色）。

## 进一步阅读的参考文献

1. [TCMalloc : Thread-Caching Malloc](http://goog-perftools.sourceforge.net/doc/tcmalloc.html)

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
