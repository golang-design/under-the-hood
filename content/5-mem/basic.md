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

### Arena

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

### Span

然而管理 arena 如此粒度的内存并不符合实践，相反，所有的堆对象都通过 span 进行分配。
小于 32kb 的小对象则分配在固定大小等级的 span 上。

## 进一步阅读的参考文献

1. [TCMalloc : Thread-Caching Malloc](http://goog-perftools.sourceforge.net/doc/tcmalloc.html)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
