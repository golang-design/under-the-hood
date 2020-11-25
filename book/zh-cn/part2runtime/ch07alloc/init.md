---
weight: 2203
title: "7.3 初始化"
---

# 7.3 初始化

除去执行栈外，内存分配器是最先完成初始化的，我们先来看这个初始化的过程。
内存分配器的初始化除去一些例行的检查之外，就是对堆的初始化了：

```go
func mallocinit() {
	// 一些涉及内存分配器的常量的检查，包括
	// heapArenaBitmapBytes, physPageSize 等等
	...

	// 初始化堆
	mheap_.init()
	_g_ := getg()
	_g_.m.mcache = allocmcache()

	// 创建初始的 arena 增长 hint
	if sys.PtrSize == 8 && GOARCH != "wasm" {
		for i := 0x7f; i >= 0; i-- {
			var p uintptr
			switch {
			case GOARCH == "arm64" && GOOS == "darwin":
				p = uintptr(i)<<40 | uintptrMask&(0x0013<<28)
			(...)
			default:
				p = uintptr(i)<<40 | uintptrMask&(0x00c0<<32)
			}
			hint := (*arenaHint)(mheap_.arenaHintAlloc.alloc())
			hint.addr = p
			hint.next, mheap_.arenaHints = mheap_.arenaHints, hint
		}
	} else {
		// 32 位机器，不关心
		(...)
	}
}
```

堆的初始化：

```go
// 堆初始化
func (h *mheap) init() {
	// 初始化堆中各个组件的分配器
	h.treapalloc.init(unsafe.Sizeof(treapNode{}), nil, nil, &memstats.other_sys)
	h.spanalloc.init(unsafe.Sizeof(mspan{}), recordspan, unsafe.Pointer(h), &memstats.mspan_sys)
	h.cachealloc.init(unsafe.Sizeof(mcache{}), nil, nil, &memstats.mcache_sys)
	h.specialfinalizeralloc.init(unsafe.Sizeof(specialfinalizer{}), nil, nil, &memstats.other_sys)
	h.specialprofilealloc.init(unsafe.Sizeof(specialprofile{}), nil, nil, &memstats.other_sys)
	h.arenaHintAlloc.init(unsafe.Sizeof(arenaHint{}), nil, nil, &memstats.other_sys)

	// 不对 mspan 的分配清零，后台扫描可以通过分配它来并发的检查一个 span
	// 因此 span 的 sweepgen 在释放和重新分配时候能存活，从而可以防止后台扫描
	// 不正确的将其从 0 进行 CAS。
	//
	// 因为 mspan 不包含堆指针，因此它是安全的
	h.spanalloc.zero = false

	// h->mapcache 不需要初始化
	for i := range h.central {
		h.central[i].mcentral.init(spanClass(i))
	}
}
```

在这个过程中还包含对 mcache 初始化 `allocmcache()`，这个 mcache 会在 `procresize` 中将 mcache
转移到 P 的门下，而并非属于 M，这个我们在已经在 [内存管理: 组件](./component.md) 中讨论过了。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).