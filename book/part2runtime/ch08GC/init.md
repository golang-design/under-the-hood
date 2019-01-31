# 垃圾回收器：初始化

TODO:

```go
// runtime/mgcwork.go
const (
	_WorkbufSize = 2048 // 单位为字节; 值越大，争用越少

	// workbufAlloc 是一次为新的 workbuf 分配的字节数。
	// 必须是 pageSize 的倍数，并且应该是 _WorkbufSize 的倍数。
	//
	// 较大的值会减少 workbuf 分配开销。较小的值可减少堆碎片。
	workbufAlloc = 32 << 10
)
//go:notinheap
type workbuf struct {
	workbufhdr
	// account for the above fields
	obj [(_WorkbufSize - unsafe.Sizeof(workbufhdr{})) / sys.PtrSize]uintptr
}

// runtime/mgc.go
func gcinit() {
	if unsafe.Sizeof(workbuf{}) != _WorkbufSize {
		throw("size of Workbuf is suboptimal")
	}

	// 第一个周期没有扫描。
	mheap_.sweepdone = 1

	// 设置合理的初始 GC 触发比率。
	memstats.triggerRatio = 7 / 8.0

	// 伪造一个 heap_marked 值，使它看起来像一个触发器
	// heapminimum 是 heap_marked的 适当增长。
	// 这将用于计算初始 GC 目标。
	memstats.heap_marked = uint64(float64(heapminimum) / (1 + memstats.triggerRatio))

	// 从环境中设置 gcpercent。这也将计算并设置 GC 触发器和目标。
	_ = setGCPercent(readgogc())

	work.startSema = 1
	work.markDoneSema = 1
}
func readgogc() int32 {
	p := gogetenv("GOGC")
	if p == "off" {
		return -1
	}
	if n, ok := atoi32(p); ok {
		return n
	}
	return 100
}
//go:linkname setGCPercent runtime/debug.setGCPercent
func setGCPercent(in int32) (out int32) {
	lock(&mheap_.lock)
	out = gcpercent
	if in < 0 {
		in = -1
	}
	gcpercent = in
	heapminimum = defaultHeapMinimum * uint64(gcpercent) / 100
	// Update pacing in response to gcpercent change.
	gcSetTriggerRatio(memstats.triggerRatio)
	unlock(&mheap_.lock)

	// If we just disabled GC, wait for any concurrent GC mark to
	// finish so we always return with no GC running.
	if in < 0 {
		gcWaitOnMark(atomic.Load(&work.cycles))
	}

	return out
}
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)