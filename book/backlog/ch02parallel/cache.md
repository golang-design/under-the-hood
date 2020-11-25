---
weight: 1202
title: "2.2 缓存技术"
---

# 2.2 缓存技术


## 缓存基础

- 命中
- 未命中
  - 原因
- 缓存的组织结构
- 缓存的相连设计

## UMA

## NUMA

## Write-through

## Write-back

## 一致性协议

### 失效协议

### 更新协议

### MSI, MESI, MOESI, MESIF

## 真假共享

由于在分布式的高速缓存上，缓存一致性通过缓存行而非单字来进行组织。
真共享（Ture Sharing）就是通常意义上的共享内存产生的瓶颈，多个不同的核心需要共享一块数据，该数据会在不同的缓存之间进行同步，此类共享通常会产生性能问题。
还有一种形式的共享——假共享（False Sharing），是指当两个或多个独立访问的数据块共享同一缓存行
时，由于缓存一致性协议的导致需要在不同核心之间同步缓存行而导致的性能问题。这时对于不同的 CPU 核心而言，彼此不共享同一数据块，但由于不恰当的数据块设计导致了与真共享时同样的性能问题。
产生此问题的解决方案是通过增加冗余数据进而将不同的数据块从共享的缓存行隔开，达到不共享的目的。

在现代处理器中，一个缓存行的大小通常为 64 byte。我们不妨编写一个示例程序观察这种现象：

```go
// pad 结构的 x y z 会被并发的执行原子操作
type pad struct {
	x uint64 // 8byte
	y uint64 // 8byte
	z uint64 // 8byte
}

func (s *pad) increase() {
	atomic.AddUint64(&s.x, 1)
	atomic.AddUint64(&s.y, 1)
	atomic.AddUint64(&s.z, 1)
}
```

下面是将 x, y, z 分别对齐到不同缓存行之上的情形：

```go
// pad 结构的 x y z 会被并发的执行原子操作
type pad struct {
	x uint64 // 8byte
	_ [56]byte
	y uint64 // 8byte
	_ [56]byte
	z uint64 // 8byte
	_ [56]byte
}

func (s *pad) increase() {
	atomic.AddUint64(&s.x, 1)
	atomic.AddUint64(&s.y, 1)
	atomic.AddUint64(&s.z, 1)
}
```

我们将如下的性能测试为上面两种不同结构前后分别进行测试：

```go
func BenchmarkPad(b *testing.B) {
	s := pad{}
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			s.increase()
		}
	})
}
```

通过 benchstat 比较前后两种结构的性能可以看到：

```
name   old time/op    new time/op    delta
Pad-4    68.4ns ± 3%    39.4ns ± 1%  -42.34%  (p=0.000 n=9+7)
```

通过对齐到不同缓存上，不同变量的原子操作性能得到了近乎一倍的提升。
因此，程序员在设计并发数据块时，为追求极致性能，应当慎重考虑其设计。

在 Go 的源码中，我们也能在很多地方看到此类处理，例如在 `runtime.mheap` 结构中：

```go
type mheap struct {
	(...)
	central [numSpanClasses]struct {
		mcentral mcentral
		pad      [cpu.CacheLinePadSize - unsafe.Sizeof(mcentral{})%cpu.CacheLinePadSize]byte
	}
	(...)
}
```

`central` 字段是一个数组结构，其内部的 `mcentral` 是一个会根据不同的 `spanClasses` 进行并发访问的字段。
如果不将 `mcentral` 结构进行对齐，直接写成：

```go
type mheap struct {
	(...)
	central [numSpanClasses]mcentral
	(...)
}
```

由于数组是一段连续的内存，两个不同的 mcentral 之间可能共享同一根缓存行。
进而不同的 `mcentral` 之间将产生假共享，从而导致并发时的性能问题。
为了使 `mcentral` 对齐到整数倍的缓存行上，通过 `unsafe.Sizeof` 来计算 `mcentral` 结构的大小，
并通过 CPU 缓存行大小（`cpu.CacheLinePadSize = 64`，现代处理器每个 L1 缓存一般拥有 32 * 1024 / 64 = 512 条缓存行）计算出需要填充的实际字节数：

```
pad [cpu.CacheLinePadSize - unsafe.Sizeof(mcentral{})%cpu.CacheLinePadSize]byte
```

从而解决了假共享的问题，同样的做法还有很多，在本书后面的源码分析中，将默认读者已经熟悉此做法，不再详细介绍。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
