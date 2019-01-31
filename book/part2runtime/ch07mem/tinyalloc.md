# 内存管理: 微对象分配

微对象（tiny object）是指那些小于 16 byte 的对象分配，微对象分配会将多个对象存放到
一起：

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
// 从而用于分配一个新的 maxTinySize 块
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

微型对象的分配过程比较简单，实际分配主要是基于 `nextFreeFast` 和 `nextFree` 两个调用。
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

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
