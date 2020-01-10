// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Cgo 调用与回调支持
//
// 为从 Go 调用 C 函数 f，cgo 生成的代码调用 runtime.cgocall(_cgo_Cfunc_f, frame),
// 其中 _cgo_Cfunc_f 为由 cgo 编写的并由 gcc 编译的函数。
//
// runtime.cgocall (见下) 调用 entersyscall，从而不会阻塞其他 goroutine 或垃圾回收器
// 而后调用 runtime.asmcgocall(_cgo_Cfunc_f, frame)。
//
// runtime.asmcgocall (见 asm_$GOARCH.s) 会切换到 m->g0 栈
// (假设为操作系统分配的栈，因此能安全的在运行 gcc 编译的代码) 并调用 _cgo_Cfunc_f(frame)。
//
// _cgo_Cfunc_f 获取了帧结构中的参数，调用了实际的 C 函数 f，在帧中记录其结果，
// 并返回到 runtime.asmcgocall。
//
// 在重新获得控制权后，runtime.asmcgocall 会切换回原来的 g (m->curg) 的执行栈
// 并返回 runtime.cgocall。
//
// 在重新获得控制权后，runtime.cgocall 会调用 exitsyscall，并阻塞，直到该 m 运行能够在不与
// $GOMAXPROCS 限制冲突的情况下运行 Go 代码。
//
// 上面的描述跳过了当 gcc 编译的函数 f 调用回 Go 的情况。如果此类情况发生，则下面描述了 f 执行期间的调用过程。
//
// 为了 gcc 编译的 C 代码调用 Go 函数 p.GoF 成为可能，cgo 编写了以 GoF 命名的 gcc 编译的函数
// （不是 p.GoF，因为 gcc 没有包的概念）。然后 gcc 编译的 C 函数 f 调用 GoF。
//
// GoF 调用了 crosscall2(_cgoexp_GoF, frame, framesize)。
// Crosscall2（见 cgo/gcc_$GOARCH.S，gcc 编译的汇编文件）为一个具有两个参数的从 gcc 函数调用 ABI
// 到 6c 函数调用 API 的适配器.
// gcc 通过调用它来调用 6c 函数。这种情况下，它会调用 _cgoexp_GoF(frame, framesize)，
// 仍然会在 m->g0 栈上运行，且不受 $GOMAXPROCS 的限制。因此该代码不能直接调用任意的 Go 代码，
// 并且必须非常小心的分配内存以及小心的使用 m->g0 栈。
//
// _cgoexp_GoF 调用了 runtime.cgocallback(p.GoF, frame, framesize, ctxt).
// （使用 _cgoexp_GoF 而不是编写 crosscall3 直接进行此调用的原因是 _cgoexp_GoF
// 是用 6c 而不是 gcc 编译的，可以引用像 runs.cgocallback 和 p.GoF 这样的带点的名称。）
//
// runtime.cgocallback（在 asm_$GOARCH.s中）从 m->g0 的堆切换到原始 g（m->curg）的栈，
// 并在在栈上调用 runtime.cgocallbackg(p.GoF，frame，framesize)。
// 作为栈切换的一部分，runtime.cgocallback 将当前 SP 保存为 m->g0->sched.sp，
// 因此在执行回调期间任何使用 m->g0 的栈都将在现有栈帧之下完成。
// 在覆盖 m->g0->sched.sp 之前，它会在 m->g0 栈上将旧值压栈，以便以后可以恢复。
//
// runtime.cgocallbackg（见下）现在在一个真正的 goroutine 栈上运行（不是 m->g0 栈）。
// 首先它调用 runtime.exitsyscall，它将阻塞到不与 $GOMAXPROCS 限制冲突的情况下运行此 goroutine。
// 一旦 exitsyscall 返回，就可以安全地执行调用内存分配器或调用 Go 的 p.GoF 回调函数等操作。
// runtime.cgocallbackg 首先推迟一个函数来 unwind m->g0.sched.sp，这样如果 p.GoF 发生 panic
// m->g0.sched.sp 将恢复到其旧值：m->g0 栈和 m->curg 栈将在 unwind 步骤中展开。
// 接下来它调用 p.GoF。最后它弹出但不执行 defer 函数，而是调用 runtime.entersyscall，
// 并返回到 runtime.cgocallback。
//
// 在重新获得控制权后，runtime.cgocallback 切换回 m->g0 栈（指针仍然为 m->g0.sched.sp），
// 从栈中恢复原来的 m->g0.sched.sp 的值，并返回到 _cgoexp_GoF。
//
// _cgoexp_GoF 直接返回 crosscall2，从而为 gcc 恢复调用方寄存器，并返回到 GoF，从而返回到 f 中。

package runtime

import (
	"runtime/internal/atomic"
	"runtime/internal/sys"
	"unsafe"
)

// cgo 崩溃回溯时搜集的地址
// 长度必须等于 x_cgo_callers 中 的 arg.Max，位于 runtime/cgo/gcc_traceback.c
type cgoCallers [32]uintptr

// 从 Go 调用 C
//
// This must be nosplit because it's used for syscalls on some
// platforms. Syscalls may have untyped arguments on the stack, so
// it's not safe to grow or scan the stack.
//
//go:nosplit
func cgocall(fn, arg unsafe.Pointer) int32 {
	if !iscgo && GOOS != "solaris" && GOOS != "illumos" && GOOS != "windows" {
		throw("cgocall unavailable")
	}

	// cgo 调用不允许为空
	if fn == nil {
		throw("cgocall nil")
	}

	if raceenabled {
		racereleasemerge(unsafe.Pointer(&racecgosync))
	}

	// 运行时会记录 cgo 调用的次数
	mp := getg().m
	mp.ncgocall++
	mp.ncgo++

	// 重置回溯信息
	mp.cgoCallers[0] = 0

	// 宣布正在进入系统调用，从而调度器会创建另一个 M 来运行 goroutine
	//
	// 对 asmcgocall 的调用保证了不会增加栈并且不分配内存，
	// 因此在 $GOMAXPROCS 计数之外的 "系统调用内" 的调用是安全的。
	//
	// fn 可能会回调 Go 代码，这种情况下我们将退出系统调用来运行 Go 代码
	//（可能增长栈），然后再重新进入系统调用来复用 entersyscall 保存的
	// PC 和 SP 寄存器
	entersyscall()

	// Tell asynchronous preemption that we're entering external
	// code. We do this after entersyscall because this may block
	// and cause an async preemption to fail, but at this point a
	// sync preemption will succeed (though this is not a matter
	// of correctness).
	osPreemptExtEnter(mp)

	// 将 m 标记为正在 cgo
	mp.incgo = true

	// 进入调用
	errno := asmcgocall(fn, arg)

	// 在 exitsyscall 之前进行计数，因为 exitsyscall 可能会把
	// 我们重新调度到不同的 M 中
	//
	// 取消运行 cgo 的标记
	mp.incgo = false
	// 正在进行的 cgo 数量减少
	mp.ncgo--

	osPreemptExtExit(mp)

	// 宣告退出系统调用
	exitsyscall()

	// race 相关，raceacquire 必须在 exitsyscall 连接了 M 和 P 之后调用
	if raceenabled {
		raceacquire(unsafe.Pointer(&racecgosync))
	}

	// 从垃圾收集器的角度来看，时间可以按照上面的顺序向后移动。
	// 如果对 Go 代码进行回调，GC 将在调用 asmcgocall 时能看到此函数。
	// 当 Go 调用稍后返回到 C 时，系统调用 PC/SP 将被回滚并且 GC 在调用
	// enteryscall 时看到此函数。通常情况下，fn 和 arg 将在 enteryscall 上运行
	// 并在 asmcgocall 处死亡，因此如果时间向后移动，GC 会将这些参数视为已死，
	// 然后生效。通过强制它们在这个时间中保持活跃来防止这些未死亡的参数崩溃。
	KeepAlive(fn)
	KeepAlive(arg)
	KeepAlive(mp)

	return errno
}

// 从 C 调用 Go
//go:nosplit
func cgocallbackg(ctxt uintptr) {
	gp := getg()
	if gp != gp.m.curg {
		println("runtime: bad g in cgocallback")
		exit(2)
	}

	// 从 C 发起的调用运行在 gp.m 的 g0 栈上，因此我们必须确认我们停留在这个 M 上
	// 在调用 exitsyscall 之前，必须调用这个操作，否则它会被释放且将我们移动到其他的 M 上
	// 当前调用结束前，会调用 unlockOSThread
	lockOSThread()

	// 保存当前系统调用的参数，因此 m.syscall 可以在进行系统调用时候进而回调使用
	syscall := gp.m.syscall

	// entersyscall 保存了调用方 SP 并允许 GC 能够跟踪 Go 栈。然而因为我们会返回到
	// 前一个栈帧并需要与 cgocall 的 entersyscall() 匹配，我们必须保存 syscall*
	// 并让 reentersyscall 恢复它们
	savedsp := unsafe.Pointer(gp.syscallsp)
	savedpc := gp.syscallpc
	exitsyscall() // 离开 cgo 调用
	gp.m.incgo = false

	osPreemptExtExit(gp.m)

	cgocallbackg1(ctxt)

	// 这时，unlockOSThread 已经被调用，下面的代码不能修改到其他的 m 上。
	// incgo 检查位于 schedule 函数中，这是强制的

	osPreemptExtEnter(gp.m)

	gp.m.incgo = true
	// 返回到 cgo 调用going back to cgo call
	reentersyscall(savedpc, uintptr(savedsp))

	gp.m.syscall = syscall
}

func cgocallbackg1(ctxt uintptr) {
	gp := getg()
	if gp.m.needextram || atomic.Load(&extraMWaiters) > 0 {
		gp.m.needextram = false
		systemstack(newextram)
	}

	if ctxt != 0 {
		s := append(gp.cgoCtxt, ctxt)

		// 现在我们需要设置 gp.cgoCtxt = s，但我们可以得到操纵切片时的 SIGPROF 信号，和
		// SIGPROF 处理程序可以获取 gp.cgoCtxt
		// 追踪堆栈。我们需要确保 handler 总是看到一个有效的切片，所以设置
		// 按顺序排列的值，以便始终如此。
		p := (*slice)(unsafe.Pointer(&gp.cgoCtxt))
		atomicstorep(unsafe.Pointer(&p.array), unsafe.Pointer(&s[0]))
		p.cap = cap(s)
		p.len = len(s)

		defer func(gp *g) {
			// 安全地减少切片的长度。
			p := (*slice)(unsafe.Pointer(&gp.cgoCtxt))
			p.len--
		}(gp)
	}

	if gp.m.ncgo == 0 {
		// 对 Go 的 C 调用来自一个当前没有运行任何 Go 的线程。
		// 在 -buildmode=c-archive 或 c-shared 的情况下，
		// 此调用可能在包初始化完成之前进入，等待完成。
		<-main_init_done
	}

	// 增加 defer 栈的入口来防止 panic
	restore := true
	defer unwindm(&restore)

	if raceenabled {
		raceacquire(unsafe.Pointer(&racecgosync))
	}

	type args struct {
		fn      *funcval
		arg     unsafe.Pointer
		argsize uintptr
	}
	var cb *args

	// Location of callback arguments depends on stack frame layout
	// and size of stack frame of cgocallback_gofunc.
	sp := gp.m.g0.sched.sp
	switch GOARCH {
	default:
		throw("cgocallbackg is unimplemented on arch")
	case "arm":
		// On arm, stack frame is two words and there's a saved LR between
		// SP and the stack frame and between the stack frame and the arguments.
		cb = (*args)(unsafe.Pointer(sp + 4*sys.PtrSize))
	case "arm64":
		// On arm64, stack frame is four words and there's a saved LR between
		// SP and the stack frame and between the stack frame and the arguments.
		// Additional two words (16-byte alignment) are for saving FP.
		cb = (*args)(unsafe.Pointer(sp + 7*sys.PtrSize))
	case "amd64":
		// On amd64, stack frame is two words, plus caller PC.
		if framepointer_enabled {
			// In this case, there's also saved BP.
			cb = (*args)(unsafe.Pointer(sp + 4*sys.PtrSize))
			break
		}
		cb = (*args)(unsafe.Pointer(sp + 3*sys.PtrSize))
	case "386":
		// On 386, stack frame is three words, plus caller PC.
		cb = (*args)(unsafe.Pointer(sp + 4*sys.PtrSize))
	case "ppc64", "ppc64le", "s390x":
		// On ppc64 and s390x, the callback arguments are in the arguments area of
		// cgocallback's stack frame. The stack looks like this:
		// +--------------------+------------------------------+
		// |                    | ...                          |
		// | cgoexp_$fn         +------------------------------+
		// |                    | fixed frame area             |
		// +--------------------+------------------------------+
		// |                    | arguments area               |
		// | cgocallback        +------------------------------+ <- sp + 2*minFrameSize + 2*ptrSize
		// |                    | fixed frame area             |
		// +--------------------+------------------------------+ <- sp + minFrameSize + 2*ptrSize
		// |                    | local variables (2 pointers) |
		// | cgocallback_gofunc +------------------------------+ <- sp + minFrameSize
		// |                    | fixed frame area             |
		// +--------------------+------------------------------+ <- sp
		cb = (*args)(unsafe.Pointer(sp + 2*sys.MinFrameSize + 2*sys.PtrSize))
	case "mips64", "mips64le":
		// On mips64x, stack frame is two words and there's a saved LR between
		// SP and the stack frame and between the stack frame and the arguments.
		cb = (*args)(unsafe.Pointer(sp + 4*sys.PtrSize))
	case "mips", "mipsle":
		// On mipsx, stack frame is two words and there's a saved LR between
		// SP and the stack frame and between the stack frame and the arguments.
		cb = (*args)(unsafe.Pointer(sp + 4*sys.PtrSize))
	}

	// Invoke callback.
	// NOTE(rsc): passing nil for argtype means that the copying of the
	// results back into cb.arg happens without any corresponding write barriers.
	// For cgo, cb.arg points into a C stack frame and therefore doesn't
	// hold any pointers that the GC can find anyway - the write barrier
	// would be a no-op.
	reflectcall(nil, unsafe.Pointer(cb.fn), cb.arg, uint32(cb.argsize), 0)

	if raceenabled {
		racereleasemerge(unsafe.Pointer(&racecgosync))
	}
	if msanenabled {
		// Tell msan that we wrote to the entire argument block.
		// This tells msan that we set the results.
		// Since we have already called the function it doesn't
		// matter that we are writing to the non-result parameters.
		msanwrite(cb.arg, cb.argsize)
	}

	// Do not unwind m->g0->sched.sp.
	// Our caller, cgocallback, will do that.
	restore = false
}

func unwindm(restore *bool) {
	if *restore {
		// Restore sp saved by cgocallback during
		// unwind of g's stack (see comment at top of file).
		mp := acquirem()
		sched := &mp.g0.sched
		switch GOARCH {
		default:
			throw("unwindm not implemented")
		case "386", "amd64", "arm", "ppc64", "ppc64le", "mips64", "mips64le", "s390x", "mips", "mipsle":
			sched.sp = *(*uintptr)(unsafe.Pointer(sched.sp + sys.MinFrameSize))
		case "arm64":
			sched.sp = *(*uintptr)(unsafe.Pointer(sched.sp + 16))
		}

		// Do the accounting that cgocall will not have a chance to do
		// during an unwind.
		//
		// In the case where a Go call originates from C, ncgo is 0
		// and there is no matching cgocall to end.
		if mp.ncgo > 0 {
			mp.incgo = false
			mp.ncgo--
			osPreemptExtExit(mp)
		}

		releasem(mp)
	}

	// Undo the call to lockOSThread in cgocallbackg.
	// We must still stay on the same m.
	unlockOSThread()
}

// called from assembly
func badcgocallback() {
	throw("misaligned stack in cgocallback")
}

// called from (incomplete) assembly
func cgounimpl() {
	throw("cgo not implemented")
}

var racecgosync uint64 // represents possible synchronization in C code

// Pointer checking for cgo code.

// We want to detect all cases where a program that does not use
// unsafe makes a cgo call passing a Go pointer to memory that
// contains a Go pointer. Here a Go pointer is defined as a pointer
// to memory allocated by the Go runtime. Programs that use unsafe
// can evade this restriction easily, so we don't try to catch them.
// The cgo program will rewrite all possibly bad pointer arguments to
// call cgoCheckPointer, where we can catch cases of a Go pointer
// pointing to a Go pointer.

// Complicating matters, taking the address of a slice or array
// element permits the C program to access all elements of the slice
// or array. In that case we will see a pointer to a single element,
// but we need to check the entire data structure.

// The cgoCheckPointer call takes additional arguments indicating that
// it was called on an address expression. An additional argument of
// true means that it only needs to check a single element. An
// additional argument of a slice or array means that it needs to
// check the entire slice/array, but nothing else. Otherwise, the
// pointer could be anything, and we check the entire heap object,
// which is conservative but safe.

// When and if we implement a moving garbage collector,
// cgoCheckPointer will pin the pointer for the duration of the cgo
// call.  (This is necessary but not sufficient; the cgo program will
// also have to change to pin Go pointers that cannot point to Go
// pointers.)

// cgoCheckPointer checks if the argument contains a Go pointer that
// points to a Go pointer, and panics if it does.
func cgoCheckPointer(ptr interface{}, arg interface{}) {
	if debug.cgocheck == 0 {
		return
	}

	ep := efaceOf(&ptr)
	t := ep._type

	top := true
	if arg != nil && (t.kind&kindMask == kindPtr || t.kind&kindMask == kindUnsafePointer) {
		p := ep.data
		if t.kind&kindDirectIface == 0 {
			p = *(*unsafe.Pointer)(p)
		}
		if p == nil || !cgoIsGoPointer(p) {
			return
		}
		aep := efaceOf(&arg)
		switch aep._type.kind & kindMask {
		case kindBool:
			if t.kind&kindMask == kindUnsafePointer {
				// We don't know the type of the element.
				break
			}
			pt := (*ptrtype)(unsafe.Pointer(t))
			cgoCheckArg(pt.elem, p, true, false, cgoCheckPointerFail)
			return
		case kindSlice:
			// Check the slice rather than the pointer.
			ep = aep
			t = ep._type
		case kindArray:
			// Check the array rather than the pointer.
			// Pass top as false since we have a pointer
			// to the array.
			ep = aep
			t = ep._type
			top = false
		default:
			throw("can't happen")
		}
	}

	cgoCheckArg(t, ep.data, t.kind&kindDirectIface == 0, top, cgoCheckPointerFail)
}

const cgoCheckPointerFail = "cgo argument has Go pointer to Go pointer"
const cgoResultFail = "cgo result has Go pointer"

// cgoCheckArg is the real work of cgoCheckPointer. The argument p
// is either a pointer to the value (of type t), or the value itself,
// depending on indir. The top parameter is whether we are at the top
// level, where Go pointers are allowed.
func cgoCheckArg(t *_type, p unsafe.Pointer, indir, top bool, msg string) {
	if t.ptrdata == 0 || p == nil {
		// If the type has no pointers there is nothing to do.
		return
	}

	switch t.kind & kindMask {
	default:
		throw("can't happen")
	case kindArray:
		at := (*arraytype)(unsafe.Pointer(t))
		if !indir {
			if at.len != 1 {
				throw("can't happen")
			}
			cgoCheckArg(at.elem, p, at.elem.kind&kindDirectIface == 0, top, msg)
			return
		}
		for i := uintptr(0); i < at.len; i++ {
			cgoCheckArg(at.elem, p, true, top, msg)
			p = add(p, at.elem.size)
		}
	case kindChan, kindMap:
		// These types contain internal pointers that will
		// always be allocated in the Go heap. It's never OK
		// to pass them to C.
		panic(errorString(msg))
	case kindFunc:
		if indir {
			p = *(*unsafe.Pointer)(p)
		}
		if p == nil || !cgoIsGoPointer(p) {
			return
		}
		panic(errorString(msg))
	case kindInterface:
		it := *(**_type)(p)
		if it == nil {
			return
		}
		// A type known at compile time is OK since it's
		// constant. A type not known at compile time will be
		// in the heap and will not be OK.
		if inheap(uintptr(unsafe.Pointer(it))) {
			panic(errorString(msg))
		}
		p = *(*unsafe.Pointer)(add(p, sys.PtrSize))
		if !cgoIsGoPointer(p) {
			return
		}
		if !top {
			panic(errorString(msg))
		}
		cgoCheckArg(it, p, it.kind&kindDirectIface == 0, false, msg)
	case kindSlice:
		st := (*slicetype)(unsafe.Pointer(t))
		s := (*slice)(p)
		p = s.array
		if !cgoIsGoPointer(p) {
			return
		}
		if !top {
			panic(errorString(msg))
		}
		if st.elem.ptrdata == 0 {
			return
		}
		for i := 0; i < s.cap; i++ {
			cgoCheckArg(st.elem, p, true, false, msg)
			p = add(p, st.elem.size)
		}
	case kindString:
		ss := (*stringStruct)(p)
		if !cgoIsGoPointer(ss.str) {
			return
		}
		if !top {
			panic(errorString(msg))
		}
	case kindStruct:
		st := (*structtype)(unsafe.Pointer(t))
		if !indir {
			if len(st.fields) != 1 {
				throw("can't happen")
			}
			cgoCheckArg(st.fields[0].typ, p, st.fields[0].typ.kind&kindDirectIface == 0, top, msg)
			return
		}
		for _, f := range st.fields {
			if f.typ.ptrdata == 0 {
				continue
			}
			cgoCheckArg(f.typ, add(p, f.offset()), true, top, msg)
		}
	case kindPtr, kindUnsafePointer:
		if indir {
			p = *(*unsafe.Pointer)(p)
			if p == nil {
				return
			}
		}

		if !cgoIsGoPointer(p) {
			return
		}
		if !top {
			panic(errorString(msg))
		}

		cgoCheckUnknownPointer(p, msg)
	}
}

// cgoCheckUnknownPointer is called for an arbitrary pointer into Go
// memory. It checks whether that Go memory contains any other
// pointer into Go memory. If it does, we panic.
// The return values are unused but useful to see in panic tracebacks.
func cgoCheckUnknownPointer(p unsafe.Pointer, msg string) (base, i uintptr) {
	if inheap(uintptr(p)) {
		b, span, _ := findObject(uintptr(p), 0, 0)
		base = b
		if base == 0 {
			return
		}
		hbits := heapBitsForAddr(base)
		n := span.elemsize
		for i = uintptr(0); i < n; i += sys.PtrSize {
			if i != 1*sys.PtrSize && !hbits.morePointers() {
				// No more possible pointers.
				break
			}
			if hbits.isPointer() && cgoIsGoPointer(*(*unsafe.Pointer)(unsafe.Pointer(base + i))) {
				panic(errorString(msg))
			}
			hbits = hbits.next()
		}

		return
	}

	for _, datap := range activeModules() {
		if cgoInRange(p, datap.data, datap.edata) || cgoInRange(p, datap.bss, datap.ebss) {
			// We have no way to know the size of the object.
			// We have to assume that it might contain a pointer.
			panic(errorString(msg))
		}
		// In the text or noptr sections, we know that the
		// pointer does not point to a Go pointer.
	}

	return
}

// cgoIsGoPointer reports whether the pointer is a Go pointer--a
// pointer to Go memory. We only care about Go memory that might
// contain pointers.
//go:nosplit
//go:nowritebarrierrec
func cgoIsGoPointer(p unsafe.Pointer) bool {
	if p == nil {
		return false
	}

	if inHeapOrStack(uintptr(p)) {
		return true
	}

	for _, datap := range activeModules() {
		if cgoInRange(p, datap.data, datap.edata) || cgoInRange(p, datap.bss, datap.ebss) {
			return true
		}
	}

	return false
}

// cgoInRange reports whether p is between start and end.
//go:nosplit
//go:nowritebarrierrec
func cgoInRange(p unsafe.Pointer, start, end uintptr) bool {
	return start <= uintptr(p) && uintptr(p) < end
}

// cgoCheckResult is called to check the result parameter of an
// exported Go function. It panics if the result is or contains a Go
// pointer.
func cgoCheckResult(val interface{}) {
	if debug.cgocheck == 0 {
		return
	}

	ep := efaceOf(&val)
	t := ep._type
	cgoCheckArg(t, ep.data, t.kind&kindDirectIface == 0, false, cgoResultFail)
}
