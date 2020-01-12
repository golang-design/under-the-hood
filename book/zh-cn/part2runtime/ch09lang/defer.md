---
weight: 2402
title: "9.2 defer 语句"
---

# 9.2 defer 语句

[TOC]

> TODO: go1.13 的优化

`defer` 不是免费的午餐，任何一次的 `defer` 都存在性能问题，这样一个简单的性能对比：

```go
var lock sync.Mutex

func NoDefer() {
	lock.Lock()
	lock.Unlock()
}
func Defer() {
	lock.Lock()
	defer lock.Unlock()
}

func BenchmarkNoDefer(b *testing.B) {
	for i := 0; i < b.N; i++ {
		NoDefer()
	}
}

func BenchmarkDefer(b *testing.B) {
	for i := 0; i < b.N; i++ {
		Defer()
	}
}
```

运行结果：

```
→go test -bench=. -v
goos: darwin
goarch: amd64
BenchmarkNoDefer-8      100000000               16.4 ns/op
BenchmarkDefer-8        30000000                50.1 ns/op
PASS
ok      _/Users/changkun/dev/go-under-the-hood/demo/7-lang/defer        3.222s
```

本文来深入源码探究 `defer` 存在如此之高性能损耗的原因。

## 本质

我们来看一看 defer 这个关键字被翻译为了什么：

```go
package main

func main() {
	defer println("hello, world!")
}
```

```asm
TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/defer/defer.go
  defer.go:3		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  (...)
  defer.go:4		0x104e059		488d05500d0200		LEAQ go.func.*+71(SB), AX		
  defer.go:4		0x104e060		4889442408		MOVQ AX, 0x8(SP)			
  defer.go:4		0x104e065		e83629fdff		CALL runtime.deferproc(SB)		
  defer.go:4		0x104e06a		85c0			TESTL AX, AX				
  defer.go:4		0x104e06c		7512			JNE 0x104e080				
  defer.go:4		0x104e06e		eb00			JMP 0x104e070				
  defer.go:5		0x104e070		90			NOPL					
  defer.go:5		0x104e071		e8aa31fdff		CALL runtime.deferreturn(SB)		
  defer.go:5		0x104e076		488b6c2420		MOVQ 0x20(SP), BP			
  defer.go:5		0x104e07b		4883c428		ADDQ $0x28, SP				
  defer.go:5		0x104e07f		c3			RET					
  (...)
```

可以看到 defer 这个调用被编译为了 `runtime.deferproc` 调用，返回前还被插入了 `runtime.deferreturn` 调用。
下面我们就来详细看看这两个调用具体发生了什么事情。

## defer 的创生

### deferproc

单看 `deferproc` 这个调用很简单，因为它甚至没有产于调用，仅仅只是将需要被 defer 调用的代码片段
做了一次保存：

```go
// 创建一个新的被延期执行的函数 fn，具有 siz 字节大小的参数。
// 编译器会将 defer 语句翻译为此调用。
//go:nosplit
func deferproc(siz int32, fn *funcval) { // arguments of fn follow fn
	if getg().m.curg != getg() {
		// 在系统栈上的 go 代码不能 defer
		throw("defer on system stack")
	}

	// fn 的参数处于不安全的状态中。deferproc 的栈 map 无法描述他们。因此，在
	// 我们完全将他们复制到某个安全的地方之前，我们都不能触发让垃圾回收或栈拷贝。
	// 下面的 memmove 就是做这件事情的。
	// 直到拷贝完成，我们才调用 nosplit 协程。
	sp := getcallersp()
	argp := uintptr(unsafe.Pointer(&fn)) + unsafe.Sizeof(fn)
	callerpc := getcallerpc()

	d := newdefer(siz)
	if d._panic != nil {
		throw("deferproc: d.panic != nil after newdefer")
	}
	d.fn = fn
	d.pc = callerpc
	d.sp = sp
	switch siz {
	case 0:
		// Do nothing.
	case sys.PtrSize:
		*(*uintptr)(deferArgs(d)) = *(*uintptr)(unsafe.Pointer(argp))
	default:
		memmove(deferArgs(d), unsafe.Pointer(argp), uintptr(siz))
	}

	// deferproc 正常返回 0。
	// 一个终止 panic 而被延迟调用的函数会使 deferproc 返回 1
	// 如果 deferproc 返回值不等于 0 则编译器保证了总是检查返回值且跳转到函数的末尾
	return0()
	// 没有代码可以执行到这里：C 返回寄存器已经被设置且在执行指令期间不会被覆盖（clobber)
}
```

这段代码中，首先对 `defer` 的调用方做检查，`defer` 无法在系统栈上被调用，因此大部分运行时其实是无法使用 `defer` 的。
这也侧面说明 `defer` 必须依附于 goroutine 来完成。

而后就是一些简单参数处理，比如 `fn` 保存了 `defer` 所调用函数的调用地址，`siz` 确定了其参数的大小。
并且通过 `newdefer` 来创建一个新的 `_defer` 实例，然后通过 `fn`/`callerpc`/`sp` 来保存这段内容的执行现场。

由于 `defer` 可能会恢复 `panic` 从而 `fn` 的参数可能不安全，于是实现中还需要按照参数的大小来对参数进行拷贝，例如
`memmove`。
直到最后调用 `return0()` 来宣告 `defer` 调用创建完毕，在函数执行完毕或发生 panic 时，便能被调用。

### newdefer

为了在调用 `defer` 时不阻塞用户代码，`newdefer` 通过 p 或 sched 的 defer 池来分配内存，新建 `_defer` 实例。而后将其加入到了
goroutine 所保留的 defer 链表上。

```go
// 分配一个 defer, 通常使用了 per-P 池.
// 每个 defer 必须由 freedefer 释放.
//
// 由于当它被调用时候可能存在没有栈map信息的帧存在，因此不能增长栈。
//
//go:nosplit
func newdefer(siz int32) *_defer {
	var d *_defer
	sc := deferclass(uintptr(siz))
	gp := getg()
	// 检查 defer 参数的大小是否从 p 的 deferpool 直接分配
	if sc < uintptr(len(p{}.deferpool)) {
		pp := gp.m.p.ptr()

		// 如果 p 本地无法分配，则从全局池中获取一批
		if len(pp.deferpool[sc]) == 0 && sched.deferpool[sc] != nil {
			// 在系统栈上采取 slow path，从而我们不会增长 newdefer 的栈
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

		// 从本地分配
		if n := len(pp.deferpool[sc]); n > 0 {
			d = pp.deferpool[sc][n-1]
			pp.deferpool[sc][n-1] = nil
			pp.deferpool[sc] = pp.deferpool[sc][:n-1]
		}
	}
	if d == nil {
		// 如果 siz 太大，则重新
		// 分配新的 defer 和 args
		systemstack(func() {
			total := roundupsize(totaldefersize(uintptr(siz)))
			d = (*_defer)(mallocgc(total, deferType, true))
		})
		if debugCachedWork {
			// Duplicate the tail below so if there's a
			// crash in checkPut we can tell if d was just
			// allocated or came from the pool.
			d.siz = siz
			d.link = gp._defer
			gp._defer = d
			return d
		}
	}
	// 将 _defer 实例添加到 goroutine 的 _defer 链表上。
	d.siz = siz
	d.link = gp._defer
	gp._defer = d
	return d
}
```

`_defer` 的具体结构也非常简单，包含了参数的大小、pc/sp、入口地址、panic 链表
和自身的 link 指针：

```go
// _defer 在被推迟调用的列表上保存了一个入口，
// 如果你在这里增加了一个字段，则需要在 freedefer 中增加清除它的代码
type _defer struct {
	siz     int32
	started bool
	sp      uintptr // defer 时的 sp
	pc      uintptr
	fn      *funcval
	_panic  *_panic // panic 被 defer
	link    *_defer
}
```

## defer 的调用

### deferreturn

`deferreturn` 是由编译器插入到函数末尾的，
它自身只是简单的将需要被 defer 的入口地址取出，然后跳转并执行：

```go
// 如果存在，则运行 defer 函数
// 编译器会将这个调用插入到任何包含 defer 的函数的末尾。
// 如果存在一个被 defer 的函数，此调用会调用 runtime.jmpdefer
// 这将跳转到被延迟的函数，使得它看起来像是在调用 deferreturn 之前由 deferreturn 的调用者调用。
// 产生的结果就是反复地调用 deferreturn，直到没有更多的 defer 函数为止。
//
// 不允许分段栈，因为我们复用了调用方栈帧来调用被 defer 的函数。
//
// 这个单独的参数没有被使用：它只是采用了它的地址，因此它可以与随后的延迟匹配。
//go:nosplit
func deferreturn(arg0 uintptr) {
	gp := getg()
	d := gp._defer
	// 当没有 defer 调用时，直接返回
	if d == nil {
		return
	}
	// 当 defer 的调用方不是当前 deferreturn 的调用方时，也直接返回
	sp := getcallersp()
	if d.sp != sp {
		return
	}

	// 移动参数
	//
	// 任何伺候的调用必须递归的 nosplit，因为垃圾回收器不会知道参数的形式，直到
	// jmpdefer 能够翻转 PC 到 fn
	switch d.siz {
	case 0:
		// Do nothing.
	case sys.PtrSize:
		*(*uintptr)(unsafe.Pointer(&arg0)) = *(*uintptr)(deferArgs(d))
	default:
		memmove(unsafe.Pointer(&arg0), deferArgs(d), uintptr(d.siz))
	}
	// 获得 fn 的入口地址，并随后立即将 _defer 释放掉
	fn := d.fn
	d.fn = nil
	gp._defer = d.link
	freedefer(d)
	jmpdefer(fn, uintptr(unsafe.Pointer(&arg0)))
}
```

在这个函数中，会在需要时对 `defer` 的参数再次进行拷贝，
多个 `defer` 函数以 `jmpdefer` 尾调用形式被实现。
在跳转到 `fn` 之前，`_defer` 实例被释放归还，`jmpdefer` 真正需要的仅仅
只是函数的入口地址和参数，以及它的调用方 `deferreturn` 的 sp：

```asm
// func jmpdefer(fv *funcval, argp uintptr)
// argp 为调用方 SP
// 从 deferreturn 调用
// 1. 出栈调用方
// 2. 替换调用方返回的 5 个字节
// 3. 跳转到参数
TEXT runtime·jmpdefer(SB), NOSPLIT, $0-16
	MOVQ	fv+0(FP), DX	// fn
	MOVQ	argp+8(FP), BX	// 调用方 sp
	LEAQ	-8(BX), SP	// CALL 后的调用方 sp
	MOVQ	-8(SP), BP	// 恢复BP，好像 deferreturn 返回（如果没有使用 framepointers，则无害）
	SUBQ	$5, (SP)	// 再次返回到 CALL
	MOVQ	0(DX), BX
	JMP	BX	// 最后才运行被 defer 的函数
```

这个 `jmpdefer` 巧妙的地方在于，它通过调用方 sp 来推算了 `deferreturn` 的入口地址，
从而在完成某个 `defer` 调用后，会再次回到 `deferreturn` 的初始位置，继续反复调用，造成尾递归的假象。

而释放一个 `defer` 实例只是简单的将其归还到 p 的 `deferpool` 中，并在必要时将其归还到全局 `sched` 的
`deferpool` 中:

```go
// 释放给定的 defer
// defer 在此调用后不能被使用
//
// 不允许增长栈，因为当调用时栈帧可能没有栈map
//
//go:nosplit
func freedefer(d *_defer) {
	if d._panic != nil {
		freedeferpanic()
	}
	if d.fn != nil {
		freedeferfn()
	}
	sc := deferclass(uintptr(d.siz))
	if sc >= uintptr(len(p{}.deferpool)) {
		return
	}
	pp := getg().m.p.ptr()
	if len(pp.deferpool[sc]) == cap(pp.deferpool[sc]) {
		// 转移一半的 local cache 到 central cache
		//
		// 将其转入系统栈上的 slow path
		// 从而不会增长 freedefer 的栈
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

	// 这些行以前只是为了简化 `*d = _defer{}`
	// 但是通过 typedmemmove 开始的会导致一个 nosplit 栈溢出
	d.siz = 0
	d.started = false
	d.sp = 0
	d.pc = 0
	// d._panic 和 d.fn 必须已经是 nil
	// 否则我们会在上面调用 freedeferpanic 或 freedeferfn，它们都会 throw
	d.link = nil

	pp.deferpool[sc] = append(pp.deferpool[sc], d)
}
```

## `defer` 的开销与优化

我们先总结以下 defer 的实现思路：

1. 将一个需要分配一个用于记录被 defer 的调用的 `_defer` 实例，并将入口地址及其参数复制保存，
安插到 goroutine 对应的延迟调用链表中。
2. 在函数末尾处，通过编译器的配合，在调用被 defer 的函数前，将 `_defer` 实例归还，而后通过尾递归的方式
来对需要 defer 的函数进行调用。

从这两个过程来看，一次 defer 的成本来源于 `_defer` 对象的分配与回收、被 defer 函数的参数的拷贝。
但我们可能会问，这些成本真的很高吗？确实不可忽略。
早在 1.8 之前，defer 调用允许对栈进行分段，即允许在调用过程中被抢占，
而分配（`newdefer`）甚至都是直接在系统栈上完成的，且需要将 p 和 m 进行绑定。

在 Go 1.8 的时候，官方对 defer 做的一个主要的优化是我们现在所看到的，
在每个 `deferproc` 和 `deferreturn` 上都切换到系统栈。从而阻止了抢占和栈增长的发生。
进而避免了抢占的发生，也就优化消除了 p 和 m 进行绑定所带来的开销。

此外，memmove 进行拷贝的开销也是不可忽略的，此前的任何 defer 调用，无论是否存在
大量参数拷贝，都会产生一次 memmove 的调用成本，1.8 之后官方针对没有参数和指针大小
参数的这两种情况进行了优化从而跳过了 memmove 这个过程，也就是我们现在所看到的 `d.siz` 的判断。
根据官方提供的性能测试，消除 p 和 m 的绑定，跳过 memmove 这两个方面的优化带来了 42% 的性能提升。
当然，`defer` 仍然存在优化的空间，我们可以对 [issues/14939](https://github.com/golang/go/issues/14939) 继续保持关注。

## 进一步阅读的参考文献

1. [runtime: defer is slow](https://github.com/golang/go/issues/14939)
2. [Tail call](https://en.wikipedia.org/wiki/Tail_call)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)