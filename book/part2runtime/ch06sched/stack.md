# 调度器: goroutine 及其执行栈管理

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

TODO: gobuf & stack consts

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

## 初始化

执行栈可以在函数执行完毕后，专门被垃圾回收整个回收掉，从而将它们单独管理起来能够利于垃圾回收器的编写：

```go
// 具有可用栈的 span 的全局池
// _NumStackOrders == 4, 分别对应 2K/4K/8K/16K 大小的小栈
var stackpool [_NumStackOrders]mSpanList
var stackpoolmu mutex

// 大栈直接分配 span 全局池
var stackLarge struct {
	lock mutex
	free [heapAddrBits - pageShift]mSpanList // free lists by log_2(s.npages)
}
```

`stackpool/stackLarge` 均为全局变量，他们均为 `mspan` 的双向链表
（参见 [内存分配器：基础](../../part2runtime/ch07alloc/basic.md)）他们的初始化逻辑非常简单，
既将整个链表初始化为空链，不分配节点：

```go
// 初始化栈空间复用管理链表
func stackinit() {
	(...)
	for i := range stackpool {
		stackpool[i].init()
	}
	for i := range stackLarge.free {
		stackLarge.free[i].init()
	}
}

// 初始化空双向链表
func (list *mSpanList) init() {
	list.first = nil
	list.last = nil
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
	go hello("hello world")
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
	// 根据 p 获得一个新的 g
	newg := gfget(_p_)

	// 初始化阶段，gfget 是不可能找到 g 的
	// 也可能运行中本来就已经耗尽了
	if newg == nil {
		// 创建一个拥有 _StackMin 大小的栈的 g
		newg = malg(_StackMin)
		// 将新创建的 g 从 _Gidle 更新为 _Gdead 状态
		casgstatus(newg, _Gidle, _Gdead)
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

## 分配

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
if stackNoCache != 0 || c == nil || thisg.m.preemptoff != "" {
	// c == nil 可能发生在 exitsyscall 或 procresize 的内部。
	// 只需从全局池中获取一个堆栈。在 gc 期间也不要接触 stackcache，因为它会并发的 flush。
	lock(&stackpoolmu)
	x = stackpoolalloc(order)
	unlock(&stackpoolmu)
} else {
	// 从对应链表提取可复用的空间
	x = c.stackcache[order].list
	// 提取失败，扩容再重试
	if x.ptr() == nil {
		stackcacherefill(c, order)
		x = c.stackcache[order].list
	}
	c.stackcache[order].list = x.ptr().next
	c.stackcache[order].size -= uintptr(n)
}
v = unsafe.Pointer(x)
```

如果没有缓存，则将其填充：

```go
//go:systemstack
func stackcacherefill(c *mcache, order uint8) {
	if stackDebug >= 1 {
		print("stackcacherefill order=", order, "\n")
	}

	// Grab some stacks from the global cache.
	// Grab half of the allowed capacity (to prevent thrashing).
	var list gclinkptr
	var size uintptr
	lock(&stackpoolmu)
	for size < _StackCacheSize/2 {
		x := stackpoolalloc(order)
		x.ptr().next = list
		list = x
		size += _FixedStack << order
	}
	unlock(&stackpoolmu)
	c.stackcache[order].list = list
	c.stackcache[order].size = size
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

if s == nil {
	// 从堆中分配一个新的栈
	s = mheap_.allocManual(npage, &memstats.stacks_inuse)
	if s == nil {
		throw("out of memory")
	}
	osStackAlloc(s)
	s.elemsize = uintptr(n)
}
v = unsafe.Pointer(s.base())
```

TODO: alloc

## 连续栈

早年的 Go 运行时使用分段栈的机制，即当一个 goroutine 的执行栈溢出时，栈的扩张操作是在另一个栈上进行的，这两个栈彼此没有连续。
这种设计的缺陷很容易破坏缓存的局部性原理，从而降低程序的运行时性能。
因此现在 Go 运行时开始使用连续栈机制，当一个执行栈发生溢出时，新建一个两倍于原栈大小的新栈，再将原栈整个拷贝到新栈上。
从而整个栈总是连续的。栈的拷贝并非想象中的那样简单，因为一个栈上可能保留指向被拷贝栈的指针，从而当栈发生拷贝后，这个指针可能还指向原栈，从而造成错误。
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

## 栈的扩张

TODO:

```asm
TEXT runtime·morestack(SB),NOSPLIT,$0-0
	// Cannot grow scheduler stack (m->g0).
	get_tls(CX)
	MOVQ	g(CX), BX
	MOVQ	g_m(BX), BX
	MOVQ	m_g0(BX), SI
	CMPQ	g(CX), SI
	JNE	3(PC)
	CALL	runtime·badmorestackg0(SB)
	CALL	runtime·abort(SB)

	// Cannot grow signal stack (m->gsignal).
	MOVQ	m_gsignal(BX), SI
	CMPQ	g(CX), SI
	JNE	3(PC)
	CALL	runtime·badmorestackgsignal(SB)
	CALL	runtime·abort(SB)

	// Called from f.
	// Set m->morebuf to f's caller.
	MOVQ	8(SP), AX	// f's caller's PC
	MOVQ	AX, (m_morebuf+gobuf_pc)(BX)
	LEAQ	16(SP), AX	// f's caller's SP
	MOVQ	AX, (m_morebuf+gobuf_sp)(BX)
	get_tls(CX)
	MOVQ	g(CX), SI
	MOVQ	SI, (m_morebuf+gobuf_g)(BX)

	// Set g->sched to context in f.
	MOVQ	0(SP), AX // f's PC
	MOVQ	AX, (g_sched+gobuf_pc)(SI)
	MOVQ	SI, (g_sched+gobuf_g)(SI)
	LEAQ	8(SP), AX // f's SP
	MOVQ	AX, (g_sched+gobuf_sp)(SI)
	MOVQ	BP, (g_sched+gobuf_bp)(SI)
	MOVQ	DX, (g_sched+gobuf_ctxt)(SI)

	// Call newstack on m->g0's stack.
	MOVQ	m_g0(BX), BX
	MOVQ	BX, g(CX)
	MOVQ	(g_sched+gobuf_sp)(BX), SP
	CALL	runtime·newstack(SB)
	CALL	runtime·abort(SB)	// crash if newstack returns
	RET
```

## 栈的伸缩

TODO:

## 总结

TODO:

[返回目录](./readme.md) | [上一节](./signal.md) | [下一节 协作与抢占](./preemptive.md)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
