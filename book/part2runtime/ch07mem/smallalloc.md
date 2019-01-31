# 内存管理: 小对象分配

小对象分配过程相对就比较复杂了。

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

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)