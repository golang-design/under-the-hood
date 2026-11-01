---
weight: 4109
title: "12.9 过去、现在与未来"
---

# 12.9 过去、现在与未来

Go 的分配器由 Cox 于 2008 年以 C 语言写成，头注释写明它基于 TCMalloc [[Cox, 2008](#ref-cox-2008)]。
此后十余年，它被改写为 Go，堆的元数据数次改换形式，地址空间、页的管理与物理内存的归还也先后重新设计。
前面各节介绍组件时，已分别交代了各自的来历。本节按时间把这些变化串联起来，补充其他各节没有涉及的两段历史，
即分配器由 C 改写为 Go 的过程与堆位图的历次改写，最后介绍几项仍在进行的工作。回收器一侧的演进见
[13.12](../ch13gc/history.md)。

下表按版本列出分配器的主要变化，以及详细讨论所在的小节：

| 版本 | 主要变化 | 详见 |
|:----|:--------|:----|
| 2008 年 | 以 C 写成，基于 TCMalloc | [12.1.2](./basic.md) |
| Go 1.1 | 本地缓存由 M 移到 P | [12.1.2](./basic.md) |
| Go 1.3 | 页由 4 KiB 增大到 8 KiB；引入微对象分配 | [12.1.2](./basic.md)、[12.6](./tinyalloc.md) |
| Go 1.4 | 删除运行时内部的 `free`；`mallocgc` 改以 Go 编写 | 12.9.1 |
| Go 1.5 | 分配器整体转换为 Go；堆位图缩减为每字 2 位；堆的预留增至 512 GB | 12.9.1、12.9.2、[12.3.2](./init.md) |
| Go 1.7 | span 内以分配位图取代自由表 | [12.2.1](./component.md) |
| Go 1.8 | 尺寸类表在构建时生成 | [12.1.2](./basic.md) |
| Go 1.9 | 大 span 的空闲链表改为 treap；不含指针的对象使用单独的 span | [12.7.2](./pagealloc.md)、12.9.2 |
| Go 1.11 | 堆改为由区域组成的稀疏映射 | [12.3.2](./init.md) |
| Go 1.12 | 更积极地归还内存；Linux 上改用 `MADV_FREE` | [12.7.7](./pagealloc.md)、[12.3.4](./init.md) |
| Go 1.13 | 后台 scavenger；页的分配改为首次适配 | [12.7](./pagealloc.md) |
| Go 1.14 | 页分配器改为位图与基数树；每 P 的页缓存 | [12.7](./pagealloc.md) |
| Go 1.15 | 中心缓存改用 `spanSet` | [12.2.3](./component.md) |
| Go 1.16 | `runtime/metrics`；Linux 上改回 `MADV_DONTNEED` | [12.8.4](./mstats.md)、[12.3.4](./init.md) |
| Go 1.19 | 软内存限制 | [12.7.8](./pagealloc.md) |
| Go 1.20 | 堆位图缩减为每字 1 位 | 12.9.2 |
| Go 1.22 | 分配头 | [12.1.4](./basic.md)、12.9.2 |
| Go 1.24 | `mallocgc` 拆分为独立的分配路径；删除 GC 程序 | [12.1.4](./basic.md)、12.9.2 |
| Go 1.26 | 堆基址随机化；wasm 的区域缩小为 512 KiB；Green Tea 默认启用；`runtimefreegc` 实验 | [12.3](./init.md)、[12.2.1](./component.md)、12.9.4 |
| Go 1.27 | 80 字节以内的尺寸类默认使用专用的分配函数 | [12.1.4](./basic.md) |

## 12.9.1 从 C 到 Go：Go 1.4 与 Go 1.5

Go 1.3 及以前，运行时主要以 C 写成，分配器分布在 `malloc.goc`、`mheap.c`、`mcentral.c`、`mcache.c`
等文件中。改写为 Go 的第一步，是去掉 Go 语言中没有对应物的部分。Go 1.4 的开发期间，Vyukov
删除了运行时内部的 `free`，提交说明列出了五条理由 [[Vyukov, 2014](#ref-vyukov-2014)]：

```text
1. Significantly simplifies runtime.
2. This code proved to be buggy.
3. Free is incompatible with bump-the-pointer allocation.
4. We want to write runtime in Go, Go does not have free.
5. Too much code to free env strings on startup.
```

第四条说明了根本的动机：运行时将以 Go 编写，而 Go 没有 `free`。第三条指出了另一层不相容：指针碰撞分配
只是向前移动一个指针，单独释放的对象无法被它重新利用。

同月，Randall 写出了 `mallocgc` 的 Go 版本 `gomallocgc`；提交说明称，当时只有少数调用改用了它，C
代码中的大量调用仍然使用原来的 C 版本 [[Randall, 2014](#ref-randall-2014)]。Go 1.4 的发布说明解释了迁移的
原因：运行时的大量代码由 C 翻译为 Go，回收器由此能够扫描运行时自身的栈，准确地获知哪些变量仍然存活
[[Go Authors, 2014a](#ref-go-authors-2014a)]。不过，Go 1.4 发布时，分配器的主体仍是 C：源码树中，
`malloc.go` 与 `malloc.c`、`mheap.c`、`mcentral.c`、`mcache.c` 并存。

2014 年 11 月，Cox 在 dev.cc 分支上把分配器与回收器整体转换为 Go。提交说明称，转换由自动化工具完成，
此后只做了使代码能够编译和运行所必需的修改 [[Cox, 2014](#ref-cox-2014)]。这一分支随 Go 1.5 发布，
发布说明宣布，编译器与运行时已完全以 Go（另加少量汇编）写成，C 不再参与实现
[[Go Authors, 2015a](#ref-go-authors-2015a)]。机械翻译保留了 C 代码的结构与注释，至今仍能看到当时的痕迹：
`mcentral.go` 的头注释仍以 `c->nonempty` 与 `c->empty` 描述两条早已不存在的链表
（[12.2.3](./component.md)）。

以 Go 编写 Go 的分配器，带来了一项 C 时代不存在的约束：分配器不能依赖它自己管理的堆。C
代码不会隐式地分配内存，也不含写屏障；Go 代码则可能因逃逸而在堆上分配，写入指针时还可能附带写屏障。
运行时的开发文档因此规定，一部分对象必须分配在受回收器管理的堆之外，即文档所说的非托管内存
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

```text
In general, the runtime tries to use regular heap allocation. However,
in some cases the runtime must allocate objects outside of the garbage
collected heap, in *unmanaged memory*. This is necessary if the
objects are part of the memory manager itself or if they must be
allocated in situations where the caller may not have a P.
```

`mheap`、`mspan`、`mcentral`、`heapArena` 等结构或者作为全局变量存在，或者由 `fixalloc`、
`persistentalloc` 等分配在非托管内存中（[12.2.5](./component.md)），并内嵌 `sys.NotInHeap`。
对于这样的类型，编译器禁止以 `new`、`make` 或隐式的方式在堆上分配，写入指向它们的指针时也可以省去写屏障。
`NotInHeap` 的注释称，后一点才是这一机制真正的用处：调度器与分配器中的一些地方不允许出现写屏障，
另一些地方则不值得为它付出开销 [[Go Authors, 2026b](#ref-go-authors-2026b)]。`//go:nowritebarrierrec`
则要求编译器检查，一个函数及其递归调用的所有函数中都不出现写屏障
[[Go Authors, 2026a](#ref-go-authors-2026a)]。C 语言天然满足的条件，在 Go 中变成了由编译器逐项检查的规则。

## 12.9.2 堆元数据的演变：Go 1.0 至 Go 1.24

精确回收要求分配器为堆上的每个字记录它是否为指针（[12.1.5](./basic.md)）。这项信息最初与其他几项元数据
存放在同一张位图中，此后经过多次改写：

| 版本 | 指针信息 | 其余元数据 |
|:----|:--------|:----------|
| Go 1.0 | 不记录，对象内部保守扫描 | 位图每字 4 位：已分配、无指针（未分配时表示块边界）、已标记、特殊记录 |
| Go 1.1 | 回收器开始依据类型信息扫描，类型记录在 span 中 | 同上 |
| Go 1.4 | 位图每字 2 位，区分无效、标量、指针与多字值 | 另有边界与已标记各 1 位，每字共 4 位 |
| Go 1.5 | 位图每字 1 位 | 去掉边界位；另 1 位在对象首字为标记位，在第二字为检查标记位，在其余字表示对象的描述尚未结束 |
| Go 1.7 | 同上 | 标记位移出堆位图，改为 span 中每个对象 1 位 |
| Go 1.9 | 同上 | 不含指针的对象使用单独的 span，由 span 类区分 |
| Go 1.11 | 同上 | 位图按区域分块，随堆稀疏分布 |
| Go 1.16 | 同上 | 检查标记移入单独的位图 |
| Go 1.20 | 位图每字 1 位，按字长成批读写 | 另以位图中每个字 1 位标记其后再无指针 |
| Go 1.22 | 512 字节以内的对象使用 span 末尾的位图；更大的对象在首字存放类型指针；大对象的类型指针存放在 span 中 | 不再有覆盖整个堆的位图 |
| Go 1.24 | 删除 GC 程序，大类型的位图由运行时按需构造 | 同上 |

表中前几行依据各版本的源码 [[Go Authors, 2012](#ref-go-authors-2012);
[Go Authors, 2014b](#ref-go-authors-2014b); [Go Authors, 2015b](#ref-go-authors-2015b)]。Go 1.1 中，Ziak
让回收器在扫描时解释类型信息 [[Ziak, 2013](#ref-ziak-2013)]，发布说明称回收器变得更加精确，代价是少量的
CPU 时间，换来的是堆的显著缩小，在 32 位平台上尤为明显 [[Go Authors, 2013](#ref-go-authors-2013)]。Go
1.11 与 Go 1.16 的改动分别使位图随区域稀疏分布、把检查标记移入单独的位图
[[Clements, 2018](#ref-clements-2018); [Clements, 2020](#ref-clements-2020)]。Go 1.20 中，Randall
把指针信息缩减为每字 1 位，以按字长的操作一次处理最多 64 位，并另设一张位图表示其后再无指针
[[Randall, 2022](#ref-randall-2022)]。

逐行对照可以看出，此后的每一次改写，都把某项信息从按字记录的位图中移走，存放到与它的变化粒度相符的位置。

对象的边界由所在 span 的对象大小决定。同一个 span 中的对象大小相同，边界可以由地址算出，不必逐字记录。
Hudson 去掉边界位时的考虑是，查找边界不再需要读取分散在堆中的位图，可以减少缓存缺失；当时测得 garbage
基准变慢 2%，但位图由此可以缩减到每字 2 位 [[Hudson, 2015](#ref-hudson-2015)]。

标记状态与分配状态属于对象而不属于字，每个对象 1 位即可。它们的生命周期也与指针信息不同：
标记位每轮回收都要清空重建，指针信息只在分配时写入一次。Go 1.7 把标记位移入 span 之后，
清扫可以直接把本轮的标记位图交给分配器，作为下一轮的分配位图，不再构建自由表
（[12.2.1](./component.md)）[[Hudson, 2016](#ref-hudson-2016)]。

是否含指针由尺寸类与类型共同决定，Go 1.9 把它编入 span 类。Clements 指出，此前回收器每标灰一个对象，
都要读取它的堆位图才能判断它是否无须扫描；含指针与不含指针的对象混在一起，还降低了每页中可扫描对象的密度，
加重了 TLB 的负担 [[Clements, 2017](#ref-clements-2017)]。

指针布局由类型决定。同一类型的所有对象共享一份类型描述，堆位图却要在每次分配时为每个对象展开写入一份副本。
Go 1.22 让大于 512 字节的对象只保存一个指向类型描述的指针，即分配头，回收器扫描时再依类型展开
（[12.1.4](./basic.md)）[[Knyszek, 2023a](#ref-knyszek-2023a); [Go Authors, 2024](#ref-go-authors-2024)]。
较小的对象仍使用位图，因为对它们而言，每个对象多出 8 字节比位图更贵。Go 1.24 又删除了 GC 程序，即编译器
为大类型生成的压缩形式的指针信息，改由运行时按需构造位图 [[Randall, 2024](#ref-randall-2024)]。

分配头使 Go 与 Java 虚拟机等运行时更为接近。按 HotSpot 术语表的描述，每个对象都带有两个字的对象头，
其中第二个字指向描述对象布局与行为的元对象 [[OpenJDK, n.d.](#ref-openjdk-nd)]。区别在于，Go
只为较大的含指针对象付出这一个字，不含指针的对象和 512 字节以内的对象都不带头部。

分配头的位置也经过一次反复。头部放在对象开头，对象的起始地址便只保证按 8 字节对齐，
而分配器以往在事实上提供 16 字节对齐。为保留这一性质，Knyszek 一度把分配头移到槽位的末尾，
代价是扫描时的局部性稍差 [[Knyszek, 2023b](#ref-knyszek-2023b)]。随后，性能面板上出现了持续的退化，
原因正是放在末尾的头部：先前的基准测试所用机器的三级缓存足够大，掩盖了由此多出的缓存缺失。分配头于是在 Go
1.22 发布之前移回对象开头，提交说明承认，16 字节对齐大体上只是实现的副产品，从未写入任何文档
[[Knyszek, 2023c](#ref-knyszek-2023c)]。

## 12.9.3 地址空间、页与归还：Go 1.11 至 Go 1.19

早期的分配器预留大片地址空间，很少归还内存。Go 1.0 在 64 位平台上为堆预留一段连续的地址，Go 1.5 起增至
512 GB（[12.3.2](./init.md)）；空闲的内存只由一个周期性的 scavenger 归还。Go 1.13 的发布说明回顾，此前
堆在一次峰值之后可能把内存保留五分钟以上；新版本之所以更积极地归还内存，是为了让同一台机器上的其他应用
能够使用这部分内存 [[Go Authors, 2019b](#ref-go-authors-2019b)]。

此后几个版本的改动，大体可以归结为关注点的两次转移。第一次是由地址空间转向物理内存。Go 1.11
把堆改为稀疏的区域，取消了堆大小的上限 [[Go Authors, 2018](#ref-go-authors-2018)]；Go 1.12
更积极地向操作系统归还内存，尤其是在大分配无法重用现有堆空间时
[[Go Authors, 2019a](#ref-go-authors-2019a)]；Go 1.13 加入了后台 scavenger（[12.7.7](./pagealloc.md)）。
Go 1.14 重写页分配器，使它在 `GOMAXPROCS` 较大时的锁争用显著减少
[[Go Authors, 2020](#ref-go-authors-2020); [Knyszek, 2019](#ref-knyszek-2019)]。设计文档还指出，
有了按页记录的位图，scavenger 的工作在概念上简单得多：结合分配位图与记录归还状态的位图，即可找出连续的、
空闲而未归还的页，以一次系统调用归还 [[Knyszek, 2019](#ref-knyszek-2019)]（[12.7](./pagealloc.md)）。

第二次是把内存的用量交由部署者观测与约束。Go 1.16 引入 `runtime/metrics`，以稳定的接口取代
`runtime.ReadMemStats` 等函数（[12.8.4](./mstats.md)）[[Go Authors, 2021](#ref-go-authors-2021)]；Go 1.19
加入软内存限制，scavenger 以这一限制为目标归还内存
（[12.7.8](./pagealloc.md)）[[Go Authors, 2022](#ref-go-authors-2022);
[Knyszek, 2021](#ref-knyszek-2021)]。

Linux 上归还方式的一次反复说明，可观测性与效率同样重要。Go 1.12 改用 `MADV_FREE`，它比 `MADV_DONTNEED`
高效，代价是进程的常驻内存在内核真正回收之前不会下降 [[Go Authors, 2019a](#ref-go-authors-2019a)]。
以常驻内存监控进程的系统因此会高估 Go 程序的内存用量，一些用户不得不设置 `GODEBUG=madvdontneed=1`。Go
1.16 改回 `MADV_DONTNEED`，发布说明称，常驻内存等进程级的统计由此能更准确地反映 Go
进程实际使用的物理内存，为改善监控而设置这一选项的系统也不再需要它
[[Go Authors, 2021](#ref-go-authors-2021)]。两种方式在各平台上的差别见 [12.3.4](./init.md)。

## 12.9.4 减少分配与回收的工作：Go 1.24 至今

近几个版本的改动，着眼点由内存的布局转向分配与回收本身的开销。Go 1.24 中，Knyszek 把 `mallocgc`
拆分为按大小与是否含指针区分的独立路径。提交说明称，原来的 `mallocgc` 分支繁多、状态复杂，在实际程序中，
相当一部分分配时间耗费在它自身；连同此前的几项改动，几个分配基准的耗时几何平均缩短了 11.58%
[[Knyszek, 2024b](#ref-knyszek-2024b)]。在此基础上，Go 1.27 默认为 80 字节以内的尺寸类启用专用的分配函数，
在这些函数中尺寸类是编译期常量（[12.1.4](./basic.md)）。

回收一侧，Green Tea 以 span 为单位累积并扫描对象
[[Knyszek and Clements, 2025](#ref-knyszek-clements-2025)]，它要求分配器在单页 span 的末尾为标记预留空间，
span 中的槽位数因此少于尺寸类表中的数目（[12.2.1](./component.md)、[13.11](../ch13gc/greentea.md)）。
分配器摆放对象的方式，直接影响回收器能否利用局部性。

还有一项尝试让 `free` 以另一种形式回到了运行时。Go 1.26 加入了 `runtime.freegc`，由
`GOEXPERIMENT=runtimefreegc` 控制，默认关闭 [[thepudds, 2025](#ref-thepudds-2025)]。它的调用者只能是编译器
[[Go Authors, 2026c](#ref-go-authors-2026c)]：

```go
// freegc must be called by the effective owner of ptr who knows
// the pointer is logically dead, with no possible aliases that might
// be used past that moment. In other words, ptr must be the
// last and only pointer to its referent.
//
// The intended caller is the compiler.
```

与 Go 1.4 删除的 `free` 不同，`freegc` 不由运行时的代码手工调用，而由编译器依据静态分析插入：
只有能够证明某个指针是对象的最后一个引用时，才会释放。目前唯一的使用者是逃逸分析中的别名分析：在循环中以
`s = append(s, ...)` 扩充的局部切片，若能证明它的底层数组没有别名，编译器便改为调用 `growsliceNoAlias`，
在扩容之后立即释放旧的底层数组 [[Malloy, 2025](#ref-malloy-2025)]；Go 1.26 只对不含指针的元素类型这样做
[[Go Authors, 2026c](#ref-go-authors-2026c)]。

被释放的对象并不交还给清扫器，而是串入本地缓存中按 span 类索引的链表 `reusableNoscan`，链表的指针存放在
对象的第一个字中。分配不含指针的小对象时，分配器先检查这张链表
[[Go Authors, 2026c](#ref-go-authors-2026c)]：

```go
	// First, check for a reusable object.
	if runtimeFreegcEnabled && c.hasReusableNoscan(spc) {
		// We have a reusable object, use it.
		x := mallocgcSmallNoscanReuse(c, span, spc, size, needzero)
		mp.mallocing = 0
		releasem(mp)
		return x, size
	}
```

Go 1.7 在 span 内以位图取代的自由表，以本地缓存中一张旁路链表的形式重新出现；`allocBits`
仍然只由清扫器改写（[12.5.5](./smallalloc.md)）。对象一经释放即可重用，无须等待下一轮回收。提交说明报告，
试验性地让 `strings.Builder` 在扩容之后释放旧的缓冲区，写入次数越多，收益越大，最多快了约一倍；同时声明，
标准库不会显式调用 `freegc`，用户代码也永远无法调用它 [[thepudds, 2025](#ref-thepudds-2025)]。Go 1.26 中，
`freegc` 只处理 16 字节至 32 KiB 减去分配头大小之间的不含指针对象，含指针的对象留待后续的提交。

## 12.9.5 展望

上述几项工作都在推进之中。专用的分配函数在 Go 1.27 中默认启用之后，主分支已为 Go 1.28
删除了对应的实验开关 [[Matloob, 2026](#ref-matloob-2026)]。`runtimefreegc` 的跟踪问题 #74299 仍然开放，
含指针对象的支持尚未合入：Go 1.26 中，以含指针的对象调用 `freegc` 会直接报错
[[Go Authors, 2026c](#ref-go-authors-2026c)]。由程序员显式管理一部分内存的尝试，即 Go 1.20 起的 `arena`
实验与 2024 年提出的内存区域设计，见 [13.12.5](../ch13gc/history.md) 与 [13.12.7](../ch13gc/history.md)；
内存区域的设计文档把 arena 的问题归结为两点，一是为了发挥作用需要大量 API 增加参数，
二是与逃逸分析等现有机制难以组合 [[Knyszek, 2024a](#ref-knyszek-2024a)]。`freegc` 走的是另一条路：
不改变语言与 API，由编译器在能够证明安全的地方释放内存。

这些方向有一个共同点：都不移动对象，也不要求赋值器常开写屏障，而是设法减少需要分配与回收的内存，
或者使已经分配的内存被更早地重用。

## 12.9.6 小结

分配器的每一次改动，都在分配速度、内存占用与回收器的协作之间重新取舍。元数据的历次改写，
把每一项信息存放到与它的变化粒度相符的位置，堆位图由每字 4 位缩减为每字 1 位，
较大的对象只保留一个类型指针；内存的管理由预留地址空间转向控制常驻内存，再转向服从部署者设定的预算；
分配路径则不断削减同步与分支：本地缓存移到 P 上，中心缓存与页分配器的锁争用逐步减少，`mallocgc`
被拆分为独立的路径并按尺寸类特化。Go 1.4 为改写为 Go 而删除了 `free`，Go 1.26
的实验则让它在编译器的控制下回到运行时。这些变化体现的仍是 [12.1](./basic.md) 提出的那组目标，
只是随着硬件、部署环境与回收器的变化，它们之间的平衡点在不断移动。

## 延伸阅读

- <a id="ref-clements-2017"></a>[Clements, 2017] Austin Clements. runtime: separate spans of noscan
  objects. Go commit 1a033b1a70, 2017. https://go.dev/cl/41251
  随 Go 1.9 发布。
- <a id="ref-clements-2018"></a>[Clements, 2018] Austin Clements. runtime: make the heap bitmap sparse. Go
  commit c0392d2e7f, 2018. https://go.dev/cl/85883
  随 Go 1.11 发布。
- <a id="ref-clements-2020"></a>[Clements, 2020] Austin Clements. runtime: move checkmarks to a separate
  bitmap. Go commit d19fedd180, 2020. https://go.dev/cl/244539
  随 Go 1.16 发布。
- <a id="ref-cox-2008"></a>[Cox, 2008] Russ Cox. malloc in runtime (not used by default). Go commit
  e29ce175ed, 2008. https://github.com/golang/go/commit/e29ce175eda2016b93e755b6a5ae759b5b692834
  随 Go 1 发布。
- <a id="ref-cox-2014"></a>[Cox, 2014] Russ Cox. [dev.cc] runtime: convert memory allocator and garbage
  collector to Go. Go commit 1e2d2f0947, 2014. https://go.dev/cl/167540043
  随 Go 1.5 发布。
- <a id="ref-go-authors-2012"></a>[Go Authors, 2012] The Go Authors. src/pkg/runtime/mgc0.c. Go 1 源码.
  https://github.com/golang/go/blob/go1/src/pkg/runtime/mgc0.c
  每字 4 位的堆位图。
- <a id="ref-go-authors-2013"></a>[Go Authors, 2013] The Go Authors. *Go 1.1 Release Notes.* 2013.
  https://go.dev/doc/go1.1
- <a id="ref-go-authors-2014a"></a>[Go Authors, 2014a] The Go Authors. *Go 1.4 Release Notes.* 2014.
  https://go.dev/doc/go1.4
- <a id="ref-go-authors-2014b"></a>[Go Authors, 2014b] The Go Authors. src/runtime/mgc0.h. Go 1.4 源码.
  https://github.com/golang/go/blob/go1.4/src/runtime/mgc0.h
- <a id="ref-go-authors-2015a"></a>[Go Authors, 2015a] The Go Authors. *Go 1.5 Release Notes.* 2015.
  https://go.dev/doc/go1.5
- <a id="ref-go-authors-2015b"></a>[Go Authors, 2015b] The Go Authors. src/runtime/mbitmap.go. Go 1.5
  源码. https://github.com/golang/go/blob/go1.5/src/runtime/mbitmap.go
  每字 2 位的堆位图。
- <a id="ref-go-authors-2018"></a>[Go Authors, 2018] The Go Authors. *Go 1.11 Release Notes.* 2018.
  https://go.dev/doc/go1.11
- <a id="ref-go-authors-2019a"></a>[Go Authors, 2019a] The Go Authors. *Go 1.12 Release Notes.* 2019.
  https://go.dev/doc/go1.12#runtime
  更积极地向操作系统归还内存，尤其是在大分配无法重用现有堆空间时；Linux 上改用 `MADV_FREE`。
- <a id="ref-go-authors-2019b"></a>[Go Authors, 2019b] The Go Authors. *Go 1.13 Release Notes.* 2019.
  https://go.dev/doc/go1.13#runtime
- <a id="ref-go-authors-2020"></a>[Go Authors, 2020] The Go Authors. *Go 1.14 Release Notes.* 2020.
  https://go.dev/doc/go1.14#runtime
  页分配器重写为位图加基数树。
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.16 Release Notes.* 2021.
  https://go.dev/doc/go1.16#runtime
  `runtime/metrics`；Linux 上改回 `MADV_DONTNEED`。
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *Go 1.19 Release Notes.* 2022.
  https://go.dev/doc/go1.19#runtime
  软内存限制 `GOMEMLIMIT`。
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. *Go 1.22 Release Notes.* 2024.
  https://go.dev/doc/go1.22#runtime
  分配头（allocation headers）。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. src/runtime/HACKING.md. Go 1.26
  源码. https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/HACKING.md
  运行时的开发约定，含非托管内存与写屏障相关的编译指示。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. src/internal/runtime/sys/nih.go. Go
  1.26 源码. https://github.com/golang/go/blob/release-branch.go1.26/src/internal/runtime/sys/nih.go
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. src/runtime/malloc.go. Go 1.26
  源码. https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/malloc.go
  `freegc` 及其重用路径。
- <a id="ref-hudson-2015"></a>[Hudson, 2015] Rick Hudson. runtime: Remove boundary bit logic. Go commit
  122384e489, 2015. https://go.dev/cl/6665
  随 Go 1.5 发布。
- <a id="ref-hudson-2016"></a>[Hudson, 2016] Rick Hudson. [dev.garbage] runtime: allocate directly from GC
  mark bits. Go commit 3479b065d4, 2016. https://go.dev/cl/19470
  随 Go 1.7 发布。
- <a id="ref-knyszek-2019"></a>[Knyszek, 2019] Michael Knyszek. *Scaling the Go page allocator.* 2019.
  https://go.googlesource.com/proposal/+/master/design/35112-scaling-the-page-allocator.md
- <a id="ref-knyszek-2021"></a>[Knyszek, 2021] Michael Knyszek. *Soft memory limit.* 2021.
  https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md
- <a id="ref-knyszek-2023a"></a>[Knyszek, 2023a] Michael Anthony Knyszek. runtime: implement experiment to
  replace heap bitmap with alloc headers. Go commit 38ac7c41aa, 2023. https://go.dev/cl/437955
  随 Go 1.22 发布。
- <a id="ref-knyszek-2023b"></a>[Knyszek, 2023b] Michael Anthony Knyszek. runtime: make alloc headers
  footers instead. Go commit 1e250a2199, 2023. https://go.dev/cl/537886
  在 Go 1.22 的开发周期内被下一项提交撤回。
- <a id="ref-knyszek-2023c"></a>[Knyszek, 2023c] Michael Anthony Knyszek. runtime: put allocation headers
  back at the start the object. Go commit 0ef169abb1, 2023. https://go.dev/cl/543255
  随 Go 1.22 发布。
- <a id="ref-knyszek-2024a"></a>[Knyszek, 2024a] Michael Knyszek. *Memory regions*（设计文档与 GitHub
  discussion #70257）. 2024. https://go.dev/design/70257-memory-regions
  https://github.com/golang/go/discussions/70257
- <a id="ref-knyszek-2024b"></a>[Knyszek, 2024b] Michael Anthony Knyszek. runtime: refactor mallocgc into
  several independent codepaths. Go commit 8730fcf885, 2024. https://go.dev/cl/614257
  随 Go 1.24 发布。
- <a id="ref-knyszek-clements-2025"></a>[Knyszek and Clements, 2025] Michael Knyszek, Austin Clements.
  *runtime: green tea garbage collector*（Go issue #73581，Green Tea 的设计讨论，Go 1.25 / 1.26）. 2025.
  https://github.com/golang/go/issues/73581 ；源码见 `runtime/mgcmark_greenteagc.go`.
- <a id="ref-malloy-2025"></a>[Malloy, 2025] PJ Malloy. *Directly freeing user memory to reduce GC
  work*（Go issue #74299）. 2025. https://go.dev/design/74299-runtime-freegc
- <a id="ref-matloob-2026"></a>[Matloob, 2026] Michael Matloob. internal/goexperiment: remove
  sizespecializedmalloc GOEXPERIMENT setting. Go commit 4a7645b730, 2026. https://go.dev/cl/806981
  位于主分支，面向 Go 1.28（Go issue #80279），尚未随正式版本发布。
- <a id="ref-openjdk-nd"></a>[OpenJDK, n.d.] The OpenJDK Community. *HotSpot Glossary of Terms.*
  https://openjdk.org/groups/hotspot/docs/HotSpotGlossary.html
  「object header」与「klass pointer」两个条目。
- <a id="ref-randall-2014"></a>[Randall, 2014] Keith Randall. runtime: rewrite malloc in Go. Go commit
  4aa50434e1, 2014. https://go.dev/cl/108840046
  随 Go 1.4 发布。
- <a id="ref-randall-2022"></a>[Randall, 2022] Keith Randall. runtime: redo heap bitmap. Go commit
  6a9c674a09, 2022. https://go.dev/cl/422634
  随 Go 1.20 发布。
- <a id="ref-randall-2024"></a>[Randall, 2024] Keith Randall. runtime: get rid of gc programs for types.
  Go commit 45869f5931, 2024. https://go.dev/cl/616255
  随 Go 1.24 发布。
- <a id="ref-thepudds-2025"></a>[thepudds, 2025] thepudds. runtime: add runtime.freegc to reduce GC work.
  Go commit fecfcaa4f6, 2025. https://go.dev/cl/673695
  随 Go 1.26 发布，默认关闭。
- <a id="ref-vyukov-2014"></a>[Vyukov, 2014] Dmitriy Vyukov. runtime: get rid of free. Go commit
  cecca43804, 2014. https://go.dev/cl/116390043
  随 Go 1.4 发布。
- <a id="ref-ziak-2013"></a>[Ziak, 2013] Jan Ziak. runtime: interpret type information during garbage
  collection. Go commit 9204eb4d3c, 2013. https://go.dev/cl/6945069
  随 Go 1.1 发布。
- 本书 [12.1 设计原则](./basic.md)、[12.2 组件](./component.md)、[12.7 页分配器](./pagealloc.md)、
  [第 13 章 垃圾回收器](../ch13gc)、[13.12 过去、现在与未来](../ch13gc/history.md).
