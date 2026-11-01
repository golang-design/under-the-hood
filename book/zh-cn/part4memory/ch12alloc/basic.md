---
weight: 4101
title: "12.1 设计原则"
---

# 12.1 设计原则

Go 程序中的每一次 `new`、每一个逃逸到堆上的变量、每一次超出容量的 `append`，最终都会调用运行时的同一个
函数 `runtime.mallocgc`。本章讨论这个函数背后的内存分配器。本节先不涉及具体组件，而是讨论分配器所面对的
问题，以及 Go 对此作出的几项基本设计决策：分配器需要兼顾哪些目标，从 TCMalloc 继承了什么，为什么按尺寸类
分配，如何按对象的大小与类型分流，以及为什么分配器必须与垃圾回收器协同设计。[12.2](./component.md) 至
[12.8](./mstats.md) 所讨论的组件与路径，都以这些决策为基础。

## 12.1.1 分配器面对的问题

本章所说的分配专指堆分配。函数的局部变量通常位于 goroutine 的栈上，随函数返回而失效，不经过分配器
（栈的管理见[第 14 章](../ch14stack/readme.md)）。只有当编译器无法证明一个对象的生命周期局限于当前栈帧时，
它才会被放到堆上，这一判断由逃逸分析完成。考虑下面的程序：

```go
package main

func f() int {
	x := 42
	return x
}

func g() *int {
	y := 42
	return &y
}

func main() {
	_ = f()
	_ = g()
}
```

使用 `-gcflags=-m` 可以让编译器输出它的优化决策：

```shell
$ go build -gcflags=-m esc.go
# command-line-arguments
./esc.go:3:6: can inline f
./esc.go:8:6: can inline g
./esc.go:13:6: can inline main
./esc.go:14:7: inlining call to f
./esc.go:15:7: inlining call to g
./esc.go:9:2: moved to heap: y
```

前五行是内联决策，与本节无关。最后一行表明，由于 `g` 返回了 `y` 的地址，`y` 在 `g` 返回后仍可能被访问，
不能留在 `g` 的栈帧中，因而被移到堆上。编译器为此生成一次 `runtime.newobject` 调用，而 `newobject` 仅以
类型的大小调用 `mallocgc` [[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
func newobject(typ *_type) unsafe.Pointer {
	return mallocgc(typ.Size_, typ, true)
}
```

`x` 不逃逸，仍留在栈上。此外，`make` 创建 slice、`append` 超出容量时的扩容（`growslice`）等操作，
最终同样调用 `mallocgc`。逃逸分析本身在 [15.5](../../part5toolchain/ch15compile/escape.md) 中讨论，
本章只关心其结果：所有逃逸的对象都由 `mallocgc` 在堆上分配。

一个通用的分配器需要同时满足几个相互冲突的目标：

- 速度：分配位于程序的热路径上，一个服务每秒可能执行数百万次分配。理想情况下，一次分配只需几条不加锁的
  指令。
- 可扩展性：Go 程序通常运行在多核机器上，大量 goroutine 可能同时分配内存。若所有分配共用一把全局锁，核数
  越多，争用越严重。
- 空间效率：为对象预留的空间不应比对象大太多，空闲内存也不应被分割得过于零碎，否则长期运行的服务会出现
  持续的内存膨胀。
- 与垃圾回收器协作：Go 没有显式的 `free`，对象何时可以重用由垃圾回收器决定
  （[第 13 章](../ch13gc/readme.md)）。分配器必须记录回收器所需的信息，并使分配的速率影响回收的启动时机。

前三个目标是所有分配器共同面对的问题。Wilson 等人 1995 年的综述 [[Wilson et al., 1995](#ref-wilson-1995)]
将空间上的浪费归结为碎片，并沿用了传统的两类划分：**内部碎片**（internal fragmentation）指分配出的块大于
请求的大小，多余部分浪费在块内；**外部碎片**（external fragmentation）指空闲内存的总量足够，却因被分割成
许多较小的块而无法满足请求。综述还指出了分配器所受的约束：它不能决定程序何时申请、何时释放，也不能通过
移动已分配的块来整理内存，只能决定下一个请求放在空闲内存中的什么位置。用综述的话说：

> 因此，分配器是一个在线算法，它必须严格按顺序立即响应每一个请求，而且它的决定不可撤销。

这一约束对 Go 同样成立，因为 Go 的垃圾回收器不移动对象。`runtime/mgc.go` 开头的注释写道
[[Go Authors, 2026d](#ref-go-authors-2026d)]：

```go
// It is non-generational and non-compacting. Allocation is done using size segregated per P allocation
// areas to minimize fragmentation while eliminating locks in the common case.
```

即回收器既不分代，也不压缩；分配按尺寸隔离，在每个 P 各自的分配空间中进行，以尽量减少碎片，
并使常见情况无需加锁。回收器既然不整理堆，碎片就只能在分配时加以控制。这段注释也概括了本章的主要设计：
以按尺寸隔离控制碎片，以按 P 划分的分配空间消除锁争用。

Wilson 等人还把分配器的设计区分为三个层次：策略（strategy）利用程序请求序列中的规律；政策（policy）是决定
块放在何处的可实现规则；机制（mechanism）是实现政策的算法与数据结构。综述认为，以往的研究过于关注机制而
忽视了政策。按照这一划分，下文的尺寸类是一项政策，即同一段内存只存放同一尺寸的对象；span、位图与各级缓存
则是实现这项政策的机制。

## 12.1.2 从 TCMalloc 到 Go

Go 的分配器源自 Google 的 TCMalloc（thread-caching malloc）。TCMalloc 的设计文档最早见于 2005 年
[[Ghemawat and Menage, 2005](#ref-ghemawat-menage-2005)]，其方法是：每个线程持有一份本地缓存，小对象的
分配与释放首先在本地缓存中完成，无需加锁；本地缓存耗尽时，才从中心自由表成批获取对象；中心自由表也耗尽时，
再从页堆申请一段连续的页，并切分为同样大小的对象。文档报告，在 2.8 GHz 的 Pentium 4 上，glibc 的 ptmalloc2
完成一对 malloc 与 free 约需 300 纳秒，TCMalloc 约需 50 纳秒；而在 2.8 GHz 的 Xeon 上，仅一对加锁与解锁
操作就约需 100 纳秒。可见，避免加锁是 TCMalloc 速度优势的主要来源。

同一时期的其他分配器也在设法摆脱全局锁，但手段各异。Bonwick 与 Adams 为 Solaris 的 slab 分配器加入了按
处理器划分的 magazine 缓存层，以解决全局锁无法扩展到多处理器的问题
[[Bonwick and Adams, 2001](#ref-bonwick-adams-2001)]。FreeBSD 的 jemalloc 则不为线程设置私有缓存，而是
建立多个 arena（多处理器上默认为处理器数的四倍），并将线程轮流分派到各个 arena 上，以降低同一 arena 被
并发使用的概率 [[Evans, 2006](#ref-evans-2006)]。这些做法的目标相同：以许多很少发生争用的局部结构取代
单一的全局锁。

Go 的分配器由 Russ Cox 于 2008 年底写成。最初的头注释明确写道「Memory allocator, based on tcmalloc」，
并附有 TCMalloc 文档的链接 [[Cox, 2008](#ref-cox-2008)]。当时的结构与 TCMalloc 几乎一一对应：约 100 个
尺寸类，以 4096 字节的页为单位管理堆，每个线程（在 Go 中即每个 M）持有一份缓存。此后，它在三个方面逐渐
偏离了 TCMalloc。

其一是缓存的归属。Go 1.1 重写调度器时引入了 P，Vyukov 将运行队列与内存缓存一并从 M 移到了 P 上
[[Vyukov, 2013](#ref-vyukov-2013)]。M 可能阻塞于系统调用，其数量也不受 `GOMAXPROCS` 限制；P 的数量等于
`GOMAXPROCS`，且任一时刻只被一个 M 持有（[9.3](../../part3concurrency/ch09sched/mpg.md)）。缓存归属于 P
之后，访问缓存无需加锁，缓存的总量也随 `GOMAXPROCS` 而非线程数增长。TCMalloc 后来也朝同一方向演进。其现行
设计文档 [[TCMalloc Authors, 2026](#ref-tcmalloc-authors-2026)]指出，每线程缓存使内存占用随线程数增长：
线程数很多时，要么缓存总量很大，要么每个线程的缓存都很小。为此，TCMalloc 增加了按逻辑 CPU 划分缓存的模式，
并借助 Linux 的可重启序列（restartable sequences）在不加锁、不使用原子指令的前提下保证正确性。在 Go 中，
P 在用户态承担了逻辑处理器的角色；由于调度由运行时自行掌握，这一设计无需内核的支持。

其二是元数据。TCMalloc 服务于显式的 `malloc` 与 `free`，而 Go 的分配器服务于精确的垃圾回收器，因此每一层
结构都需额外记录回收所需的信息：哪些字是指针，哪些对象已被标记，哪些槽位空闲（12.1.5）。

其三是大量实现层面的调整。页大小在 Go 1.3 中由 4096 字节增大到 8192 字节
[[Vyukov, 2014](#ref-vyukov-2014)]；从 Go 1.7 起，span 内的空闲槽改由位图而非链表记录
[[Clements, 2015](#ref-clements-2015)] [[Hudson, 2016](#ref-hudson-2016)]；从 Go 1.8 起，
尺寸类表在构建时生成，不再于启动时计算 [[Randall, 2016](#ref-randall-2016)]；Go 1.15
将中心缓存中加锁的链表替换为带有原子快速路径的集合，在 `GOMAXPROCS` 为 16 时，并发分配 1 KiB
对象的吞吐量由每秒约 4220 MiB 提高到约 10420 MiB [[Knyszek, 2020](#ref-knyszek-2020)]。Go 1.8 时，
Clements 将头注释改为现在的表述 [[Clements, 2016](#ref-clements-2016)]：

```go
// This was originally based on tcmalloc, but has diverged quite a bit.
// http://goog-perftools.sourceforge.net/doc/tcmalloc.html
```

尽管如此，分层的结构始终未变。同一份注释描述了分配小对象时逐级上溯的过程：

```go
// Allocating a small object proceeds up a hierarchy of caches:
//
//	1. Round the size up to one of the small size classes
//	   and look in the corresponding mspan in this P's mcache.
//	   Scan the mspan's free bitmap to find a free slot.
//	   If there is a free slot, allocate it.
//	   This can all be done without acquiring a lock.
//
//	2. If the mspan has no free slots, obtain a new mspan
//	   from the mcentral's list of mspans of the required size
//	   class that have free space.
//	   Obtaining a whole span amortizes the cost of locking
//	   the mcentral.
//
//	3. If the mcentral's mspan list is empty, obtain a run
//	   of pages from the mheap to use for the mspan.
//
//	4. If the mheap is empty or has no page runs large enough,
//	   allocate a new group of pages (at least 1MB) from the
//	   operating system. Allocating a large run of pages
//	   amortizes the cost of talking to the operating system.
```

第一步在当前 P 的缓存 `mcache` 中完成，无需加锁。第二步从该尺寸类的中心缓存 `mcentral` 获取一整个 span，
一次补充可供此后多次分配使用，同步的代价因而被均摊；注释中仍称需要对 `mcentral` 加锁，这是 Go 1.15
以前的情况，如今其常见路径只使用原子操作。第三步从全局的页堆 `mheap` 申请若干连续的页，第四步扩充页堆，
必要时向操作系统申请内存。注释中的「至少 1MB」是 Go 1.10 及以前的下限，如今页堆在大多数平台上以 4 MiB
为单位扩充（[12.2](./component.md)）。层级越靠后，单次代价越高，发生的频率也越低：

```mermaid
flowchart LR
    A["mcache<br/>每 P 一份，不加锁"] -->|span 已满| B["mcentral<br/>每个 span 类一份<br/>取一整个 span"]
    B -->|没有可用 span| C["mheap<br/>全局，按页分配"]
    C -->|页不足| D["操作系统<br/>成块申请"]
```

绝大多数分配在第一步即告完成，这条只涉及当前 P 本地数据的路径称为**快速路径**（fast path）；需要逐级上溯
补充的路径则称为**慢速路径**（slow path）。将全局争用分散到各个 P，是 Go 运行时多处采用的设计：调度器为
每个 P 维护一条本地运行队列（[9.2](../../part3concurrency/ch09sched/steal.md)），`sync.Pool` 为每个 P 维护
一份本地缓存（[11.6](../../part3concurrency/ch11sync/pool.md)），分配器则为每个 P 维护一份 `mcache`。
各组件的细节见 [12.2](./component.md)。

## 12.1.3 尺寸类

Wilson 等人将一类简单而快速的分配政策称为简单隔离存储（simple segregated storage）：请求被向上取整到若干
尺寸档位之一，每个档位有各自的自由表；自由表为空时，向操作系统申请一两页，切分为同样大小的块；块既不分裂
也不合并，因此一页之内只有同一档位的块 [[Wilson et al., 1995](#ref-wilson-1995)]。TCMalloc 与 Go 采用的
正是这一政策，其中的档位称为**尺寸类**（size class），容纳同一尺寸类对象的若干连续页称为 span
（[12.2](./component.md)）。

这一政策有三点好处：同一 span 内的槽位大小相同，分配时只需找到一个空闲槽，而不必在大小各异的空闲块中搜索；
对象的大小由其所在的 span 决定，无需在对象旁另行记录；同尺寸的对象集中存放，不同尺寸的对象不会相互分割
空闲内存。代价是内部碎片，因为请求总要向上取整到某个尺寸类。尺寸类划分得越细，取整的浪费越少；但每个尺寸类
都需要各自的 span 与缓存，划分过细又会使空闲内存分散到过多的尺寸类中。TCMalloc 2005 年的文档使用约 170 个
尺寸类 [[Ghemawat and Menage, 2005](#ref-ghemawat-menage-2005)]，现行文档则为 60 至 80 个
[[TCMalloc Authors, 2026](#ref-tcmalloc-authors-2026)]。

Go 1.26 共有 68 个尺寸类，其中 0 号不对应任何尺寸，实际使用的是 1 至 67 号，覆盖 8 字节到 32 KiB。尺寸类表
由 `runtime/_mkmalloc/mksizeclasses.go` 生成，写入 `internal/runtime/gc/sizeclasses.go`
[[Go Authors, 2026b](#ref-go-authors-2026b)] [[Go Authors, 2026c](#ref-go-authors-2026c)]。生成器开头的
注释说明了其中的取舍：

```go
// The size classes are chosen so that rounding an allocation
// request up to the next size class wastes at most 12.5% (1.125x).
//
// Each size class has its own page count that gets allocated
// and chopped up when new objects of the size class are needed.
// That page count is chosen so that chopping up the run of
// pages into objects of the given size wastes at most 12.5% (1.125x)
// of the memory. It is not necessary that the cutoff here be
// the same as above.
//
// The two sources of waste multiply, so the worst possible case
// for the above constraints would be that allocations of some
// size might have a 26.6% (1.266x) overhead.
// In practice, only one of the wastes comes into play for a
// given size (sizes < 512 waste mainly on the round-up,
// sizes > 512 waste mainly on the page chopping).
// For really small sizes, alignment constraints force the
// overhead higher.
```

浪费有两个来源。一是取整：请求被放入不小于它的槽位。二是切分：span 的长度未必是对象大小的整数倍，末尾
不足以容纳一个对象的部分称为尾部浪费。生成器将两者各自限制在 12.5% 以内，二者相乘，最坏情形为
1.125 × 1.125 ≈ 1.266，即 26.6%。

具体的生成过程如下。尺寸从 8 字节开始，按当前的对齐步长递增，每到一个 2 的幂便调整步长：32 字节起为 16，
128 字节起为该 2 的幂的 1/8，2048 字节起固定为 256。因此，从 128 字节起，相邻候选尺寸之差不超过尺寸的
1/8，取整浪费由此受限；更小的尺寸受 8 字节与 16 字节对齐的约束，浪费比例更高。对每个候选尺寸，
生成器选取最少的页数，使尾部浪费不超过 1/8；若某个尺寸所需的页数与前一个尺寸类相同，每个 span
容纳的对象数也相同，二者便合并为一类。最后，在不改变对象数的前提下，将尺寸放大到尽可能填满 span，
注释中的例子是将 8448 字节放大到 9472 字节，二者都是 7 页容纳 6 个对象。
合并与放大都会拉大相邻尺寸类之间的间距。生成器还会检查结果是否恰为 68 类，否则报错。

生成的文件在注释中列出了每个尺寸类的参数，下表摘录其中几行：

| 尺寸类 | 对象大小（字节） | span 大小（字节） | 对象数 | 尾部浪费（字节） | 最大浪费 | 最小对齐（字节） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 8 | 8192 | 1024 | 0 | 87.50% | 8 |
| 2 | 16 | 8192 | 512 | 0 | 43.75% | 16 |
| 5 | 48 | 8192 | 170 | 32 | 31.52% | 16 |
| 10 | 128 | 8192 | 64 | 0 | 11.72% | 128 |
| 18 | 256 | 8192 | 32 | 0 | 5.86% | 256 |
| 32 | 1024 | 8192 | 8 | 0 | 12.40% | 1024 |
| 45 | 4864 | 24576 | 5 | 256 | 16.65% | 256 |
| 67 | 32768 | 32768 | 1 | 0 | 12.50% | 8192 |

「最大浪费」一列合计了两种浪费，计算的是最坏情形，即 span 中每个对象的请求大小都只比前一个尺寸类多
1 字节。以 5 号类为例，前一个尺寸类为 32 字节，33 字节的请求被放入 48 字节的槽位，每个对象浪费 15 字节，
170 个对象共浪费 2550 字节，加上 32 字节的尾部浪费，占 8192 字节的 31.52%。1 号类的 87.50%
也由同样的计算得出：1 字节的请求占用 8 字节的槽位，浪费 7/8。这正是注释所说的极小尺寸受对齐约束而开销更
高，但浪费的绝对量仅为数个字节。在 128 字节及以上的 58 个尺寸类中，有 13 个超过 12.5%，最高的是 45 号类的
16.65%，这些尺寸上两种浪费同时出现。「最小对齐」一列是尺寸所含的最大 2 的幂因子（以页大小为上限），
即该类对象的地址所能保证的对齐。表中的对象数是生成器按整个 span 计算的结果，Go 1.26 中一部分 span
还要在末尾预留元数据，实际的槽数略少，见 [12.2](./component.md)。

尺寸类可以在程序中直接观察到。`append` 扩容时，运行时将新容量所需的字节数向上取整到尺寸类，再按取整后的
大小确定容量。因此，向空 slice 追加 n 个字节后，`cap` 即为 n 所在尺寸类的大小：

```go {run=true}
package main

import "fmt"

func main() {
	for _, n := range []int{1, 9, 17, 25, 33, 100, 1025, 5000, 33000} {
		b := append([]byte(nil), make([]byte, n)...)
		fmt.Printf("请求 %5d 字节，得到 %5d 字节\n", n, cap(b))
	}
}
```

运行结果如下：

```
请求     1 字节，得到     8 字节
请求     9 字节，得到    16 字节
请求    17 字节，得到    24 字节
请求    25 字节，得到    32 字节
请求    33 字节，得到    48 字节
请求   100 字节，得到   112 字节
请求  1025 字节，得到  1152 字节
请求  5000 字节，得到  5376 字节
请求 33000 字节，得到 40960 字节
```

33 字节落入 48 字节的 5 号类，1025 字节落入 1152 字节的 33 号类。33000 字节超过了 32 KiB，
不属于任何尺寸类，而是作为大对象按整页分配，40960 字节恰为 5 个 8 KiB 的页。

每次小对象分配都要由大小求出尺寸类，这一步不宜使用除法或循环比较。运行时预先生成了两张索引表：不超过
1016 字节的请求以 8 字节为一档查 `SizeToSizeClass8`，更大的请求以 128 字节为一档查 `SizeToSizeClass128`，
一次数组下标即可得到尺寸类。回收时由地址求对象序号同样不用除法：生成器为每个尺寸类预先计算一个魔数，将
`n / size` 转化为一次乘法与一次移位，并在生成时对 span 内所有可能的偏移逐一验证。这两处细节见
[12.5](./smallalloc.md)。

## 12.1.4 按大小与类型分流

尺寸类只解决了小对象的问题。`mallocgc` 还要按两个维度对请求分流：对象的大小，以及对象是否含有指针。下面是
Go 1.26 中 `mallocgc` 的分派部分 [[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
func mallocgc(size uintptr, typ *_type, needzero bool) unsafe.Pointer {
	// ……
	// Short-circuit zero-sized allocation requests.
	if size == 0 {
		return unsafe.Pointer(&zerobase)
	}
	// ……
	// Actually do the allocation.
	var x unsafe.Pointer
	var elemsize uintptr
	if sizeSpecializedMallocEnabled {
		// ……
	} else {
		if size <= maxSmallSize-gc.MallocHeaderSize {
			if typ == nil || !typ.Pointers() {
				// tiny allocations might be kept alive by other co-located values.
				// Make sure secret allocations get zeroed by avoiding the tiny allocator
				// See go.dev/issue/76356
				gp := getg()
				if size < maxTinySize && gp.secret == 0 {
					x, elemsize = mallocgcTiny(size, typ)
				} else {
					x, elemsize = mallocgcSmallNoscan(size, typ, needzero)
				}
			} else {
				if !needzero {
					throw("objects with pointers must be zeroed")
				}
				if heapBitsInSpan(size) {
					x, elemsize = mallocgcSmallScanNoHeader(size, typ)
				} else {
					x, elemsize = mallocgcSmallScanHeader(size, typ)
				}
			}
		} else {
			x, elemsize = mallocgcLarge(size, typ, needzero)
		}
	}
	// ……
}
```

大小为零的请求一律返回同一个地址 `zerobase`，不占用内存。其余请求分为五条路径：

| 路径 | 条件 | 函数 | 详见 |
| --- | --- | --- | --- |
| 微对象 | 不含指针，小于 16 字节 | `mallocgcTiny` | [12.6](./tinyalloc.md) |
| 不含指针的小对象 | 不含指针，16 字节至 32760 字节 | `mallocgcSmallNoscan` | [12.5](./smallalloc.md) |
| 含指针的小对象，无分配头 | 含指针，不超过 512 字节 | `mallocgcSmallScanNoHeader` | [12.5](./smallalloc.md) |
| 含指针的小对象，有分配头 | 含指针，大于 512 字节且不超过 32760 字节 | `mallocgcSmallScanHeader` | [12.5](./smallalloc.md) |
| 大对象 | 超过 32760 字节 | `mallocgcLarge` | [12.4](./largealloc.md) |

小对象的上限是 `maxSmallSize-gc.MallocHeaderSize`，即 32768 减去 8 字节的分配头，这一上限对不含指针的对象
同样适用。Go 1.24 以前，这些路径写在 `mallocgc` 的同一个函数体中，各种情形的条件交织在一起；Knyszek 将其
拆分为上表中各自独立的函数，以便分别优化 [[Knyszek, 2024](#ref-knyszek-2024)]。

按大小分流，是因为不同大小的对象在数量与代价上差异很大。微对象数量极多，
注释称其主要目标是很短的字符串与单独逃逸的变量；若每个微对象独占一个最小槽位，浪费的比例很高。
微对象分配器将多个微对象合并到同一个 16 字节的块中，块内对象全部不可达后，整块才被回收。注释报告，在一个
JSON 基准上，它使分配次数减少约 12%，堆大小减少约 20%。微对象必须不含指针，
注释给出的理由是这样才能使潜在的浪费有界。原因在于，一个已不可达的对象可能因同块中的其他对象存活而被保留，
若它含有指针，其所指向的对象也会随之被保留。代码中的 `gp.secret` 检查与 Go 1.26 的 `runtime/secret`
实验有关：块中的其他对象可能使整块长期存活，而在 secret 模式下分配的对象须在释放时及时清零，
因此不使用微对象分配器 [[Morsing, 2025](#ref-morsing-2025)]。大对象的情况恰好相反：数量少而单个体积大，
若同样在每个 P 上缓存，闲置时将占用大量内存。因此，大对象绕过 `mcache` 与 `mcentral`，各自独占一个 span，
直接从 `mheap` 按页申请。其单次分配的代价较高，但这类分配次数少，均摊到每个字节上的开销并不显著。

按是否含指针分流，则是出于回收器的需要。不含指针的对象存放在单独的 span 中，回收器在标记阶段完全无需扫描
它们：一个 1 MiB 的 `[]byte` 只需被标记，无需逐字检查。含指针的对象则需记录哪些字是指针，记录的位置随对象
大小而不同 [[Go Authors, 2026e](#ref-go-authors-2026e)]：

- 不超过 512 字节的对象没有头部，指针信息存放在 span 末尾的堆位图中，每个指针大小的字对应 1 位；
- 大于 512 字节的小对象，槽位的第一个字存放指向类型描述的指针，称为**分配头**（malloc header），回收器扫描
  时根据类型描述即时展开指针位图；
- 大对象独占一个 span，类型指针直接存放在 span 的描述结构中。

以 512 字节为分界，是因为两种方案的空间开销在这一尺寸上恰好相等。在 64 位平台上，一个 8 KiB 的 span 含
1024 个字，堆位图每字 1 位，共 128 字节；512 字节的对象每个 span 可容纳 16 个，若各带 8 字节的分配头，
同样共计 128 字节。对象更小时，分配头的总开销将超过位图，因此不设分配头
[[Go Authors, 2026f](#ref-go-authors-2026f)]。

这一布局始于 Go 1.22。此前，整个堆共用一张位图，每个字对应 1 位，分配时需按类型将指针信息展开写入位图。
Knyszek 的提交 [[Knyszek, 2023](#ref-knyszek-2023)]列举了改用分配头的好处：多数尺寸类在分配时不再需要展开
位图；类型描述远比展开后的位图紧凑，减轻了 TLB 的压力；分配头紧邻对象，查找类型时具有更好的缓存局部性；
去掉覆盖整个堆的位图后，内存占用固定减少约 1.5%。代价是部分对象因多出 8 字节而升入更大的尺寸类。Go 1.22 的
发布说明 [[Go Authors, 2024](#ref-go-authors-2024)]报告，这一改动使程序的 CPU 性能提高 1% 至 3%，多数程序
的内存开销降低约 1%；其副作用是，一些原本总按 16 字节对齐的对象如今只保证按 8 字节对齐。

分派代码中省略的 `sizeSpecializedMallocEnabled` 分支是一项仍在推进的优化。Matloob 为不超过
512 字节的每个尺寸类生成了专用的分配函数，如 `mallocgcSmallScanNoHeaderSC3`，按请求大小查表调用；
在这些函数中，尺寸类等信息都是编译期常量 [[Matloob, 2025](#ref-matloob-2025)]。这一实验原计划在 Go 1.26
中启用，但发布前在大规模部署中观察到指令缓存占用上升，因而被默认关闭
[[Knyszek, 2026](#ref-knyszek-2026)]。Go 1.27 将专用函数的范围缩小到 80 字节以内并默认启用；据 Matloob
介绍，这些分配最多可加快 20% 至 30%，分配密集的程序整体最多可加快 1%
[[Matloob, 2026](#ref-matloob-2026)]。本书以 Go 1.26 为准，下文只讨论通用路径。

## 12.1.5 与垃圾回收器共生

分配器与回收器的耦合不止于上述分流。`mallocgc` 这个名字本身就反映了这一点。它最早出现在 Russ Cox 2009 年
1 月实现第一个标记清扫回收器的提交中，含义是「可能触发垃圾回收的 malloc」：
函数在分配之后检查已使用的页数，超过阈值便启动一轮回收 [[Cox, 2009](#ref-cox-2009)]。到 Go 1 时，
它带有一个 `dogc` 参数，运行时内部不应触发回收的分配会将其置为 0。如今，
二者的耦合体现在元数据与回收节奏两个方面。

在元数据方面，除上一小节所述的指针信息外，每个 span 还记录哪些槽位已被分配、哪些对象在本轮回收中已被标记。
span 的类别 `spanClass` 由尺寸类与「是否不含指针」合成，每个尺寸类各对应一个含指针的与一个不含指针的 span
类：

```go
func makeSpanClass(sizeclass uint8, noscan bool) spanClass {
	return spanClass(sizeclass<<1) | spanClass(bool2int(noscan))
}
```

在标记期间，新分配的对象会被直接标记，即注释所说的「allocate black」，理由是新对象的各个字都还是 `nil`，
无需扫描：

```go
	if writeBarrier.enabled {
		// Allocate black during GC.
		// All slots hold nil so no scanning is needed.
		// This may be racing with GC so do it atomically if there can be
		// a race marking the bit.
		gcmarknewobject(span, uintptr(x))
	}
```

在回收节奏方面，Go 主要依据堆的增长而非时间启动回收：堆增长到目标值时启动下一轮回收，目标值由上一轮回收
后的存活量决定（[13.3](../ch13gc/pacing.md)）；按时间触发只是后备措施，若两分钟内没有发生回收，则强制进行
一次。检查是否达到目标的时机也经过权衡：小对象只在 `mcache` 中的 span 用尽、需要补充时才检查，即每用完一个
span 检查一次；大对象则每次分配都检查。在标记期间，分配还须承担一部分标记工作，这一机制称为标记辅助。
`mallocgc` 在分配之前，先从当前 goroutine 的协助额度中扣除本次分配的字节数：

```go
	// Assist the GC if needed. (On the reuse path, we currently compensate for this;
	// changes here might require changes there.)
	if gcBlackenEnabled != 0 {
		deductAssistCredit(size)
	}
```

额度为负时，该 goroutine 须先协助回收器补足额度，才能继续分配：它首先尝试借用后台标记工作积累的额度，不足
时再亲自执行标记工作。分配完成后，取整造成的内部碎片也计入额度。分配越快，承担的标记工作越多，从而保证标记
的进度能够跟上分配的速度（[13.4](../ch13gc/mark.md)）。

最后是清零。Go 保证新分配的内存为零值，但从操作系统新获得的内存本来就是零，span 以 `needzero` 记录是否确实
需要清零，从而省去不必要的写入。大对象的清零还须考虑对回收器的影响：清零函数内部没有安全点，一次清零一个
很大的对象时，该 goroutine 长时间无法被抢占，回收器中需要暂停所有 goroutine 的阶段便会因此推迟。因此，
`mallocgcLarge` 在恢复可抢占状态之后才进行清零，并以 256 KiB 为一块分批进行，在块与块之间检查抢占请求
[[Chase, 2020](#ref-chase-2020)]。

## 12.1.6 小结

Go 的分配器是一套分层缓存：最常见的分配在每个 P 的本地缓存中完成，无需加锁；层级越靠后，代价越高，发生得
越少。它采用简单隔离存储的政策，以有界的内部碎片换取分配速度与可控的外部碎片；按对象的大小与是否含指针将
请求分为五条路径；并在每一层记录回收器所需的元数据，使分配的速率驱动回收的节奏。它源自 TCMalloc，但由于
服务于一个不移动对象的并发回收器，已与 TCMalloc 有了很大的差异。[12.2](./component.md) 将逐一介绍实现这一
设计的组件。

## 延伸阅读

- <a id="ref-bonwick-adams-2001"></a>[Bonwick and Adams, 2001] Jeff Bonwick, Jonathan Adams. "Magazines
  and Vmem: Extending the Slab Allocator to Many CPUs and Arbitrary Resources." *USENIX ATC 2001*, 2001.
  https://www.usenix.org/legacy/publications/library/proceedings/usenix01/bonwick.html
  每处理器 magazine 缓存层的出处。
- <a id="ref-chase-2020"></a>[Chase, 2020] David Chase. runtime: break up large calls to
  memclrNoHeapPointers to allow preemption. Go commit 0bbfc5c31e, 2020. https://go.dev/cl/270943
  随 Go 1.17 发布。起因是 Go issue #42642 报告的数毫秒的清扫终止停顿。
- <a id="ref-clements-2015"></a>[Clements, 2015] Austin Clements. *Proposal: Dense mark bits and
  sweep-free allocation.* 2015. https://go.dev/design/12800-sweep-free-alloc
  以位图取代 span 内自由表的设计。
- <a id="ref-clements-2016"></a>[Clements, 2016] Austin Clements. runtime: update malloc.go documentation.
  Go commit aaf4099a5c, 2016. https://go.dev/cl/29731
  随 Go 1.8 发布。
- <a id="ref-cox-2008"></a>[Cox, 2008] Russ Cox. malloc in runtime (not used by default). Go commit
  e29ce175ed, 2008. https://github.com/golang/go/commit/e29ce175eda2016b93e755b6a5ae759b5b692834
  随 Go 1 发布。
- <a id="ref-cox-2009"></a>[Cox, 2009] Russ Cox. gc #0. mark and sweep collector. Go commit 1ce17918e3,
  2009. https://github.com/golang/go/commit/1ce17918e32afe42824404a1419b54a465e8b155
  随 Go 1 发布。
- <a id="ref-evans-2006"></a>[Evans, 2006] Jason Evans. "A Scalable Concurrent malloc(3) Implementation
  for FreeBSD." *BSDCan 2006*, 2006. https://people.freebsd.org/~jasone/jemalloc/bsdcan2006/jemalloc.pdf
  jemalloc 的最初设计：多个 arena，线程轮流分派。
- <a id="ref-ghemawat-menage-2005"></a>[Ghemawat and Menage, 2005] Sanjay Ghemawat, Paul Menage.
  *TCMalloc: Thread-Caching Malloc.* 2005. http://goog-perftools.sourceforge.net/doc/tcmalloc.html
  `runtime/malloc.go` 引用的即是此文。gperftools 项目现在维护的版本：
  https://gperftools.github.io/gperftools/tcmalloc.html
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. *Go 1.22 Release Notes.* 2024.
  https://go.dev/doc/go1.22
  「Runtime」一节介绍分配头带来的变化。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. src/runtime/malloc.go. Go 1.26
  源码. https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/malloc.go
  `mallocgc` 的分派入口与分配器的总体说明。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  src/internal/runtime/gc/sizeclasses.go. Go 1.26 源码.
  https://github.com/golang/go/blob/release-branch.go1.26/src/internal/runtime/gc/sizeclasses.go
  68 个尺寸类及其浪费上界，含 `max waste` 列。
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors.
  src/runtime/_mkmalloc/mksizeclasses.go. Go 1.26 源码.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/_mkmalloc/mksizeclasses.go
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. src/runtime/mgc.go. Go 1.26 源码.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/mgc.go
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors. src/runtime/mbitmap.go. Go 1.26
  源码. https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/mbitmap.go
  堆位图与分配头的布局。
- <a id="ref-go-authors-2026f"></a>[Go Authors, 2026f] The Go Authors. src/internal/runtime/gc/malloc.go.
  Go 1.26 源码. https://github.com/golang/go/blob/release-branch.go1.26/src/internal/runtime/gc/malloc.go
  `MallocHeaderSize` 与 `MinSizeForMallocHeader`，以及 512 字节分界的说明。
- <a id="ref-hudson-2016"></a>[Hudson, 2016] Rick Hudson. [dev.garbage] runtime: add bit and cache ctz64
  (count trailing zero). Go commit 4093481523, 2016. https://go.dev/cl/20200
  随 Go 1.7 发布。
- <a id="ref-knyszek-2020"></a>[Knyszek, 2020] Michael Anthony Knyszek. runtime: add new mcentral
  implementation. Go commit a13691966a, 2020. https://go.dev/cl/221182
  随 Go 1.15 发布。
- <a id="ref-knyszek-2023"></a>[Knyszek, 2023] Michael Anthony Knyszek. runtime: implement experiment to
  replace heap bitmap with alloc headers. Go commit 38ac7c41aa, 2023. https://go.dev/cl/437955
  随 Go 1.22 发布。
- <a id="ref-knyszek-2024"></a>[Knyszek, 2024] Michael Anthony Knyszek. runtime: refactor mallocgc into
  several independent codepaths. Go commit 8730fcf885, 2024. https://go.dev/cl/614257
  随 Go 1.24 发布。
- <a id="ref-knyszek-2026"></a>[Knyszek, 2026] Michael Anthony Knyszek. [release-branch.go1.26]
  internal/buildcfg: disable sizespecializedmalloc by default. Go commit 3604782621, 2026.
  https://go.dev/cl/738900
  随 Go 1.26 发布。
- <a id="ref-matloob-2025"></a>[Matloob, 2025] Michael Matloob. runtime: add specialized malloc functions
  for sizes up to 512 bytes. Go commit 411c250d64, 2025. https://go.dev/cl/665835
  随 Go 1.26 发布，默认关闭。
- <a id="ref-matloob-2026"></a>[Matloob, 2026] Michael Matloob. *Size-Specialized Memory Allocation.* The
  Go Blog, 2026. https://go.dev/blog/size-specialized-allocations
- <a id="ref-morsing-2025"></a>[Morsing, 2025] Daniel Morsing. Go issue #76356. *runtime: tiny allocator
  can keep allocations alive longer than expected.* 2025. https://github.com/golang/go/issues/76356
- <a id="ref-randall-2016"></a>[Randall, 2016] Keith Randall. runtime: compute size classes statically. Go
  commit 7ba36f4adb, 2016. https://go.dev/cl/32219
  随 Go 1.8 发布。
- <a id="ref-tcmalloc-authors-2026"></a>[TCMalloc Authors, 2026] The TCMalloc Authors.
  *TCMalloc: Thread-Caching Malloc.* 2026. https://google.github.io/tcmalloc/design.html
  TCMalloc 现在的设计文档，介绍每线程与每 CPU 两种前端。
- <a id="ref-vyukov-2013"></a>[Vyukov, 2013] Dmitriy Vyukov. runtime: improved scheduler. Go commit
  779c45a507, 2013. https://go.dev/cl/7314062
  随 Go 1.1 发布。
- <a id="ref-vyukov-2014"></a>[Vyukov, 2014] Dmitriy Vyukov. runtime: increase page size to 8K. Go commit
  e48751e217, 2014. https://go.dev/cl/56630043
  随 Go 1.3 发布。
- <a id="ref-wilson-1995"></a>[Wilson et al., 1995] Paul R. Wilson, Mark S. Johnstone, Michael Neely,
  David Boles. "Dynamic Storage Allocation: A Survey and Critical Review." *IWMM 1995*, 1–116, 1995.
  https://doi.org/10.1007/3-540-60368-9_19
  碎片、简单隔离存储以及策略、政策与机制之分的出处。
- 本书 [12.2 组件](./component.md)、[12.4 大对象分配](./largealloc.md)、
  [12.5 小对象分配](./smallalloc.md)、[12.6 微对象分配](./tinyalloc.md)、
  [第 13 章 垃圾回收器](../ch13gc/readme.md)（分配器与回收器的共生关系）。
