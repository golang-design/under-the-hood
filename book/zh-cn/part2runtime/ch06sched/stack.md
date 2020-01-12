---
weight: 2106
title: "6.6 goroutine 及其执行栈管理"
---

# 6.6 goroutine 及其执行栈管理

[TOC]

## goroutine 栈结构

goroutine 是一个 g 对象，g 对象的前三个字段描述了它的执行栈：

```go
// stack 描述了 goroutine 的执行栈，栈的区间为 [lo, hi)，在栈两边没有任何隐式数据结构
// 因此 Go 的执行栈由运行时管理，本质上分配在堆中，比 ulimit -s 大
type stack struct {
	lo uintptr
	hi uintptr
}
// gobuf 描述了 goroutine 的执行现场
type gobuf struct {
	sp   uintptr
	pc   uintptr
	g    guintptr
	ctxt unsafe.Pointer
	ret  sys.Uintreg
	lr   uintptr
	bp   uintptr
}
type g struct {
	// stack 描述了实际的栈内存：[stack.lo, stack.hi)
	stack stack
	// stackguard0 是对比 Go 栈增长的 prologue 的栈指针
	// 如果 sp 寄存器比 stackguard0 小（由于栈往低地址方向增长），会触发栈拷贝和调度
	// 通常情况下：stackguard0 = stack.lo + StackGuard，但被抢占时会变为 StackPreempt
	stackguard0 uintptr
	// stackguard1 是对比 C 栈增长的 prologue 的栈指针
	// 当位于 g0 和 gsignal 栈上时，值为 stack.lo + StackGuard
	// 在其他栈上值为 ~0 用于触发 morestackc (并 crash) 调用
	stackguard1 uintptr
	(...)
	// sched 描述了执行现场
	sched       gobuf
	(...)
}
```

```
                           <-- _StackPreempt

高地址
       goroutine stack
    +-------------------+  <-- _g_.stack.hi
    |                   |
    +-------------------+
    |                   |
    +-------------------+
    |                   |
    +-------------------+  <-- _g_.sched.sp
    |                   |
    +-------------------+
    |                   |
    +-------------------+
    |                   |
    +-------------------+
    |                   |
    +-------------------+
            ....
    |                   |
    +-------------------+  <-- _g_.stackguard0
    |                   |   |   |
    +-------------------+   |   | _StackSmall
    |                   |   |   |
    +-------------------+   |  ---
    |                   |   |
    +-------------------+   |  _StackGuard
    |                   |   |
    +-------------------+  <-- _g_.stack.lo
低地址
```

## 执行栈初始化

执行栈可以在函数执行完毕后，专门被垃圾回收整个回收掉，从而将它们单独管理起来能够利于垃圾回收器的统一回收：

```go
// 具有可用栈的 span 的全局池
// 每个栈均根据其大小会被分配一个 order = log_2(size/FixedStack)
// 每个 order 都包含一个可用 mspan 链表
var stackpool [_NumStackOrders]struct {
	item stackpoolItem
	_    [cpu.CacheLinePadSize - unsafe.Sizeof(stackpoolItem{})%cpu.CacheLinePadSize]byte
}
//go:notinheap
type stackpoolItem struct {
	mu   mutex
	span mSpanList
}


var stackLarge struct {
	lock mutex
	free [heapAddrBits - pageShift]mSpanList // 按 log_2(s.npages) 阶组成的多个链表
}
```

`stackpool/stackLarge` 均为全局变量，他们均为 `mspan` 的双向链表，他们的初始化逻辑非常简单，
既将整个链表初始化为空链，不分配节点：

```go
//go:notinheap
type mSpanList struct { // 不带头结点的 mspan 双向链表
	first *mspan
	last  *mspan
}

func (list *mSpanList) init() {
	list.first = nil
	list.last = nil
}
```

`stackpool` 和 `stackLarge` 的初始化仅仅就是讲这两个链表中不同阶的 mspan 链表进行初始化：

```go
func stackinit() {
	(...)
	for i := range stackpool {
		stackpool[i].item.span.init()
	}
	for i := range stackLarge.free {
		stackLarge.free[i].init()
	}
}
```

## G 的创生

一个 goroutine 的创建通过 `newproc` 来完成，在调用这个函数之前，goroutine 还尚未存在，
只有一个入口地址及参数的大小，我们通过下面的例子来理解：

```go
package main

func hello(msg string) {
	println(msg)
}

func main() {
	go hello("hello world") // 7-8 行
}
```

其编译后的形式为：

```asm
TEXT main.main(SB) main.go
  main.go:7		0x104df70		65488b0c2530000000	MOVQ GS:0x30, CX
  (...)
  main.go:8		0x104df8d		488d055ed10100		LEAQ go.string.*+1874(SB), AX
  main.go:8		0x104df94		4889442410		MOVQ AX, 0x10(SP)
  main.go:8		0x104df99		48c74424180b000000	MOVQ $0xb, 0x18(SP)
  main.go:8		0x104dfa2		c7042410000000		MOVL $0x10, 0(SP)
  main.go:8		0x104dfa9		488d05b80c0200		LEAQ go.func.*+67(SB), AX
  main.go:8		0x104dfb0		4889442408		MOVQ AX, 0x8(SP)
  main.go:8		0x104dfb5		e876cefdff		CALL runtime.newproc(SB)
  (...)
```

具体的传参过程：

```asm
LEAQ go.string.*+1874(SB), AX // 将 "hello world" 的地址给 AX
MOVQ AX, 0x10(SP)             // 将 AX 的值放到 0x10
MOVL $0x10, 0(SP)             // 将最后一个参数的位置存到栈顶 0x00
LEAQ go.func.*+67(SB), AX     // 将 go 语句调用的函数入口地址给 AX
MOVQ AX, 0x8(SP)              // 将 AX 存入 0x08
CALL runtime.newproc(SB)      // 调用 newproc
```

这个过程里我们基本上可以看到栈是这样排布的：

```
             栈布局
      |                 |       高地址
      |                 |
      +-----------------+ 
      | &"hello world"  |
0x10  +-----------------+ <-- fn + sys.PtrSize
      |      hello      |
0x08  +-----------------+ <-- fn
      |       siz       |
0x00  +-----------------+ <-- SP
      |    newproc PC   |  
      +-----------------+ callerpc: 要运行的 goroutine 的 PC
      |                 |
      |                 |       低地址
```

```go
func newproc(siz int32, fn *funcval) {
	// 从 fn 的地址增加一个指针的长度，从而获取第一参数地址
	argp := add(unsafe.Pointer(&fn), sys.PtrSize)
	gp := getg()
	// 获取调用方 PC/IP 寄存器值
	pc := getcallerpc()

	// 用 g0 系统栈创建 goroutine 对象
	// 传递的参数包括 fn 函数入口地址, argp 参数起始地址, siz 参数长度, gp（g0），调用方 pc（goroutine）
	systemstack(func() {
		newproc1(fn, (*uint8)(argp), siz, gp, pc)
	})
}
```

当调用 `newproc1` ，会尝试获取一个已经分配好的 g，否则会直接进入创建：

```go
func newproc1(fn *funcval, argp *uint8, narg int32, callergp *g, callerpc uintptr) {
	(...)
	newg := gfget(_p_) // 根据 p 获得一个新的 g

	// 初始化阶段，gfget 是不可能找到 g 的
	// 也可能运行中本来就已经耗尽了
	if newg == nil {
		newg = malg(_StackMin)		 // 创建一个拥有 _StackMin 大小的栈的 g
		casgstatus(newg, _Gidle, _Gdead) // 将新创建的 g 从 _Gidle 更新为 _Gdead 状态
		allgadd(newg) // 将 Gdead 状态的 g 添加到 allg，这样 GC 不会扫描未初始化的栈
	}
	(...)
}
```

从而通过 `malg` 分配一个具有最小栈的 goroutine：

```go
// 分配一个新的 g 结构, 包含一个 stacksize 字节的的栈
func malg(stacksize int32) *g {
	newg := new(g)
	if stacksize >= 0 {
		// 将 stacksize 舍入为 2 的指数，目的是为了消除 _StackSystem 对栈的影响
		// 在 Linux/Darwin 上（ _StackSystem == 0 ）本行不改变 stacksize 的大小
		stacksize = round2(_StackSystem + stacksize)

		systemstack(func() {
			newg.stack = stackalloc(uint32(stacksize))
		})
		newg.stackguard0 = newg.stack.lo + _StackGuard
		newg.stackguard1 = ^uintptr(0)
	}
	return newg
}
```

`stackguard0` 不出所料的被设置为了 `stack.lo + _StackGuard`，而 `stackguard0` 则为 `~0`。
而执行栈本身是通过 `stackalloc` 来进行分配。

## 执行栈的分配

前面已经提到栈可能从两个不同的位置被分配：小栈和大栈。小栈指大小为 2K/4K/8K/16K 的栈，大栈则是更大的栈。
`stackalloc` 基本上也就是在权衡应该从哪里分配出一个执行栈，返回所在栈的低位和高位。
当然，高低位的确立很简单，因为我们已经知道了需要栈的大小，那么只需要知道分配好的栈的起始位置在哪儿就够了，
即指针 `v`：

```go
//go:systemstack
func stackalloc(n uint32) stack {
	thisg := getg()
	(...)

	// 小栈由自由表分配器分配有固定大小。
	// 如果我们需要更大尺寸的栈，我们将重新分配专用 span。
	var v unsafe.Pointer
	// 检查是否从缓存分配
	if n < _FixedStack<<_NumStackOrders && n < _StackCacheSize {
		(...) // 小栈分配
	} else {
		(...) // 大栈分配
	}

	(...)
	return stack{uintptr(v), uintptr(v) + uintptr(n)}
}
```

### 小栈分配

对于大小较小的栈可以从 stackpool 或者 stackcache 中进行分配，这取决于
当产生栈分配时，goroutine 所在的 m 是否具有 mcache （`m.mcache`）或者是否发生抢占（`m.preemptoff`）：

```go
// 计算对应的 mSpanList
order := uint8(0)
n2 := n
for n2 > _FixedStack {
	order++
	n2 >>= 1
}
var x gclinkptr
c := thisg.m.mcache

// 决定是否从 stackpool 中分配
if c == nil || thisg.m.preemptoff != "" {
	// c == nil 可能发生在 exitsyscall 或 procresize 时
	lock(&stackpool[order].item.mu)
	x = stackpoolalloc(order)
	unlock(&stackpool[order].item.mu)
} else { // 从对应链表提取可复用的空间
	x = c.stackcache[order].list
	if x.ptr() == nil { // 提取失败，扩容再重试
		stackcacherefill(c, order)
		x = c.stackcache[order].list
	}
	c.stackcache[order].list = x.ptr().next
	c.stackcache[order].size -= uintptr(n)
}
v = unsafe.Pointer(x) // 最终取得 stack
```

如果没他们都有缓存，则向内部填充更多的缓存：

```go
//go:systemstack
func stackcacherefill(c *mcache, order uint8) {
	(...)

	// 从全局缓存中获取一些 stack
	// 获取所允许的容量的一半来防止 thrashing
	var list gclinkptr
	var size uintptr
	lock(&stackpool[order].item.mu)
	for size < _StackCacheSize/2 {
		x := stackpoolalloc(order)
		x.ptr().next = list
		list = x
		size += _FixedStack << order
	}
	unlock(&stackpool[order].item.mu)
	c.stackcache[order].list = list
	c.stackcache[order].size = size
}
```

最终落实到 `stackpoolalloc` 上：

```go
// 从空闲池中分配一个栈，必须在持有 stackpool[order].item.mu 下调用
func stackpoolalloc(order uint8) gclinkptr {
	list := &stackpool[order].item.span
	s := list.first // 链表头
	if s == nil {
		// 缓存已空，从 mheap 上进行分配
		s = mheap_.allocManual(_StackCacheSize>>_PageShift, &memstats.stacks_inuse)
		(...)
		s.elemsize = _FixedStack << order
		for i := uintptr(0); i < _StackCacheSize; i += s.elemsize {
			x := gclinkptr(s.base() + i)
			x.ptr().next = s.manualFreeList
			s.manualFreeList = x
		}
		list.insert(s)
	}
	x := s.manualFreeList
	(...)
	s.manualFreeList = x.ptr().next
	s.allocCount++
	if s.manualFreeList.ptr() == nil {
		// s 中所有的栈都被分配了
		list.remove(s)
	}
	return x
}
```

### 大栈分配

大空间从 `stackLarge` 进行分配：

```go
var s *mspan
npage := uintptr(n) >> _PageShift
log2npage := stacklog2(npage)

// 尝试从 stackLarge 缓存中获取堆栈。
lock(&stackLarge.lock)
if !stackLarge.free[log2npage].isEmpty() {
	s = stackLarge.free[log2npage].first
	stackLarge.free[log2npage].remove(s)
}
unlock(&stackLarge.lock)

if s == nil { // 如果无法从缓存中获取，则从堆中分配一个新的栈
	s = mheap_.allocManual(npage, &memstats.stacks_inuse)
	(...)
	s.elemsize = uintptr(n)
}
v = unsafe.Pointer(s.base())
```

### 堆上分配

无论是小栈分配还是大栈的分配，在分配失败时都会从 `mheap` 上分配重新分配新的缓存，使用 `allocManual`：

```go
//go:systemstack
func (h *mheap) allocManual(npage uintptr, stat *uint64) *mspan {
	lock(&h.lock)
	s := h.allocSpanLocked(npage, stat)
	if s != nil {
		s.state = mSpanManual
		s.manualFreeList = 0
		s.allocCount = 0
		s.spanclass = 0
		s.nelems = 0
		s.elemsize = 0
		s.limit = s.base() + s.npages<<_PageShift
		(...)
	}

	// This unlock acts as a release barrier. See mheap.alloc_m.
	unlock(&h.lock)

	return s
}
```

其中的 `allocSpanLocked`：

```go
func (h *mheap) allocSpanLocked(npage uintptr, stat *uint64) *mspan {
	t := h.free.find(npage) // 第一次从 mheap 的缓存中寻找
	if t.valid() {
		goto HaveSpan
	}
	if !h.grow(npage) { // 第一次没找到，尝试对堆进行扩充
		return nil
	}
	t = h.free.find(npage) // 第二次从 mheap 缓存中寻找
	if t.valid() {
		goto HaveSpan
	}
	throw("grew heap, but no adequate free span found")

HaveSpan:
	s := t.span()
	(...)
	return s
}
```


## 执行栈的伸缩

早年的 Go 运行时使用**分段栈**的机制，即当一个 goroutine 的执行栈溢出时，
栈的扩张操作是在另一个栈上进行的，这两个栈彼此没有连续。
这种设计的缺陷很容易破坏缓存的局部性原理，从而降低程序的运行时性能。
因此现在 Go 运行时开始使用**连续栈**机制，当一个执行栈发生溢出时，
新建一个两倍于原栈大小的新栈，再将原栈整个拷贝到新栈上。
从而整个栈总是连续的。栈的拷贝并非想象中的那样简单，因为一个栈上可能保留指向被拷贝栈的指针，
从而当栈发生拷贝后，这个指针可能还指向原栈，从而造成错误。
此外，goroutine 上原本的 `gobuf` 也需要被更新，这也是使用连续栈的难点之一。

### 分段标记

分段标记是编译器的机制，涉及栈帧大小的计算。这个过程比较复杂，我们暂时假设编译器已经计算好了栈帧的大小，
这时，编译的预处理阶段，会为没有标记为 `go:nosplit` 的函数插入栈的分段检查：

```go
// cmd/internal/obj/x86/obj6.go
func preprocess(ctxt *obj.Link, cursym *obj.LSym, newprog obj.ProgAlloc) {
	(...)
	p := cursym.Func.Text
	autoffset := int32(p.To.Offset) // 栈帧大小
	// 一些额外的栈帧大小计算
	(...)
	if !cursym.Func.Text.From.Sym.NoSplit() {
		p = stacksplit(ctxt, cursym, p, newprog, autoffset, int32(textarg)) // 触发分段检查
	}
	(...)
}
```

与处理阶段将栈帧大小传入 `stacksplit`，用于针对不同大小的栈进行不同的分段检查，
具体的代码相当繁琐，这里直接给出的是汇编的伪代码：

```go
func stacksplit(ctxt *obj.Link, cursym *obj.LSym, p *obj.Prog, newprog obj.ProgAlloc, framesize int32, textarg int32) *obj.Prog {
	(...)

	var q1 *obj.Prog
	if framesize <= objabi.StackSmall {
		// 小栈: SP <= stackguard，直接比较 SP 和 stackguard
		//	CMPQ SP, stackguard
		(...)
	} else if framesize <= objabi.StackBig {
		// 大栈: SP-framesize <= stackguard-StackSmall
		//	LEAQ -xxx(SP), AX
		//	CMPQ AX, stackguard
		(...)
	} else {
		// 更大的栈需要防止 wraparound
		// 如果 SP 接近于零:
		//	SP-stackguard+StackGuard <= framesize + (StackGuard-StackSmall)
		// 两端的 +StackGuard 是为了保证左侧大于零。
		// SP 允许位于 stackguard 下面一点点
		//
		// 抢占设置了 stackguard 为 StackPreempt，一个大到能够打破上面的数学计算的值，
		// 因此必须显式的进行检查：
		//	MOVQ	stackguard, CX
		//	CMPQ	CX, $StackPreempt
		//	JEQ	label-of-call-to-morestack
		//	LEAQ	StackGuard(SP), AX
		//	SUBQ	CX, AX
		//	CMPQ	AX, $(framesize+(StackGuard-StackSmall))
		(...)
	}

	(...)
	// 函数的尾声
	morestack := "runtime.morestack"
	switch {
	case cursym.CFunc():
		morestack = "runtime.morestackc" // morestackc 会 panic，因为此时是系统栈上的 C 函数
	case !cursym.Func.Text.From.Sym.NeedCtxt():
		morestack = "runtime.morestack_noctxt"
	}
	call.To.Sym = ctxt.Lookup(morestack)
	(...)

	return jls
}
```

总而言之，没有被 `go:nosplit` 标记的函数的序言部分会插入分段检查，从而在发生栈溢出的情况下，
触发 `runtime.morestack` 调用，如果函数不需要 `ctxt`，则会调用 `runtime.morestack_noctxt`
从而抛弃 `ctxt` 再调用 `morestack`：

<!-- TODO: what is ctxt? -->

```asm
TEXT runtime·morestack_noctxt(SB),NOSPLIT,$0
	MOVL	$0, DX
	JMP	runtime·morestack(SB)
```

### 栈的扩张

用户栈的扩张发生在 morestack 处，该函数此前会检查该调用是否正确的在用户栈上调用（因此 g0 栈和信号栈
不能发生此调用）。而后将 `morebuf` 设置为 f 的调用方，并将 G 的执行栈设置为 f 的 ctxt，
从而在 g0 上调用 `newstack`。

```asm
TEXT runtime·morestack(SB),NOSPLIT,$0-0
	// 无法增长调度器的栈(m->g0)
	get_tls(CX)
	MOVQ	g(CX), BX
	MOVQ	g_m(BX), BX
	MOVQ	m_g0(BX), SI
	CMPQ	g(CX), SI
	JNE	3(PC)
	CALL	runtime·badmorestackg0(SB)
	CALL	runtime·abort(SB)

	// 无法增长信号栈 (m->gsignal)
	MOVQ	m_gsignal(BX), SI
	CMPQ	g(CX), SI
	JNE	3(PC)
	CALL	runtime·badmorestackgsignal(SB)
	CALL	runtime·abort(SB)

	// 从 f 调用
	// 将 m->morebuf 设置为 f 的调用方
	MOVQ	8(SP), AX	// f 的调用方 PC
	MOVQ	AX, (m_morebuf+gobuf_pc)(BX)
	LEAQ	16(SP), AX	// f 的调用方 SP
	MOVQ	AX, (m_morebuf+gobuf_sp)(BX)
	get_tls(CX)
	MOVQ	g(CX), SI
	MOVQ	SI, (m_morebuf+gobuf_g)(BX)

	// 将 g->sched 设置为 f 的 context
	MOVQ	0(SP), AX // f 的 PC
	MOVQ	AX, (g_sched+gobuf_pc)(SI)
	MOVQ	SI, (g_sched+gobuf_g)(SI)
	LEAQ	8(SP), AX // f 的 SP
	MOVQ	AX, (g_sched+gobuf_sp)(SI)
	MOVQ	BP, (g_sched+gobuf_bp)(SI)
	MOVQ	DX, (g_sched+gobuf_ctxt)(SI)

	// 在 m->g0 栈上调用 newstack.
	MOVQ	m_g0(BX), BX
	MOVQ	BX, g(CX)
	MOVQ	(g_sched+gobuf_sp)(BX), SP
	CALL	runtime·newstack(SB)
	CALL	runtime·abort(SB)	// 如果 newstack 返回则崩溃
	RET
```

`newstack` 在前半部分承担了对 goroutine 进行抢占的任务（见 [6.7 协作与抢占](./preemption.md)），
而在后半部分则是真正的栈扩张。

```go
//go:nowritebarrierrec
func newstack() {
	thisg := getg()

	(...)

	gp := thisg.m.curg

	(...)

	morebuf := thisg.m.morebuf
	thisg.m.morebuf.pc = 0
	thisg.m.morebuf.lr = 0
	thisg.m.morebuf.sp = 0
	thisg.m.morebuf.g = 0

	(...)

	sp := gp.sched.sp
	if sys.ArchFamily == sys.AMD64 || sys.ArchFamily == sys.I386 || sys.ArchFamily == sys.WASM {
		// 到 morestack 的调用会消耗一个字
		sp -= sys.PtrSize
	}

	(...)

	// 分配一个更大的段，并对栈进行移动
	oldsize := gp.stack.hi - gp.stack.lo
	newsize := oldsize * 2 // 两倍于原来的大小

	// 需要的栈太大，直接溢出
	if newsize > maxstacksize {
		print("runtime: goroutine stack exceeds ", maxstacksize, "-byte limit\n")
		throw("stack overflow")
	}

	// goroutine 必须是正在执行过程中才来调用 newstack
	// 所以这个状态一定是 Grunning 或 Gscanrunning
	casgstatus(gp, _Grunning, _Gcopystack)

	// 因为 gp 处于 Gcopystack 状态，当我们对栈进行复制时并发 GC 不会扫描此栈
	copystack(gp, newsize, true)
	(...)
	casgstatus(gp, _Gcopystack, _Grunning)
	gogo(&gp.sched) // 继续执行
}
```

### 栈的拷贝

前面我们已经提到了，栈拷贝的其中一个难点就是 Go 中栈上的变量会包含自己的地址，
当我们拷贝了一个指向原栈的指针时，拷贝后的指针会变为无效指针。
不难发现，只有栈上分配的指针才能指向栈上的地址，否则这个指针指向的对象会重新在堆中进行分配（逃逸）。

```go
func copystack(gp *g, newsize uintptr, sync bool) {
	(...)
	old := gp.stack
	(...)
	used := old.hi - gp.sched.sp

	// 分配新的栈
	new := stackalloc(uint32(newsize))
	if stackPoisonCopy != 0 {
		fillstack(new, 0xfd)
	}
	(...)

	// 计算调整的幅度
	var adjinfo adjustinfo
	adjinfo.old = old
	adjinfo.delta = new.hi - old.hi

	// 调整 sudogs, 必要时与 channel 操作同步
	ncopy := used
	if sync {
		adjustsudogs(gp, &adjinfo)
	} else {
		// sudogs can point in to the stack. During concurrent
		// shrinking, these areas may be written to. Find the
		// highest such pointer so we can handle everything
		// there and below carefully. (This shouldn't be far
		// from the bottom of the stack, so there's little
		// cost in handling everything below it carefully.)
		adjinfo.sghi = findsghi(gp, old)

		// Synchronize with channel ops and copy the part of
		// the stack they may interact with.
		ncopy -= syncadjustsudogs(gp, used, &adjinfo)
	}

	// 将原来的栈的内容复制到新的位置
	memmove(unsafe.Pointer(new.hi-ncopy), unsafe.Pointer(old.hi-ncopy), ncopy)

	// Adjust remaining structures that have pointers into stacks.
	// We have to do most of these before we traceback the new
	// stack because gentraceback uses them.
	adjustctxt(gp, &adjinfo)
	adjustdefers(gp, &adjinfo)
	adjustpanics(gp, &adjinfo)
	if adjinfo.sghi != 0 {
		adjinfo.sghi += adjinfo.delta
	}

	// 为新栈置换出旧栈
	gp.stack = new
	gp.stackguard0 = new.lo + _StackGuard // 注意: 可能覆盖（clobber）一个抢占请求
	gp.sched.sp = new.hi - used
	gp.stktopsp += adjinfo.delta

	// 在新栈重调整指针
	gentraceback(^uintptr(0), ^uintptr(0), 0, gp, 0, nil, 0x7fffffff, adjustframe, noescape(unsafe.Pointer(&adjinfo)), 0)

	// 释放旧栈
	if stackPoisonCopy != 0 {
		fillstack(old, 0xfc)
	}
	stackfree(old)
}

func fillstack(stk stack, b byte) {
	for p := stk.lo; p < stk.hi; p++ {
		*(*byte)(unsafe.Pointer(p)) = b
	}
}
func findsghi(gp *g, stk stack) uintptr {
	var sghi uintptr
	for sg := gp.waiting; sg != nil; sg = sg.waitlink {
		p := uintptr(sg.elem) + uintptr(sg.c.elemsize)
		if stk.lo <= p && p < stk.hi && p > sghi {
			sghi = p
		}
	}
	return sghi
}
func syncadjustsudogs(gp *g, used uintptr, adjinfo *adjustinfo) uintptr {
	if gp.waiting == nil {
		return 0
	}

	// Lock channels to prevent concurrent send/receive.
	// It's important that we *only* do this for async
	// copystack; otherwise, gp may be in the middle of
	// putting itself on wait queues and this would
	// self-deadlock.
	var lastc *hchan
	for sg := gp.waiting; sg != nil; sg = sg.waitlink {
		if sg.c != lastc {
			lock(&sg.c.lock)
		}
		lastc = sg.c
	}

	// Adjust sudogs.
	adjustsudogs(gp, adjinfo)

	// Copy the part of the stack the sudogs point in to
	// while holding the lock to prevent races on
	// send/receive slots.
	var sgsize uintptr
	if adjinfo.sghi != 0 {
		oldBot := adjinfo.old.hi - used
		newBot := oldBot + adjinfo.delta
		sgsize = adjinfo.sghi - oldBot
		memmove(unsafe.Pointer(newBot), unsafe.Pointer(oldBot), sgsize)
	}

	// Unlock channels.
	lastc = nil
	for sg := gp.waiting; sg != nil; sg = sg.waitlink {
		if sg.c != lastc {
			unlock(&sg.c.lock)
		}
		lastc = sg.c
	}

	return sgsize
}
```

### 栈的收缩

栈的收缩发生在 GC 时对栈进行扫描的阶段：

```go
//go:nowritebarrier
//go:systemstack
func scanstack(gp *g, gcw *gcWork) {
	(...)
	// _Grunnable, _Gsyscall, _Gwaiting 才会发生

	// 如果栈使用不多，则进行栈收缩
	shrinkstack(gp)
	(...)
}

func shrinkstack(gp *g) {
	(...)

	oldsize := gp.stack.hi - gp.stack.lo
	newsize := oldsize / 2
	// 当收缩后的大小小于最小的栈的大小时，不再进行搜索
	if newsize < _FixedStack {
		return
	}
	// 计算当前正在使用的栈数量，如果 gp 使用的当前栈少于四分之一，则对栈进行收缩。
	// 当前使用的栈包括到 SP 的所有内容以及栈保护空间，以确保有 nosplit 功能的空间。
	avail := gp.stack.hi - gp.stack.lo
	if used := gp.stack.hi - gp.sched.sp + _StackLimit; used >= avail/4 {
		return
	}

	// 在系统调用期间无法对栈进行拷贝
	// 因为系统调用可能包含指向栈的指针
	if gp.syscallsp != 0 {
		return
	}
	if sys.GoosWindows != 0 && gp.m != nil && gp.m.libcallsp != 0 {
		return
	}

	(...)

	// 将旧栈拷贝到新收缩后的栈上
	copystack(gp, newsize, false)
}
```

可以看到，如果一个栈仅被使用了四分之一，则会出发栈的收缩，收缩后的大小是原来栈大小的一半。

## 小结

TODO:

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
