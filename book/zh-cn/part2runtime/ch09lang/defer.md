---
weight: 2402
title: "9.2 延迟语句"
---

# 9.2 延迟语句

[TOC]

延迟语句 `defer` 在最早期的 Go 语言设计中并不存在，后来才单独增加了这一特性，
由 Robert Griesemer 完成语言规范的编写，并由 Ken Thompson 完成最早期的实现，
两人合作完成这一语言特性。

defer 的语义表明，它会在函数返回、产生恐慌或者 `runtime.Goexit` 时被调用。直觉上看，
defer 应该由编译器直接将需要的函数调用插入到该调用的地方，似乎是一个编译期特性，
不应该存在运行时性能问题，非常类似于 C++ 的 RAII 范式（当离开资源的作用域时，
自动执行析构函数）。
但实际情况是，由于 defer 并没有与其依赖资源挂钩，也允许在条件、循环语句中出现，
这就是使得 defer 的语义变得相对复杂，无法在编译期决定存在多少个 defer 调用，例如：

```go
func randomDefers() {
	rand.Seed(time.Now().UnixNano())
	for rand.Intn(100) > 42 {
		defer func() {
			println("changkun/go-under-the-hood")
		}()
	}
}
```

因而 defer 并不是免费的午餐，在一个复杂的调用中，当无法直接确定需要的产生的延迟调用的数量时，
延迟语句将产生运行时性能问题。本节我们来讨论 defer 的实现本质及其对症下药的相关性能优化手段。

## 9.2.1 defer 的类型

延迟语句的文法产生式 `DeferStmt -> "defer" Expression` 非常的简单，
很容易将其处理为语法树的形式，但我们这里更关心的其实是它语义背后的中间和目标代码的形式。

我们已经知道，在进行中间代码生成、SSA 处理阶段时，Go 语言的语句在 `buildssa` 时，
会由 `state.stmt` 函数完成 SSA 处理。

```go
// src/cmd/compile/internal/gc/ssa.go
func buildssa(fn *Node, worker int) *ssa.Func {
	var s state
	...
	s.stmtList(fn.Nbody)
	...
}
func (s *state) stmtList(l Nodes) {
	for _, n := range l.Slice() {
		s.stmt(n)
	}
}
```

对于 defer 而言，编译器会产生三种不同的 defer 形式，一种是普通在**堆上分配**的 `callDefer`，
第二种是在**栈上分配**的 `callDeferStack`，最后一种则是**开放编码式（Open-coded）defer**。

```go
// src/cmd/compile/internal/gc/ssa.go
func (s *state) stmt(n *Node) {
	...
	switch n.Op {
	case ODEFER:
		// 开放编码式 defer
		if s.hasOpenDefers {
			s.openDeferRecord(n.Left)
		} else {
			// 堆上分配的 defer
			d := callDefer
			if n.Esc == EscNever {
				// 栈上分配的 defer
				d = callDeferStack
			}
			s.call(n.Left, d)
		}
	case ...
	}
	...
}
```

## 9.2.2 在堆上分配的 defer

我们先来讨论最简单的在堆上分配的 defer 这种形式。在堆上分配的原因可以是由于参数的逃逸，
或者无法执行编译器优化导致的。如果一个与 defer 相关的参数会逃逸到堆上，
则会尝试在堆上分配；如果一个 defer 不能被编译器采用开放编码优化（之后会提到），
则也会在堆上分配 defer。总之，在堆上分配的 defer 产生的运行时开销最大。

### 编译阶段

为了使延迟语句的功能符合语言规范，该语句在编译的 SSA 阶段会被翻译为两个主体，
其中第一个主体是被延迟的函数本身，另一个主体则是函数结束时需要执行所记录 defer 的代码块：

```go
// src/cmd/compile/internal/gc/ssa.go
func (s *state) call(n *Node, k callKind) *ssa.Value {
	...
	var call *ssa.Value
	if k == callDeferStack {
		// 在栈上创建 defer 结构
		...
	} else {
		// 在堆上创建 defer
		argStart := Ctxt.FixedFrameSize()
		// Defer 参数
		if k != callNormal {
			// 记录 deferproc 的参数
			argsize := s.constInt32(types.Types[TUINT32], int32(stksize))
			addr := s.constOffPtrSP(s.f.Config.Types.UInt32Ptr, argStart)
			s.store(types.Types[TUINT32], addr, argsize)	// 保存参数大小 siz
			addr = s.constOffPtrSP(s.f.Config.Types.UintptrPtr, argStart+int64(Widthptr))
			s.store(types.Types[TUINTPTR], addr, closure)	// 保存函数地址 fn
			stksize += 2 * int64(Widthptr)
			argStart += 2 * int64(Widthptr)
		}
		...

		// 创建 deferproc 调用
		switch {
		case k == callDefer:
			call = s.newValue1A(ssa.OpStaticCall, types.TypeMem, deferproc, s.mem())
		...
		}
		...
	}
	...

	// 结束 defer 块
	if k == callDefer || k == callDeferStack {
		s.exit()
		...
	}
	...
}
```

并在函数帧的末尾插入函数的退出调用 `deferreturn`，并在在汇编代码生成时，
通过 `genssa` 调用早就初始化好的 `ssaGenBlock`，来最终生成 defer 的函数尾声：

```go
// src/cmd/compile/internal/gc/ssa.go
func (s *state) exit() *ssa.Block {
	if s.hasdefer {
		if s.hasOpenDefers {
			...
		} else {
			// 调用 deferreturn
			s.rtcall(Deferreturn, true, nil)
		}
	}
	...
}
// src/cmd/compile/internal/gc/ssa.go
func genssa(f *ssa.Func, pp *Progs) {
	var s SSAGenState
	...
	for i, b := range f.Blocks {
		...
		thearch.SSAGenBlock(&s, b, next) // 调用 ssaGenBlock
		...
	}
	...
}
// src/cmd/compile/internal/gc/ssa.go
func ssaGenBlock(s *gc.SSAGenState, b, next *ssa.Block) {
	switch b.Kind {
	case ssa.BlockDefer:
		p := s.Prog(x86.ATESTL) // TESTL
		p.From.Type = obj.TYPE_REG
		p.From.Reg = x86.REG_AX // AX
		p.To.Type = obj.TYPE_REG
		p.To.Reg = x86.REG_AX   // AX
		p = s.Prog(x86.AJNE)    // JNE
		p.To.Type = obj.TYPE_BRANCH
		s.Branches = append(s.Branches, gc.Branch{P: p, B: b.Succs[1].Block()})
		if b.Succs[0].Block() != next {
			p := s.Prog(obj.AJMP) // JMP
			p.To.Type = obj.TYPE_BRANCH
			s.Branches = append(s.Branches, gc.Branch{P: p, B: b.Succs[0].Block()})
		}
	case ...:
	}
}
```

注意，这里非常的巧妙，我们可能会疑惑为什么要用 TESTL 指令来判断 AX 的值？我们之后再谈。
<!-- 

		// 根据 TESTL AX, AX 判断 deferproc 或者 deferprocStack 的返回值：
		// 0 表示我们应该继续执行
		// 1 表示我们应该跳转到 deferreturn 调用

原因在于 `deferproc` 或者 `deferprocStack` 的返回值可能是 0 也可能是 1。
当返回 0 时，说明 defer 语句的记录被成功创建，返回值会记录在 AX 上：

```go
//go:nosplit
func deferproc(siz int32, fn *funcval) {
	...
	return0()
}
```

```asm
TEXT runtime·return0(SB), NOSPLIT, $0
	MOVL	$0, AX
	RET
```

而当发生 panic 时，AX 的值会记录为 1，从而会跳转到函数尾声，执行 `deferreturn`。 -->

### 运行阶段

一个函数中的延迟语句会被保存为一个 `_defer` 记录的链表，附着在一个 Goroutine 上。
`_defer` 记录的具体结构也非常简单，主要包含了参与调用的参数大小、
当前 defer 语句所在函数的 PC 和 SP 寄存器、被 defer 的函数的入口地址以及串联
多个 defer 的 link 链表，该链表指向下一个需要执行的 defer，如图 9.2.1 所示。

```go
// src/runtime/panic.go
type _defer struct {
	siz       int32
	heap      bool
	sp        uintptr
	pc        uintptr
	fn        *funcval
	link      *_defer
	...
}
// src/runtime/runtime2.go
type g struct {
	...
	_defer *_defer
	...
}
```

![](../../../assets/defer-link.png)

**图 9.2.1：附着在 Goroutine 上的 `_defer` 记录的链表**

现在我们知道，一个在堆上分配的延迟语句被编译为了 `runtime.deferproc`，用于记录被延迟的函数调用；
在函数的尾声，会插入 `runtime.deferreturn` 调用，用于执行被延迟的调用。

下面我们就来详细看看这两个调用具体发生了什么事情。

我们先看创建 defer 的第一种形式 `deferproc`。
这个调用很简单，仅仅只是将需要被 defer 调用的函数做了一次记录：

```go
//go:nosplit
func deferproc(siz int32, fn *funcval) {
	...
	sp := getcallersp()
	argp := uintptr(unsafe.Pointer(&fn)) + unsafe.Sizeof(fn)
	callerpc := getcallerpc()

	d := newdefer(siz)
	d.fn = fn
	d.pc = callerpc
	d.sp = sp
	switch siz {
	case 0: // 什么也不做
	case sys.PtrSize:
		*(*uintptr)(deferArgs(d)) = *(*uintptr)(unsafe.Pointer(argp))
	default:
		memmove(deferArgs(d), unsafe.Pointer(argp), uintptr(siz))
	}

	return0()
}
```

这段代码中，本质上只是在做一些简单参数处理，
比如 `fn` 保存了 `defer` 所调用函数的调用地址，`siz` 确定了其参数的大小。
并且通过 `newdefer` 来创建一个新的 `_defer` 实例，
然后由 `fn`、`callerpc` 和 `sp` 来保存调用该 defer 的 Goroutine 上下文。

注意，在这里我们看到了一个对参数进行拷贝的操作。这个操作也是我们在实践过程中经历过的，
defer 调用被记录时，并不会对参数进行求值，而是会对参数完成一次拷贝。
这么做原因在于，`defer` 可能会恢复 `panic`，进而导致 `fn` 的参数可能不安全。
<!-- TODO: 为什么？ -->

出于性能考虑，`newdefer` 通过 P 或者调度器 sched 上的的本地或全局 defer 池来
复用已经在堆上分配的内存。defer 的资源池会根据被延迟的调用所需的参数来决定 defer 记录
的大小等级，每 16 个字节分一个等级。此做法的动机与运行时内存分配器针对不同大小对象的分配思路雷同，
这里不再做深入讨论。

```go
// src/runtime/runtime2.go
type p struct {
	...
	// 不同大小的本地 defer 池
	deferpool    [5][]*_defer
	deferpoolbuf [5][32]*_defer
	...
}
type schedt struct {
	...
	// 不同大小的全局 defer 池
	deferlock mutex
	deferpool [5]*_defer
	...
}
```

对于新建的 `_defer` 实例而言，会将其加入到 Goroutine 所保留的 defer 链表上，
通过 `link` 字段串联。

```go
// src/runtime/panic.go

//go:nosplit
func newdefer(siz int32) *_defer {
	var d *_defer
	sc := deferclass(uintptr(siz))
	gp := getg()
	// 检查 defer 参数的大小是否从 p 的 deferpool 直接分配
	if sc < uintptr(len(p{}.deferpool)) {
		pp := gp.m.p.ptr()

		// 如果 p 本地无法分配，则从全局池中获取一半 defer，来填充 P 的本地资源池
		if len(pp.deferpool[sc]) == 0 && sched.deferpool[sc] != nil {
			// 出于性能考虑，如果发生栈的增长，则会调用 morestack，
			// 进一步降低 defer 的性能。因此切换到系统栈上执行，进而不会发生栈的增长。
			systemstack(func() {
				lock(&sched.deferlock)
				for len(pp.deferpool[sc]) < cap(pp.deferpool[sc])/2 && sched.deferpool[sc] != nil {
					d := sched.deferpool[sc]
					sched.deferpool[sc] = d.link
					d.link = nil
					pp.deferpool[sc] = append(pp.deferpool[sc], d)
				}
				unlock(&sched.deferlock)
			})
		}

		// 从 P 本地进行分配
		if n := len(pp.deferpool[sc]); n > 0 {
			d = pp.deferpool[sc][n-1]
			pp.deferpool[sc][n-1] = nil
			pp.deferpool[sc] = pp.deferpool[sc][:n-1]
		}
	}
	// 没有可用的缓存，直接从堆上分配新的 defer 和 args
	if d == nil {
		systemstack(func() {
			total := roundupsize(totaldefersize(uintptr(siz)))
			d = (*_defer)(mallocgc(total, deferType, true))
		})
	}
	// 将 _defer 实例添加到 goroutine 的 _defer 链表上。
	d.siz = siz
	d.heap = true
	d.link = gp._defer
	gp._defer = d
	return d
}
```

`deferreturn` 被编译器插入到函数末尾，当跳转到它时，会将需要被 defer 的入口地址取出，
然后跳转并执行：

```go
// src/runtime/panic.go

//go:nosplit
func deferreturn(arg0 uintptr) {
	gp := getg()
	d := gp._defer
	if d == nil {
		return
	}
	// 确定 defer 的调用方是不是当前 deferreturn 的调用方
	sp := getcallersp()
	if d.sp != sp {
		return
	}
	if d.openDefer {
		...
		return
	}

	// 移动参数
	switch d.siz {
	case 0: // 什么也不做
	case sys.PtrSize:
		*(*uintptr)(unsafe.Pointer(&arg0)) = *(*uintptr)(deferArgs(d))
	default:
		memmove(unsafe.Pointer(&arg0), deferArgs(d), uintptr(d.siz))
	}
	// 获得被延迟的调用 fn 的入口地址，并随后立即将 _defer 释放掉
	fn := d.fn
	d.fn = nil
	gp._defer = d.link
	freedefer(d)

	// 调用，并跳转到下一个 defer
	jmpdefer(fn, uintptr(unsafe.Pointer(&arg0)))
}
```

在这个函数中，会在需要时对 `defer` 的参数再次进行拷贝，多个 `defer` 函数以 `jmpdefer` 尾调用形式被实现。
在跳转到 `fn` 之前，`_defer` 实例被释放归还，`jmpdefer` 真正需要的仅仅只是函数的入口地址和参数，
以及它的调用方 `deferreturn` 的 SP：

```asm
// src/runtime/asm_amd64.s

// func jmpdefer(fv *funcval, argp uintptr)
TEXT runtime·jmpdefer(SB), NOSPLIT, $0-16
	MOVQ	fv+0(FP), DX	// DX = fn
	MOVQ	argp+8(FP), BX	// 调用方 SP
	LEAQ	-8(BX), SP		// CALL 后的调用方 SP
	MOVQ	-8(SP), BP		// 恢复 BP，好像 deferreturn 返回
	SUBQ	$5, (SP)		// 再次返回到 CALL
	MOVQ	0(DX), BX		// BX = DX
	JMP	BX					// 最后才运行被 defer 的函数
```

这个 `jmpdefer` 巧妙的地方在于，它通过调用方 SP 来推算了 `deferreturn` 的入口地址，
从而在完成某个 `defer` 调用后，由于被 defer 的函数返回时会出栈，
会再次回到 `deferreturn` 的初始位置，进而继续反复调用，形成好似尾递归的假象。

释放操作非常普通，只是简单的将其归还到 P 的 `deferpool` 中，
并在本地池已满时将其归还到全局资源池:

```go
// src/runtime/panic.go

//go:nosplit
func freedefer(d *_defer) {
	...
	sc := deferclass(uintptr(d.siz))
	if sc >= uintptr(len(p{}.deferpool)) {
		return
	}
	pp := getg().m.p.ptr()
	// 如果 P 本地池已满，则将一半资源放入全局池，同样也是出于性能考虑
	// 操作会切换到系统栈上执行。
	if len(pp.deferpool[sc]) == cap(pp.deferpool[sc]) {
		systemstack(func() {
			var first, last *_defer
			for len(pp.deferpool[sc]) > cap(pp.deferpool[sc])/2 {
				n := len(pp.deferpool[sc])
				d := pp.deferpool[sc][n-1]
				pp.deferpool[sc][n-1] = nil
				pp.deferpool[sc] = pp.deferpool[sc][:n-1]
				if first == nil {
					first = d
				} else {
					last.link = d
				}
				last = d
			}
			lock(&sched.deferlock)
			last.link = sched.deferpool[sc]
			sched.deferpool[sc] = first
			unlock(&sched.deferlock)
		})
	}

	// 恢复 _defer 的零值，即 *d = _defer{}
	d.siz = 0
	...
	d.sp = 0
	d.pc = 0
	d.framepc = 0
	...
	d.link = nil

	// 放入 P 本地资源池
	pp.deferpool[sc] = append(pp.deferpool[sc], d)
}
```

## 9.2.3 在栈上创建 defer

defer 还可以直接在栈上进行分配，也就是第二种记录 defer 的形式 `deferprocStack`。
在栈上分配 defer 的好处在于函数返回后 `_defer` 便已得到释放，
不再需要考虑内存分配时产生的性能开销，只需要适当的维护 `_defer` 的链表即可。

在 SSA 阶段与在堆上分配的区别在于，在栈上创建 defer，需要直接在函数调用帧上使用编译器来初始化
`_defer` 记录，并作为参数传递给 `deferprocStack`：

```go
// src/cmd/compile/internal/gc/ssa.go
func (s *state) call(n *Node, k callKind) *ssa.Value {
	...
	var call *ssa.Value
	if k == callDeferStack {
		// 直接在栈上创建 defer 记录
		t := deferstruct(stksize) // 从编译器角度构造 _defer 结构
		d := tempAt(n.Pos, s.curfn, t)

		s.vars[&memVar] = s.newValue1A(ssa.OpVarDef, types.TypeMem, d, s.mem())
		addr := s.addr(d, false)

		// 在栈上预留记录 _defer 的各个字段的空间
		s.store(types.Types[TUINT32],
			s.newValue1I(ssa.OpOffPtr, types.Types[TUINT32].PtrTo(), t.FieldOff(0), addr),
			s.constInt32(types.Types[TUINT32], int32(stksize)))
		s.store(closure.Type,
			s.newValue1I(ssa.OpOffPtr, closure.Type.PtrTo(), t.FieldOff(6), addr),
			closure)

		// 记录参与 defer 调用的函数参数
		ft := fn.Type
		off := t.FieldOff(12)
		args := n.Rlist.Slice()

		// 调用 runtime.deferprocStack，以 _defer 记录的指针作为参数传递
		arg0 := s.constOffPtrSP(types.Types[TUINTPTR], Ctxt.FixedFrameSize())
		s.store(types.Types[TUINTPTR], arg0, addr)
		call = s.newValue1A(ssa.OpStaticCall, types.TypeMem, deferprocStack, s.mem())
		...
	} else {
		...
	}

	// 函数尾声与堆上分配的栈一样，调用 deferreturn
	if k == callDefer || k == callDeferStack {
		...
		s.exit()
	}
	...
}
```

可见，在编译阶段，一个 `_defer` 记录的空间已经在栈上得到保留，`deferprocStack` 的作用
就仅仅承担了运行时对该记录的初始化这一功能：

```go
// src/runtime/panic.go

//go:nosplit
func deferprocStack(d *_defer) {
	gp := getg()
	// 注意，siz 和 fn 已经在编译阶段完成设置，这里只初始化了其他字段
	d.started = false
	d.heap = false		// 可见此时 defer 被标记为不在堆上分配
	d.openDefer = false
	d.sp = getcallersp()
	d.pc = getcallerpc()
	...
	// 尽管在栈上进行分配，仍然需要将多个 _defer 记录通过链表进行串联，
	// 以便在 deferreturn 中找到被延迟的函数的入口地址：
	//   d.link = gp._defer
	//   gp._defer = d
	*(*uintptr)(unsafe.Pointer(&d.link)) = uintptr(unsafe.Pointer(gp._defer))
	*(*uintptr)(unsafe.Pointer(&gp._defer)) = uintptr(unsafe.Pointer(d))
	return0()
}
```

至于函数尾声的行为，与在堆上进行分配的操作同样是调用 `deferreturn`，我们就不再重复说明了。
当然，里面涉及的 `freedefer` 调用由于不需要释放任何内存，也就早早返回了：

```go
// src/runtime/panic.go
func freedefer(d *_defer) {
	if !d.heap {
		return
	}
	...
}
```

## 9.2.3 开放编码式 defer

正如本节最初中描述的那样，defer 给我们的第一感觉其实是一个编译期特性。前面我们讨论了
为什么 defer 会需要运行时的支持，已经需要运行时的 defer 是如何工作的。现在我们来
探究一下什么情况下能够让 defer 进化为一个编译期特性，即在函数末尾直接对延迟函数进行调用，
做到几乎不需要额外的开销。这类几乎不需要额外运行时性能开销的 defer，正是开放编码式 defer。
这类 defer 与直接调用产生的性能差异有多大呢？我们不妨编写两个性能测试：

```go
func call()  { func() {}() }
func callDefer() { defer func() {}() }
func BenchmarkDefer(b *testing.B) {
	for i := 0; i < b.N; i++ {
		call() // 第二次运行时替换为 callDefer
	}
}
```

在 Go 1.14 版本下，读者可以获得类似下方的性能估计，其中使用 `callDefer` 后，
性能损耗大约为 1 ns。这种纳秒级的性能损耗不到一个 CPU 时钟周期，
我们已经可以认为开放编码式 defer 几乎没有了性能开销：

```
name      old time/op  new time/op  delta
Defer-12  1.24ns ± 1%  2.23ns ± 1%  +80.06%  (p=0.000 n=10+9)
```

那么开放编码式 defer 是怎么实现的？所有的 defer 都是开放编码式的吗？
什么情况下，开放编码式 defer 会退化为一个以来运行时的特性？

对于一个开放编码式 defer 而言，它比普通类型的 defer 多记录了以下字段：

```go
// src/runtime/panic.go
type _defer struct {
	started   bool	// 指定 defer 是否已经执行
	openDefer bool	// 指定是否是一个开放编码式 defer
	fd        unsafe.Pointer
	varp      uintptr
	framepc   uintptr
	...
}
```

这些字段的主要功能是在需要进行调用时候

```go
// src/cmd/compile/internal/gc/ssa.go
func (s *state) stmt(n *Node) {
	...
	switch n.Op {
	case ODEFER:
		// 开放编码式 defer
		if s.hasOpenDefers {
			s.openDeferRecord(n.Left)
		} else {
			...
		}
	case ...
	}
	...
}
```


```go
func runOpenDeferFrame(gp *g, d *_defer) bool {
	done := true
	fd := d.fd

	// Skip the maxargsize
	_, fd = readvarintUnsafe(fd)
	deferBitsOffset, fd := readvarintUnsafe(fd)
	nDefers, fd := readvarintUnsafe(fd)
	deferBits := *(*uint8)(unsafe.Pointer(d.varp - uintptr(deferBitsOffset)))

	for i := int(nDefers) - 1; i >= 0; i-- {
		// read the funcdata info for this defer
		var argWidth, closureOffset, nArgs uint32
		argWidth, fd = readvarintUnsafe(fd)
		closureOffset, fd = readvarintUnsafe(fd)
		nArgs, fd = readvarintUnsafe(fd)
		if deferBits&(1<<i) == 0 {
			for j := uint32(0); j < nArgs; j++ {
				_, fd = readvarintUnsafe(fd)
				_, fd = readvarintUnsafe(fd)
				_, fd = readvarintUnsafe(fd)
			}
			continue
		}
		closure := *(**funcval)(unsafe.Pointer(d.varp - uintptr(closureOffset)))
		d.fn = closure
		deferArgs := deferArgs(d)
		// If there is an interface receiver or method receiver, it is
		// described/included as the first arg.
		for j := uint32(0); j < nArgs; j++ {
			var argOffset, argLen, argCallOffset uint32
			argOffset, fd = readvarintUnsafe(fd)
			argLen, fd = readvarintUnsafe(fd)
			argCallOffset, fd = readvarintUnsafe(fd)
			memmove(unsafe.Pointer(uintptr(deferArgs)+uintptr(argCallOffset)),
				unsafe.Pointer(d.varp-uintptr(argOffset)),
				uintptr(argLen))
		}
		deferBits = deferBits &^ (1 << i)
		*(*uint8)(unsafe.Pointer(d.varp - uintptr(deferBitsOffset))) = deferBits
		p := d._panic
		reflectcallSave(p, unsafe.Pointer(closure), deferArgs, argWidth)
		if p != nil && p.aborted {
			break
		}
		d.fn = nil
		// These args are just a copy, so can be cleared immediately
		memclrNoHeapPointers(deferArgs, uintptr(argWidth))
		if d._panic != nil && d._panic.recovered {
			done = deferBits == 0
			break
		}
	}

	return done
}
```

## 9.2.4 `defer` 的演进过程

TODO: 尚未完成

defer 最早的实现非常的粗糙，每当出现一个 defer 调用，都会在堆上分配 defer 记录，
并参与调用的参数实施一次拷贝，然后将其加入到 defer 链条上；当函数返回需要触发 defer 调用时，
依次将 defer 从链表中取出，完成调用。

在 Go 1.1 时，defer 得到了它的第一次优化 [Cox, 2011]。Russ Cox 提出
将 defer 的分配和释放过程进行批量化处理，当时 Dmitry Vyukov 则提议在栈上分配会更加有效。
但 Russ Cox 认为在执行栈上分配 defer 记录和在其他地方进行分配并没有带来太多收益。
最终实现了 per-G 批量式分配的 defer 机制。

由于后续调度器的改进，运行时开始支持 per-P 的资源池，defer 自然也是一类可以被视作局部持有的资源。
因此分配和释放 defer 的资源在 Go 1.3 时得到优化 [Vyukov, 2014]，Dmitry Vyukov 将 per-G 分配的
defer 改为了从 per-P 资源池分配的机制。

早在 1.8 之前，defer 调用允许对栈进行分段，即允许在调用过程中被抢占，
而分配（`newdefer`）甚至都是直接在系统栈上完成的，且需要将 P 和 M 进行绑定。
因此，Austin Clements 对 defer 做的一个优化 [Clements, 2016] 是
在每个 `deferproc` 和 `deferreturn` 中都切换至系统栈，从而阻止了抢占和栈增长的发生。
进而避免了抢占的发生，也就优化消除了 P 和 M 进行绑定所带来的开销。
此外，`memmove` 进行拷贝的开销也是不可忽略的，此前的任何 defer 调用，无论是否存在
大量参数拷贝，都会产生一次 `memmove` 的调用成本，在这个优化中，运行时针对没有参数和指针大小
参数的这两种情况进行了优化，从而跳过了 `memmove` 带来的开销。

后来，Keith Randall 终于实现了 [Randall, 2013] 很早之前 Dmitry Vyukov 就已经
提出的在栈上分配 defer 的优化 [Cox, 2011]，简单情况下不再需要打扰运行时的内存管理。
为 Go 1.13 进一步提升了 defer 的性能。

最近，Dan Scales 作为 Go 团队的新成员，defer 的优化成为了他的第一个项目。
他提出开放式编码 defer [Scales, 2019]，通过编译器辅助信息和位掩码在函数末尾处直接获取调用参数，
完成了近乎零成本的 defer 调用，成为了 Go 1.14 中几个出色的运行时性能优化之一。

至此，defer 的优化之路正式告一段落。

| 版本 | 内容 | 作者 |
|:----|:-----|:----|
| 1.0 及之前 | 制定 defer 的语言规范，首次实现，在堆上分配 | Robert Griesemer, Ken Thompson |
| 1.1 | 将 defer 的分配与释放方式改为 per-G 批量处理 | Russ Cox |
| 1.3 | 将 defer 的分配与释放方式改为 per-P 池化处理 | Dmitry Vyukov |
| 1.8 | 将 defer 的执行过程切换到系统栈中，阻止抢占和栈增长带来的成本 | Austin Clements |
| 1.13 | 实现在执行栈上分配 defer，消除了常见的简单情况下堆上分配带来的开销 | Keith Randall |
| 1.14 | 实现开放式编码 defer，支持在函数末尾处直接插入 defer 调用，引入几乎零成本 defer | Dan Scales |


我们最后来总结一下 defer 的工作原理：

1. 将一个需要分配一个用于记录被 defer 的调用的 `_defer` 实例，并将入口地址及其参数复制保存，
安插到 Goroutine 对应的延迟调用链表中。

2. 在函数末尾处，通过编译器的配合，在调用被 defer 的函数前，将 `_defer` 实例归还，而后通过尾递归的方式
来对需要 defer 的函数进行调用。

从这两个过程来看，一次 defer 的成本来源于 `_defer` 对象的分配与回收、被 defer 函数的参数的拷贝。我们会问，这些成本真的很高吗？确实不可忽略。什么时候会出现这些成本？在循环里使用 defer、函数内 defer 的数量超过 8 个时。

## 进一步阅读的参考文献

- [Cox, 2011] Russ Cox. runtime: aggregate defer. Oct, 2011. https://github.com/golang/go/issues/2364
- [Clements, 2016] Austin Clements. runtime: optimize defer code. Sep, 2016. https://github.com/golang/go/commit/4c308188cc05d6c26f2a2eb30631f9a368aaa737
- [Ma, 2016] Minux Ma. runtime: defer is slow. Mar, 2016. https://github.com/golang/go/issues/14939
- [Randall, 2013] Keith Randall. cmd/compile: allocate some defers in stack frames. Dec, 2013. https://github.com/golang/go/issues/6980
- [Vyukov, 2014] Dmitry Vyukov. runtime: per-P defer pool. Jan, 2014. https://github.com/golang/go/commit/1ba04c171a3c3a1ea0e5157e8340b606ec9d8949
- [Scales, 2019] Dan Scales, Keith Randall, and Austin Clements. Proposal: Low-cost defers through inline code, and extra funcdata to manage the panic case. Sep, 2019. https://go.googlesource.com/proposal/+/refs/heads/master/design/34481-opencoded-defers.md

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)