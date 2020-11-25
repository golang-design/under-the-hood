---
weight: 2205
title: "7.5 小对象分配"
---

# 7.5 小对象分配

小对象分配过程相对就比较复杂了。

## 从 mcache 获取

```go
// 计算 size class
var sizeclass uint8
if size <= smallSizeMax-8 {
    sizeclass = size_to_class8[(size+smallSizeDiv-1)/smallSizeDiv]
} else {
    sizeclass = size_to_class128[(size-smallSizeMax+largeSizeDiv-1)/largeSizeDiv]
}
size = uintptr(class_to_size[sizeclass])
spc := makeSpanClass(sizeclass, noscan)
span := c.alloc[spc]
// 获得对应 size 的 span 列表
v := nextFreeFast(span)
if v == 0 {
    v, span, shouldhelpgc = c.nextFree(spc)
}
x = unsafe.Pointer(v)
if needzero && span.needzero != 0 {
    memclrNoHeapPointers(unsafe.Pointer(v), size)
}
```

表面上看，小对象的分配过程似乎很少，实际上基于 `nextFreeFast` 和 `nextFree` 两个分配调用隐藏了相当复杂的过程。
`nextFreeFast` 不涉及正式的分配过程，只是简单的寻找一个能够容纳当前微型对象的 span：

```go
func nextFreeFast(s *mspan) gclinkptr {
	// 检查莫为零的个数
	theBit := sys.Ctz64(s.allocCache)
	// 如果小于 64 则说明可以直接使用
	if theBit < 64 {
		result := s.freeindex + uintptr(theBit)
		if result < s.nelems {
			freeidx := result + 1
			if freeidx%64 == 0 && freeidx != s.nelems {
				return 0
			}
			s.allocCache >>= uint(theBit + 1)
			s.freeindex = freeidx
			s.allocCount++
			return gclinkptr(result*s.elemsize + s.base())
		}
	}
	return 0
}
```

`allocCache` 字段用于计算 `freeindex` 上的 `allocBits` 缓存，`allocCache` 进行了移位使其最低位对应于
freeindex 位。allocCache 保存 allocBits 的补码，从而尾零计数可以直接使用它。

```go
func (c *mcache) nextFree(spc spanClass) (v gclinkptr, s *mspan, shouldhelpgc bool) {
	s = c.alloc[spc]
	(...)
	// 获得 s.freeindex 中或之后 s 中下一个空闲对象的索引
	freeIndex := s.nextFreeIndex()
	if freeIndex == s.nelems {
		// span 已满，进行填充
		(...)
		c.refill(spc)
		(...)

		// 再次获取 freeIndex
		s = c.alloc[spc]
		freeIndex = s.nextFreeIndex()
	}
	(...)
	v = gclinkptr(freeIndex*s.elemsize + s.base()) // 这部分内容需要被 gc 接管，因此需要计算位置
	s.allocCount++ // 分配计数
	(...)
	return
}
```

过程很直接，先尝试获取 `freeIndex`，如已经获取到，则直接根据元素的大小来计算需要被 GC 的内存位置。
当 span 已满时候，会通过 `refill` 进行填充，而后再次尝试获取 `freeIndex`。
可以看到 `refill` 其实是从 `mcentral` 调用 `cacheSpan` 方法来获得 span：


```go
func (c *mcache) refill(spc spanClass) {
	_g_ := getg()

	_g_.m.locks++
	// Return the current cached span to the central lists.
	s := c.alloc[spc]

	(...)
	// Get a new cached span from the central lists.
	s = mheap_.central[spc].mcentral.cacheSpan()
	if s == nil {
		throw("out of memory")
	}

	(...)

	c.alloc[spc] = s
}
```

## 从 mcentral 获取

```go
func (c *mcentral) cacheSpan() *mspan {
	(...)
	lock(&c.lock)
	(...)
retry:
	var s *mspan
	for s = c.nonempty.first; s != nil; s = s.next {
		(...)
		c.nonempty.remove(s)
		c.empty.insertBack(s)
		unlock(&c.lock)
		goto havespan
	}
	(...)
	unlock(&c.lock)

	// Replenish central list if empty.
	s = c.grow()
	if s == nil {
		return nil
	}
	lock(&c.lock)
	c.empty.insertBack(s)
	unlock(&c.lock)

	// At this point s is a non-empty span, queued at the end of the empty list,
	// c is unlocked.
havespan:
	(...)
	n := int(s.nelems) - int(s.allocCount)
	if n == 0 || s.freeindex == s.nelems || uintptr(s.allocCount) == s.nelems {
		throw("span has no free objects")
	}
	// Assume all objects from this span will be allocated in the
	// mcache. If it gets uncached, we'll adjust this.
	atomic.Xadd64(&c.nmalloc, int64(n))
	usedBytes := uintptr(s.allocCount) * s.elemsize
	atomic.Xadd64(&memstats.heap_live, int64(spanBytes)-int64(usedBytes))
	(...)
	freeByteBase := s.freeindex &^ (64 - 1)
	whichByte := freeByteBase / 8
	// Init alloc bits cache.
	s.refillAllocCache(whichByte)

	// Adjust the allocCache so that s.freeindex corresponds to the low bit in
	// s.allocCache.
	s.allocCache >>= s.freeindex % 64

	return s
}
```

## 从 mheap 获取

```go
func (c *mcentral) grow() *mspan {
	npages := uintptr(class_to_allocnpages[c.spanclass.sizeclass()])
	size := uintptr(class_to_size[c.spanclass.sizeclass()])
	n := (npages << _PageShift) / size

	s := mheap_.alloc(npages, c.spanclass, false, true)
	if s == nil {
		return nil
	}

	p := s.base()
	s.limit = p + size*n

	heapBitsForAddr(s.base()).initSpan(s)
	return s
}
```

直接从 `mheap_` 分配的 `alloc`，已经在大对象的分配过程中讨论过了，这里便不再赘述了。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).