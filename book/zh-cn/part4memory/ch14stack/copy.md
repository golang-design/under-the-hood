---
weight: 4304
title: "14.4 栈的拷贝与指针调整"
---

# 14.4 栈的拷贝与指针调整

连续栈的代价集中在一处：当一个 goroutine 的栈溢出，运行时分配一段两倍大的新栈，把旧栈整个
搬过去，再释放旧栈。搬家这一步看似就是一次 `memmove`，把 `[old.lo, old.hi)` 的字节复制到
`[new.lo, new.hi)`。倘若真的只是复制字节，问题就来了：栈上的变量里可能存着指向这个栈自身的
指针，比如某个局部变量取了另一个局部变量的地址。字节被原样搬到新地址后，这些指针的值没有变，
仍然指着旧栈的位置，而旧栈马上就要被回收。复制完成的那一刻，它们就成了悬垂指针。

所以栈的拷贝不是 `memmove`，而是 `memmove` 加上一遍**指针调整**：搬完字节之后，运行时必须
遍历新栈，把每一个原本指向旧栈区间的指针，统统加上一个固定的位移 $\delta = \mathrm{new.hi} -
\mathrm{old.hi}$，让它改指向新栈的对应位置。难点不在「怎么加」，而在「怎么知道哪些字是指针」。
栈上的字没有类型标签，一个 8 字节的字到底是指针还是恰好长得像地址的整数，运行时无从分辨。
答案来自编译器：它为每个函数在每个安全点（[13.7](../ch13gc/safe.md)）生成了**栈映射**
（stack map），用位图精确记录该函数栈帧里哪些槽位是指针。GC 扫描栈靠它，栈拷贝调整指针也靠它。

这一节就讲这件事：`copystack` 如何在搬家之后，借栈映射走遍新栈，把所有指向旧栈的指针、加上
那些不在栈帧里、却同样指向栈的运行时结构（`gobuf`、`sudog`、`defer`、`panic`）一并调整正确。
读完会看到，正是「栈可以移动」这条性质，反过来约束了语言：哪些指针允许指向栈、逃逸分析
（[15.5](../../part5toolchain/ch15compile/escape.md)）为何必须把外部持有的地址搬到堆上。

## 14.4.1 为什么不能只 memmove

先把问题摆清楚。考虑一段普通的 Go 代码：

```go
func f() {
	var x int
	p := &x      // p 指向本栈帧里的 x
	g(p)         // 把栈上地址传下去
}
```

`p` 的值是 `x` 在栈上的地址，落在 `[old.lo, old.hi)` 区间内。当 `g` 或其更深的调用触发栈增长，
整个栈被搬到新地址，`x` 随之搬走，但 `p` 这个字里存的还是旧地址。若不修正，`p` 指向的已是
一段即将释放、或将被别的 goroutine 栈复用的内存。

修正的算法本身朴素：对栈上每个**指针槽**取出其值 $v$，若 $\mathrm{old.lo} \le v <
\mathrm{old.hi}$，就改写为 $v + \delta$。`adjustpointer` 就是这一句判断的实现：

```go
// adjustpointer：若 *vpp 落在旧栈区间内，则平移 delta，指向新栈（速写）
func adjustpointer(adjinfo *adjustinfo, vpp unsafe.Pointer) {
	pp := (*uintptr)(vpp)
	p := *pp
	if adjinfo.old.lo <= p && p < adjinfo.old.hi {
		*pp = p + adjinfo.delta // 平移到新栈
	}
}
```

`adjustinfo` 把这趟调整需要的三样东西收在一起：旧栈区间（用来判断「是否指向旧栈」）、位移
`delta`、以及一个稍后会解释的 `sghi`：

```go
type adjustinfo struct {
	old   stack    // 旧栈区间 [lo, hi)，用于判定指针是否指向旧栈
	delta uintptr  // 新旧栈基址之差 new.hi - old.hi
	sghi  uintptr  // 栈上最高的 sudog.elem 地址，用于并发收发的边界
}
```

真正难的是「找到所有指针槽」。整个栈被切成一帧帧函数调用，每帧的指针布局由编译器在编译期
就已算定，运行时只需按图索骥。这张图，就是栈映射。

## 14.4.2 借栈映射逐帧调整

`copystack` 在 `memmove` 之后，从栈顶开始用 `unwinder` 一帧帧回溯，对每一帧调用
`adjustframe`（完整骨架见 14.4.4）。这里有一处版本变迁值得点出：早期运行时是把调整逻辑作为
回调函数传给 `gentraceback` 来驱动遍历的，go1.26 改用了独立的 `unwinder` 迭代器，遍历与调整
解耦，但「逐帧回调」的骨架未变。

`adjustframe` 处理单帧。它向编译器要来这一帧的三类栈映射，局部变量（locals）、参数与返回值
（args）、以及栈对象（stack objects），逐类按位图调整：

```go
// 调整一个栈帧内的所有指针（速写）
func adjustframe(frame *stkframe, adjinfo *adjustinfo) {
	if frame.continpc == 0 {
		return // 死帧（不会再恢复执行），无需调整
	}
	// 若本帧保存了调用者的帧指针（frame pointer），先调整它
	if frame.argp-frame.varp == 2*goarch.PtrSize {
		adjustpointer(adjinfo, unsafe.Pointer(frame.varp))
	}
	locals, args, objs := frame.getStackMap(true) // 取编译器生成的栈映射
	if locals.n > 0 { // 局部变量区，按位图调整
		size := uintptr(locals.n) * goarch.PtrSize
		adjustpointers(unsafe.Pointer(frame.varp-size), &locals, adjinfo, frame.fn)
	}
	if args.n > 0 { // 参数与返回值区
		adjustpointers(unsafe.Pointer(frame.argp), &args, adjinfo, funcInfo{})
	}
	// 栈对象：取地址、可能被多处引用的局部变量，无论存活与否都要调整
	// ... 遍历 objs，按各自的指针位图调整 ...
}
```

`adjustpointers` 是真正与位图打交道的地方。它收到一段内存的起址 `scanp` 与一个位图 `bv`，
位图的第 $i$ 位为 1 表示 `scanp` 偏移 $i$ 个字处是指针。它只在置位的槽上动手，不去碰整数槽：

```go
// 按位图 bv 调整 scanp 开始的一段内存中的指针（速写）
func adjustpointers(scanp unsafe.Pointer, bv *bitvector, adjinfo *adjustinfo, f funcInfo) {
	num := uintptr(bv.n)
	useCAS := uintptr(scanp) < adjinfo.sghi // 这段可能被并发收发触碰，见 14.4.4
	for i := uintptr(0); i < num; i += 8 {
		b := *(addb(bv.bytedata, i/8)) // 取出 8 个槽位的指针位
		for b != 0 {
			j := uintptr(sys.TrailingZeros8(b)) // 下一个指针槽
			b &= b - 1
			pp := (*uintptr)(add(scanp, (i+j)*goarch.PtrSize))
			p := *pp
			if adjinfo.old.lo <= p && p < adjinfo.old.hi {
				if useCAS { // 与并发写者竞争时用 CAS
					atomic.Casp1(...)
				} else {
					*pp = p + adjinfo.delta
				}
			}
		}
	}
}
```

到此，栈帧内的指针都已正确。但栈上的指针不止藏在栈帧里。

## 14.4.3 栈帧之外：那些也指向栈的结构

有几类运行时结构，本身不在栈上，却存着指向栈的指针。`memmove` 不会碰它们，逐帧遍历也覆盖
不到它们，必须在 `copystack` 里逐一显式调整。

第一类是 goroutine 的执行现场 `gobuf`（即 `g.sched`，见本章 [14.1](./readme.md)）。它保存着
`sp`、`bp`、以及 `ctxt`，其中 `ctxt` 与帧指针可能指向栈：

```go
func adjustctxt(gp *g, adjinfo *adjustinfo) {
	adjustpointer(adjinfo, unsafe.Pointer(&gp.sched.ctxt))
	adjustpointer(adjinfo, unsafe.Pointer(&gp.sched.bp)) // 栈顶帧指针
}
```

第二类是 `defer` 与 `panic` 记录。每个 `defer` 结构里存着待执行函数 `fn`、登记时的栈指针 `sp`、
以及链向下一个 `defer` 的 `link`，这些都可能落在栈上：

```go
func adjustdefers(gp *g, adjinfo *adjustinfo) {
	adjustpointer(adjinfo, unsafe.Pointer(&gp._defer)) // 链表头
	for d := gp._defer; d != nil; d = d.link {
		adjustpointer(adjinfo, unsafe.Pointer(&d.fn))
		adjustpointer(adjinfo, unsafe.Pointer(&d.sp))
		adjustpointer(adjinfo, unsafe.Pointer(&d.link))
	}
}

func adjustpanics(gp *g, adjinfo *adjustinfo) {
	// panic 记录本身在栈上、已随帧调整，这里只更新 g 里指向链头的指针
	adjustpointer(adjinfo, unsafe.Pointer(&gp._panic))
}
```

第三类最微妙，是 goroutine 阻塞在通道上时挂着的 `sudog`（[10.3](../../part3concurrency/ch10chan/sendrecv.md)）。
当一个 goroutine 在 `ch <- v` 或 `<-ch` 上阻塞，运行时用一个 `sudog` 把它挂到通道的等待队列，
`sudog.elem` 指向收发数据所在的内存，而这块内存常常就在阻塞者的栈上。栈一搬，`sudog.elem`
也要跟着调整：

```go
func adjustsudogs(gp *g, adjinfo *adjustinfo) {
	for s := gp.waiting; s != nil; s = s.waitlink {
		adjustpointer(adjinfo, unsafe.Pointer(&s.elem)) // elem 可能指向本栈（速写）
	}
}
```

## 14.4.4 并发的边界：_Gcopystack 与 sudog 的同步

拷贝期间，这个 goroutine 的栈正处于「搬到一半」的中间态，指针有的已调整、有的还没。若此时
并发 GC 来扫描这个栈，或别的 goroutine 通过通道往它的栈上写数据，就会读到或写坏不一致的状态。
运行时用两道闸把这段临界区围起来。

对 GC，办法是状态机。`newstack` 在调用 `copystack` 前，把 goroutine 从 `_Grunning` 切到
`_Gcopystack`，拷贝完再切回去：

```go
// newstack 片段：拷贝期间置 _Gcopystack，挡住并发 GC 扫描（速写）
casgstatus(gp, _Grunning, _Gcopystack)
copystack(gp, newsize)
casgstatus(gp, _Gcopystack, _Grunning)
```

并发 GC 扫描栈前会检查 goroutine 状态，见到 `_Gcopystack` 便知道这个栈正在搬家，不去碰它。

对并发收发，办法是锁与 CAS。当 goroutine 已经把自己挂上通道等待队列、并释放了通道锁
（`activeStackChans` 为真），别的 goroutine 随时可能往它栈上的收发槽里写值。`copystack` 此时
不能莽撞地搬：它先用 `findsghi` 找出栈上最高的 `sudog.elem` 地址，记入 `adjinfo.sghi`，再用
`syncadjustsudogs` 锁住相关通道、同步地调整并搬运那一段，期间对可能被并发写的槽位改用 CAS
来平移指针（这正是 14.4.2 里 `useCAS` 的由来）。这一层小心，只为收发槽这一小块栈，代价不大，
却堵住了「调整指针」与「并发写槽」之间的竞争。

把以上串起来，`copystack` 的骨架是这样：

```go
// 连续栈搬家的完整骨架（速写）
func copystack(gp *g, newsize uintptr) {
	old := gp.stack
	used := old.hi - gp.sched.sp
	new := stackalloc(uint32(newsize)) // 分配新栈

	var adjinfo adjustinfo
	adjinfo.old = old
	adjinfo.delta = new.hi - old.hi // 位移量

	ncopy := used
	if !gp.activeStackChans {       // 未在通道上「裸露」栈，可放心调整
		adjustsudogs(gp, &adjinfo)
	} else {                        // 否则与并发收发同步，只小心处理收发槽
		adjinfo.sghi = findsghi(gp, old)
		ncopy -= syncadjustsudogs(gp, used, &adjinfo)
	}

	memmove(new.hi-ncopy, old.hi-ncopy, ncopy) // 搬字节

	adjustctxt(gp, &adjinfo)   // 调整 g.sched 里的栈指针
	adjustdefers(gp, &adjinfo) // 调整 defer 链
	adjustpanics(gp, &adjinfo) // 调整 panic 链头

	gp.stack = new             // 换栈
	gp.sched.sp = new.hi - used
	gp.stktopsp += adjinfo.delta

	var u unwinder             // 逐帧调整新栈上的指针
	for u.init(gp, 0); u.valid(); u.next() {
		adjustframe(&u.frame, &adjinfo)
	}

	stackfree(old)             // 释放旧栈
}
```

顺序是有讲究的。`adjustctxt`、`adjustdefers`、`adjustpanics` 必须排在逐帧遍历之前，因为
`unwinder` 回溯新栈时会用到 `g.sched` 与 defer 链里的指针，它们得先正确才能驱动遍历。

## 14.4.5 拷贝的约束反过来塑造了语言

走到这里，可以回答一个更深的问题：为什么 Go 里「只有栈上分配的指针，才允许指向栈」？

因为栈会移动，而移动时能被找到并调整的指针，**只有栈映射覆盖得到的那些**，也就是栈帧内的
指针、加上运行时显式登记的那几类结构（`gobuf`、`sudog`、`defer`、`panic`）。一个指向某 goroutine
栈的指针，如果存在堆上的某个对象里，或被另一个 goroutine 的栈持有，`copystack` 在搬家时根本
无从知道它的存在，自然无法调整它。栈一搬，它就悬垂。

这正是逃逸分析（[15.5](../../part5toolchain/ch15compile/escape.md)）必须做出某些判断的根因。
当编译器发现一个局部变量的地址会被外部持有，典型如：

```go
func newInt() *int {
	x := 0
	return &x // x 的地址逃出本帧，被调用者持有
}
```

`x` 的地址要返回给上层，将被一个本帧之外的持有者保存。若把 `x` 放在栈上，一旦本栈日后增长
搬家，那个外部持有者手里的指针就会失效，而运行时没有任何办法替它修正。于是逃逸分析的结论
只能是：把 `x` 分配到堆上。堆对象不随栈移动，地址终生不变，外部持有者尽可放心。

换句话说，连续栈「搬家必须能调整全部指向它的指针」这条工程约束，向上传导成了一条语言层面的
分配规则：**凡是地址会被栈外持有的值，必须逃逸到堆**。栈的可移动性买来了「按需伸缩、无需
预留巨栈」的便宜（本章 [14.1](./readme.md)），代价则记在逃逸分析与堆分配这一侧。性能的便宜
从不白来，它总伴着复杂度在别处的重新安置。

放进谱系看，这套「搬栈加调指针」并非 Go 独有。带移动式 GC 的运行时，如 JVM 的复制式收集、
.NET 的压缩式 GC，也都要在对象移动后修正所有指向它的引用，手法同样是「靠精确的类型信息找出
指针，再统一平移」。Go 的特别之处在于它把这套机制用在了**栈**上，且与逃逸分析这一编译期决策
紧紧咬合，让「栈能动」与「指针总有效」这两件看似矛盾的事得以并存。

## 延伸阅读的文献

1. The Go Authors. *runtime/stack.go：copystack、adjustframe、adjustpointers、adjustsudogs、
   adjustdefers、adjustctxt.* https://github.com/golang/go/blob/master/src/runtime/stack.go
   （本节所据的一手实现，go1.26）
2. Keith Randall. *Contiguous stacks.* Go design document, 2013.
   https://go.dev/s/contigstacks
   （连续栈取代分段栈的设计与拷贝时的指针调整动机）
3. The Go Authors. *runtime/runtime2.go（_Gcopystack 状态）、runtime/mgcmark.go（栈扫描与 shrinkstack）.*
   https://github.com/golang/go/tree/master/src/runtime
4. The Go Authors. *cmd/compile：栈映射（stack maps / liveness）的生成.*
   https://github.com/golang/go/tree/master/src/cmd/compile/internal/liveness
5. 本书 [13.7 安全点分析](../ch13gc/safe.md)：栈映射与安全点，指针调整与 GC 扫描共用的基础。
6. 本书 [15.5 逃逸分析](../../part5toolchain/ch15compile/escape.md)：栈可移动性如何约束分配决策。
7. 本书 [10.3 收发与直接传递](../../part3concurrency/ch10chan/sendrecv.md)：sudog 与通道收发槽，
   解释 `adjustsudogs` 为何存在。

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
