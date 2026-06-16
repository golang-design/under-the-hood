---
weight: 4207
title: "13.7 安全点分析"
---

# 13.7 安全点分析

标记阶段（[13.4](./mark.md)）要扫描一个 goroutine 的栈，找出栈上所有指向堆的指针，把它们当作
GC 根加入灰色队列。这件事看似直白，实则藏着一个不易察觉的前提：**栈上的一个机器字，到底是不是
指针？** 一个 64 位的字，可能是一个堆地址，也可能是一个恰好落在堆地址区间里的整数、一段被半拆
出来的浮点数、或一个尚未写入的垃圾值。若把非指针误当指针，会平白吊住一块本该回收的内存；若把
指针漏判成整数，则会回收掉仍在使用的对象,后者是致命的内存破坏。

要分辨这两者，运行时需要一份「这一刻，栈上哪些位置存着指针」的精确说明。这份说明并非时时存在：
寄存器与栈槽的指针 / 非指针归属，随着指令逐条执行不断变化。编译器只在某些**程序点**上为它生成
快照，这些点就是**安全点**（safe-point）。GC 要精确扫描栈，就必须先把目标 goroutine 停在一个安全
点上。安全点这个概念在调度的抢占一节（[9.7](../../part3concurrency/ch09sched/preemption.md)）已从
「何时可以打断一个 goroutine」的角度系统讲过；本节从 GC 的角度补足它的另一半含义：**安全点是栈
上指针信息精确可读的那些瞬间**。这两半其实是同一件事，本节最后会让它们合流。

## 13.7.1 栈图：编译期记下每个安全点的指针布局

编译器为每个函数生成若干**栈图**（stack map，又称指针位图 pointer map）。一份栈图是一个位向量
（`bitvector`），第 $i$ 位为 1 表示「栈帧中第 $i$ 个字长的槽此刻存着一个指针」。同一个函数在不同
程序点上的栈布局不同，于是编译器为每个安全点各记一份栈图，并用一张 `PCDATA` 表把「程序计数器
PC」映射到「该 PC 对应哪一份栈图」。运行时扫描某一帧时，拿该帧将要返回到的 PC 去查表，便得到
这一帧此刻的指针布局。

运行时读取栈图的入口是 `getStackMap`。它对一帧返回三样东西：局部变量的指针位图、参数的指针位图、
以及该帧内的**栈对象**（stack object）记录:

```go
// getStackMap：用帧的返回 PC 查出本帧的指针布局（速写）
func (frame *stkframe) getStackMap(debug bool) (locals, args bitvector, objs []stackObjectRecord) {
    targetpc := frame.continpc // 本帧将返回到的 PC
    f := frame.fn

    // 回退到 CALL 指令处再查表：安全点记录的是「调用点」上的布局
    targetpc--
    pcdata := pcdatavalue(f, abi.PCDATA_StackMapIndex, targetpc)

    // 局部变量位图：funcdata 里取出本函数的栈图表，按 pcdata 索引取第几份
    stkmap := (*stackmap)(funcdata(f, abi.FUNCDATA_LocalsPointerMaps))
    locals = stackmapdata(stkmap, pcdata)

    // 参数位图：另一张表 FUNCDATA_ArgsPointerMaps，同样按 pcdata 索引
    // ...
    return
}
```

两个细节值得点出。其一，`targetpc--`,查表用的不是返回地址本身，而是退一格落到 `CALL` 指令上。
原因是被打断的帧总是停在「调用了某个下层函数、正等它返回」的位置，编译器恰是在调用点处记录了
栈布局，所以要对齐到调用点而非调用后的下一条指令。其二，指针信息分两类来源：`FUNCDATA_LocalsPointerMaps`
管局部变量，`FUNCDATA_ArgsPointerMaps` 管参数区，两者用同一个 `pcdata` 索引各取一份位图。

拿到位图后，扫描一帧就只是「按位图把标了 1 的那些槽当指针交给 `scanblock`」:

```go
// scanframeworker 的精确路径（速写）：按栈图扫一帧
func scanframeworker(frame *stkframe, state *stackScanState, gcw *gcWork) {
    locals, args, objs := frame.getStackMap(false)

    if locals.n > 0 {          // 局部变量区，按 locals 位图精确扫
        size := uintptr(locals.n) * goarch.PtrSize
        scanblock(frame.varp-size, size, locals.bytedata, gcw, state)
    }
    if args.n > 0 {            // 参数区，按 args 位图精确扫
        scanblock(frame.argp, uintptr(args.n)*goarch.PtrSize, args.bytedata, gcw, state)
    }
    // 栈对象（取了地址、可能被指针引用的大局部量）单独登记，后续按可达性扫
    // ...
}
```

`scanblock` 拿到的 `locals.bytedata` 就是那份位图：它逐字遍历这段内存，只对位图标了 1 的字解引用、
把指向的堆对象置灰。位图没标的字，无论它的值看起来多像地址，一律不碰。**这就是精确**:指针之所以
被识别为指针，是因为编译器在编译期声明了它是指针，而非运行时凭值猜测。

## 13.7.2 必须停在安全点才能扫栈

栈图只在安全点有效。函数的指令序列中间存在大量「中间态」:寄存器分配把一个指针暂存进某个槽、
又在下一条指令把它挪走；或一次大结构体赋值正写到一半。这些瞬间没有对应的栈图，强行去读会读到
一份过期或缺失的位图。所以 GC 不能在任意时刻扫一个正在跑的 goroutine 的栈，它必须先把这个
goroutine 停到一个安全点上。

`scanstack` 把这条约束写成了断言:进来第一件事就是检查目标 goroutine 的状态，若它仍是 `_Grunning`
（正在某个 P 上执行），直接 `throw`:

```go
// scanstack：扫描一个已停下的 goroutine 的栈（速写）
func scanstack(gp *g, gcw *gcWork) int64 {
    switch readgstatus(gp) &^ _Gscan {
    case _Grunning:
        // 正在运行的 goroutine 不能扫，它的栈图此刻未必有效
        throw("scanstack: goroutine not stopped")
    case _Grunnable, _Gsyscall, _Gwaiting, _Gleaked:
        // 这些状态下 goroutine 已停在安全点，可以扫
    }

    // 逐帧展开，对每一帧按栈图精确扫描
    var u unwinder
    for u.init(gp, 0); u.valid(); u.next() {
        scanframeworker(&u.frame, &state, gcw)
    }
    // 此外还要扫 defer 链、panic 记录、栈对象等栈上可达的指针
    // ...
}
```

「停到安全点」这件事本身由抢占机制完成。GC 需要扫某个 goroutine 的栈时，调用 `suspendG` 把它
请离 CPU 并停到安全点；扫完再 `resumeG` 放它回去。`suspendG` 内部走的，正是
[9.7](../../part3concurrency/ch09sched/preemption.md) 描述的那套协作式 / 异步抢占流程。换言之，
栈扫描不是 GC 自己另起炉灶的能力，它**复用了调度器停 goroutine 的全部机制**。

## 13.7.3 GC 与抢占的合流

把前两节连起来，就看清了 GC 与调度在安全点上的合流:**两者都需要「把一个 goroutine 停在安全点」，
用的是同一套机制，只是目的不同。**

- 调度器停一个 goroutine，是为了**抢占**:让出 CPU 给别人，保证公平与低延迟（[9.7](../../part3concurrency/ch09sched/preemption.md)）。
- GC 停一个 goroutine，是为了**扫它的栈**:在标记开始时把这个 goroutine 的栈一次性置黑（混合写
  屏障下开始即扫、之后不再重扫，[13.2](./barrier.md)），并把栈上的根指针交给标记队列。

这条合流线在 Go 1.14 异步抢占的诞生史里看得最清楚。在那之前，Go 只有**协作式**安全点:编译器在
每个函数调用处（以及循环回边等位置）插入抢占检查，goroutine 跑到这些点才会查看「是否被请求停下」。
对绝大多数代码这没问题，因为函数调用足够频繁。但有一类病态代码会击穿它,一个不含任何函数调用的
紧致计算循环:

```go
func spin() {
    for i := 0; i < 1e18; i++ {
        // 没有函数调用、没有循环回边检查的纯计算
    }
}
```

这样的循环里没有协作式安全点，抢占信号无处落地。在协作式时代，这会同时拖垮两件事:调度器无法
抢占它（其他 goroutine 饿死），GC 也无法把它停到安全点扫栈（标记阶段卡住，无法推进到结束）。
这正是 [9.7](../../part3concurrency/ch09sched/preemption.md) 反复讨论的 TTSP（time-to-safepoint）
问题在 GC 侧的投影。

Go 1.14 的**异步抢占**给出了出路：运行时向目标线程发一个信号（类 Unix 上是 `SIGURG`），信号
处理器在任意指令边界把 goroutine 停下。这样上面那个 `spin` 循环也能被停了。但代价随之而来:被
信号停下的位置**几乎一定不是**编译器记过栈图的安全点。这一帧没有有效的栈图，怎么扫？

## 13.7.4 保守扫描：没有栈图时的退路

异步抢占停下的那一帧，运行时退而用**保守扫描**(conservative scanning)。保守扫描放弃「精确知道
哪些是指针」，改为把这段内存里**每一个看起来像堆指针的字都当作指针**:只要某个字的值落在某个
已分配 span 的地址范围内，就把对应对象保留下来。`scanframeworker` 的另一条分支正是干这个:

```go
func scanframeworker(frame *stkframe, state *stackScanState, gcw *gcWork) {
    isAsyncPreempt := frame.fn.valid() && frame.fn.funcID == abi.FuncID_asyncPreempt
    isDebugCall := frame.fn.valid() && frame.fn.funcID == abi.FuncID_debugCallV2

    if state.conservative || isAsyncPreempt || isDebugCall {
        // 没有可信栈图，保守扫整帧:连出参区也一并扫，
        // 因为可能恰停在「正在布置一次调用」的中途
        if size := frame.varp - frame.sp; size > 0 {
            scanConservative(frame.sp, size, nil, gcw, state)
        }
        if n := frame.argBytes(); n != 0 {
            scanConservative(frame.argp, n, nil, gcw, state)
        }
        if isAsyncPreempt || isDebugCall {
            // 异步抢占的那一帧里保存着被中断的父帧的寄存器，
            // 故父帧也必须保守扫
            state.conservative = true
        }
        return
    }

    // 否则走 13.7.1 的精确路径
    locals, args, objs := frame.getStackMap(false)
    // ...
}
```

这里有两处工程上的讲究。其一，保守扫描连**出参区**也扫，因为信号可能恰好停在「调用者正把参数
写进出参槽、还没真正跳进被调函数」的中途，此时出参槽里的指针不在任何一份精确位图里，只能靠
保守扫兜住。其二，异步抢占用一个特制的 `asyncPreempt` 桩帧承载被中断处的寄存器现场，所以不仅
这一帧要保守扫，**紧邻的父帧**（被真正中断的用户帧）也要保守扫，于是把 `state.conservative` 置位
传递下去。被异步抢占停住的 goroutine 还会被标记 `gp.asyncSafePoint = true`，扫栈时据此连同被保存
的扩展寄存器状态一并保守处理。

保守扫描是一条**安全但不精确**的退路。它安全：绝不会漏判指针，因为「像指针的都当指针」，故不会
误回收活对象。它不精确：可能把恰好像地址的整数误判为指针，从而吊住一两块本该回收的内存。代价
被刻意压到了最小,只有被异步抢占的那一两帧用保守扫，goroutine 栈的其余部分（在更下层、有正常
栈图的帧）仍走精确路径；而被保守保留的对象也因此**不可移动**（移动需要确切知道哪些字是指针才能
改写）。这套「绝大多数精确、个别帧保守兜底」的混合策略，是 Go 在「能停下任意紧致循环」与「尽量
保持精确」之间取的平衡（参见 issue [#24543](https://github.com/golang/go/issues/24543) 对保守扫描
内层帧的设计讨论）。

## 13.7.5 精确 GC 的取舍与谱系

至此可以回答一个根本问题:Go 为什么要让编译器和运行时一起维护这套栈图与安全点基础设施？因为
它要做**精确 GC**(precise GC)。把精确与保守两条路线放在一起对照，取舍就清楚了。

**保守式 GC**(如经典的 Boehm-Demers-Weiser 收集器)完全不需要编译器配合:它把栈、寄存器、堆里
每一个像指针的字都当指针。优点是几乎可以挂到任何语言上（包括 C），不要求编译期类型信息。缺点
是两条:一是**假指针**会造成内存泄漏,一个值恰好等于某个对象地址的整数，会把那个对象连同它指向
的整张子图都吊住，在指针密集、地址空间紧张时可能很严重；二是**无法移动对象**,既然分不清指针与
整数，就不敢改写任何字，于是放弃了整理（compaction）、分代复制这类需要移动对象的高级回收策略。

**精确 GC**(Go 的选择)要求编译器为每个安全点生成栈图、为每个类型生成堆指针位图，运行时据此
准确区分指针与非指针。代价是编译器与运行时的复杂度，以及栈图带来的二进制体积。换来的是:没有
假指针导致的泄漏，回收更彻底；并且因为确切知道每个指针的位置，**为将来的移动式回收留了门**。
Go 至今的 GC 不移动堆对象，但它移动**栈**,`copystack` 扩缩栈时要把栈上所有指针逐一改写到新栈，
靠的正是同一套栈图（[14 栈管理](../ch14stack/readme.md)）。可以说精确 GC 的基础设施，已经在「移动栈」这件事上
天天兑现着它的价值。

把这条线放进谱系:精确 GC 是「编译器与运行时深度协同」（[3.2](../../part1overview/ch03life/compile.md)）
的又一处体现,GC 不是一个能旁挂到任意语言上的独立库，它和编译器共享一套关于「指针在哪里」的
约定。这份协同是成本，也是底气:正因为运行时确切掌握每个指针的位置，Go 才有余地持续重构它的
回收器（从三色标记到混合写屏障，再向 Green Tea 等新方向演进，见 [13.1](./basic.md) 与
[13 概述](./readme.md)），而不必担心动了对象布局就破坏正确性。精确，是这一切优化得以安全进行的
前提。

## 延伸阅读的文献

1. 本书 [9.7 协作与抢占](../../part3concurrency/ch09sched/preemption.md):安全点、TTSP、协作式与
   异步抢占的完整机制,本节的栈扫描复用了它。
2. The Go Authors. *runtime: scanstack / scanframeworker / getStackMap.*
   https://github.com/golang/go/blob/master/src/runtime/mgcmark.go 与
   https://github.com/golang/go/blob/master/src/runtime/stkframe.go （栈图读取与精确 / 保守扫描）.
3. The Go Authors. *runtime: suspendG / isAsyncSafePoint.*
   https://github.com/golang/go/blob/master/src/runtime/preempt.go （把 goroutine 停到安全点）.
4. Richard Jones, Antony Hosking, Eliot Moss. *The Garbage Collection Handbook*, 2nd ed., 2023.
   （精确 vs 保守 GC、指针识别与可移动性）.
5. Hans-J. Boehm, Mark Weiser. *Garbage Collection in an Uncooperative Environment.*
   Software: Practice and Experience, 1988. （保守式 GC 的经典代表）.
6. The Go Authors. *runtime: conservative inner-frame scanning for async preemption.*
   https://github.com/golang/go/issues/24543 （异步抢占处保守扫描内层帧的设计）.
7. 本书 [13.2 写屏障](./barrier.md)、[13.4 标记](./mark.md)、[12.2 组件](../ch12alloc/component.md)
   （栈图与 mspan / arena 指针位图共同支撑精确扫描）.
