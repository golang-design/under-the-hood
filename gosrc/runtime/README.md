# Go 运行时编程

本文可能会过时。 它旨在阐明不同于常规 Go 编程的 Go 运行时编程，并侧重于一般概念而非特定接口的详细信息。

调度器结构
=============

调度器管理了三种不同类型的资源分布在运行时中：G, M, P。
即便你进行不涉及调度器的相关工作，理解它们仍然很重要。

Gs, Ms, Ps
----------

"G" 是 goroutine 的缩写。由 `g` 类型表示。当 goroutine 退出时，`g` 被归还到有效的 `g` 池，
能够被后续 goroutine 使用。

"M" 代表一个能够执行用户 Go 代码、运行时代码、系统调用或处于空闲状态的 OS thread。
由类型 `m` 表示。因为任意多个线程可以同时阻塞在系统调用上，因此同一时刻可以包含任意多个 M。

"P" 则表示执行 Go 代码所需的资源，例如调度器和内存分配器状态。由 `p` 类型表示,且最多只有 
`GOMAXPROCS` 个。
P 可以理解一个 OS 调度器中的 CPU，`p` 类型的内容类似于每个 CPU 的状态。是一个可以为了效率
而存放不同状态的地方，同时还不需要每个线程或者每个 goroutine 对应一个 P。

调度器的任务是匹配一个 G（要执行的代码）一个 M（在哪儿执行）和一个 P（执行代码的资源和权利）。 
当 M 停止执行用户 Go 代码时，例如进入系统调用，它会将其对应的 P 返回给空闲 P 池。
而为了恢复执行用户的 Go 代码，例如从一个系统调用返回时，必须从空闲池中获取一个有效的 P。

所有的 `g`, `m` 和 `p` 对象均在堆上分配，且从不释放。因此他们的内存保持 type stable。
因此，运行时可以在调度器内避免 write barrier。

用户栈与系统栈
------------

每个非 dead 状态的 G 均被关联到**用户栈**上，即用户 Go 代码执行的地方。用户栈初始大小很小（例如 2K），
然后动态的增加或减少。

每个 M 均对应一个关联的系统栈（也成为 M 的 `g0` 栈，因为其作为一个 stub G 来实现）。在 Unix 平台上，
则称为**信号栈**（也称之为 M 的 `gsignal` 栈）。系统和信号栈无法扩展，但已经大到足够运行运行时和
cgo 代码（一个纯 Go 二进制文件有 8K；而 cgo 二进制文件则有系统分配）。

运行时代码经常会临时通过 `systemstack`, `mcall` 或 `asmcgocall` 切换到系统栈以执行那些无法扩展用户栈、
或切换用户 goroutine 的不可抢占式任务。运行在系统栈上的代码是隐式不可抢占的、且不会被垃圾回收检测。
当运行在系统栈上时，当前用户栈没有被用于执行代码。

`getg()` 与 `getg().m.curg`
----------------------------

为获取当前用户 `g`，可以使用 `getg().m.curg`。

`getg()` 单独返回当前 `g`。但当执行在系统或信号栈时，会返回当前 M 的 `g0` 或 `gsignal`。
这通常可能不是你想要的。

为判断你是运行在用户栈还是系统栈，可以使用：`getg() == getg().m.curg`

错误处理与报告
===========

通常使用 `panic` 的来自用户代码的错误能够被合理的恢复。然而某些情况下 `panic` 会导致一个立即致命错误，
例如在系统栈上的调用或在 `mallocgc` 执行阶段的调用。

大部分运行时错误无法恢复。对于这些错误，请使用 `throw`，它能够将被终止整个过程的中间状态全部回溯出来。
一般情况下，`throw` 需要传递一个 string 常量在危险情况下避免内存分配。按照惯例，在 `throw` 
前会使用 `print` 或 `println` 输出额外信息，并冠以 "runtime:" 的前缀。

若需调试运行时错误，可以设置 `GOTRACEBACK=system` 或 `GOTRACEBACK=crash`。

同步
===

运行时有多种同步机制。它们根据与 goroutine 调度器或者 OS 调度器的交互不同而有着不同的语义。

最简单的是 `mutex`，使用 `lock` 和 `unlock` 进行操作。用于在短时间内共享结构体。
在 `mutex` 上阻塞会直接阻塞 M，且不会与 Go 调度器进行交互。这也就意味着它能在运行时最底层是安全的，
且同时阻止了任何与之关联的 G 和 P 被重新调度。`rwmutex` 也类似。

为进行一次性通知，可以使用 `note`。它提供了 `notesleep` 和 `notewakeup`。
与传统的 UNIX `sleep`/`wakeup` 不同，`note` 是无竞争的。
因此`notesleep` 会在 `notewakeup` 发生时立即返回。一个 `note` 能够在使用 `noteclear` 后被重置，
并且必须不能与 sleep 或 wakeup 产生竞争。类似于 `mutex`，阻塞在 `note` 上会阻塞 M。
然而有很多不同的方式可以在 `note` 上进行休眠：`notesleep` 会阻止关联的 G 和 P 被重新调度，
而 `notetsleepg`  的行为类似于阻止系统调用、运行 P 被复用从而运行另一个 G。
这种方式仍然比直接 阻塞一个 G 效率低，因为它还消耗了一个 M。

为直接与 goroutine 调度器进行交互，可以使用 `gopark`、`goready`。
`gopark` 停摆了一个当前的 goroutine，并将其放入 waiting 状态，并将其从调度器运行队列中移除，
再进一步将其他 goroutine 在当前 M/P 上进行调度。而 `goready` 会将一个停摆的 goroutine 标回 tunable 状态，并加入运行队列中。

总结：

<table>
<tr><th></th><th colspan="3">阻塞</th></tr>
<tr><th>接口</th><th>G</th><th>M</th><th>P</th></tr>
<tr><td>(rw)mutex</td><td>是</td><td>是</td><td>是</td></tr>
<tr><td>note</td><td>是</td><td>是</td><td>是/否</td></tr>
<tr><td>park</td><td>是</td><td>否</td><td>否</td></tr>
</table>


原子操作
=======

运行时拥有自己的原子操作包，位于 `runtime/internal/atomic`。其对应于 `sync/atomic`，但处于历史原因函数具有不同的名字以及一些额外的运行时所需的函数。

一般来说，我们都仔细考虑了在运行始终使用这些原子操作，并尽可能避免了不必要的原子操作。如果某个时候访问一个某些时候会被其他同步机制保护的变量，那么访问已经受保护的内容通常不需要成为原子操作，原因如下：

1. 在适当的时候使用非原子或原子操作访问会使代码更明确。对于变量的原子访问意味着其他地方可能同时访问该变量。
2. 非原子访问能够自动进行竞争检查。运行时目前并没有竞争检查器，但未来可能会有。运行竞争检查器来检查你非原子访问的假设时，原子访问会破坏竞争检查器。
3. 非原子访问能够提升性能。

当然，对一个共享变量进行任何非原子访问需要解释为什么该访问是受到保护的。

混合原子访问和费原子访问的常见模式为：

* 读通过写锁进行的变量，在锁区域内，读不需要原子操作，而写是需要的。在锁定区外，读是需要原子操作的。

* 读取仅发生在 STW 期间（Stop-The-World）。在 STW 期间不会发生写入 STW，即不需要原子操作。

换句话说，Go 内存模型的建议是：『不要太聪明』。运行时的性能很重要，但它的健壮性更重要。

非托管内存
================

通常，运行时尝试使用常规堆分配。然而，在某些情况下，运行时必须非托管内存中分配垃圾回收堆之外的对象。如果对象是内存管理器的一部分，或者必须在调用者可能没有 P 的情况下分他们，则这些分配和回收是有必要的。

分配非托管内存有三种机制：

* `sysAlloc` 直接从 OS 获取内存。这会是系统页大小的整数倍，但也可以使用 `sysFree` 进行释放。

* `persistentalloc` 将多个较小的分配组合到一个 `sysAlloc` 中避免碎片。但没有办法释放 `persistentalloc` 对象（所以叫这个名字）。

* `fixalloc` 是一个 SLAB 样式的分配器，用于分配固定大小的对象。`fixalloced` 对象可以被释放，但是这个内存只能由同一个 `fixalloc` 池重用，所以它只能被重用于同一类型的对象。

一般来说，使用其中任何一个分配的类型应标记为 `//go:notinheap` （见下文）。

在非托管内存中分配对象**不得包含**堆指针，除非遵循下列原则：

1. 任何来自非托管内存的指向堆的指针必须为垃圾回收的 root。具体而言，所有指针必须要么能够被一个全局变量访问到，要么能够在 `runtime.markroot` 中添加为显式垃圾回收的 root。
2. 如果内存被重用，那么堆指针必须进行在他们作为 GC root 可见前进行零初始化。否则，GC 可能会回收已经过时的堆指针。请参考「零初始化与归零」

零初始化 v.s. 归零
==================================

运行时有两种类型的归零方式，具体取决于内存是否已经初始化为类型安全状态。

如果内存不是类型安全的状态，那么它可能包含「垃圾」，因为它刚刚被分配且被初始化以供第一次使用，因此它必须使用 `memclrNoHeapPointers` 或非指针写进行**零初始化**。这不会执行 write barrier。

如果内存已经处于类型安全状态，并且只设置为零值，则必须使用常规写，通过 `typedmemclr` 或 `memclrHasPointers` 完成。这会执行 write barrier。

运行时独占的编译标志
================================

除了 "go doc compile" 文档中说明的 "//go:" 标志外，编译器还未运行时支持了额外的标志。

go:systemstack
--------------

`go:systemstack` 表示函数必须在系统堆栈上运行。由特殊的函数序言（function prologue，指汇编程序函数开头的几行代码，通常是寄存器准备）进行动态检查。

go:nowritebarrier
-----------------

如果函数包含 write barrier，则 `go:nowritebarrier` 触发一个编译器错误（它不会抑制 write barrier 的产生，只是一个断言）。

你通常希望 `go:nowritebarrierrec`。`go:nowritebarrier` 主要适用于没有 write barrier 会更好的情况，但没有要求正确性。

go:nowritebarrierrec 和 go:yeswritebarrierrec
----------------------------------------------

如果声明的函数或任何它递归调用的函数甚至于 `go:yeswritebarrierrec` 包含 write barrier，则 `go:nowritebarrierrec` 触发编译器错误。

逻辑上，编译器为每个函数调用补充 `go:nowritebarrierrec` 且当遭遇包含 write barrier 函数的时候产生一个错误。这种补充在 `go:yeswritebarrierrec` 函数上停止。

`go:nowritebarrierrec` 用于防止 write barrier 实现中的无限循环。

两个标志都在调度器中使用。write barrier 需要一个活跃的 P （`getg().m.p != nil`）且调度器代码通常在没有活跃 P 的情况下运行。在这种情况下，`go:nowritebarrierrec` 用于释放 P 的函数上，或者可以在没有 P 的情况下运行。而且`go:nowritebarrierrec` 还被用于当代码重新要求一个活跃的 P 时。由于这些都是函数级标注，因此释放或获取 P 的代码可能需要分为两个函数。

这两个指令都在调度程序中使用。 write barrier 需要一个活跃的P（ `getg().mp != nil`）并且调度程序代码通常在没有活动 P 的情况下运行。在这种情况下，`go:nowritebarrierrec` 用于释放P的函数或者可以在没有P的情况下运行并且去 ：当代码重新获取活动P时使用 `go:yeswritebarrierrec`。由于这些是功能级注释，因此释放或获取P的代码可能需要分为两个函数。

go:notinheap
------------

`go:notinheap` 适用于类型声明。它表明一种不能从 GC 堆中分配的类型。具体来说，指向此类型必须让 `runtime.inheap` 检查失败。类型可能是用于全局变量，堆栈变量或用于对象非托管内存（例如使用 `sysAlloc` 分配、`persistentalloc`、`fixalloc` 或手动管理的范围）。特别的：

1. `new(T)`, `make([]T)`, `append([]T, ...)` 以及 T 的隐式堆分配是不允许的（尽管运行时中无论如何都是不允许隐式分配的）。

2. 指向常规类型（ `unsafe.Pointer` 除外）的指针不能转换为指向 `go:notinheap` 类型，即使他们有相同的基础类型。

3. 任何包含 `go:notinheap` 类型的类型本身也是
   `go:notinheap` 的。结构和数组中如果元素是 `go:notinheap` 的则自生也是。`go:notinheap` 类型的 map 和 channel 是不允许的。为使所有事情都变得显式，任何隐式 `go:notinheap` 类型的声明必须显式的声明 `go:notinheap`。

4. 指向 `go:notinheap` 类型的指针上的 write barrier 可以省略。

最后一点是 `go:notinheap` 真正的好处。运行时会使用它作为低级别内部结构使用来在内存分配器和调度器中避免非法或简单低效的内存屏障。这种机制相当安全且没有牺牲运行时代码的可读性。

## 许可

本文译者系 [changkun](https://changkun.de)，译文许可：

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).