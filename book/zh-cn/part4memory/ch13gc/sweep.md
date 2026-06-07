---
weight: 4205
title: "13.5 清扫与位图"
---

# 13.5 清扫与位图

标记（[13.4](./mark.md)）结束后，仍为白色的对象就是垃圾。把它们占的内存收回、供再分配，是
**清扫**（sweep）。Go 的清扫有两个特点值得讲：它是**并发**且**惰性**的，以及它靠**位图翻转**而非
逐对象处理来高效完成。

## 13.5.1 清扫即位图翻转

得益于尺寸类分配（[12.1](../ch12alloc/basic.md)），清扫不必逐个对象地"释放"。每个 span 有两份
位图：标记位图（`gcmarkBits`，本轮标记中被置位的=存活）与分配位图（`allocBits`，哪些槽在用）。
清扫一个 span，本质就是把**标记位图变成新的分配位图**:被标记的槽继续算"在用"，没被标记的槽
就此变成"空闲"，可供再分配。整段 span 若一个存活对象都没有，则把它整个还给 mcentral / mheap
（[12.2](../ch12alloc/component.md)）。这种"翻转位图"的做法，把清扫从"逐对象释放"降成了"按
span 改几个位",又一次，尺寸类的规整让回收退化成位操作。这正是本节标题"免清扫式位图"的含义,
死对象无需被显式"清理"，它们的槽只是在位图翻转后被标记为可复用，下次分配直接覆写。

## 13.5.2 并发且惰性

清扫与用户程序**并发**进行（在 `_GCoff` 阶段由后台 sweeper 推进，[13.3](./pacing.md)），不占
STW。更巧的是它**惰性**：并不在标记一结束就把所有 span 都扫一遍，而是**按需**,当某个 P 要
分配、需要一个该尺寸类的 span 时，顺手清扫一个待扫的 span 再用（"分配即清扫一点"）。这样
清扫的开销被自然地分摊到分配路径上，且只清扫真正要用到的部分。后台 sweeper 则兜底地推进剩余
未扫的 span，保证在下一轮 GC 开始前扫完。惰性清扫体现了 Go 运行时一贯的"把集中开销摊薄"
思路,与标记辅助（[13.4](./mark.md)）、写屏障（[13.2](./barrier.md)）异曲同工。

## 13.5.3 为何不整理碎片

标记清扫不移动对象（[13.1](./basic.md)），所以会留下**碎片**:span 内死对象的槽变空，但若整个
span 没全空就还不能整体归还，空槽只能等同尺寸类的新对象来填。Go 接受这种碎片，不做**整理**
（compaction，把存活对象搬到一起腾出连续空间），原因有二：整理要**移动对象**，就得更新所有
指向它们的指针,这既复杂又与 cgo（外部 C 持有 Go 指针）冲突;而尺寸类分配本就把碎片限制在
"同尺寸类内的空槽"，相对可控。这是一处明确的取舍：**放弃整理换取指针稳定与实现简单**，用
尺寸类把碎片代价压到可接受。值得一提，go1.25/1.26 的 Green Tea GC（[13.11](./history.md)）
正是在"以 span/页为粒度组织扫描与回收、改善局部性"方向上的新探索,清扫与回收的设计仍在演进。

## 延伸阅读的文献

1. The Go Authors. *runtime/mgcsweep.go（清扫、惰性 sweep、位图翻转）.*
   https://github.com/golang/go/blob/master/src/runtime/mgcsweep.go
2. Rick Hudson. *Getting to Go: The Journey of Go's GC.* https://go.dev/blog/ismmkeynote
3. Richard Jones et al. *The Garbage Collection Handbook*（清扫与碎片整理的取舍）. 2023.
4. 本书 [12.2 组件](../ch12alloc/component.md)、[13.4 标记](./mark.md)、
   [13.11 过去现在未来](./history.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
