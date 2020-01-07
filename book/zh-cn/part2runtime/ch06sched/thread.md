---
weight: 2104
title: "6.4 线程管理"
---

# 6.4 线程管理

[TOC]

Go 语言既然专门将线程进一步抽象为 goroutine，自然也就不希望我们对线程做过多的操作，事实也是如此，
大部分的用户代码并不需要线程级的操作。但某些情况下，当需要
使用 cgo 调用 C 端图形库（如 GLib）时，甚至需要将某个 goroutine 用户态代码一直在主线程上执行。
我们已经知道了 `runtime.LockOSThread` 会将当前 goroutine 锁在一个固定的 OS 线程上执行，
但是一旦开放了锁住某个 OS 线程后，会连带产生一些副作用。比如当系统级的编程实践总是需要对线程进行操作，
尤其是当用户态代码通过系统调用将 OS 线程所在的 Linux namespace 进行修改、把线程私有化时（系统调用
`unshare` 和标志位 `CLONE_NEWNS`），
其他 goroutine 已经不再适合在此 OS 线程上执行。这时候不得不将 M 永久的从运行时中移出，
通过[对调度器调度循环的分析](./exec.md)，得知了 `LockOSThread/UnlockOSThread`
也是目前唯一一个能够让 M 退出的做法（将 goroutine 锁在 OS 线程上，且在 goroutine 死亡退出时不调用 Unlock 方法）。
本节便进一步研究 Go 语言对用户态线程操作的支持和与之相关的运行时线程的管理。

## LockOSThread

LockOSThread 和 UnlockOSThread 在运行时包中分别提供了私有和公开的方法。
运行时私有的 lockOSThread 非常简单：

```go
//go:nosplit
func lockOSThread() {
	getg().m.lockedInt++
	dolockOSThread()
}
```

因为整个运行时只有在 `runtime.main` 调用 `main.init` 、和 cgo 的 C 调用 Go 时候才会使用，
其中 `main.init` 其实也是为了 cgo 里 Go 调用某些 C 图形库时需要主线程支持才使用的。
因此不需要做过多复杂的处理，直接在 m 上进行计数
（计数的原因在于安全性和始终上的一些处理，防止用户态代码误用，例如只调用了 Unlock 而没有先调用 Lock [MILLS et al., 2017]），
而后调用 `dolockOSThread` 将 g 与 m 互相锁定：

```go
// dolockOSThread 在修改 m.locked 后由 LockOSThread 和 lockOSThread 调用。
// 在此调用期间不允许抢占，否则此函数中的 m 可能与调用者中的 m 不同。
//go:nosplit
func dolockOSThread() {
	if GOARCH == "wasm" {
		return // no threads on wasm yet
	}
	_g_ := getg()
	_g_.m.lockedg.set(_g_)
	_g_.lockedm.set(_g_.m)
}
```

而用户态的公开方法则不同，还额外增加了一个模板线程的处理（随后解释），这也解释了运行时其实并不希望
模板线程的存在，只有当需要时才会懒加载：

```go
func LockOSThread() {
	if atomic.Load(&newmHandoff.haveTemplateThread) == 0 && GOOS != "plan9" {
		// 如果我们需要从锁定的线程启动一个新线程，我们需要模板线程。
		// 当我们处于一个已知良好的状态时，立即启动它。
		startTemplateThread()
	}
	_g_ := getg()
	_g_.m.lockedExt++
	if _g_.m.lockedExt == 0 {
		_g_.m.lockedExt--
		panic("LockOSThread nesting overflow")
	}
	dolockOSThread()
}
```

## UnlockOSThread

Unlock 的部分非常简单，减少计数，再实际 dounlock：

```go
func UnlockOSThread() {
	_g_ := getg()
	if _g_.m.lockedExt == 0 {
		return
	}
	_g_.m.lockedExt--
	dounlockOSThread()
}
//go:nosplit
func unlockOSThread() {
	_g_ := getg()
	if _g_.m.lockedInt == 0 {
		systemstack(badunlockosthread)
	}
	_g_.m.lockedInt--
	dounlockOSThread()
}
```

而且并无特殊处理，只是简单的将 `lockedg` 和 `lockedm` 两个字段清零：

```go
// dounlockOSThread 在更新 m->locked 后由 UnlockOSThread 和 unlockOSThread 调用。
// 在此调用期间不允许抢占，否则此函数中的 m 可能与调用者中的 m 不同。
//go:nosplit
func dounlockOSThread() {
	if GOARCH == "wasm" {
		return // no threads on wasm yet
	}
	_g_ := getg()
	if _g_.m.lockedInt != 0 || _g_.m.lockedExt != 0 {
		return
	}
	_g_.m.lockedg = 0
	_g_.lockedm = 0
}
```

## lockedg/lockedm 与调度循环

一个很自然的问题，为什么简单的设置 lockedg 和 lockedm 之后就能保证 g 只在一个 m 上执行了？
其实我们已经在调度循环中见过与之相关的代码了：

```go
// 调度器的一轮：找到 runnable goroutine 并进行执行且永不返回
func schedule() {
	_g_ := getg()

	if _g_.m.locks != 0 {
		throw("schedule: holding locks")
	}

	// m.lockedg 会在 lockosthread 下变为非零
	if _g_.m.lockedg != 0 {
		stoplockedm()
		execute(_g_.m.lockedg.ptr(), false) // 永不返回
	}
	...
}
```

调度循环在发现当前的 m 存在请求锁住执行的 g 时，不会进入后续 g 的偷取过程，
相反会直接调用 `stoplockedm`，将当前的 m 和 p 解绑，并 park 当前的 m，
直到可以再次调度 lockedg 为止，获取 p 并通过 `execute` 直接调度 lockedg ，
从而再次进入调度循环：

```go
// 停止当前正在执行锁住的 g 的 m 的执行，直到 g 重新变为 runnable。
// 返回获得的 P
func stoplockedm() {
	_g_ := getg()

	if _g_.m.lockedg == 0 || _g_.m.lockedg.ptr().lockedm.ptr() != _g_.m {
		throw("stoplockedm: inconsistent locking")
	}
	if _g_.m.p != 0 {
		// 调度其他 M 来运行此 P
		_p_ := releasep()
		handoffp(_p_)
	}
	incidlelocked(1)
	// 等待直到其他线程可以再次调度 lockedg
	notesleep(&_g_.m.park)
	noteclear(&_g_.m.park)
	status := readgstatus(_g_.m.lockedg.ptr())
	if status&^_Gscan != _Grunnable {
		print("runtime:stoplockedm: g is not Grunnable or Gscanrunnable\n")
		dumpgstatus(_g_)
		throw("stoplockedm: not runnable")
	}
	acquirep(_g_.m.nextp.ptr())
	_g_.m.nextp = 0
}
```

## 模板线程

前面已经提到过，锁住系统线程带来的隐患就是某个线程的状态可能被用户态代码过分的修改，
从而不再具有产出新线程的能力，模板线程就提供了一个备用线程，不会执行 g，只用于创建安全的 m。

模板线程会在第一次调用 `LockOSThread` 的时候被创建，并将 `haveTemplateThread`
标记为已经存在模板线程：

```go
// 如果模板线程尚未运行，则startTemplateThread将启动它。
//
// 调用线程本身必须处于已知良好状态。
func startTemplateThread() {
	if GOARCH == "wasm" { // no threads on wasm yet
		return
	}
	if !atomic.Cas(&newmHandoff.haveTemplateThread, 0, 1) {
		return
	}
	newm(templateThread, nil)
}
```

`tempalteThread` 这个函数会在 m 正式启动时被调用：

```go
// 创建一个新的 m. 它会启动并调用 fn 或调度器
// fn 必须是静态、非堆上分配的闭包
// 它可能在 m.p==nil 时运行，因此不允许 write barrier
//go:nowritebarrierrec
func newm(fn func(), _p_ *p) {
	// 分配一个 m
	mp := allocm(_p_, fn)
	...
}

//go:yeswritebarrierrec
func allocm(_p_ *p, fn func()) *m {
	...
	mp := new(m)
	mp.mstartfn = fn
	...
}

func mstart1() {
	...

	// 执行启动函数
	if fn := _g_.m.mstartfn; fn != nil {
		fn()
	}

	...
}
```

这个 `newmHandoff` 负责并串联了所有新创建的 m：

```go
// newmHandoff 包含需要新 OS 线程的 m 的列表。
// 在 newm 本身无法安全启动 OS 线程的情况下，newm 会使用它。
var newmHandoff struct {
	lock mutex

	// newm 指向需要新 OS 线程的M结构列表。 该列表通过 m.schedlink 链接。
	newm muintptr

	// waiting 表示当 m 列入列表时需要通知唤醒。
	waiting bool
	wake    note

	// haveTemplateThread 表示 templateThread 已经启动。没有锁保护，使用 cas 设置为 1。
	haveTemplateThread uint32
}
```

而模板线程本身不会退出，只会在需要的时，创建 m：

```go
// templateThread是处于已知良好状态的线程，仅当调用线程可能不是良好状态时，
// 该线程仅用于在已知良好状态下启动新线程。
//
// 许多程序不需要这个，所以当我们第一次进入可能导致在未知状态的线程上运行的状态时，
// templateThread会懒启动。
//
// templateThread 在没有 P 的 M 上运行，因此它必须没有写障碍。
//
//go:nowritebarrierrec
func templateThread() {
	lock(&sched.lock)
	sched.nmsys++
	checkdead()
	unlock(&sched.lock)

	for {
		lock(&newmHandoff.lock)
		for newmHandoff.newm != 0 {
			newm := newmHandoff.newm.ptr()
			newmHandoff.newm = 0
			unlock(&newmHandoff.lock)
			for newm != nil {
				next := newm.schedlink.ptr()
				newm.schedlink = 0
				newm1(newm)
				newm = next
			}
			lock(&newmHandoff.lock)
		}

		// 等待新的创建请求
		newmHandoff.waiting = true
		noteclear(&newmHandoff.wake)
		unlock(&newmHandoff.lock)
		notesleep(&newmHandoff.wake)
	}
}
```

当创建好 m 后，模板线程会休眠，直到创建新的 m 时候会被唤醒，这个我们在分析调度循环的时候已经看到过了：

```go
// 创建一个新的 m. 它会启动并调用 fn 或调度器
// fn 必须是静态、非堆上分配的闭包
// 它可能在 m.p==nil 时运行，因此不允许 write barrier
//go:nowritebarrierrec
func newm(fn func(), _p_ *p) {
	...
	if gp := getg(); gp != nil && gp.m != nil && (gp.m.lockedExt != 0 || gp.m.incgo) && GOOS != "plan9" {
		// 我们处于一个锁定的 M 或可能由 C 启动的线程。这个线程的内核状态可能
		// 很奇怪（用户可能已将其锁定）。我们不想将其克隆到另一个线程。
		// 相反，请求一个已知状态良好的线程来创建给我们的线程。
		//
		// 在 plan9 上禁用，见 golang.org/issue/22227
		//
		// TODO: This may be unnecessary on Windows, which
		// doesn't model thread creation off fork.
		lock(&newmHandoff.lock)
		if newmHandoff.haveTemplateThread == 0 {
			throw("on a locked thread with no template thread")
		}
		mp.schedlink = newmHandoff.newm
		newmHandoff.newm.set(mp)
		if newmHandoff.waiting {
			newmHandoff.waiting = false
			// 唤醒 m, spinning -> non-spinning
			notewakeup(&newmHandoff.wake)
		}
		unlock(&newmHandoff.lock)
		return
	}
	newm1(mp)
}
```

## 小结

LockOSThread 并不是什么优秀的特性，相反它却给 Go 运行时调度器带来了诸多管理上的难题。
它的存在仅仅只是需要提供对上个世纪 C 编写的诸多遗产提供必要支持，倘若 Go 的基础库能够更加丰富，
这项特性可能不复存在。

## 进一步阅读的参考文献

- [LOPEZ et al., 2016] [runtime: let idle OS threads exit](https://github.com/golang/go/issues/14592)
- [MILLS et al., 2017] [proposal: runtime: pair LockOSThread, UnlockOSThread calls](https://github.com/golang/go/issues/20458)
- [NAVYTUX et al., 2017] [runtime: big performance penalty with runtime.LockOSThread](https://github.com/golang/go/issues/21827)
- [RGOOCH et al., 2017] [runtime: terminate locked OS thread if its goroutine exits](https://github.com/golang/go/issues/20395)
- [TAYLOR et al., 2016] [runtime: unexpectedly large slowdown with runtime.LockOSThread](https://github.com/golang/go/issues/18023)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)