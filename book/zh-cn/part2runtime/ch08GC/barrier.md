---
weight: 2302
title: "8.2 混合写屏障技术"
---

# 8.2 混合写屏障技术

[TOC]

在诸多屏障技术中，Go 使用了 Dijkstra 与 Yuasa 屏障的结合，
即**混合写屏障（Hybrid write barrier）技术** [Clements and Hudson, 2016]。
Go 在 1.8 的时候为了简化 GC 的流程，同时减少标记终止阶段的重扫成本，
将 Dijkstra 插入屏障和 Yuasa 删除屏障进行混合，形成混合写屏障，沿用至今。

## 基本思想

该屏障提出时的基本思想是：对正在被覆盖的对象进行着色，且如果当前栈未扫描完成，
则同样对指针进行着色。

但在最终实现时原提案 [Clements and Hudson, 2016] 中对 ptr 的着色还额外包含
对执行栈的着色检查，但由于时间有限，并未完整实现过，所以混合写屏障在目前的实现是：

```go
// 混合写屏障
func HybridWritePointerSimple(slot *unsafe.Pointer, ptr unsafe.Pointer) {
	shade(*slot)
	shade(ptr)
	*slot = ptr
}
```

在 Go 1.8 之前，为了减少写屏障的成本，Go 选择没有启用栈上写操作的写屏障，
赋值器总是可以通过将一个单一的指针移动到某个已经被扫描后的栈，
从而导致某个白色对象被标记为灰色进而隐藏到黑色对象之下，进而需要对栈的重新扫描，
甚至导致栈总是灰色的，因此需要 STW。

混合写屏障为了消除栈的重扫过程，因为一旦栈被扫描变为黑色，则它会继续保持黑色，
并要求将对象分配为黑色。

混合写屏障等同于 IBM 实时 JAVA 实现中使用的 Metronome 中使用的双重写屏障。
这种情况下，垃圾回收器是增量而非并发的，但最终必须处理严格限制的世界时间的相同问题。

## 混合写屏障的正确性

直觉上来说，混合写屏障是可靠的。那么当我们需要在数学上逻辑的证明某个屏障是正确的，应该如何进行呢？

TODO：补充正确性证明的基本思想和此屏障的正确性证明

## 实现细节

TODO:

## 批量写屏障缓存

在这个 Go 1.8 的实现中，如果无条件对引用双方进行着色，自然结合了 Dijkstra 和 Yuasa 写屏障的优势，
但缺点也非常明显，因为着色成本是双倍的，而且编译器需要插入的代码也成倍增加，
随之带来的结果就是编译后的二进制文件大小也进一步增加。为了针对写屏障的性能进行优化，
Go 1.10 和 Go 1.11 中，Go 实现了批量写屏障机制。
其基本想法是将需要着色的指针统一写入一个缓存，
每当缓存满时统一对缓存中的所有 ptr 指针进行着色。

TODO:

## 小结

并发回收的屏障技术归根结底就是在利用内存写屏障来保证强三色不变性和弱三色不变性。
早期的 Go 团队实践中选择了从提出较早的 Dijkstra 插入屏障出发，
不可避免的在为了保证强三色不变性的情况下，需要对栈进行重扫。
而在后期的实践中，Go 团队提出了将 Dijkstra 和 Yuasa 屏障结合的混合屏障，
将强三色不变性进行了弱化，从而消除了对栈的重新扫描这一硬性要求，使得在未来实现全面并发 GC 成为可能。

## 进一步阅读的参考文献

- [Clements and Hudson, 2016] [Eliminate STW stack re-scanning](https://github.com/golang/proposal/blob/master/design/17503-eliminate-rescan.md)
- [Dijkstra et al. 1978] Edsger W. Dijkstra, Leslie Lamport, A. J. Martin, C. S. Scholten, and E. F. M. Steffens. 1978. On-the-fly garbage collection: an exercise in cooperation. *Commun. ACM* 21, 11 (November 1978), 966-975.

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
