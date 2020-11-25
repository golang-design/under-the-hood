---
weight: 2206
title: "7.6 微对象分配"
---

# 7.6 微对象分配

微对象（tiny object）是指那些小于 16 byte 的对象分配，
微对象分配会将多个对象存放到一起，与小对象分配相比，过程基本类似。

```go
// 偏移量
off := c.tinyoffset
// 将微型指针对齐以进行所需（保守）对齐。
if size&7 == 0 {
	off = round(off, 8)
} else if size&3 == 0 {
	off = round(off, 4)
} else if size&1 == 0 {
	off = round(off, 2)
}

if off+size <= maxTinySize && c.tiny != 0 {
	// 能直接被当前的内存块容纳
	x = unsafe.Pointer(c.tiny + off)
	// 增加 offset
	c.tinyoffset = off + size
	// 统计数量
	c.local_tinyallocs++
	// 完成分配，释放 m
	mp.mallocing = 0
	releasem(mp)
	return x
}
// 根据 tinySpan 的大小等级获得对应的 span 链表
// 从而用于分配一个新的 maxTinySize 块，与小对象分配的过程一致
span := c.alloc[tinySpanClass]
v := nextFreeFast(span)
if v == 0 {
	v, _, shouldhelpgc = c.nextFree(tinySpanClass)
}
x = unsafe.Pointer(v)
(*[2]uint64)(x)[0] = 0
(*[2]uint64)(x)[1] = 0
// 看看我们是否需要根据剩余可用空间量替换现有的小块
if size < c.tinyoffset || c.tiny == 0 {
	c.tiny = uintptr(x)
	c.tinyoffset = size
}
size = maxTinySize
```

寻找 span 的过程其实与小对象分配完全一致，区别在于微对象分配只寻找 `tinySpanClass` 大小等级的 span。
而且不会对这部分内存进行清零。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
