---
weight: 4201
title: "13.1 垃圾回收的基本想法"
---

# 13.1 垃圾回收的基本想法

垃圾回收（GC）把程序员从手动 `free` 中解放出来，代价是运行时要自己判断「哪些内存还有用、
哪些可以收回」。Go 的 GC 以低延迟为首要目标，它宁可牺牲一点吞吐与内存，也要把卡顿
（stop-the-world 停顿）压到亚毫秒级。这一节建立 GC 的理论坐标：可达性、标记清扫、三色抽象，
以及 Go 在 GC 设计空间里的定位。后续各节是这套基本想法的展开。

在展开之前，先借用一组贯穿全章的术语。Dijkstra 等人 [Dijkstra et al., 1978] 把一个带 GC 的
程序拆成两个半独立的角色：赋值器（mutator）与回收器（collector）。赋值器即用户态代码，
它只做一件与 GC 相关的事，修改对象之间的引用关系，也就是在一张「对象图」上增删有向边；
回收器则是运行时里负责找出并收回垃圾的那部分代码。本章的全部难处，都源自这两者要同时运行。

## 13.1.1 可达性即存活

GC 判断存活的依据是可达性：从一组根（root）出发，凡能沿指针到达的对象都算存活，
到达不了的就是垃圾。Go 的根集合有三类，全局变量、各 goroutine 栈上的变量、以及寄存器中
可能存放的指针。回收器从这些根出发遍历对象图，标记一路可达的对象。

可达性是一个保守而安全的近似。它并不真正知道某个对象将来还会不会被读到，只知道「从根够不到的，
程序一定再也用不上」。于是「这块内存是否还有用」这个语义问题，被转化成了一个图遍历问题：
从根开始走对象图，走得到的留下，走不到的回收。

这里还藏着一个 Go 与许多 C/C++ 上的回收器的分野。Go 的 GC 是精确（precise，亦称 type-accurate）
的：运行时借助编译期生成的类型信息与 span 元数据（[12.2](../ch12alloc/component.md)），
能准确分辨一个字（word）究竟是指针还是普通整数。保守式回收器做不到这一点，它只能把任何
「看起来像指针」的位模式都当作指针看待，因而可能误判、且无法移动对象。精确是 Go 后续许多
设计（写屏障、栈扫描）得以成立的前提。

## 13.1.2 标记—清扫

最经典的实现是标记—清扫（mark-sweep），由 McCarthy 在 1960 年实现 Lisp 时首次提出
[McCarthy, 1960]。它把回收分成两个阶段。标记阶段从根出发遍历对象图，给每个可达对象打上标记：

```go
func mark() {
    worklist.Init()                       // 待扫描的灰色对象队列
    for root := range roots {             // 从根集合开始
        ref := *root
        if ref != nil && !isMarked(ref) {
            setMarked(ref)                // 标记并入队
            worklist.Add(ref)
            for !worklist.Empty() {
                ref := worklist.Remove()  // 取一个已标记对象
                for fld := range Pointers(ref) {
                    child := *fld
                    if child != nil && !isMarked(child) {
                        setMarked(child)  // 标记其每一个可达子对象
                        worklist.Add(child)
                    }
                }
            }
        }
    }
}
```

清扫阶段扫过整个堆，把未被标记的对象当作垃圾收回，并清掉存活对象的标记位，为下一轮做准备：

```go
func sweep() {
    for scan := heap.Start(); scan < heap.End(); scan = scan.Next {
        if isMarked(scan) {
            unsetMarked(scan) // 存活：清标记，留待下轮
        } else {
            free(scan)        // 不可达：回收
        }
    }
}
```

Go 用的正是标记清扫，而非复制式（copying，把存活对象搬到新空间）或引用计数
（reference counting，每个对象记录被引用数）。这是一组取舍。标记清扫不移动对象，
指针因此稳定，对 cgo 尤为友好（C 侧持有的 Go 指针不会在脚下被挪走），但它会产生碎片；
复制式天然无碎片，却要搬移对象、且一般要保留一半空间作半空间（semispace）；引用计数回收及时、
停顿分散，但解决不了循环引用，且每次指针写入都要更新计数，开销分摊在赋值器的热路径上。

Go 选标记清扫，又把它最大的短板，碎片，交给分配器来兜。运行时的分配基于尺寸类
（size class，[12.1](../ch12alloc/basic.md)）：对象按大小归入固定的若干档，同档对象在同一
mspan 内等大排布。这样「不移动」带来的外部碎片被压成了「同档内尺寸不整」的内部碎片，
其上界可控（最坏约 12.5%）。mgc.go 开头的注释把这条取舍说得很直白：分配按 per-P 的尺寸分隔
区域进行，既压制碎片，又在常见情形下免去加锁。换言之，Go 不靠移动对象消碎片，而靠分配器的
布局从源头上抑制它，这正是 Go 敢用非移动式回收器的底气。

## 13.1.3 三色抽象

要让标记能与赋值器并发进行（这是低延迟的关键），需要一个能描述「标记进行到一半」这种中间状态的
抽象。这就是 Dijkstra 等人在 1978 年提出的三色标记 [Dijkstra et al., 1978]。它从回收器的视角
把堆中对象分成三色：

- 白色（可能死亡）：尚未被回收器访问到的对象。回收开始时所有对象皆为白色，回收结束后仍为
  白色者即不可达，是回收的候选。
- 灰色（波面）：已被回收器访问到，但其内部的一个或多个指针尚未扫描，因而可能还指向白色对象。
- 黑色（确定存活）：已被回收器访问到，且其全部字段都已扫描完毕，黑色对象不会再直接指向任何
  白色对象。

```mermaid
flowchart LR
    W["白色<br/>尚未访问，回收候选"] -->|"被灰色对象引用，置灰"| G["灰色<br/>已访问，引用尚未扫完"]
    G -->|"自身引用全部扫描完毕，转黑"| B["黑色<br/>已访问且引用已全扫，判定存活"]
    B -.->|"标记结束，仍为白色者即垃圾"| DONE["交清扫回收"]
```

标记从把所有根置灰开始，随后不断重复一个动作：取出一个灰色对象，扫描它的引用，把引用到的
白色对象置灰，再把自己转黑，直到再没有灰色对象。这套规则定义出的，是一个波面（wavefront）
不断推进的过程。灰色对象构成黑、白之间的边界，即波面本身；随着标记进行，波面把对象图分成
身后已确认存活的黑色区与身前尚未触及的白色区，并持续向前推进，直到所有可达对象都被吞入黑色区。
波面消失（无灰色对象）之时，标记即告完成，此刻仍为白色者就是垃圾。

三色其实只是给标记进度起的名字，对象身上并没有真的染色。某一对象属于何色，完全由它的标记位与
是否还在 worklist 中决定：

```go
func isWhite(ref interface{}) bool {
    return !isMarked(ref) // 未标记
}
func isGrey(ref interface{}) bool {
    return worklist.Find(ref) // 已标记，待扫描
}
func isBlack(ref interface{}) bool {
    return isMarked(ref) && !isGrey(ref) // 已标记，已扫完
}
```

三色抽象的价值，正在于它把「标记的进度」显式化。有了它，我们才能在赋值器同时改动对象图的前提下，
精确地说出一个并发回收器必须维持哪些条件才不出错，这就是下一节的不变式。

## 13.1.4 并发的代价：三色不变式

串行的标记清扫在执行时会把赋值器整个挂起，对用户代码而言回收是一步原子操作，正确性不言自明。
代价是停顿时间随堆增长而线性拉长。要把停顿压到亚毫秒，就得让标记与赋值器并发，而这立刻带来
一个棘手的正确性问题。

设想标记进行到一半。赋值器此时改了一个指针：它把一个白色对象从某个灰色对象上摘下，转挂到一个
已经变黑的对象之下。黑色对象按定义不会再被回收器扫描，于是这个白色对象虽仍可达，却再也没有
机会被置灰、转黑。标记结束时它仍是白色，会被当作垃圾误回收，程序随即读到一块已被收回的内存。
这就是并发标记的根本风险，赋值器能在回收器眼皮底下「把一个白色对象藏到黑色对象之下」。

并发标记的骨架与串行版相去不远，差别只在它每次只推进一小步，把工作切碎了与赋值器交错执行：

```go
func markSome() bool {
    if worklist.Empty() {     // 一轮的开始
        scan(roots)           // 扫根，重建灰色集合
        if worklist.Empty() { // 灰色已全部处理完
            sweep()           // 标记结束，转入清扫
            return false
        }
    }
    ref := worklist.Remove()  // 推进一步：取一个灰色对象
    scan(ref)                 // 扫描它，把白色子对象置灰，自己转黑
    return true
}

func scan(ref interface{}) {
    for fld := range Pointers(ref) {
        if child := *fld; child != nil {
            shade(child) // 把引用到的对象置灰
        }
    }
}

func shade(ref interface{}) {
    if !isMarked(ref) {
        setMarked(ref)
        worklist.Add(ref)
    }
}
```

要堵住误回收，必须维持三色不变式。它有强弱两个版本。强不变式要求：黑色对象不得指向白色对象，
任何时刻都不允许这样的边存在。弱不变式放宽一档：黑色对象可以指向白色对象，但该白色对象必须
同时被某个灰色对象保护着（即仍可经一条全灰路径从根到达），从而不会被遗漏。维持哪种不变式，
对应着不同的写屏障设计（[13.2](./barrier.md)）。

不变式不会自己成立，得靠在赋值器改指针的那一刻插一小段代码来守护，这就是写屏障
（write barrier）。它在指针写入时按需做一点着色工作，把上面那条危险的边重新纳入回收器的视野。
mgc.go 中三色不变式的开关，正与 GC 的相位绑定：写屏障只在 `_GCmark` 与 `_GCmarktermination`
两个相位开启，其余时间关闭，以免给赋值器的热路径平白增加负担。

至此，Go 并发 GC 的三件核心拼图已经齐备：三色标记给出进度的语言，三色不变式给出正确性的条件，
写屏障给出维持条件的手段。本章接下来便是逐一拆解它们：写屏障（[13.2](./barrier.md)）、
步调（[13.3](./pacing.md)）、标记（[13.4](./mark.md)）、清扫（[13.5](./sweep.md)）、
终止（[13.6](./termination.md)）。

## 13.1.5 设计取舍、谱系与定位

把 Go 的选择放进 GC 的谱系里看，几处取舍才显出分量。

标记清扫的思想源头是 McCarthy 1960 年的串行实现，Dijkstra 等人 1978 年的「在飞行中」
（on-the-fly）算法第一次把它与赋值器并发起来，奠定了三色抽象与不变式；Hudson 与 Moss 2003 年
进一步给出了这类并发回收器完备、正确、可终止的严格证明 [Hudson & Moss, 2003]。Go 的回收器
直接站在这条线上，mgc.go 的注释也明确把自己的「思想血统」追溯到 Dijkstra 的 on-the-fly 算法。

横向看别家，主流 JVM（HotSpot 的 G1、ZGC 等）大多选择移动式、分代的回收器：它们靠搬移对象
来消碎片、靠分代假设把精力集中在年轻对象上。Go 反其道而行，既不移动也不分代。不移动，
是为了指针稳定与 cgo 友好，碎片交给尺寸类分配兜底（[13.1.2](#1312-标记清扫)）；不分代，
则是因为分代假设在 Go 里红利有限：编译器的逃逸分析（[15.5](../../part5toolchain/ch15compile/escape.md)）已把
大量短命对象直接分配在栈上，goroutine 退出时随栈一并回收，根本不经过堆 GC，能落到堆上的
多是需要长期存活的对象，年轻代里本就所剩无几。

最根本的分野在目标函数。多数传统回收器把降低总停顿、提高吞吐放在首位，Go 团队则把低延迟
排在吞吐与内存占用之前：与其追问「一次 GC 总共停多久」，不如追问「如何让 GC 与赋值器更好地
并发，用恰当的一部分 CPU 把停顿摊薄到几乎不可感知」。正因如此，Go 的并发停顿时间与对象的
代际、大小都基本无关，这与分代、移动式回收器的权衡是两套不同的世界观。性能的取舍从不白来，
Go 用一点吞吐与内存，换来了亚毫秒级的可预测停顿。

## 延伸阅读的文献

1. John McCarthy. "Recursive Functions of Symbolic Expressions and Their Computation by
   Machine, Part I." *Communications of the ACM*, 3(4), 1960, 184-195.
   https://doi.org/10.1145/367177.367199 （标记清扫的源头）.
2. Edsger W. Dijkstra, Leslie Lamport, A. J. Martin, C. S. Scholten, E. F. M. Steffens.
   "On-the-Fly Garbage Collection: An Exercise in Cooperation." *Communications of the ACM*,
   21(11), 1978, 966-975. https://doi.org/10.1145/359642.359655 （三色标记与并发 GC 的奠基）.
3. Richard E. Hudson, J. Eliot B. Moss. "Sapphire: Copying Garbage Collection without Stopping
   the World." *Concurrency and Computation: Practice and Experience*, 15(3-5), 2003, 223-261.
   https://doi.org/10.1002/cpe.712 （并发回收器完备、正确、可终止的证明）.
4. Richard Jones, Antony Hosking, Eliot Moss. *The Garbage Collection Handbook: The Art of
   Automatic Memory Management.* 2nd ed., CRC Press, 2023.
5. Austin Clements, Rick Hudson. "Go 1.5 concurrent garbage collector pacing."
   2015. https://go.dev/blog/go15gc （Go 选择低延迟并发回收的设计取向）.
6. The Go Authors. *runtime/mgc.go（GC 总览注释，含相位与思想血统）.*
   https://github.com/golang/go/blob/master/src/runtime/mgc.go
7. 本书 [12.1 内存分配设计原则](../ch12alloc/basic.md)、
   [12.2 分配器组件](../ch12alloc/component.md)、[13.2 写屏障技术](./barrier.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
