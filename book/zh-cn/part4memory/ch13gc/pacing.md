---
weight: 4203
title: "13.3 触发频率及其调步算法"
---

# 13.3 触发频率及其调步算法

并发标记（[13.2](./barrier.md)）让回收与赋值器同时运行，随之而来的问题是：下一轮回收应当在什么时候开始。
开始得太晚，标记尚未完成，堆已超出预期的大小；开始得太早，回收过于频繁，耗费不必要的 CPU。运行时中
负责这一决策的部分称为**调步器**（pacer）。它为每一轮回收确定一个**堆目标**（heap goal），即希望标记
结束时堆所达到的大小；再根据赋值器分配与回收器扫描的相对速度，推算一个比目标更早的触发点，使标记恰好
在堆增长到目标时完成。本节依次讨论回收的触发条件、`GOGC` 与内存限制如何决定堆目标、触发点如何推算、
标记期间如何修正，最后借助 gctrace 观察调步器的实际行为。

## 13.3.1 回收的触发条件

`runtime.gcTrigger` 列出了结束 `_GCoff` 阶段、开始新一轮回收的三种条件
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

- `gcTriggerHeap`：堆的大小达到调步器给出的触发点。绝大多数回收由此开始。
- `gcTriggerTime`：距上一轮回收已超过两分钟（`forcegcperiod`）。系统监控线程定期检查这一条件
  （[9.8](../../part3concurrency/ch09sched/sysmon.md)），`GOGC=off` 时它不起作用。
- `gcTriggerCycle`：程序调用 `runtime.GC()`，显式要求一轮回收。

第一种条件中的「堆的大小」是上一轮标记的存活字节数加上此后新分配的字节数，运行时记为 `heapLive`。
为了减少争用，它只在本地缓存从中心缓存取得新的 span 或分配大对象时更新；前一种情况下，span
中尚未分配的槽也一并计入，因此略高于实际值。源码注释说明了这样做的理由：高估只会让回收提早开始，
而不会使它来得太晚。与此相应，触发条件只在分配的慢速路径上检查：小对象分配在需要更换 span
时检查一次（[12.5](../ch12alloc/smallalloc.md)），大对象分配每次都检查
（[12.4](../ch12alloc/largealloc.md)）。

## 13.3.2 GOGC 与堆目标

环境变量 `GOGC`（或 `runtime/debug.SetGCPercent`）给出一个百分比 $p$，默认为 100。每轮标记终止时，
调步器的 `commit` 方法据此计算下一轮的堆目标 [[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
	gcPercentHeapGoal := ^uint64(0)
	if gcPercent := c.gcPercent.Load(); gcPercent >= 0 {
		gcPercentHeapGoal = c.heapMarked + (c.heapMarked+c.lastStackScan.Load()+c.globalsScan.Load())*uint64(gcPercent)/100
	}
	// Apply the minimum heap size here. It's defined in terms of gcPercent
	// and is only updated by functions that call commit.
	if gcPercentHeapGoal < c.heapMinimum {
		gcPercentHeapGoal = c.heapMinimum
	}
```

写成公式：

$$
H_{goal} = H_m + (H_m + S + G)\cdot\frac{p}{100}
$$

其中 $H_m$ 是上一轮标记的存活堆（`heapMarked`），$S$ 是上一轮实际扫描的栈字节数，$G$ 是可扫描的全局变量
字节数。按默认值，两轮回收之间允许新分配的内存等于存活堆与根之和。Go 1.18 之前的公式只有
$H_m(1+p/100)$。栈与全局变量同样是回收的工作量，忽略它们会在 goroutine 很多或全局变量很大时低估回收的
代价；把它们计入目标，是 1.18 调步器重新设计的第一项内容 [[Knyszek, 2021a](#ref-knyszek-2021a)]。Go
1.18 的发布说明也提醒，部分程序因此会比以前多用或少用一些内存，必要时可以调整 `GOGC`
[[Go Authors, 2022a](#ref-go-authors-2022a)]。

`GOGC` 是在内存与 CPU 之间取舍的参数。GC 指南给出了一个简单的推导
[[Go Authors, 2022c](#ref-go-authors-2022c)]：每轮回收的 CPU 开销大致正比于需要扫描的 $H_m + S + G$；
在分配速率不变的稳态下，回收的频率反比于两轮之间新分配的 $(H_m + S + G)\cdot p/100$。两者相乘，
堆足够大时，回收的总开销约正比于分配速率除以 $p/100$，与存活堆的大小无关。因此，`GOGC` 加倍，堆的
额外内存加倍，回收的 CPU 开销约减半；反之亦然。`GOGC=off` 时 $p$ 为负，公式给出的目标为无穷大，
只有内存限制（13.3.3）或显式调用 `runtime.GC()` 才会引发回收。

堆目标还有一个下限 `heapMinimum`，等于 4 MiB 乘以 $p/100$。存活堆很小时，按比例算出的目标会使回收过于
频繁，每轮的固定开销无法摊薄 [[Go Authors, 2026a](#ref-go-authors-2026a)]。1.18 的重新设计曾把默认下限
降为 512 KiB，理由是运行时自身就有约 200 KiB 可扫描的全局变量，根计入目标之后，小堆上的回收也能合理
摊销 [[Knyszek, 2021c](#ref-knyszek-2021c)]。这一改动随后被移入默认关闭的实验 `HeapMinimum512KiB`，Go
1.26 的默认下限仍是 4 MiB。

下面的程序保留约 64 MiB 的存活数据，每次调用 `runtime.GC()` 之后通过 `runtime/metrics` 读取调步器的
输入与堆目标，并与上面的公式比较：

```go {run=true}
package main

import (
	"fmt"
	"runtime"
	"runtime/debug"
	"runtime/metrics"
)

var keep [][]byte // 约 64 MiB 的存活数据

func report(label string) {
	runtime.GC()
	s := []metrics.Sample{
		{Name: "/gc/heap/live:bytes"},    // 上一轮标记的存活堆
		{Name: "/gc/scan/stack:bytes"},   // 上一轮扫描的栈
		{Name: "/gc/scan/globals:bytes"}, // 可扫描的全局变量
		{Name: "/gc/gogc:percent"},
		{Name: "/gc/heap/goal:bytes"},
	}
	metrics.Read(s)
	live, stack, globals := s[0].Value.Uint64(), s[1].Value.Uint64(), s[2].Value.Uint64()
	gogc, goal := s[3].Value.Uint64(), s[4].Value.Uint64()
	formula := live + (live+stack+globals)*gogc/100
	fmt.Printf("%s：存活 %.1f MiB，目标 %.1f MiB，等于公式：%t\n",
		label, mib(live), mib(goal), goal == formula)
}

func mib(b uint64) float64 { return float64(b) / (1 << 20) }

func main() {
	for i := 0; i < 64; i++ {
		keep = append(keep, make([]byte, 1<<20))
	}
	report("GOGC=100")
	debug.SetGCPercent(50)
	report("GOGC=50")
	debug.SetGCPercent(200)
	report("GOGC=200")
	debug.SetMemoryLimit(100 << 20)
	report("GOGC=200，限制 100 MiB")
}
```

运行结果如下：

```
GOGC=100：存活 64.3 MiB，目标 128.9 MiB，等于公式：true
GOGC=50：存活 64.4 MiB，目标 96.6 MiB，等于公式：true
GOGC=200：存活 64.4 MiB，目标 193.4 MiB，等于公式：true
GOGC=200，限制 100 MiB：存活 64.4 MiB，目标 91.5 MiB，等于公式：false
```

前三行中，堆目标与公式的结果逐字节相等；`SetGCPercent` 会立即重新计算目标，无须等到下一轮回收。
具体的数值随平台略有出入。最后一行设置了 100 MiB 的内存限制，目标不再由 `GOGC` 决定，下一小节讨论
这种情形。

## 13.3.3 软内存限制

`GOGC` 只规定堆的相对增长，不约束内存的绝对用量。存活堆为 1 GiB 时，`GOGC=100` 意味着堆的峰值接近 2 GiB；
在内存配额固定的容器中，存活堆的一次短暂上涨就可能导致内存耗尽（out of memory，OOM）。为了既不调低
`GOGC`、又避免 OOM，社区发展出一些不受支持的做法，例如「堆压舱物」（heap ballast）：
分配一大块从不使用的内存，使回收器以为存活堆比实际更大 [[Knyszek, 2021b](#ref-knyszek-2021b)]。Go 1.19
为此引入环境变量 `GOMEMLIMIT` 与函数 `debug.SetMemoryLimit`，为运行时设定**软内存限制**（soft memory
limit）[[Go Authors, 2022b](#ref-go-authors-2022b)]。限制的对象是运行时映射且尚未归还操作系统的全部内存，
相当于 `runtime.MemStats` 中的 `Sys` 减去 `HeapReleased`；Go 二进制文件本身、C 代码分配的内存以及
`syscall.Mmap` 映射的内存都不在其内 [[Go Authors, 2026b](#ref-go-authors-2026b)]。

堆目标只计堆对象，内存限制却涵盖各类内存，两者之间需要换算。`memoryLimitHeapGoal` 的注释写出了换算式
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
	//    goal := memoryLimit - ((mappedReady - heapFree - heapAlloc) + max(mappedReady - memoryLimit, 0))
	//                    ^1                                    ^2
	//    goal -= goal / 100 * memoryLimitHeapGoalHeadroomPercent
	//    ^3
```

其中 `mappedReady` 是已映射且尚未归还的内存，`heapFree` 是空闲但尚未归还的页，`heapAlloc`
是堆对象占用的字节。第 1 项是无法用来存放堆对象的非堆开销，如栈与运行时的元数据；空闲页不算在内，
因为它们是今后分配的储备，在其中分配不会增加内存的总用量。第 2 项是已经超出限制的部分，从目标中扣除它，
回收就会更早开始，腾出空间。第 3 步再留出余量，用来吸收调步的误差，同时给分配器保留一些未归还的内存。
余量取目标的 3%，且不少于 1 MiB；最终的目标不低于上一轮的存活堆。Go 1.19 至 1.20 只有固定的 1 MiB 余量。3%
的比例余量是 1.21 加入的：`GOGC=off` 且分配速率很高时，堆目标紧贴限制，分配时的同步归还过于频繁
[[Knyszek, 2023b](#ref-knyszek-2023b)]。

调步器取两个目标中较小的一个。上一小节示例的最后一行正是这种情形：`GOGC=200` 给出的目标约为 193 MiB，而
100 MiB 的限制扣除非堆开销与余量之后约为 91 MiB，后者生效。非堆开销因平台而异，在浏览器的 wasm 环境中，
这一数值约为 95 MiB。此外，scavenger 向操作系统归还内存的目标也随内存限制而定，见
[12.7](../ch12alloc/pagealloc.md)。

「软」的含义是运行时不保证限制一定得到遵守。存活堆本身逼近限制时，按限制推算的目标越来越低，
回收越来越频繁，最终几乎持续运行，程序无法继续推进。设计文档称之为死亡螺旋（death
spiral）[[Knyszek, 2021b](#ref-knyszek-2021b)]，GC 指南称之为抖动
（thrashing）[[Go Authors, 2022c](#ref-go-authors-2022c)]。为此，运行时用一个漏桶限制回收所用的 CPU：
回收占用的 CPU 时间注入桶中，赋值器的 CPU 时间使之流出，两者等速，相当于把回收的 CPU 占用限制在约 50%；
桶的容量为每个 P 一个 CPU 秒，用来容纳短时的峰值 [[Go Authors, 2026a](#ref-go-authors-2026a)]。桶满之后，
分配内存的 goroutine 不再参与标记（13.3.5），堆因此可以越过限制。漏桶的思路借鉴自 Netflix 的 jvmquake，
后者在 Java 服务陷入死亡螺旋时终止进程；Go 不终止进程，而是暂停标记辅助
[[Knyszek, 2021b](#ref-knyszek-2021b)]。这一上限始终生效，但按发布说明的预期，它只在特殊情况下才会起作用
[[Go Authors, 2022b](#ref-go-authors-2022b)]。

GC 指南解释了 50% 这一取值：即使内存限制被误设得过低，程序最多也只会慢一倍；在许多场合，无限期的停滞
比内存耗尽更糟，后者至少失败得更快 [[Go Authors, 2022c](#ref-go-authors-2022c)]。指南据此建议，只在运行
环境完全受控时（例如容器有固定的内存配额）使用内存限制，并为运行时无法感知的内存留出 5% 至 10% 的
余量；若程序与其他进程共享这部分内存，不宜同时设置 `GOGC=off`。

## 13.3.4 触发点与提前量

确定了目标，还要决定何时开始。标记需要时间，期间赋值器仍在分配；若等到堆达到目标才开始标记，标记
结束时堆已超出目标。触发点因此要比目标提前一段距离，源码称之为 runway，下文称为提前量。

1.18 的设计文档用一个简单的模型推算提前量 [[Knyszek, 2021a](#ref-knyszek-2021a)]。设赋值器每个 CPU 秒
分配 $a$ 字节，回收器每个 CPU 秒扫描 $s$ 字节，标记期间回收器占用 CPU 的比例为 $u$，其余的 $1-u$
归赋值器。回收器扫描完 $W$ 字节所需的时间内，赋值器分配的字节数为

$$
R = \frac{a}{s}\cdot\frac{1-u}{u}\cdot W
$$

比值 $a/s$ 即分配速率与扫描速率之比，源码中称为 cons/mark 比。Go 把 $u$ 固定为 25%，
于是 $(1-u)/u = 3$。`commit` 中计算提前量的一行与此一一对应 [[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
	c.runway.Store(uint64((c.consMark * (1 - gcGoalUtilization) / (gcGoalUtilization)) * float64(c.lastHeapScan+c.lastStackScan.Load()+c.globalsScan.Load())))
```

预期的扫描工作量 $W$ 取上一轮扫描的堆与栈，加上可扫描的全局变量。扫描工作量只计含指针的内存：
不含指针的对象只需标记，无须逐字扫描（[13.4](./mark.md)）。

cons/mark 比在每轮标记结束时测量：本轮从触发到标记结束所分配的字节数除以赋值器所用的 CPU 时间，
再除以本轮的扫描工作量与回收器所用 CPU 时间之商。单轮的测量含有噪声。Go 1.26 取本轮与前四轮测量值
中的最大值作为下一轮的估计，宁可让回收提早开始、次数略多，也要减少标记辅助。引入这一做法的提交说明
称，一些生产环境中的程序尾延迟因此降低了最多 45% [[Knyszek, 2023a](#ref-knyszek-2023a)]。

触发点等于堆目标减去提前量，再被限制在一个范围之内 [[Go Authors, 2026a](#ref-go-authors-2026a)]：

- 下限位于从 $H_m$ 到目标这段距离的约 70%（45/64）处。触发得过早，标记期间分配的大量对象直接成为黑色
  （[13.1](./basic.md)），存活堆虚高，常驻内存随之上涨；源码注释说明，宁可在回收期间多用 CPU，也不让
  常驻内存这样增长。
- 上限位于同一段距离的约 95%（61/64）处，保证标记开始时总留有余地。堆较大时，上限放宽为目标减去 4 MiB：
  最小堆大小反映的正是一轮无事可做的回收的成本，对扫描工作很少的大堆而言，这段距离恰好够用。
- 上一轮的清扫尚未完成时，触发点至少比计算时的 `heapLive` 高 1 MiB，为并发清扫留出空间
  （[13.5](./sweep.md)）。

如果 cons/mark 比估计准确，标记恰好在堆增长到目标时完成，期间回收器占用 25% 的 CPU，无须任何标记辅助。
下图概括了调步器在一轮回收中的工作：

```mermaid
flowchart LR
    MT["标记终止<br/>测量 cons/mark<br/>计算堆目标与提前量"] -->|"恢复赋值器"| SW["清扫与分配<br/>heapLive 增长"]
    SW -->|"heapLive 达到触发点"| MK["并发标记<br/>按辅助比率<br/>分配者协助标记"]
    MK -->|"灰色对象耗尽"| MT
```

## 13.3.5 标记期间的修正

触发点建立在稳态假设之上：本轮的分配速度与扫描工作量都与以往相近。实际情况偏离时，由标记辅助
（[13.4](./mark.md)）兜底：分配内存的 goroutine 按分配量承担一部分标记工作，或者支取后台标记积累的扫描
信用。辅助的力度由调步器的 `revise` 方法计算的辅助比率决定 [[Go Authors, 2026a](#ref-go-authors-2026a)]：

$$
\text{辅助比率} = \frac{\text{剩余的扫描工作量}}{\text{堆目标与当前堆之差}}
$$

赋值器每分配一个字节，就要完成相应的扫描工作，因此堆增长到目标时，剩余的扫描工作也恰好完成。`heapLive`
或堆目标的任何输入发生变化时，`revise` 都会重新计算这一比率。它还处理两种偏离：

- 已完成的扫描工作超过预期，说明存活堆在增长。`revise` 按最坏情况外推堆目标，
  即假设全部可扫描的内存都存活、全部已分配的栈都需要扫描，使辅助比率保持平稳。外推的目标不超过「硬目标」$(1 + p/100)\cdot H_{goal}$，
  依据是：即使本轮分配的内存全部存活，下一轮回收也会用到这么多内存
  [[Knyszek, 2021a](#ref-knyszek-2021a)]。
- 堆已超过目标（包括外推后的目标）时，目标放宽为原来的 1.1 倍，剩余的扫描工作量按最坏情况估计。

按照设计，触发点估计准确时，后台标记的进度与赋值器的分配同步，后台积累的信用足以抵付分配，赋值器
无须亲自标记 [[Knyszek, 2021a](#ref-knyszek-2021a)]；只有触发得偏晚时，标记辅助才会明显地拖慢分配。

## 13.3.6 观察调步器

把 13.3.2 的示例编译为 `pacedemo`，打开 gctrace，只保留标准错误的输出，截取前七行，并删去 13.1.5 已解释
过的时间字段：

```shell
$ go build -o pacedemo
$ GODEBUG=gctrace=1 ./pacedemo >/dev/null 2>trace.txt
$ sed -E -n '1,7s/ @.* ms cpu,//p' trace.txt
gc 1 4->4->4 MB, 4 MB goal, 0 MB stacks, 0 MB globals, 18 P
gc 2 9->9->9 MB, 9 MB goal, 0 MB stacks, 0 MB globals, 18 P
gc 3 19->19->19 MB, 19 MB goal, 0 MB stacks, 0 MB globals, 18 P
gc 4 38->38->38 MB, 38 MB goal, 0 MB stacks, 0 MB globals, 18 P
gc 5 64->64->64 MB, 76 MB goal, 0 MB stacks, 0 MB globals, 18 P (forced)
gc 6 64->64->64 MB, 96 MB goal, 0 MB stacks, 0 MB globals, 18 P (forced)
gc 7 64->64->64 MB, 193 MB goal, 0 MB stacks, 0 MB globals, 18 P (forced)
```

以箭头相连的三个数依次是回收开始时的 `heapLive`、标记结束时的 `heapLive` 与本轮标记的存活堆；`goal` 是
本轮所追的堆目标；`stacks` 与 `globals` 即公式中的 $S$ 与 $G$；最后是所用处理器（P）的数目。各数的单位是
MiB（输出中写作 MB），向下取整 [[Go Authors, 2026a](#ref-go-authors-2026a)]。

前四轮由分配触发。第 1 轮时还没有标记过的存活堆，目标取下限 4 MiB；此后每轮的目标约为上一轮存活堆的
两倍。程序保留了全部分配，所以每轮开始、结束与存活的三个数相同。这些字节切片不含指针，每轮需要扫描的
内存只有几百 KB，提前量很小，触发点被上限截住，所以每轮开始时堆已接近目标。后三轮由示例中的
`runtime.GC()` 强制触发，行末标有 `(forced)`。第 5 轮的目标 76 MB 是第 4 轮结束时由 38 MB 的存活堆算出的；
第 6、7 轮的目标分别为 96 MB 和 193 MB，与示例输出中修改设置后的目标一致，可见修改设置会立即生效。
各数在多次运行之间略有出入。

需要调步器内部的数值时，可以设置 `GODEBUG=gcpacertrace=1`：每轮开始时输出辅助比率与标记工作者的数量，
结束时输出实际的 CPU 占用及 25% 的期望值、实际与预期的扫描工作量，以及本轮所用的 cons/mark 估计值
[[Go Authors, 2026a](#ref-go-authors-2026a)]。

## 13.3.7 调步器的演进

调步器的形态几经变化：

- Go 1.5：调步器与并发回收一同引入。Clements 的设计把调步表述为同时优化两个目标：标记结束时的堆尽量
  接近 `GOGC` 给出的目标，标记期间回收的 CPU 占用尽量接近 25%。它由四部分组成：扫描工作量的估计、
  按分配量进行的标记辅助、后台标记的调度，以及调整触发比例的比例控制器
  [[Clements, 2015](#ref-clements-2015)]。最终实现给触发比例设了上限，即目标增长率的 0.95 倍，以免辅助
  比率趋于无穷；触发点也至少比存活堆高 1 MB，使比例清扫的速率保持有限且为正。
- Go 1.10：辅助原先按整个堆都存活的保守假设计算，而稳态下 `GOGC=100` 的堆只有一半存活，结果标记在触发点
  与目标的中点就已完成，标记期间回收占用约 50% 的 CPU [[Clements, 2017c](#ref-clements-2017c)]。Clements
  据此把目标分为软目标与高出 10% 的硬目标，越过软目标之前按稳态假设计算辅助
  [[Clements, 2017a](#ref-clements-2017a)]。同一版本把 CPU 目标设为 30%，即 25% 的后台标记加 5% 的辅助：
  没有辅助时，控制器无法把 CPU 占用压到后台标记的 25% 以下，只能得到单向的反馈
  [[Clements, 2017b](#ref-clements-2017b)]。
- Go 1.14：更快的分配器可能把触发比例压到 0.07，标记期间大量对象被分配为黑色，存活堆与常驻内存随之上涨。Knyszek
  为触发比例加上了 0.6 倍的下限 [[Knyszek, 2019](#ref-knyszek-2019)]。
- Go 1.18：调步器重新设计 [[Knyszek, 2021a](#ref-knyszek-2021a)]。栈与全局变量计入堆目标；调步从求解优化
  问题改为估计 cons/mark 比，并用比例积分（PI）控制器平滑测量值；稳态下不再需要辅助，CPU 目标回到 25%；
  硬目标改为 $(1+p/100)$ 倍；触发比例的下限由 0.6 提高到 0.7 [[Knyszek, 2021c](#ref-knyszek-2021c)]。
- Go 1.19：引入软内存限制与回收的 CPU 上限 [[Go Authors, 2022b](#ref-go-authors-2022b)]，旧调步器的代码
  被删除。
- Go 1.20：PI 控制器对历史敏感，行为难以分析，改为两轮移动平均；计算中也改用实际的触发点，而不是预先
  算出的触发点 [[Knyszek, 2022](#ref-knyszek-2022)]。
- Go 1.21：cons/mark 比的估计改为取五轮测量值的最大值 [[Knyszek, 2023a](#ref-knyszek-2023a)]；按内存限制
  计算的目标增加 3% 的比例余量 [[Knyszek, 2023b](#ref-knyszek-2023b)]。

其他运行时也要回答同样的问题。HotSpot 的 G1 回收器 [[Detlefs et al., 2004](#ref-detlefs-2004)]在老年代
占用达到「初始堆占用阈值」（initiating heap occupancy，IHOP）时开始并发标记；默认情况下，它观察标记的
耗时与标记期间老年代的分配量，自动调整这一阈值 [[Oracle, 2026](#ref-oracle-2026)]。这与 Go 按 cons/mark 比
推算触发点的思路相同。差别在于目标：Java 的回收器通常运行在由 `-Xmx` 限定大小的堆上
[[Knyszek, 2021b](#ref-knyszek-2021b)]，G1 再以停顿时间目标决定每次停顿回收多少区域；Go 的堆没有固定的
上限，堆目标随存活堆按 `GOGC` 伸缩，内存限制只是一道软约束。

## 13.3.8 小结

调步器把「何时回收」拆成两个问题。堆目标回答回收结束时堆应有多大：`GOGC` 按存活堆与根的规模给出相对
增长，软内存限制按内存的绝对用量给出上限，两者取其小。触发点回答何时开始：调步器测量分配与标记的速率
之比，推算标记期间赋值器还会分配多少，再从目标中扣除这段提前量。估计偏差由标记期间的辅助比率修正，
回收的 CPU 上限则防止内存限制把程序拖入死亡螺旋。从 Go 1.5 的比例控制器到 1.18 的重新设计，再到此后对
平滑方式的几次调整，调步器始终围绕同一个目标：在稳态下让回收恰好占用 25% 的 CPU，并在堆增长到目标时
完成标记。

## 延伸阅读

- <a id="ref-clements-2015"></a>[Clements, 2015] Austin Clements. *Go 1.5 concurrent garbage collector
  pacing.* 2015. https://golang.org/s/go15gcpacing
  初版调步器的设计文档，定义目标增长率与 assist 模型；2015 年 8 月补充了 Go 1.5 最终实现与原方案的差别。
- <a id="ref-clements-2017a"></a>[Clements, 2017a] Austin Clements. runtime: separate soft and hard heap
  limits. Go commit 03eb9483e3, 2017. https://go.dev/cl/59970
  随 Go 1.10 发布。
- <a id="ref-clements-2017b"></a>[Clements, 2017b] Austin Clements. runtime: allow 5% mutator assist over
  25% background mark. Go commit af192a3e22, 2017. https://go.dev/cl/59971
  随 Go 1.10 发布。
- <a id="ref-clements-2017c"></a>[Clements, 2017c] Austin Clements. *Proposal: Separate soft and hard heap
  size goal.* Go design document, golang/go#14951, 2017.
  https://github.com/golang/proposal/blob/master/design/14951-soft-heap-limit.md
  分析了旧调步器为何稳定在错误的稳态。
- <a id="ref-detlefs-2004"></a>[Detlefs et al., 2004] David Detlefs, Christine Flood, Steve Heller, Tony
  Printezis. *Garbage-First Garbage Collection.* ISMM 2004. https://doi.org/10.1145/1029873.1029879
  （JVM G1 的暂停时间目标式调步，与 Go 的堆增长目标式调步对照）
- <a id="ref-go-authors-2022a"></a>[Go Authors, 2022a] The Go Authors. *Go 1.18 Release Notes.* 2022.
  https://go.dev/doc/go1.18
- <a id="ref-go-authors-2022b"></a>[Go Authors, 2022b] The Go Authors. *Go 1.19 Release Notes.* 2022.
  https://go.dev/doc/go1.19
- <a id="ref-go-authors-2022c"></a>[Go Authors, 2022c] The Go Authors. *A Guide to the Go Garbage
  Collector.* 2022. https://go.dev/doc/gc-guide
  （GOGC、GOMEMLIMIT 与调步直觉的官方指南）
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. src/runtime/mgcpacer.go、src/runtime/mgclimit.go、src/runtime/mgc.go、src/internal/goexperiment/flags.go.
  Go 1.26 源码.
  https://github.com/golang/go/tree/release-branch.go1.26/src/runtime
  （`gcControllerState`、`commit`、`revise`、`trigger`、`heapGoalInternal` 的实现；`gcCPULimiter` 与
  gctrace 的输出亦见于此）
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Package runtime/debug:
  SetGCPercent, SetMemoryLimit.* Go 1.26 文档. https://pkg.go.dev/runtime/debug
- <a id="ref-knyszek-2019"></a>[Knyszek, 2019] Michael Knyszek. runtime: place lower limit on trigger
  ratio. Go commit 74af7fc603, 2019. https://go.dev/cl/200439
  随 Go 1.14 发布。
- <a id="ref-knyszek-2021a"></a>[Knyszek, 2021a] Michael Knyszek. *GC Pacer Redesign.* Go proposal 44167,
  2021. https://github.com/golang/proposal/blob/master/design/44167-gc-pacer-redesign.md
  （1.18 调步器重设计，含把根计入节奏的推导）
- <a id="ref-knyszek-2021b"></a>[Knyszek, 2021b] Michael Knyszek. *Soft memory limit.* Go proposal 48409,
  2021. https://github.com/golang/proposal/blob/master/design/48409-soft-memory-limit.md
  （`GOMEMLIMIT` 的设计与软上限语义）。其早期渊源见 Brad Fitzpatrick. *runtime: mechanism for monitoring
  heap size.* Go issue #16843, 2016. https://github.com/golang/go/issues/16843 与 Austin Clements.
  *runtime/debug: add SetMaxHeap API.* CL 46751, 2017. https://go-review.googlesource.com/c/go/+/46751
  （前者是追踪应用监控、限制内存用量需求的问题；后者是在 Google 内部试用多年的 `SetMaxHeap` 补丁，
  软内存限制的设计以它的经验为基础）
- <a id="ref-knyszek-2021c"></a>[Knyszek, 2021c] Michael Knyszek. runtime: implement GC pacer redesign. Go
  commit a108b280bc, 2021. https://go.dev/cl/309869
  随 Go 1.18 发布。
- <a id="ref-knyszek-2022"></a>[Knyszek, 2022] Michael Knyszek. runtime: smooth cons/mark with a moving
  average and use actual trigger. Go commit 41795528b0, 2022. https://go.dev/cl/417558
  随 Go 1.20 发布。
- <a id="ref-knyszek-2023a"></a>[Knyszek, 2023a] Michael Knyszek. runtime: bias the pacer's cons/mark
  smoothing against noise. Go commit b513bd808f, 2023. https://go.dev/cl/467875
  随 Go 1.21 发布。
- <a id="ref-knyszek-2023b"></a>[Knyszek, 2023b] Michael Knyszek. runtime: make the memory limit heap goal
  headroom proportional. Go commit e97bd776f9, 2023. https://go.dev/cl/460375
  随 Go 1.21 发布。
- <a id="ref-oracle-2026"></a>[Oracle, 2026] Oracle. "Garbage-First (G1) Garbage Collector." *HotSpot
  Virtual Machine Garbage Collection Tuning Guide*, Java SE 21, F80283-06, 2026.
  https://docs.oracle.com/en/java/javase/21/gctuning/garbage-first-g1-garbage-collector1.html
  G1 的停顿时间目标与自适应 IHOP。
- 本书 [13.2 写屏障技术](./barrier.md)、[13.4 扫描标记与标记辅助](./mark.md)、[13.5
  清扫与位图](./sweep.md)。
