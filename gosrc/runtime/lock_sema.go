// Copyright 2011 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// +build aix darwin netbsd openbsd plan9 solaris windows

package runtime

import (
	"runtime/internal/atomic"
	"unsafe"
)

// This implementation depends on OS-specific implementations of
//
//	func semacreate(mp *m)
//		Create a semaphore for mp, if it does not already have one.
//
//	func semasleep(ns int64) int32
//		If ns < 0, acquire m's semaphore and return 0.
//		If ns >= 0, try to acquire m's semaphore for at most ns nanoseconds.
//		Return 0 if the semaphore was acquired, -1 if interrupted or timed out.
//
//	func semawakeup(mp *m)
//		Wake up mp, which is or will soon be sleeping on its semaphore.
// 该实现取决于 OS 特定的实现：
//
//	func semacreate(mp *m)
//		如果 mp 还未拥有一个 semaphore 则创建一个
//
//	func semasleep(ns int64) int32
//		如果 ns < 0, 获取 m 的 semaphore 并返回 0
//		如果 ns >= 0, 尝试在至多 ns 纳秒内获取 m 的 semaphore
//		如果 semaphore 获取成功则返回 0，如果被中断或超时则返回 -1
//
//	func semawakeup(mp *m)
//		唤醒一个已经或即将在 semaphore 上休眠的 mp
//
const (
	locked uintptr = 1

	active_spin     = 4
	active_spin_cnt = 30
	passive_spin    = 1
)

func lock(l *mutex) {
	lockWithRank(l, getLockRank(l))
}

func lock2(l *mutex) {
	gp := getg()
	if gp.m.locks < 0 {
		throw("runtime·lock: lock count")
	}
	gp.m.locks++

	// Speculative grab for lock.
	// 对锁进行推测，如果成功上锁，则立刻返回
	if atomic.Casuintptr(&l.key, 0, locked) {
		return
	}
	// 否则上说失败，创建 semaphore，进一步处理
	semacreate(gp.m)

	// On uniprocessor's, no point spinning.
	// On multiprocessors, spin for ACTIVE_SPIN attempts.
	// 在单一处理器上时，spinning 没有意义
	// 在多个处理器上时，为 ACTIVE_SPIN 的尝试进行自旋
	spin := 0
	if ncpu > 1 {
		spin = active_spin // spin 最多四个
	}
Loop:
	for i := 0; ; i++ {
		v := atomic.Loaduintptr(&l.key)
		if v&locked == 0 { // 0&1==0，重新读发现此时已经处于解锁状态
			// 再次尝试进行加锁，如果成功，则加锁成功
			if atomic.Casuintptr(&l.key, v, v|locked) {
				return
			}
			// 否则将 i 清零重试
			i = 0
		}
		// 如果 loop 的次数小于自旋等待持有锁的数量
		// 则调用 PAUSE 指令 active_spin_cnt 次
		if i < spin {
			procyield(active_spin_cnt)
		} else if i < spin+passive_spin {
			// 如果 loop 次数小于 spin 和被动 spin 之和
			// 则调用 sched_yield 系统调用
			osyield()
		} else {
			// Someone else has it.
			// l->waitm points to a linked list of M's waiting
			// for this lock, chained through m->nextwaitm.
			// Queue this M.
			// 其他人拥有它
			// l->waitm 指向 M 上等待此 lock 的链表通过 m->nextwaitm 链接
			// 将此 M 入队
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
				// 已入队. 等待.
				semasleep(-1)
				i = 0
			}
		}
	}
}

func unlock(l *mutex) {
	unlockWithRank(l)
}

//go:nowritebarrier
// We might not be holding a p in this code.
// 在这段代码中可能并不持有 P
func unlock2(l *mutex) {
	gp := getg()
	var mp *m
	for {
		v := atomic.Loaduintptr(&l.key)
		// 如果此时处于上锁状态，则 cas 解锁
		if v == locked {
			if atomic.Casuintptr(&l.key, locked, 0) {
				break
			}
		} else {
			// Other M's are waiting for the lock.
			// Dequeue an M.
			// 否则其他 M 正在等待此锁
			// 将其他 M 出队
			mp = muintptr(v &^ locked).ptr()
			if atomic.Casuintptr(&l.key, v, uintptr(mp.nextwaitm)) {
				// Dequeued an M.  Wake it.
				// 从队列中取出一个 M，并唤醒
				semawakeup(mp)
				break
			}
		}
	}
	gp.m.locks--
	if gp.m.locks < 0 {
		throw("runtime·unlock: lock count")
	}
	if gp.m.locks == 0 && gp.preempt { // restore the preemption request in case we've cleared it in newstack
		gp.stackguard0 = stackPreempt
	}
}

// One-time notifications.
// 一次性通知.
func noteclear(n *note) {
	if GOOS == "aix" {
		// On AIX, semaphores might not synchronize the memory in some
		// rare cases. See issue #30189.
		atomic.Storeuintptr(&n.key, 0)
	} else {
		n.key = 0
	}
}

func notewakeup(n *note) {
	var v uintptr
	for {
		v = atomic.Loaduintptr(&n.key)
		if atomic.Casuintptr(&n.key, v, locked) {
			break
		}
	}

	// Successfully set waitm to locked.
	// What was it before?
	switch {
	case v == 0:
		// Nothing was waiting. Done.
	case v == locked:
		// Two notewakeups! Not allowed.
		throw("notewakeup - double wakeup")
	default:
		// Must be the waiting m. Wake it up.
		semawakeup((*m)(unsafe.Pointer(v)))
	}
}

func notesleep(n *note) {
	gp := getg()
	if gp != gp.m.g0 {
		throw("notesleep not on g0")
	}
	semacreate(gp.m)
	if !atomic.Casuintptr(&n.key, 0, uintptr(unsafe.Pointer(gp.m))) {
		// Must be locked (got wakeup).
		if n.key != locked {
			throw("notesleep - waitm out of sync")
		}
		return
	}
	// Queued. Sleep.
	gp.m.blocked = true
	if *cgo_yield == nil {
		semasleep(-1)
	} else {
		// Sleep for an arbitrary-but-moderate interval to poll libc interceptors.
		const ns = 10e6
		for atomic.Loaduintptr(&n.key) == 0 {
			semasleep(ns)
			asmcgocall(*cgo_yield, nil)
		}
	}
	gp.m.blocked = false
}

//go:nosplit
func notetsleep_internal(n *note, ns int64, gp *g, deadline int64) bool {
	// gp and deadline are logically local variables, but they are written
	// as parameters so that the stack space they require is charged
	// to the caller.
	// This reduces the nosplit footprint of notetsleep_internal.
	gp = getg()

	// Register for wakeup on n->waitm.
	if !atomic.Casuintptr(&n.key, 0, uintptr(unsafe.Pointer(gp.m))) {
		// Must be locked (got wakeup).
		if n.key != locked {
			throw("notetsleep - waitm out of sync")
		}
		return true
	}
	if ns < 0 {
		// Queued. Sleep.
		// 已入队. 休眠.
		gp.m.blocked = true
		if *cgo_yield == nil {
			semasleep(-1)
		} else {
			// Sleep in arbitrary-but-moderate intervals to poll libc interceptors.
			const ns = 10e6
			for semasleep(ns) < 0 {
				asmcgocall(*cgo_yield, nil)
			}
		}
		gp.m.blocked = false
		return true
	}

	deadline = nanotime() + ns
	for {
		// Registered. Sleep.
		gp.m.blocked = true
		if *cgo_yield != nil && ns > 10e6 {
			ns = 10e6
		}
		if semasleep(ns) >= 0 {
			gp.m.blocked = false
			// Acquired semaphore, semawakeup unregistered us.
			// Done.
			return true
		}
		if *cgo_yield != nil {
			asmcgocall(*cgo_yield, nil)
		}
		gp.m.blocked = false
		// Interrupted or timed out. Still registered. Semaphore not acquired.
		ns = deadline - nanotime()
		if ns <= 0 {
			break
		}
		// Deadline hasn't arrived. Keep sleeping.
	}

	// Deadline arrived. Still registered. Semaphore not acquired.
	// Want to give up and return, but have to unregister first,
	// so that any notewakeup racing with the return does not
	// try to grant us the semaphore when we don't expect it.
	for {
		v := atomic.Loaduintptr(&n.key)
		switch v {
		case uintptr(unsafe.Pointer(gp.m)):
			// No wakeup yet; unregister if possible.
			if atomic.Casuintptr(&n.key, v, 0) {
				return false
			}
		case locked:
			// Wakeup happened so semaphore is available.
			// Grab it to avoid getting out of sync.
			gp.m.blocked = true
			if semasleep(-1) < 0 {
				throw("runtime: unable to acquire - semaphore out of sync")
			}
			gp.m.blocked = false
			return true
		default:
			throw("runtime: unexpected waitm - semaphore out of sync")
		}
	}
}

func notetsleep(n *note, ns int64) bool {
	gp := getg()
	if gp != gp.m.g0 {
		throw("notetsleep not on g0")
	}
	semacreate(gp.m)
	return notetsleep_internal(n, ns, nil, 0)
}

// same as runtime·notetsleep, but called on user g (not g0)
// calls only nosplit functions between entersyscallblock/exitsyscall
func notetsleepg(n *note, ns int64) bool {
	gp := getg()
	if gp == gp.m.g0 {
		throw("notetsleepg on g0")
	}
	semacreate(gp.m)
	entersyscallblock()
	ok := notetsleep_internal(n, ns, nil, 0)
	exitsyscall()
	return ok
}

func beforeIdle(int64) (*g, bool) {
	return nil, false
}

func checkTimeouts() {}
