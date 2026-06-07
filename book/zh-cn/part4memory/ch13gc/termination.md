---
weight: 4206
title: "13.6 标记终止阶段"
---

# 13.6 标记终止阶段

并发标记（[13.4](./mark.md)）什么时候算"做完了"？这个看似简单的问题，在并发环境下其实很微妙,
因为标记进行时用户程序还在不断产生新的灰色对象。**标记终止**（mark termination）就是安全地
判定并确认"标记已彻底完成"的阶段。它包含 Go GC 两次极短 STW 中的第二次。

## 13.6.1 判定标记完成的难题

标记完成的条件是"没有灰色对象了"（[13.1](./basic.md)）。但并发下，某个 worker 刚清空它的本地
灰色队列，别的 worker 或写屏障（[13.2](./barrier.md)）可能又产生了新的灰色对象,如何确认
**全局**真的没有灰色对象、且不会再有？Go 用一次短暂的 STW 来给出一个确定的判定点：暂停所有
用户 goroutine，此时不再有新的指针写入（也就不再有写屏障产生新灰色），运行时检查所有标记队列
确已清空。若发现还有残余（极少数情况），就在 STW 内把它扫完。这次 STW 因为混合写屏障
（[13.2](./barrier.md)）消除了"重扫所有栈"的需要，所以极短,只做收尾确认，而非繁重的扫描。

## 13.6.2 终止阶段做的事

进入 `_GCmarktermination` 的这次 STW 里，运行时完成几件收尾工作：确认标记完全结束;**关闭写
屏障**（标记已完成，不再需要维持三色不变式）;把 GC 阶段切回 `_GCoff`;准备进入并发清扫
（[13.5](./sweep.md)）;更新统计与下一轮的调步参数（[13.3](./pacing.md)）。然后恢复所有用户
goroutine。整个过程力求最短,这是 Go GC 两段 STW 中的关键一段，它的时长直接计入用户可感知的
停顿。

## 13.6.3 STW 为何还不能完全消除

既然 Go 如此追求低延迟，为何还保留这两小段 STW（开启屏障/扫根、标记终止）而不彻底消除？
因为有些操作需要一个"全局一致的瞬间":开启写屏障要让所有 goroutine 同时进入"屏障已开"的
状态，标记终止要有一个"此刻确无并发写入"的确定点。要在完全不停顿的前提下达成这种全局一致，
代价与复杂度极高（[9.7](../../part3concurrency/ch09sched/preemption.md) 提到的 ZGC 并发栈处理
等正是这个方向的探索）。Go 的工程取舍是：把 STW 的**工作量**压到最小（靠混合写屏障消除重扫栈），
让停顿时长与堆/栈规模**几乎无关**、稳定在亚毫秒,而非追求理论上的零停顿。这是"足够好"对
"完美"的务实胜利,把两段不可避免的 STW 做到短得无关紧要，比为消灭它们付出巨大复杂度更划算。
从开启屏障、并发标记、标记终止、到并发清扫，一轮 GC 的全貌至此完整（[13.3](./pacing.md) 的
周期图）。

## 延伸阅读的文献

1. Austin Clements, Rick Hudson. *Proposal: Eliminate STW stack re-scanning.* golang/go#17503.
   https://go.dev/issue/17503
2. Rick Hudson. *Getting to Go: The Journey of Go's GC.* https://go.dev/blog/ismmkeynote
3. The Go Authors. *runtime/mgc.go（gcMarkTermination）.*
   https://github.com/golang/go/blob/master/src/runtime/mgc.go
4. 本书 [13.2 写屏障](./barrier.md)、[13.3 调步算法](./pacing.md)、[13.5 清扫](./sweep.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
