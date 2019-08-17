# 调度器：运行时同步原语

[TOC]




`note` 和 `mutex` 分别是 Go 运行时实现的一次性通知机制和互斥锁机制，其实现是操作系统特定的，
这里讨论 darwin 和 linux 的分别基于 semaphore 和 futex 的实现，wasm 的实现我们放到其章节中专门讨论。

## runtime.note

### 结构

`note` 的结构本身并没有什么黑魔法，它自身只包含一个 `uintptr` 类型的标志。

```go
// 休眠与唤醒一次性事件.
// 在任何调用 notesleep 或 notewakeup 之前，必须调用 noteclear 来初始化这个 note
// 且只能有一个线程调用 notewakeup 一次。一旦 notewakeup 被调用后，notesleep 会返回。
// 随后的 notesleep 调用则会立即返回。
// 随后的 noteclear 必须在前一个 notesleep 返回前调用，例如 notewakeup 调用后
// 直接调用 noteclear 是不允许的。
//
// notetsleep 类似于 notesleep 但会在给定数量的纳秒时间后唤醒，即使事件尚未发生。
// 如果一个 goroutine 使用 notetsleep 来提前唤醒，则必须等待调用 noteclear，直到可以确定
// 没有其他 goroutine 正在调用 notewakeup。
//
// notesleep/notetsleep 通常在 g0 上调用，notetsleepg 类似于 notetsleep 但会在用户 g 上调用。
type note struct {
	// 基于 futex 的实现将其视为 uint32 key (linux)
	// 而基于 sema 实现则将其视为 M* waitm。 (darwin)
	// 以前作为 union 使用，但 union 会打破精确 GC
	key uintptr
}
```

### `noteclear`

`note` 通知被设计为调用前必须对其标志位进行复位，这就需要调用 `noteclear`：

```go
// darwin, runtime/lock_sema.go
func noteclear(n *note) {
	n.key = 0
}

// linux, runtime/lock_futex.go
func noteclear(n *note) {
	n.key = 0
}
```

### `notesleep`/`notetsleep`

### `notewakeup`

### `notetsleepg`

## runtime.mutex

### 结构

运行时的 `mutex` 互斥锁与 `note` 原理几乎一致，结构上也只有一个 `uintptr` 类型的 key：

```go
// 互斥锁。在无竞争的情况下，与自旋锁 spin lock（只是一些用户级指令）一样快，
// 但在争用路径 contention path 中，它们在内核中休眠。零值互斥锁为未加锁状态（无需初始化每个锁）。
type mutex struct {
	// 基于 futex 的实现将其视为 uint32 key (linux)
	// 而基于 sema 实现则将其视为 M* waitm。 (darwin)
	// 以前作为 union 使用，但 union 会打破精确 GC
	key uintptr
}
```

### `lock`

```go
const (
	locked uintptr = 1

	active_spin     = 4
	active_spin_cnt = 30
	passive_spin    = 1
)

func lock(l *mutex) {
	gp := getg()
	if gp.m.locks < 0 {
		throw("runtime·lock: lock count")
	}
	gp.m.locks++

	// Speculative grab for lock.
	if atomic.Casuintptr(&l.key, 0, locked) {
		return
	}
	semacreate(gp.m)

	// On uniprocessor's, no point spinning.
	// On multiprocessors, spin for ACTIVE_SPIN attempts.
	spin := 0
	if ncpu > 1 {
		spin = active_spin
	}
Loop:
	for i := 0; ; i++ {
		v := atomic.Loaduintptr(&l.key)
		if v&locked == 0 {
			// Unlocked. Try to lock.
			if atomic.Casuintptr(&l.key, v, v|locked) {
				return
			}
			i = 0
		}
		if i < spin {
			procyield(active_spin_cnt)
		} else if i < spin+passive_spin {
			osyield()
		} else {
			// Someone else has it.
			// l->waitm points to a linked list of M's waiting
			// for this lock, chained through m->nextwaitm.
			// Queue this M.
			for {
				gp.m.nextwaitm = muintptr(v &^ locked)
				if atomic.Casuintptr(&l.key, v, uintptr(unsafe.Pointer(gp.m))|locked) {
					break
				}
				v = atomic.Loaduintptr(&l.key)
				if v&locked == 0 {
					continue Loop
				}
			}
			if v&locked != 0 {
				// Queued. Wait.
				semasleep(-1)
				i = 0
			}
		}
	}
}
```

`procyield` 内部实现什么也不做，只是反复调用 PAUSE 指令 30 次。

```asm
TEXT runtime·procyield(SB),NOSPLIT,$0-0
	MOVL	cycles+0(FP), AX
again:
	PAUSE
	SUBL	$1, AX
	JNZ	again
	RET
```

`osyield` 则是系统调用 `sched_yield` 的封装：

```asm
TEXT runtime·osyield(SB),NOSPLIT,$0
	MOVL	$SYS_sched_yield, AX
	SYSCALL
	RET
```

### `unlock`

## semaphore

sync 包中 Mutex 的实现依赖运行时中关于 `runtime_Semacquire` 与 `runtime_Semrelease` 的实现。
他们对应于运行时的 `sync_runtime_Semacquire` 和 `sync_runtime_Semrelease` 函数。

```go
//go:linkname sync_runtime_Semacquire sync.runtime_Semacquire
func sync_runtime_Semacquire(addr *uint32) {
	semacquire1(addr, false, semaBlockProfile, 0)
}
//go:linkname sync_runtime_Semrelease sync.runtime_Semrelease
func sync_runtime_Semrelease(addr *uint32, handoff bool, skipframes int) {
	semrelease1(addr, handoff, skipframes)
}
```

可以看到他们均为运行时中的 `semacquire1` 和 `semrelease1` 函数。

先来看 `semacquire1`。

```go
func semacquire1(addr *uint32, lifo bool, profile semaProfileFlags, skipframes int) {
	// 获取当前 goroutine
	// 该调用发生在 goroutine 运行时，所以有绑定的 P
	gp := getg()
	if gp != gp.m.curg {
		throw("semacquire not on the G stack")
	}

	// 简单情况，直接 acquire 成功
	if cansemacquire(addr) {
		return
	}

	// 比较难情况
	//	增加等待计数
	//	再试一次 cansemacquire 如果成功则直接返回
	//	将自己作为等待器入队
	//	休眠
	//	(等待器描述符由出队信号产生出队行为)
	s := acquireSudog()
	root := semroot(addr)
	t0 := int64(0)
	s.releasetime = 0
	s.acquiretime = 0
	s.ticket = 0
	if profile&semaBlockProfile != 0 && blockprofilerate > 0 {
		t0 = cputicks()
		s.releasetime = -1
	}
	if profile&semaMutexProfile != 0 && mutexprofilerate > 0 {
		if t0 == 0 {
			t0 = cputicks()
		}
		s.acquiretime = t0
	}
	for {
		lock(&root.lock)
		// Add ourselves to nwait to disable "easy case" in semrelease.
		atomic.Xadd(&root.nwait, 1)
		// Check cansemacquire to avoid missed wakeup.
		if cansemacquire(addr) {
			atomic.Xadd(&root.nwait, -1)
			unlock(&root.lock)
			break
		}
		// Any semrelease after the cansemacquire knows we're waiting
		// (we set nwait above), so go to sleep.
		root.queue(addr, s, lifo)
		goparkunlock(&root.lock, waitReasonSemacquire, traceEvGoBlockSync, 4+skipframes)
		if s.ticket != 0 || cansemacquire(addr) {
			break
		}
	}
	if s.releasetime > 0 {
		blockevent(s.releasetime-t0, 3+skipframes)
	}
	releaseSudog(s)
}
```

```go
func cansemacquire(addr *uint32) bool {
	for {
		v := atomic.Load(addr)
		// 如果地址中的值为 0 则不能处理，即保证不为负
		if v == 0 {
			return false
		}
		// 比较并执行减一，如果成功则返回 true
		if atomic.Cas(addr, v, v-1) {
			return true
		}
		// 否则继续 acquire
	}
}
```

```go
//go:nosplit
func acquireSudog() *sudog {
	mp := acquirem()
	pp := mp.p.ptr()
	if len(pp.sudogcache) == 0 {
		lock(&sched.sudoglock)
		// First, try to grab a batch from central cache.
		for len(pp.sudogcache) < cap(pp.sudogcache)/2 && sched.sudogcache != nil {
			s := sched.sudogcache
			sched.sudogcache = s.next
			s.next = nil
			pp.sudogcache = append(pp.sudogcache, s)
		}
		unlock(&sched.sudoglock)
		// If the central cache is empty, allocate a new one.
		if len(pp.sudogcache) == 0 {
			pp.sudogcache = append(pp.sudogcache, new(sudog))
		}
	}
	n := len(pp.sudogcache)
	s := pp.sudogcache[n-1]
	pp.sudogcache[n-1] = nil
	pp.sudogcache = pp.sudogcache[:n-1]
	if s.elem != nil {
		throw("acquireSudog: found s.elem != nil in cache")
	}
	releasem(mp)
	return s
}
```

```go
func semroot(addr *uint32) *semaRoot {
	return &semtable[(uintptr(unsafe.Pointer(addr))>>3)%semTabSize].root
}
```


```go
type semaRoot struct {
	lock  mutex
	treap *sudog
	nwait uint32
}
func (root *semaRoot) queue(addr *uint32, s *sudog, lifo bool) {
	s.g = getg()
	s.elem = unsafe.Pointer(addr)
	s.next = nil
	s.prev = nil

	var last *sudog
	pt := &root.treap
	for t := *pt; t != nil; t = *pt {
		if t.elem == unsafe.Pointer(addr) {
			// Already have addr in list.
			if lifo {
				// Substitute s in t's place in treap.
				*pt = s
				s.ticket = t.ticket
				s.acquiretime = t.acquiretime
				s.parent = t.parent
				s.prev = t.prev
				s.next = t.next
				if s.prev != nil {
					s.prev.parent = s
				}
				if s.next != nil {
					s.next.parent = s
				}
				// Add t first in s's wait list.
				s.waitlink = t
				s.waittail = t.waittail
				if s.waittail == nil {
					s.waittail = t
				}
				t.parent = nil
				t.prev = nil
				t.next = nil
				t.waittail = nil
			} else {
				// Add s to end of t's wait list.
				if t.waittail == nil {
					t.waitlink = s
				} else {
					t.waittail.waitlink = s
				}
				t.waittail = s
				s.waitlink = nil
			}
			return
		}
		last = t
		if uintptr(unsafe.Pointer(addr)) < uintptr(t.elem) {
			pt = &t.prev
		} else {
			pt = &t.next
		}
	}

	s.ticket = fastrand() | 1
	s.parent = last
	*pt = s

	// Rotate up into tree according to ticket (priority).
	for s.parent != nil && s.parent.ticket > s.ticket {
		if s.parent.prev == s {
			root.rotateRight(s.parent)
		} else {
			if s.parent.next != s {
				panic("semaRoot queue")
			}
			root.rotateLeft(s.parent)
		}
	}
}
```


```go
//go:nosplit
func releaseSudog(s *sudog) {
	(...)
	gp := getg()
	(...)
	mp := acquirem() // avoid rescheduling to another P
	pp := mp.p.ptr()
	if len(pp.sudogcache) == cap(pp.sudogcache) {
		// Transfer half of local cache to the central cache.
		var first, last *sudog
		for len(pp.sudogcache) > cap(pp.sudogcache)/2 {
			n := len(pp.sudogcache)
			p := pp.sudogcache[n-1]
			pp.sudogcache[n-1] = nil
			pp.sudogcache = pp.sudogcache[:n-1]
			if first == nil {
				first = p
			} else {
				last.next = p
			}
			last = p
		}
		lock(&sched.sudoglock)
		last.next = sched.sudogcache
		sched.sudogcache = first
		unlock(&sched.sudoglock)
	}
	pp.sudogcache = append(pp.sudogcache, s)
	releasem(mp)
}
```

### semrelease1

```go
func semrelease1(addr *uint32, handoff bool) {
	root := semroot(addr)
	atomic.Xadd(addr, 1)

	// Easy case: no waiters?
	// This check must happen after the xadd, to avoid a missed wakeup
	// (see loop in semacquire).
	if atomic.Load(&root.nwait) == 0 {
		return
	}

	// Harder case: search for a waiter and wake it.
	lock(&root.lock)
	if atomic.Load(&root.nwait) == 0 {
		// The count is already consumed by another goroutine,
		// so no need to wake up another goroutine.
		unlock(&root.lock)
		return
	}
	s, t0 := root.dequeue(addr)
	if s != nil {
		atomic.Xadd(&root.nwait, -1)
	}
	unlock(&root.lock)
	if s != nil { // May be slow, so unlock first
		acquiretime := s.acquiretime
		if acquiretime != 0 {
			mutexevent(t0-acquiretime, 3)
		}
		if s.ticket != 0 {
			throw("corrupted semaphore ticket")
		}
		if handoff && cansemacquire(addr) {
			s.ticket = 1
		}
		readyWithTime(s, 5)
	}
}
```


```go
func (root *semaRoot) dequeue(addr *uint32) (found *sudog, now int64) {
	ps := &root.treap
	s := *ps
	for ; s != nil; s = *ps {
		if s.elem == unsafe.Pointer(addr) {
			goto Found
		}
		if uintptr(unsafe.Pointer(addr)) < uintptr(s.elem) {
			ps = &s.prev
		} else {
			ps = &s.next
		}
	}
	return nil, 0

Found:
	now = int64(0)
	if s.acquiretime != 0 {
		now = cputicks()
	}
	if t := s.waitlink; t != nil {
		// Substitute t, also waiting on addr, for s in root tree of unique addrs.
		*ps = t
		t.ticket = s.ticket
		t.parent = s.parent
		t.prev = s.prev
		if t.prev != nil {
			t.prev.parent = t
		}
		t.next = s.next
		if t.next != nil {
			t.next.parent = t
		}
		if t.waitlink != nil {
			t.waittail = s.waittail
		} else {
			t.waittail = nil
		}
		t.acquiretime = now
		s.waitlink = nil
		s.waittail = nil
	} else {
		// Rotate s down to be leaf of tree for removal, respecting priorities.
		for s.next != nil || s.prev != nil {
			if s.next == nil || s.prev != nil && s.prev.ticket < s.next.ticket {
				root.rotateRight(s)
			} else {
				root.rotateLeft(s)
			}
		}
		// Remove s, now a leaf.
		if s.parent != nil {
			if s.parent.prev == s {
				s.parent.prev = nil
			} else {
				s.parent.next = nil
			}
		} else {
			root.treap = nil
		}
	}
	s.parent = nil
	s.elem = nil
	s.next = nil
	s.prev = nil
	s.ticket = 0
	return s, now
}
```


```go
//go:linkname mutexevent sync.event
func mutexevent(cycles int64, skip int) {
	if cycles < 0 {
		cycles = 0
	}
	rate := int64(atomic.Load64(&mutexprofilerate))
	// TODO(pjw): measure impact of always calling fastrand vs using something
	// like malloc.go:nextSample()
	if rate > 0 && int64(fastrand())%rate == 0 {
		saveblockevent(cycles, skip+1, mutexProfile)
	}
}
func saveblockevent(cycles int64, skip int, which bucketType) {
	gp := getg()
	var nstk int
	var stk [maxStack]uintptr
	if gp.m.curg == nil || gp.m.curg == gp {
		nstk = callers(skip, stk[:])
	} else {
		nstk = gcallers(gp.m.curg, skip, stk[:])
	}
	lock(&proflock)
	b := stkbucket(which, 0, stk[:nstk], true)
	b.bp().count++
	b.bp().cycles += cycles
	unlock(&proflock)
}
```

```go
func readyWithTime(s *sudog, traceskip int) {
	if s.releasetime != 0 {
		s.releasetime = cputicks()
	}
	goready(s.g, traceskip)
}
func goready(gp *g, traceskip int) {
	systemstack(func() {
		ready(gp, traceskip, true)
	})
}
// 将 gp 标记为 ready 来运行
func ready(gp *g, traceskip int, next bool) {
	if trace.enabled {
		traceGoUnpark(gp, traceskip)
	}

	status := readgstatus(gp)

	// 标记为 runnable.
	_g_ := getg()
	_g_.m.locks++ // 禁止抢占，因为它可以在局部变量中保存 p
	if status&^_Gscan != _Gwaiting {
		dumpgstatus(gp)
		throw("bad g->status in ready")
	}

	// 状态为 Gwaiting 或 Gscanwaiting, 标记 Grunnable 并将其放入运行队列 runq
	casgstatus(gp, _Gwaiting, _Grunnable)
	runqput(_g_.m.p.ptr(), gp, next)
	if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 {
		wakep()
	}
	_g_.m.locks--
	if _g_.m.locks == 0 && _g_.preempt { // 在 newstack 中已经清除它的情况下恢复抢占请求
		_g_.stackguard0 = stackPreempt
	}
}
```

## 总结

TODO:

[返回目录](./readme.md) | [上一节](./preemptive.md) | [下一节 过去、现在与未来](./history.md)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)