---
weight: 4211
title: "13.11 过去、现在与未来"
---

# 13.11 过去、现在与未来

读完前面十节，读者手里已经握有 Go 垃圾回收器各个零件的现状：三色标记（[13.1](./basic.md)）、
混合写屏障（[13.2](./barrier.md)）、调步器（[13.3](./pacing.md)）、清扫与回收（[13.5](./sweep.md)）。
这一节换一个角度，把这些零件放回时间轴上，看它们是怎样一步步长成今天这副模样的。

回收器的演进史，读起来像一条始终朝同一个方向收敛的曲线。从 Go 1.0 到今天，停顿时间下降了约两个
数量级，而这一路上有一条不变的主线：每一步改动，都服务于「在不打扰用户代码的前提下完成回收」。
理解了这条主线，下面被采纳与被抛弃的诸多方案，就都能放到同一把尺子上衡量。

## 13.11.1 被采纳的方案：从数百毫秒到亚毫秒

### Go 1.0–1.4：朴素的停顿世界标记清扫

最早的回收器是教科书式的标记清扫（mark-sweep），且整个过程停顿世界（stop-the-world，STW）：
一旦回收开始，所有用户 Goroutine 停下，回收器在单个或少数线程上走完「标记存活、清扫死亡」，
再放用户代码继续。Go 1.3 把清扫阶段改为与标记并行（parallel，多个回收线程同时干活），
缩短了总时长，但用户代码仍然是被整段挂起的。

这套设计的代价直白地写在停顿时间上：堆越大，需要扫描的对象越多，STW 越长。实测停顿落在数十到
数百毫秒的量级。对一个正在处理请求的 Web 服务，这意味着尾延迟（tail latency）随时可能被一次回收
拖出一道百毫秒级的尖峰。这一痛点，定下了此后十年的主题。

### Go 1.5（2015）：并发标记，低延迟的转向

Go 1.5 是分水岭。Richard Hudson 主导的这次重写，把标记阶段做成与用户代码**并发**（concurrent）
执行：回收器一边标记，用户 Goroutine 一边运行、一边分配、一边改写指针。为了在指针被并发改写时
仍不漏标存活对象，引入了 Dijkstra 风格的写屏障（[13.2](./barrier.md)）。这次重写公开喊出的目标，
是把 STW 压到 10 毫秒以下，并在博客与 ISMM 2018 的报告里反复强调一句立场：宁可牺牲一点吞吐与
峰值内存，也要换来可预测的低延迟。这是一次明确的价值排序，而非单纯的性能优化。

### Go 1.6、1.7：把毫秒继续往下压

并发标记落地后，剩下的 STW 集中在回收循环的起止两端。1.6 把回收器状态化、改进了标记终止
（mark termination）阶段的实现，1.7 让栈收缩（stack shrinking）独立于 STW 进行，停顿从 1.5 的
个位数毫秒进一步降到一两毫秒以内。这两个版本没有惊人的算法变动，做的是把 1.5 打下的并发框架
逐处打磨干净。

### Go 1.8（2017）：混合写屏障，跨过亚毫秒

1.5 之后停顿的最后一座大山，是**栈重扫**（stack re-scan）。Dijkstra 写屏障只拦截堆上的指针写入，
不拦截栈上的写入，于是回收器无法保证一个已扫黑的栈不会在之后又指向白色对象。它只能在标记终止时
把所有栈重新扫一遍，而这一步必须在 STW 下完成。实测重扫吃掉 10 至 100 毫秒，恰好成了亚毫秒目标
跨不过去的门槛。

Go 1.8 引入 **混合写屏障**（hybrid write barrier，[13.2](./barrier.md)），把 Dijkstra 屏障与
Yuasa 删除屏障合二为一，使栈一旦扫描为黑便不必再扫。这一改动直接消除了 STW 栈重扫，把典型停顿
带进**亚毫秒**（sub-millisecond）区间。从此「GC 停顿」在大多数应用的延迟预算里，不再是需要单独
列项的开销。

### Go 1.18 与 1.19：调步器重做与软内存上限

亚毫秒之后，重心从「停顿多长」转向「回收触发得是否聪明」。Go 1.18 重做了调步器
（pacer，[13.3](./pacing.md)），用更清晰的比例积分模型替换了原先打补丁式累积的逻辑，让回收节奏
在堆增长不规则时也更稳。Go 1.19 引入 `GOMEMLIMIT`，给运行时一个**软内存上限**（soft memory limit）：
在它之下，回收器可以放慢节奏多攒一点垃圾以省 CPU；逼近它时，回收器自动加紧，避免无谓的 OOM。
这件事与页分配器、清道夫（scavenger，[12.7](../ch12alloc/pagealloc.md)）的归还策略协同，把「延迟、
吞吐、内存」三者的权衡，从写死的常数变成了用户可声明的目标。

### 一条下降约百倍的停顿曲线

把上面的版本连起来看，停顿时间走出了一条清晰的下降曲线，而它对用户代码始终是**透明**的：除了
设环境变量，应用源码一行不必改，停顿就一代代变短。

```mermaid
timeline
    title Go GC 典型 STW 停顿的演进（数量级，非精确基准）
    Go 1.0-1.4 (2012-2014) : 停顿世界标记清扫 : 数十至数百毫秒
    Go 1.5 (2015) : 并发标记，Dijkstra 写屏障 : 目标 10 毫秒以下
    Go 1.6-1.7 (2016) : 标记终止与栈收缩打磨 : 一两毫秒
    Go 1.8 (2017) : 混合写屏障，消除栈重扫 : 亚毫秒
    Go 1.18-1.19 (2022) : 调步器重做，GOMEMLIMIT : 亚毫秒，节奏更可控
    Go 1.25-1.26 : Green Tea GC（实验） : 标记吞吐随核数与堆扩展
```

这条曲线背后的设计立场，可以浓缩成一句话：性能的提升从不白来。Go 用写屏障带来的少量吞吐开销，
换来了停顿的可预测；用 `GOMEMLIMIT` 暴露的旋钮，把三者的取舍交回给最清楚业务需求的人。

## 13.11.2 被抛弃的方案：两条没有走通的路

并非每一次尝试都进了正式版本。两个曾被认真探索、最终放弃的方案，恰恰从反面印证了上面那条主线。

第一个是**并发栈重扫**。1.8 之前，团队也考虑过不引入新屏障，而是把 STW 下的栈重扫改为并发执行。
这条路在工程上比混合写屏障复杂得多，且即便做成，重扫本身依旧存在。混合写屏障一举把重扫这个阶段
连根去掉，顺带简化了回收的状态机，于是并发重扫方案被弃。

第二个是**请求制导回收**（ROC，request-oriented collector，[13.9](./roc.md)）与**传统分代回收**
（[13.8](./generational.md)）。ROC 假设「请求私有的对象在请求结束时即可整批回收」，分代回收假设
「多数对象年纪轻轻就死」。两个假设都符合直觉，但落到 Go 上都败在同一处：为了维持假设的正确性，
写屏障必须长期开启，带来昂贵的缓存未命中。而 Go 的栈式分配让许多「年轻对象」根本没进堆、在栈上
就已死亡，分代假设能榨出的收益又被削去一截。代价高于收益，两者都未进入正式版本。

这两次放弃留下的教训很具体：在 Go 里，任何想靠「利用对象的某种结构性规律」来加速回收的方案，都得
先过「写屏障开销」这一关。这恰好为下一节的主角埋下伏笔。

## 13.11.3 现在与未来：Green Tea GC

Go 1.25 起，运行时带来一个新的标记算法，代号 **Green Tea**，以实验特性形式提供，用
`GOEXPERIMENT=greenteagc` 构建即可开启，实现集中在 `runtime/mgcmark_greenteagc.go`。它瞄准的，
是前面所有版本都没正面解决的另一个维度：标记阶段的**缓存局部性**（cache locality）。

### 问题：追指针追得满内存乱跑

传统的三色标记是一种以对象为单位的图遍历：从灰色对象取出，扫描它内部的每个指针，把指向的白色
对象染灰入队，如此往复。问题在于，对象在堆上的物理位置与它们的引用关系毫不相干，于是标记器的内存
访问几乎是随机的：扫完这个对象，下一个要访问的对象可能在几兆字节之外的另一个 span 上，对应的
元数据又在别处。在多核、大堆的场景下，这种「追着指针满内存乱跑」的访问模式把 CPU 缓存与预取
（prefetch）的效用压到很低，标记吞吐难以随核数线性扩展。

### 设计：把扫描攒到 span 上批量做

Green Tea 的核心思路一句话可以说清：**推迟扫描，按 span 把对象攒起来一起扫**。它不再发现一个对象
就立刻去扫，而是发现指向某个 span 的指针时，先在该 span 上记一笔，把这个 span 整体排进队列；等真正
轮到这个 span，再把它上面攒下的、待扫的对象一次性扫完。同一个 span 上的对象在内存里本就相邻，
批量扫描于是把随机访问变回了顺序访问，让缓存与预取重新发挥作用，元数据的访问成本也被一批对象摊薄。

要做到批量而又不失精确，Green Tea 在 span 上维护**两套位图**：一套是常规的标记位 `marks`，指针第一次
被发现时置位；另一套 `scans` 记录哪些对象已经扫过。轮到一个 span 时，取两套位图的并集写回 `scans`，
取其差集（已标记但未扫描的）决定这一轮要扫哪些对象。这样既攒了批，又保证不重扫、不漏扫，精确性
不打折扣。这两套位图直接内联在 span 自身（`spanInlineMarkBits`），扫描时无需回查 `mspan`，省下一次
间接寻址。

span 的入队与取出，借用的是调度器早已验证过的招式：**每 P 一条可窃取的 span 队列**
（`spanQueue`，P-local stealable）。空闲的标记 worker 会从别的 P 的队列里窃取
（[9.2](../../part3concurrency/ch09sched/steal.md) 的工作窃取在这里又出现一次）。与普通工作缓冲
（workbuf）用 LIFO 不同，span 队列刻意用 **FIFO**：经验表明先进先出更利于在一个 span 上攒够对象
再扫。下面这段速写勾勒出它的骨架：

```go
// span 内联标记位：marks 与 scans 两套位图（速写，见 mgcmark_greenteagc.go）
type spanInlineMarkBits struct {
    scans [63]uint8         // 已扫描位：决定本轮 span 上哪些对象不必再扫
    owned spanScanOwnership // 谁取得了本 span 的扫描权（用于并发认领）
    marks [63]uint8         // 标记位：指针首次被发现时置位
    class spanClass
}

// 发现一个指针时，不立刻扫，而是推迟到所在 span 批量处理（速写）
func tryDeferToSpanScan(p uintptr, gcw *gcWork) bool {
    // 在 p 所属 span 上置标记位；首次令该 span 待扫，则认领并入队
    if /* 成功设置 mark 且取得 span 扫描权 */ true {
        gcw.spanq.put(/* span + objIndex */) // 进每 P 的 FIFO span 队列，可被他 P 窃取
    }
    return true
}
```

### 谱系：ROC 与分代的精神，却躲开了它们的代价

把 Green Tea 放回上一节的脉络里看，它与被放弃的 ROC、分代回收同出一脉：都想**利用对象的结构性
规律**来加速回收。区别在于利用的是哪一种规律，以及代价落在何处。ROC 利用请求边界、分代利用对象
年龄，两者都得靠长期开启的写屏障来维持假设，代价是缓存未命中；Green Tea 利用的是**空间局部性**
（同一 span 上的对象物理相邻），它只改变标记器**遍历的顺序**，不需要任何新的屏障，于是绕开了那道
让前两者折戟的关卡。同一种「利用结构」的直觉，这一次找对了不必付屏障代价的切入点。

Green Tea 与分配器是一对**共生**的演进。批量扫描之所以划算，前提正是分配器按 span、按尺寸类把同类
对象聚到一起（[12.2](../ch12alloc/component.md)）；它的设计也与分配器的持续演进相互呼应
（[12.9](../ch12alloc/history.md)）。源码注释里还点出了更远的方向：一旦扫描按尺寸类组织，就有机会
用 SIMD 指令成批撕过堆内存，把标记吞吐再推一个台阶。这些尚在路上。

无论 Green Tea 最终以何种形态转正，它服务的仍是那条从 Go 1.5 贯穿至今的主线：让回收尽可能地不打扰
用户代码。早年这条主线表现为「把停顿压短」，如今它表现为「让标记吞吐随核数与堆规模扩展，同时不把
延迟还回去」。尺子没变，只是又量到了一个新的维度。

## 延伸阅读的文献

1. Richard L. Hudson. *Getting to Go: The Journey of Go's Garbage Collector.* ISMM 2018 keynote / The Go Blog, 2018.
   https://go.dev/blog/ismmkeynote （1.5 并发回收转向与低延迟立场的一手叙述）
2. The Go Authors. *A Guide to the Go Garbage Collector.*
   https://tip.golang.org/doc/gc-guide （调步器、`GOMEMLIMIT` 与延迟/吞吐/内存权衡的官方指南）
3. Austin Clements. *Proposal: Concurrent Garbage Collector Pacing (Go 1.5).* design doc.
   https://golang.org/s/go15gcpacing
4. Austin Clements, Rick Hudson. *Eliminate STW stack re-scanning (hybrid write barrier, Go 1.8), issue #17503.*
   https://github.com/golang/go/issues/17503
5. The Go Authors. *Soft memory limit (`GOMEMLIMIT`), Go 1.19 release notes.*
   https://go.dev/doc/go1.19#runtime
6. The Go Authors. *runtime: green tea garbage collector, issue #73581.*
   https://github.com/golang/go/issues/73581 （Green Tea 的设计动机与基准）
7. The Go Authors. *runtime/mgcmark_greenteagc.go.*
   https://github.com/golang/go/blob/master/src/runtime/mgcmark_greenteagc.go （`GOEXPERIMENT=greenteagc` 的实现）

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
