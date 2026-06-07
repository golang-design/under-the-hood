---
weight: 4104
title: "12.4 大对象分配"
---

# 12.4 大对象分配

大于 **32KB** 的对象走最直接的一条路：跳过所有缓存层，**直接向 mheap 按页申请**
（[12.2](./component.md)）。这一节看这条路为何如此设计。

## 12.4.1 直达堆

大对象（`size > maxSmallSize`，即 32KB）不经过 mcache、mcentral 的尺寸类缓存,那套缓存是为
高频小对象优化的，对大对象既不划算也无必要。运行时直接计算需要多少页（以 8KB 页为单位向上取整），
向 mheap 的页分配器（[12.7](./pagealloc.md)）要一段连续的空闲页，专门为这一个对象建一个 span。
回收时这段页直接还给 mheap。

## 12.4.2 为何不缓存大对象

道理很简单：缓存的价值在于"高频复用同样大小的块"。小对象成千上万、大小集中在少数尺寸类，
缓存命中率高、收益巨大。大对象则**低频且大小各异**,为每种大小都缓存既浪费内存，命中率也低。
更重要的是，大对象动辄数十 KB 到数 MB，若被缓存而不及时归还，内存浪费立竿见影。因此对大对象，
"按需直取、用完即还"比"缓存复用"更合理。这是一处朴素的成本权衡：**优化要花在高频路径上**，
对低频的大对象，简单直接反而最好。

## 12.4.3 几个实践含义

大对象走独立路径，带来几个值得知道的实践点。其一，分配大对象会直接触及 mheap 的全局锁，
比小对象的无锁快路径慢得多,频繁分配大缓冲区是性能隐患，常用 `sync.Pool`
（[11.6](../../part3concurrency/ch11sync/pool.md)）复用来缓解。其二，大对象按页对齐，可能带来
页级的内部碎片（如 33KB 对象占 40KB 的 5 个页）。其三，大对象的分配也会**显著推动 GC 步调**
（[13.x](../../part4memory/ch13gc)）,一次大分配可能直接触发一轮 GC。理解了大对象这条简单直接
的路，再看小对象那条精巧的缓存路径（[12.5](./smallalloc.md)），对比之下设计取舍就格外清晰。

## 延伸阅读的文献

1. The Go Authors. *runtime/malloc.go：mallocgc 的 largeAlloc 分支.*
   https://github.com/golang/go/blob/master/src/runtime/malloc.go
2. The Go Authors. *runtime/mheap.go：mheap.alloc.*
   https://github.com/golang/go/blob/master/src/runtime/mheap.go
3. 本书 [12.5 小对象分配](./smallalloc.md)、[12.7 页分配器](./pagealloc.md)、
   [11.6 缓存池](../../part3concurrency/ch11sync/pool.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
