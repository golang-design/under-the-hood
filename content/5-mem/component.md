# 5 内存管理: 分配器组件

## mcache

`mcache` 是一个 per-P 的缓存，因此每个线程都只访问自身的 `mcache`，因此也就不会出现
并发，也就省去了对其进行加锁步骤。

```go
//go:notinheap
type mcache struct {
	// 下面的成员在每次 malloc 时都会被访问
	// 因此将它们放到一起来利用缓存的局部性原理
	next_sample int32   // 分配这么多字节后触发堆样本
	local_scan  uintptr // 分配的可扫描堆的字节数

	// 没有指针的微小对象的分配器缓存。
	// 请参考 malloc.go 中的 "小型分配器" 注释。
	//
	// tiny 指向当前 tiny 块的起始位置，或当没有 tiny 块时候为 nil
	// tiny 是一个堆指针。由于 mcache 在非 GC 内存中，我们通过在
	// mark termination 期间在 releaseAll 中清除它来处理它。
	tiny             uintptr
	tinyoffset       uintptr
	local_tinyallocs uintptr // 不计入其他统计的极小分配的数量

	// 下面的不在每个 malloc 时被访问

	alloc [numSpanClasses]*mspan // 用来分配的 spans，由 spanClass 索引

	stackcache [_NumStackOrders]stackfreelist

	// 本地分配器统计，在 GC 期间被刷新
	local_largefree  uintptr                  // bytes freed for large objects (>maxsmallsize)
	local_nlargefree uintptr                  // number of frees for large objects (>maxsmallsize)
	local_nsmallfree [_NumSizeClasses]uintptr // number of frees for small objects (<=maxsmallsize)
}
```

### 分配

运行时的 `runtime.allocmcache` 从 `mheap` 上分配一个 `mcache`。
由于 `mheap` 是全局的，因此在分配期必须对其进行加锁，而分配通过 fixAlloc 组件完成：

```go
// 虚拟的MSpan，不包含任何对象。
var emptymspan mspan

func allocmcache() *mcache {
	lock(&mheap_.lock)
	c := (*mcache)(mheap_.cachealloc.alloc())
	unlock(&mheap_.lock)
	for i := range c.alloc {
		c.alloc[i] = &emptymspan // 暂时指向虚拟的 mspan 中
	}
	// 返回下一个采样点，是服从泊松过程的随机数
	c.next_sample = nextSample()
	return c
}
```

由于运行时提供了采样过程堆分析的支持，
由于我们的采样的目标是平均每个 `MemProfileRate` 字节对分配进行采样，
显然，在整个时间线上的分配情况应该是完全随机分布的，这是一个泊松过程。
因此最佳的采样点应该是服从指数分布 `exp(MemProfileRate)` 的随机数，其中
`MemProfileRate` 为均值。

```go
func nextSample() int32 {
	if GOOS == "plan9" {
		// Plan 9 doesn't support floating point in note handler.
		if g := getg(); g == g.m.gsignal {
			return nextSampleNoFP()
		}
	}

	return fastexprand(MemProfileRate) // 即 exp(MemProfileRate)
}
```

`MemProfileRate` 是一个公共变量，可以在用户态代码进行修改：

```go
var MemProfileRate int = 512 * 1024
```

### 释放

由于 `mcache` 从非 GC 内存上进行分配，因此出现的任何堆指针都必须进行特殊处理。
所以在释放前，需要调用 `mcache.releaseAll` 将堆指针进行处理：

```go
func (c *mcache) releaseAll() {
	for i := range c.alloc {
		s := c.alloc[i]
		if s != &emptymspan {
			// 将 span 归还
			mheap_.central[i].mcentral.uncacheSpan(s)
			c.alloc[i] = &emptymspan
		}
	}
	// 清空 tinyalloc 池.
	c.tiny = 0
	c.tinyoffset = 0
}
```

```go
func freemcache(c *mcache) {
	systemstack(func() {
		// 归还 span
		c.releaseAll()
		// 释放 stack
		stackcache_clear(c)

		lock(&mheap_.lock)
		// 记录局部统计
		purgecachedstats(c)
		// 将 mcache 释放
		mheap_.cachealloc.free(unsafe.Pointer(c))
		unlock(&mheap_.lock)
	})
}
```

### per-P? per-M?

mcache 其实早在 [4 调度器: 调度执行](../4-sched/exec.md) 中与 mcache 打过照面了。

首先，mcache 是一个 per-P 的 mcache，我们很自然的疑问就是，这个 mcache 在 p/m 这两个结构体上都有成员：

```go
type p struct {
	(...)
	mcache      *mcache
	(...)
}
type m struct {
	(...)
	mcache      *mcache
	(...)
}
```

那么 mcache 是跟着谁跑的？结合调度器的知识不难发现，m 在执行时需要持有一个 p 才具备执行能力。
那么在 `acquirep` 的时候，是否有发生 mcache 的持有呢？答案是有的：

```go
//go:yeswritebarrierrec
func acquirep(_p_ *p) {
	acquirep1(_p_)
	_g_ := getg()
	
	// 将 p 上的 mcache 给到 m 上
	_g_.m.mcache = _p_.mcache

	(...)
}
```

同样，我们还需要验证，当 releasep 的时候，是否会发生 mcache 和 m 的解绑？答案也是肯定的：

```go
func releasep() *p {
	_g_ := getg()

	(...)
	_g_.m.mcache = nil

	(...)
}
```

更有利的证据是，当调用 `runtime.procresize` 时，初始化新的 P 时，mcache 是直接分配到 p 的；
回收 p 时，mcache 是直接从 p 上获取：

```go
func procresize(nprocs int32) *p {
	(...)
	// 初始化新的 P
	for i := int32(0); i < nprocs; i++ {
		pp := allp[i]
		(...)
		// 为 P 分配 cache 对象
		if pp.mcache == nil {
			if old == 0 && i == 0 {
				if getg().m.mcache == nil {
					throw("missing mcache?")
				}
				pp.mcache = getg().m.mcache
			} else {
				// 创建 cache
				pp.mcache = allocmcache()
			}
		}

		(...)
	}

	// 释放未使用的 P
	for i := nprocs; i < old; i++ {
		p := allp[i]
		(...)
		// 释放当前 P 绑定的 cache
		freemcache(p.mcache)
		p.mcache = nil
		(...)
	}
	(...)
}
```

因而我们可以明确：

- mcache 会被 P 持有，当 M 和 P 绑定时，M 同样会保留 mcache 的指针
- mcache 直接向操作系统申请内存，且常驻运行时
- p 通过 make 命令进行分配，会分配在 Go 堆上

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
