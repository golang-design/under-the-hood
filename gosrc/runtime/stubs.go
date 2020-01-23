// Copyright 2014 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

import "unsafe"

// 是否应该内建到 unsafe.Pointer?
//go:nosplit
func add(p unsafe.Pointer, x uintptr) unsafe.Pointer {
	return unsafe.Pointer(uintptr(p) + x)
}

// getg 返回指向当前 g 的指针
// 编译器将对此函数的调用重写为指令，从而直接获取 g（来自 TLS 或来自专用寄存器）
func getg() *g

// mcall 从 g 切换到 g0 栈并调用 fn(g)，其中 g 为调用该方法的 goroutine
// mcall 保存了 g 在 g->sched 中当前的 PC/SP，进而可以在之后被恢复。
// fn 通常通过在一个数据结构中记录 g 来安排随后的执行，从而为随后调用 ready(g)。
// 当 g 被重新调度时，mcall 随后返回了原始的 goroutine g.
// fn 必须不能返回；通常已调用 schedule 结束，进而让 m 来运行其他的 goroutine。
//
// mcall 只能从 g 栈中被调用（而非 g0 和 gsignal）
//
// 如果 fn 是一个栈分配的 closure 该函数不允许是 go:noescape: 的，fn 将 g 放入运行队列中
// 且 g 在 fn 返回前执行，则 closure 将在它仍在执行时失效。
func mcall(fn func(*g))

// systemstack 在系统栈上运行 fn. 如果：
// - systemstack 从 per-OS 线程 (g0) 栈上调用
// - systemstack 从信号处理 (gsignal) 栈上调用，且 systemstack 直接调用 fn 并返回
// 否则 systemstack 会在一个普通的 goroutine 的受限栈上进行调用。
// 这时，systemstack 会切换到 per-OS-thread 栈上，然后调用 fn ，然后再切换回来。
// 通常使用 func 字面量作为参数，以便与调用系统堆栈的代码共享输入和输出：
//
//	... 构建 y ...
//	systemstack(func() {
//		x = bigcall(y)
//	})
//	... 使用 x ...
//
//go:noescape
func systemstack(fn func())

var badsystemstackMsg = "fatal: systemstack called from unexpected goroutine"

//go:nosplit
//go:nowritebarrierrec
func badsystemstack() {
	sp := stringStructOf(&badsystemstackMsg)
	write(2, sp.str, int32(sp.len))
}

// memclrNoHeapPointers 清除从 ptr 开始的 n 个字节
//
// 通常情况下你应该使用 typedmemclr，而 memclrNoHeapPointers 应该仅在调用方知道 *ptr
// 不包含堆指针的情况下使用，因为 *ptr 只能是下面两种情况：
//
// 1. *ptr 是初始化过的内存，且其类型不是指针。
//
// 2. *ptr 是未初始化的内存（例如刚被新分配时使用的内存），则指包含 "junk" 垃圾内存
//
// CPU 特定的实现参见 memclr_*.s
//
//go:noescape
func memclrNoHeapPointers(ptr unsafe.Pointer, n uintptr)

//go:linkname reflect_memclrNoHeapPointers reflect.memclrNoHeapPointers
func reflect_memclrNoHeapPointers(ptr unsafe.Pointer, n uintptr) {
	memclrNoHeapPointers(ptr, n)
}

// memmove 从 "from" 复制 n 字节到 "to"
//
// memmove ensures that any pointer in "from" is written to "to" with
// an indivisible write, so that racy reads cannot observe a
// half-written pointer. This is necessary to prevent the garbage
// collector from observing invalid pointers, and differs from memmove
// in unmanaged languages. However, memmove is only required to do
// this if "from" and "to" may contain pointers, which can only be the
// case if "from", "to", and "n" are all be word-aligned.
//
// Implementations are in memmove_*.s.
//
//go:noescape
func memmove(to, from unsafe.Pointer, n uintptr)

//go:linkname reflect_memmove reflect.memmove
func reflect_memmove(to, from unsafe.Pointer, n uintptr) {
	memmove(to, from, n)
}

// exported value for testing
var hashLoad = float32(loadFactorNum) / float32(loadFactorDen)

//go:nosplit
func fastrand() uint32 {
	mp := getg().m
	// Implement xorshift64+: 2 32-bit xorshift sequences added together.
	// Shift triplet [17,7,16] was calculated as indicated in Marsaglia's
	// Xorshift paper: https://www.jstatsoft.org/article/view/v008i14/xorshift.pdf
	// This generator passes the SmallCrush suite, part of TestU01 framework:
	// http://simul.iro.umontreal.ca/testu01/tu01.html
	s1, s0 := mp.fastrand[0], mp.fastrand[1]
	s1 ^= s1 << 17
	s1 = s1 ^ s0 ^ s1>>7 ^ s0>>16
	mp.fastrand[0], mp.fastrand[1] = s0, s1
	return s0 + s1
}

//go:nosplit
func fastrandn(n uint32) uint32 {
	// This is similar to fastrand() % n, but faster.
	// See https://lemire.me/blog/2016/06/27/a-fast-alternative-to-the-modulo-reduction/
	return uint32(uint64(fastrand()) * uint64(n) >> 32)
}

//go:linkname sync_fastrand sync.fastrand
func sync_fastrand() uint32 { return fastrand() }

// in asm_*.s
//go:noescape
func memequal(a, b unsafe.Pointer, size uintptr) bool

// noescape 从逃逸分析中隐藏了一个指针。noescape 是一个恒等变换（数学上的）。
// 但会让逃逸分析认为输出结果不依赖于输入。
// noescape 为内嵌且当前编译器会将其优化为零指令（无开销）
// 小心使用！
//go:nosplit
func noescape(p unsafe.Pointer) unsafe.Pointer {
	x := uintptr(p)
	return unsafe.Pointer(x ^ 0)
}

func cgocallback(fn, frame unsafe.Pointer, framesize, ctxt uintptr)
func gogo(buf *gobuf)
func gosave(buf *gobuf)

//go:noescape
func jmpdefer(fv *funcval, argp uintptr)
func asminit()
func setg(gg *g)
func breakpoint()

// reflectcall 使用 arg 指向的 n 个参数字节的副本调用 fn。
// fn 返回后，reflectcall 在返回之前将 n-retoffset 结果字节复制回 arg+retoffset。
// 如果重新复制结果字节，则调用者应将参数帧类型作为 argtype 传递，以便该调用可以在复制期间执行适当的写障碍。
// reflect 包传递帧类型。在 runtime 包中，只有一个调用将结果复制回来，即 cgocallbackg1，
// 并且它不传递帧类型，这意味着没有调用写障碍。参见该调用的页面了解相关理由。
//
// 包 reflect 通过 linkname 访问此符号
func reflectcall(argtype *_type, fn, arg unsafe.Pointer, argsize uint32, retoffset uint32)

func procyield(cycles uint32)

type neverCallThisFunction struct{}

// goexit 是每个 goroutine 调用栈顶部的返回 stub
// 如果 goexit 是 goroutine 的入口函数，则对应的 goroutine 栈当入口函数返回时，将返回 goexit
// 进而调用 goexit1 来完成实际的退出过程。
//
// 该函数不能直接调用，而应调用 goexit1。
// gentraceback 假设 goexit 终止该栈。直接调用堆栈将导致 gentraceback 提前终止堆栈，
// 如果有剩余状态可能会导致 panic
func goexit(neverCallThisFunction)

// Not all cgocallback_gofunc frames are actually cgocallback_gofunc,
// so not all have these arguments. Mark them uintptr so that the GC
// does not misinterpret memory when the arguments are not present.
// cgocallback_gofunc is not called from go, only from cgocallback,
// so the arguments will be found via cgocallback's pointer-declared arguments.
// See the assembly implementations for more details.
func cgocallback_gofunc(fv, frame, framesize, ctxt uintptr)

// publicationBarrier performs a store/store barrier (a "publication"
// or "export" barrier). Some form of synchronization is required
// between initializing an object and making that object accessible to
// another processor. Without synchronization, the initialization
// writes and the "publication" write may be reordered, allowing the
// other processor to follow the pointer and observe an uninitialized
// object. In general, higher-level synchronization should be used,
// such as locking or an atomic pointer write. publicationBarrier is
// for when those aren't an option, such as in the implementation of
// the memory manager.
//
// There's no corresponding barrier for the read side because the read
// side naturally has a data dependency order. All architectures that
// Go supports or seems likely to ever support automatically enforce
// data dependency ordering.
func publicationBarrier()

// getcallerpc 返回它调用方的调用方程序计数器 PC program conter
// getcallersp 返回它调用方的调用方的栈指针 SP stack pointer
// 实现由编译器内建，在任何平台上都没有实现它的代码
//
// 例如:
//
//	func f(arg1, arg2, arg3 int) {
//		pc := getcallerpc()
//		sp := getcallersp()
//	}
//
// 这两行会寻找调用 f 的 PC 和 SP
//
// 调用 getcallerpc 和 getcallersp 必须被询问的帧中完成
//
// getcallersp 的结果在返回时是正确的，但是它可能会被任何随后调用的函数无效，
// 因为它可能会重新定位堆栈，以使其增长或缩小。一般规则是，getcallersp 的结果
// 应该立即使用，并且只能传递给 nosplit 函数。

//go:noescape
func getcallerpc() uintptr

//go:noescape
func getcallersp() uintptr // 在所有平台上作为 intrinsic 实现

// getclosureptr returns the pointer to the current closure.
// getclosureptr can only be used in an assignment statement
// at the entry of a function. Moreover, go:nosplit directive
// must be specified at the declaration of caller function,
// so that the function prolog does not clobber the closure register.
// for example:
//
//	//go:nosplit
//	func f(arg1, arg2, arg3 int) {
//		dx := getclosureptr()
//	}
//
// The compiler rewrites calls to this function into instructions that fetch the
// pointer from a well-known register (DX on x86 architecture, etc.) directly.
func getclosureptr() uintptr

//go:noescape
func asmcgocall(fn, arg unsafe.Pointer) int32

func morestack()
func morestack_noctxt()
func rt0_go()

// return0 是一个用于在 deferproc 中返回 0 的 stub
// 他会在每个 deferproc 结束时返回 0 来通知调用的 go 函数，从而不会跳转到
// deferreturn, 在 asm_*.s 中实现
func return0()

// in asm_*.s
// not called directly; definitions here supply type information for traceback.
func call32(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call64(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call128(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call256(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call512(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call1024(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call2048(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call4096(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call8192(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call16384(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call32768(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call65536(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call131072(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call262144(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call524288(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call1048576(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call2097152(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call4194304(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call8388608(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call16777216(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call33554432(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call67108864(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call134217728(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call268435456(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call536870912(typ, fn, arg unsafe.Pointer, n, retoffset uint32)
func call1073741824(typ, fn, arg unsafe.Pointer, n, retoffset uint32)

func systemstack_switch()

// 向上入 n 到 a 的倍数， a 一定是2的幂
func alignUp(n, a uintptr) uintptr {
	return (n + a - 1) &^ (a - 1)
}

// 向下舍入 n 到 a 的倍数. a 一定是 2 的幂
func alignDown(n, a uintptr) uintptr {
	return n &^ (a - 1)
}

// checkASM reports whether assembly runtime checks have passed.
func checkASM() bool

func memequal_varlen(a, b unsafe.Pointer) bool

// bool2int returns 0 if x is false or 1 if x is true.
func bool2int(x bool) int {
	// Avoid branches. In the SSA compiler, this compiles to
	// exactly what you would want it to.
	return int(uint8(*(*uint8)(unsafe.Pointer(&x))))
}

// abort crashes the runtime in situations where even throw might not
// work. In general it should do something a debugger will recognize
// (e.g., an INT3 on x86). A crash in abort is recognized by the
// signal handler, which will attempt to tear down the runtime
// immediately.
func abort()

// Called from compiled code; declared for vet; do NOT call from Go.
func gcWriteBarrier()
func duffzero()
func duffcopy()

// Called from linker-generated .initarray; declared for go vet; do NOT call from Go.
func addmoduledata()
