---
weight: 2308
title: "8.8 内存清扫阶段"
---

# 8.8 内存清扫阶段

[TOC]

清扫过程非常简单，此刻 GC 已停止，它与赋值器（用户代码）并发执行。
它的主要职能便是如何将一个已经从内存分配器中分配出得内存回收到内存分配器中。

## 启动方式

标记终止结束后，会进入 `GCoff` 阶段，并调用 `gcSweep` 来并发的使后台清扫器 goroutine 与赋值器并发执行。

```go
func gcMarkTermination(nextTriggerRatio float64) {
	(...)
	systemstack(func() {
		(...)
		// 标记阶段已经完成，关闭写屏障，开始并发清扫
		setGCPhase(_GCoff)
		gcSweep(work.mode)
	})
	(...)
}
```

其实现非常简单，只需要将 mheap_ 相关的标志位清零，并唤醒后台清扫器 goroutine 即可。

```go
//go:systemstack
func gcSweep(mode gcMode) { // 此时为 GCoff 阶段
	(...)
	lock(&mheap_.lock)
	mheap_.sweepgen += 2
	mheap_.sweepdone = 0
	(...)
	mheap_.pagesSwept = 0
	mheap_.sweepArenas = mheap_.allArenas
	mheap_.reclaimIndex = 0
	mheap_.reclaimCredit = 0
	unlock(&mheap_.lock)

	// 出于调试目的，用户可以让 sweep 过程阻塞执行，但我们并不感兴趣
	(...)

	// 并发清扫（唤醒后台 goroutine）
	lock(&sweep.lock)
	if sweep.parked {
		sweep.parked = false
		ready(sweep.g, 0, true)
	}
	unlock(&sweep.lock)
}
```

## 并发清扫

清扫过程依赖下面的结构：

```go
var sweep sweepdata

type sweepdata struct {
	lock    mutex
	g       *g
	parked  bool
	started bool

	nbgsweep    uint32
	npausesweep uint32
}
```

该结构通过：

1. mutex 保证清扫过程的原子性
2. g 指针来保存所在的 goroutine
3. started 判断是否开始
4. nbgsweep 和 npausesweep 来统计清扫过程


当一个后台 sweeper 从应用程序启动时休眠后，再重新唤醒时，会进入如下循环，并一直在次循环中反复休眠与被唤醒：


```go
func bgsweep(c chan int) {
	(...)
	for {
		// 清扫 span，如果清扫了一部分 span，则记录 bgsweep 的次数
		for sweepone() != ^uintptr(0) {
			sweep.nbgsweep++
			Gosched()
		}
		// 可抢占的释放一些 workbufs 到堆中
		for freeSomeWbufs(true) {
			Gosched()
		}
		// 在 mheap_ 上判断是否完成清扫，若未完成，则继续进行清扫
		lock(&sweep.lock)
		if !isSweepDone() {  // 即 mheap_.sweepdone != 0
			unlock(&sweep.lock)
			continue
		}
		// 否则让 goroutine 进行 park
		sweep.parked = true
		goparkunlock(&sweep.lock, waitReasonGCSweepWait, traceEvGoBlock, 1)
	}
}
```

sweepone 从堆中清理

```go
func sweepone() uintptr {
	_g_ := getg()
	(...)

	// 增加锁的数量确保 goroutine 在 sweep 中不会被抢占，进而不会将 span 留到下个 GC 产生不一致
	_g_.m.locks++
	if atomic.Load(&mheap_.sweepdone) != 0 {
		_g_.m.locks--
		return ^uintptr(0)
	}
	// 记录 sweeper 的数量
	atomic.Xadd(&mheap_.sweepers, +1)

	// 寻找需要 sweep 的 span
	var s *mspan
	sg := mheap_.sweepgen
	for {
		s = mheap_.sweepSpans[1-sg/2%2].pop()
		if s == nil {
			atomic.Store(&mheap_.sweepdone, 1)
			break
		}
		if s.state != mSpanInUse {
			(...)
			continue
		}
		if s.sweepgen == sg-2 && atomic.Cas(&s.sweepgen, sg-2, sg-1) {
			break
		}
	}

	// sweep 找到的 span
	npages := ^uintptr(0)
	if s != nil {
		npages = s.npages
		if s.sweep(false) { // false 表示将其归还到 heap 中
			// 整个 span 都已被释放，记录释放的额度，因为整个页都能用作 span 分配了
			atomic.Xadduintptr(&mheap_.reclaimCredit, npages)
		} else {
			// span 还在被使用，因此返回零
			// 并需要 span 移动到已经 sweep 的 in-use 列表中。
			npages = 0
		}
	}

	// 减少 sweeper 的数量并确保最后一个运行的 sweeper 正常标记了 mheap.sweepdone
	if atomic.Xadd(&mheap_.sweepers, -1) == 0 && atomic.Load(&mheap_.sweepdone) != 0 {
		(...)
	}
	_g_.m.locks--
	return npages
}
```

```go
// freeSomeWbufs 释放一些 workbufs 回到堆中，如果需要再次调用则返回 true
func freeSomeWbufs(preemptible bool) bool {
	const batchSize = 64 // 每个 span 需要 ~1–2 µs
	lock(&work.wbufSpans.lock)
	// 如果此时在标记阶段、或者 wbufSpans 为空，则不需要进行释放
	// 因为标记阶段 workbufs 需要被标记，而 workbufs 为空则更不需要释放
	if gcphase != _GCoff || work.wbufSpans.free.isEmpty() {
		unlock(&work.wbufSpans.lock)
		return false
	}
	systemstack(func() {
		gp := getg().m.curg
		// 清扫一批 span，64 个，大约 ~1–2 µs
		// 在需要被抢占时停止、在清扫完毕后停止
		for i := 0; i < batchSize && !(preemptible && gp.preempt); i++ {
			span := work.wbufSpans.free.first
			if span == nil {
				break
			}
			// 将 span 移除 wbufSpans 的空闲链表中
			work.wbufSpans.free.remove(span)
			// 将 span 归还到 mheap 中
			mheap_.freeManual(span, &memstats.gc_sys)
		}
	})
	// workbufs 的空闲 span 列表尚未清空，还需要更多清扫
	more := !work.wbufSpans.free.isEmpty()
	unlock(&work.wbufSpans.lock)
	return more
}
```

```go
//go:systemstack
func (h *mheap) freeManual(s *mspan, stat *uint64) {
	s.needzero = 1 // span 在下次被分配走时需要对该段内存进行清零
	lock(&h.lock)
	*stat -= uint64(s.npages << _PageShift)
	memstats.heap_sys += uint64(s.npages << _PageShift) // 记录并增加堆中的剩余空间
	h.freeSpanLocked(s, false, true) // 将其释放会堆中
	unlock(&h.lock)
}
func (h *mheap) freeSpanLocked(s *mspan, acctinuse, acctidle bool) {
	switch s.state {
	case mSpanManual:
		(...) // panic
	case mSpanInUse:
		(...)
		h.pagesInUse -= uint64(s.npages)

		// 清除 arena page bitmap 正在使用的二进制位
		arena, pageIdx, pageMask := pageIndexOf(s.base())
		arena.pageInUse[pageIdx] &^= pageMask
	default:
		(...) // panic
	}

	if acctinuse {
		memstats.heap_inuse -= uint64(s.npages << _PageShift)
	}
	if acctidle {
		memstats.heap_idle += uint64(s.npages << _PageShift)
	}
	s.state = mSpanFree

	// 与邻居进行结合
	h.coalesce(s)

	// 插入回 treap
	h.free.insert(s)
}
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
