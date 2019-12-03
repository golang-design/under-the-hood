---
weight: 2302
title: "8.2 混合写屏障技术"
---

# 8.2 混合写屏障技术

[TOC]

如今的 Go 垃圾回收器是一个三色并发收集器，即每个对象会被标记为白色、灰色或者黑色。在 GC 周期的开始前，
所有对象都是白色，垃圾回收器的目标是将所有可达对象标记为黑。
内存屏障技术则在 Go 语言中用于保障并发垃圾回收的正确性。

**混合写屏障（Hybrid write barrier）技术** [Clements and Hudson, 2016] 则是 Go 1.8 中引入的特性，沿用至今。
它结合了 Yuasa 风格的删除写屏障和 Dijkstra 风格的插入写屏障。

## 基本思想

混合写屏障会：

- 对正在被覆盖的对象进行着色，且
- 如果当前栈尚未被扫描，则同样对安插的引用进行着色

实现的基本思路为：

```go
// 混合写屏障
func writePointer(slot, ptr unsafe.Pointer) {
    shade(*slot)                // 对正在被覆盖的对象进行着色，通过将唯一指针从堆移动到栈来防止赋值器隐藏对象。
    if current stack is grey {  // 如果当前 goroutine 栈还未被扫描为黑色
        shade(ptr)              // 则对引用进行着色，通过将唯一指针从栈移动到堆中的黑色对象来防止赋值器隐藏对象
    }
    *slot = ptr
}
```

对于弱三色不变性而言，只要存在一个能够通向白色对象的路径，黑色对象就能允许直接引用白色对象。而对于写屏障而言，总是会防止赋值器去隐藏某个对象。比如，对于 Dijkstra 屏障而言，赋值器总是可以通过将一个单一的指针移动到某个已经被扫描后的栈，从而导致某个白色对象被标记为灰色进而隐藏到黑色对象之下，进而需要对栈的重新扫描，甚至导致栈总是灰色的。

这个屏障消除栈的重扫过程，因为一旦栈被扫描变为黑色，则它会继续保持黑色。此外，它要求将对象分配为黑色（分配白色是一种常见策略，但与此屏障不兼容）。

混合写屏障等同于 IBM 实时 JAVA 实现中使用的 Metronome 中使用的双重写屏障。这种情况下，垃圾回收器是增量而非并发的，但最终必须处理严格限制的世界时间的相同问题。

## 可靠性、完备性和有界性的证明

直觉上来说，混合写屏障是可靠的。那么当我们需要在数学上逻辑的证明某个屏障是正确的，应该如何进行呢？

TODO：补充正确性证明的基本思想和此屏障的正确性证明

## 实现细节

TODO:

## 总结

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
