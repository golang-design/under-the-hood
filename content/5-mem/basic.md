# 5 内存管理: 基本知识

到目前为止，我们已经分析了 Go 程序如何启动、初始化需要进行的关键步骤、初始化结束后，
主 goroutine 如何被调度器进行调度。现在我们来看 Go 中另一重要的关键组件：内存分配器。

在阅读 Go 内存管理（分配器）的代码之前，我们首先建立几个基本的思想。
在计算机领域中，无外乎时间换空间、空间换时间。如果你有自己实现过内存池，
基本上能够非常轻松理解所谓「内存管理」的概念。所谓内存管理，无非是提前分配好一大块内存，
对其进行管理、分配与回收。这样带来的好处毋庸置疑：减少了向操作系统申请内存的开销，加快了内存分配的速度。
当然，除了这个好处之外，另一个优势就是能够更好的支持垃圾回收，这一点我们留到垃圾回收器一节中进行讨论。

## TCMalloc

Go 的内存分配器基于 tcmalloc [1]，但存在一定差异。

TODO:

## 内存分配器的主要结构

内存分配器主要包含以下几个核心组件：

- [x] fixalloc：用于分配固定大小的堆外内存，基于自由表实现
- mheap：分配的堆，在页大小为 8KB 的粒度上进行管理
- mspan：是 mheap 上管理的一连串 page
- mcentral：搜集了给定 class 大小的所有 span
- [x] mcache：是一个 per-P 的缓存。
- mstats：用于分配器的统计

每一个结构虽然不都像是 m/p/g 结构那样的大部头，但初次阅读这些结构时想要理清他们之间的关系还是比较麻烦的。

传统意义上的堆内存，被 Go 运行时划分为了两个部分，一个是 Go 运行时所需的堆内存，
另一部分则用于 Go 用户态代码所使用的堆内存，也叫做 Go 堆。
Go 堆被视为由多个 arena 组成，每个 arena 在 64 位机器上位 64MB，
且起始地址与 arena 的大小对齐。

每个 arena 都包含一个 heapArena 对象，它内部的对象与堆外进行关联，它保存了 arena 的 metadata，
这些 metadata 包括：

- arena 中所有字的 heap bitmap
- arena 中所有页的 span map

## 进一步阅读的参考文献

1. [TCMalloc : Thread-Caching Malloc](http://goog-perftools.sourceforge.net/doc/tcmalloc.html)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
