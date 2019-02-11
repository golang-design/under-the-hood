# 调度器: goroutine 执行栈管理

[TOC]



## 栈结构

## 初始化

```go
// runtime/internal/sys/stubs.go
const PtrSize = 4 << (^uintptr(0) >> 63) // unsafe.Sizeof(uintptr(0)) 理想情况下为常量 8

// runtime/malloc.go
// 获得缓存的 order 数。order 0 为 FixedStack，每个后序都是前一个的两倍
// 我们需要缓存 2KB, 4KB, 8KB 和 16KB 的栈，更大的栈则会直接分配.
// 由于 FixedStack 与操作系统相关，必须动态的计算 NumStackOrders 来保证相同的最大缓存大小
//   OS               | FixedStack | NumStackOrders
//   -----------------+------------+---------------
//   linux/darwin/bsd | 2KB        | 4
//   windows/32       | 4KB        | 3
//   windows/64       | 8KB        | 2
//   plan9            | 4KB        | 3
// sys.GoosWindows 当操作系统为 windows 时会被设置为 1
const _NumStackOrders = 4 - sys.PtrSize/4*sys.GoosWindows - 1*sys.GoosPlan9

// 具有可用栈的 span 的全局池
// 每个栈均根据其大小会被分配一个 order
//     order = log_2(size/FixedStack)
// 每个 order 都包含一个可用链表
// TODO: one lock per order?
var stackpool [_NumStackOrders]mSpanList
var stackpoolmu mutex

// 大小较大的栈 span 的全局池
var stackLarge struct {
	lock mutex
	free [heapAddrBits - pageShift]mSpanList // free lists by log_2(s.npages)
}

// 初始化栈空间复用管理链表
func stackinit() {
	// 10 0000 0000 0000 & 01 1111 1111 1111 = 0，理论上应该等于 0
	if _StackCacheSize&_PageMask != 0 {
		throw("cache size must be a multiple of page size")
	}
	for i := range stackpool {
		stackpool[i].init()
	}
	for i := range stackLarge.free {
		stackLarge.free[i].init()
	}
}

// 初始化空双向链表
func (list *mSpanList) init() {
	list.first = nil
	list.last = nil
}
```

## 从分段栈到连续栈

<!-- https://github.com/golang/go/blob/20ac64a2dd1f7993101d7e069eab3b84ab2c0bd2/src/cmd/internal/obj/x86/obj6.go#L1023 -->

## 栈扩张与栈伸缩

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
