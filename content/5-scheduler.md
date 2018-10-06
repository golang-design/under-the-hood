# 5 调度器

## 初始化

我们已经在 [2 初始化概览](2-init.md) 中粗略看过了 `schedinit` 函数，现在我们来仔细看看里面真正关于调度器的初始化步骤。

### M 初始化

TODO:

```go
func mcommoninit(mp *m) {
	_g_ := getg()

	// g0 栈对用户而言是没有意义的（且不是不可避免的）
	if _g_ != _g_.m.g0 {
		callers(1, mp.createstack[:])
	}

	lock(&sched.lock)
	if sched.mnext+1 < sched.mnext {
		throw("runtime: thread ID overflow")
	}
	mp.id = sched.mnext
	sched.mnext++
	checkmcount()

	mp.fastrand[0] = 1597334677 * uint32(mp.id)
	mp.fastrand[1] = uint32(cputicks())
	if mp.fastrand[0]|mp.fastrand[1] == 0 {
		mp.fastrand[1] = 1
	}

	mpreinit(mp)
	if mp.gsignal != nil {
		mp.gsignal.stackguard1 = mp.gsignal.stack.lo + _StackGuard
	}

	// Add to allm so garbage collector doesn't free g->m
	// when it is just in a register or thread-local storage.
	mp.alllink = allm

	// NumCgoCall() iterates over allm w/o schedlock,
	// so we need to publish it safely.
	atomicstorep(unsafe.Pointer(&allm), unsafe.Pointer(mp))
	unlock(&sched.lock)

	// Allocate memory to hold a cgo traceback if the cgo call crashes.
	if iscgo || GOOS == "solaris" || GOOS == "windows" {
		mp.cgoCallers = new(cgoCallers)
	}
}
```

### P 初始化

我们来看 `runtime.procresize` 函数。

TODO:

### G 初始化

运行完 `runtime.procresize` 之后，我们已经在 [1 引导](1-boot.md) 和 [3 主 goroutine 生命周期](3-main.md) 中已经看到，
主 goroutine 会以被调度器调度的方式进行运行，这将有 `runtime.newproc` 来完成主 goroutine 的初始化工作。
我们接下来就来看看 `runtime.newproc` 的过程。

TODO:

## 执行调度

TODO:

## 系统监控

本小节分析 `runtime.main` 在运行用户态代码前的 `newm(sysmon, nil)`。

TODO:

## 进一步阅读的参考文献

1. [Scalable Go Scheduler Design Doc](https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/edit#heading=h.mmq8lm48qfcw)
2. [Go Preemptive Scheduler Design Doc](https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit#heading=h.3pilqarbrc9h)
3. [NUMA-aware scheduler for Go](https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub)
4. [Scheduling Multithreaded Computations by Work Stealing](papers/steal.pdf)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)