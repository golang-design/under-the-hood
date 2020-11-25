---
weight: 2307
title: "8.7 安全点分析"
---

# 8.7 安全点分析



<!-- + enlistWorker
+ gcStart: gcbgmarkworker
+ gcStart: marktermination -->

## 回收的安全点

什么时候才能进行抢占呢？如何才能区分该抢占信号是运行时发出的还是用户代码发出的呢？
TODO:
<!-- 例如 GC 标记阶段的存活指针， -->

TODO: 解释执行栈映射补充寄存器映射，中断信号 SIGURG

```go
// wantAsyncPreempt 返回异步抢占是否被 gp 请求
func wantAsyncPreempt(gp *g) bool {
	// 同时检查 G 和 P
	return (gp.preempt || gp.m.p != 0 && gp.m.p.ptr().preempt) && readgstatus(gp)&^_Gscan == _Grunning
}
```

什么时候才是安全的异步抢占点呢？
TODO:

```go
func isAsyncSafePoint(gp *g, pc, sp, lr uintptr) bool {
	mp := gp.m

	// Only user Gs can have safe-points. We check this first
	// because it's extremely common that we'll catch mp in the
	// scheduler processing this G preemption.
	if mp.curg != gp {
		return false
	}

	// Check M state.
	if mp.p == 0 || !canPreemptM(mp) {
		return false
	}

	// Check stack space.
	if sp < gp.stack.lo || sp-gp.stack.lo < asyncPreemptStack {
		return false
	}

	// Check if PC is an unsafe-point.
	f := findfunc(pc)
	if !f.valid() {
		// Not Go code.
		return false
	}
	...
	smi := pcdatavalue(f, _PCDATA_RegMapIndex, pc, nil)
	if smi == -2 {
		// Unsafe-point marked by compiler. This includes
		// atomic sequences (e.g., write barrier) and nosplit
		// functions (except at calls).
		return false
	}
	if fd := funcdata(f, _FUNCDATA_LocalsPointerMaps); fd == nil || fd == unsafe.Pointer(&no_pointers_stackmap) {
		// This is assembly code. Don't assume it's
		// well-formed. We identify assembly code by
		// checking that it has either no stack map, or
		// no_pointers_stackmap, which is the stack map
		// for ones marked as NO_LOCAL_POINTERS.
		//
		// TODO: Are there cases that are safe but don't have a
		// locals pointer map, like empty frame functions?
		return false
	}
	if hasPrefix(funcname(f), "runtime.") ||
		hasPrefix(funcname(f), "runtime/internal/") ||
		hasPrefix(funcname(f), "reflect.") {
		// For now we never async preempt the runtime or
		// anything closely tied to the runtime. Known issues
		// include: various points in the scheduler ("don't
		// preempt between here and here"), much of the defer
		// implementation (untyped info on stack), bulk write
		// barriers (write barrier check),
		// reflect.{makeFuncStub,methodValueCall}.
		//
		// TODO(austin): We should improve this, or opt things
		// in incrementally.
		return false
	}

	return true
}
```

#### 其他抢占触发点

TODO: 一些 GC 的处理， suspendG

preemptStop 会在什么时候被设置为抢占呢？GC。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
