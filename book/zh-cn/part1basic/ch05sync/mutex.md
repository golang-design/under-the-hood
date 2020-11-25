---
weight: 1502
title: "5.2 互斥锁"
---

# 5.2 互斥锁



```go
type Mutex struct {
	state int32  // 表示 mutex 锁当前的状态
	sema  uint32 // 信号量，用于唤醒 goroutine
}
```

## 状态

```go
const (
	mutexLocked = 1 << iota // 互斥锁已锁住
	mutexWoken
	mutexStarving
	mutexWaiterShift = iota
	starvationThresholdNs = 1e6
)
```

Mutex 可能处于两种不同的模式：正常模式和饥饿模式。

在正常模式中，等待者按照 FIFO 的顺序排队获取锁，但是一个被唤醒的等待者有时候并不能获取 mutex，
它还需要和新到来的 goroutine 们竞争 mutex 的使用权。
新到来的 goroutine 存在一个优势，它们已经在 CPU 上运行且它们数量很多，
因此一个被唤醒的等待者有很大的概率获取不到锁，在这种情况下它处在等待队列的前面。
如果一个 goroutine 等待 mutex 释放的时间超过 1ms，它就会将 mutex 切换到饥饿模式

在饥饿模式中，mutex 的所有权直接从解锁的 goroutine 递交到等待队列中排在最前方的 goroutine。
新到达的 goroutine 们不要尝试去获取 mutex，即使它看起来是在解锁状态，也不要试图自旋，
而是排到等待队列的尾部。

如果一个等待者获得 mutex 的所有权，并且看到以下两种情况中的任一种：

1. 它是等待队列中的最后一个，
2. 它等待的时间少于 1ms，它便将 mutex 切换回正常操作模式

正常模式下的性能会更好，因为一个 goroutine 能在即使有很多阻塞的等待者时多次连续的获得一个 mutex，饥饿模式的重要性则在于避免了病态情况下的尾部延迟。

## 加锁

Lock 对申请锁的情况分为三种：

1. 无冲突，通过 CAS 操作把当前状态设置为加锁状态
2. 有冲突，开始自旋，并等待锁释放，如果其他 goroutine 在这段时间内释放该锁，直接获得该锁；如果没有释放则为下一种情况
3. 有冲突，且已经过了自旋阶段，通过调用 semrelease 让 goroutine 进入等待状态

```go
func (m *Mutex) Lock() {
	// 快速路径: 抓取并锁上未锁住状态的互斥锁
	if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
		(...)
		return
	}
	m.lockSlow()
}
func (m *Mutex) lockSlow() {
	var waitStartTime int64
	starving := false
	awoke := false
	iter := 0
	old := m.state
	for {
		// Don't spin in starvation mode, ownership is handed off to waiters
		// so we won't be able to acquire the mutex anyway.
		if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
			// Active spinning makes sense.
			// Try to set mutexWoken flag to inform Unlock
			// to not wake other blocked goroutines.
			if !awoke && old&mutexWoken == 0 && old>>mutexWaiterShift != 0 &&
				atomic.CompareAndSwapInt32(&m.state, old, old|mutexWoken) {
				awoke = true
			}
			runtime_doSpin()
			iter++
			old = m.state
			continue
		}
		new := old
		// Don't try to acquire starving mutex, new arriving goroutines must queue.
		if old&mutexStarving == 0 {
			new |= mutexLocked
		}
		if old&(mutexLocked|mutexStarving) != 0 {
			new += 1 << mutexWaiterShift
		}
		// The current goroutine switches mutex to starvation mode.
		// But if the mutex is currently unlocked, don't do the switch.
		// Unlock expects that starving mutex has waiters, which will not
		// be true in this case.
		if starving && old&mutexLocked != 0 {
			new |= mutexStarving
		}
		if awoke {
			// The goroutine has been woken from sleep,
			// so we need to reset the flag in either case.
			if new&mutexWoken == 0 {
				throw("sync: inconsistent mutex state")
			}
			new &^= mutexWoken
		}
		if atomic.CompareAndSwapInt32(&m.state, old, new) {
			if old&(mutexLocked|mutexStarving) == 0 {
				break // locked the mutex with CAS
			}
			// If we were already waiting before, queue at the front of the queue.
			queueLifo := waitStartTime != 0
			if waitStartTime == 0 {
				waitStartTime = runtime_nanotime()
			}
			runtime_SemacquireMutex(&m.sema, queueLifo, 1)
			starving = starving || runtime_nanotime()-waitStartTime > starvationThresholdNs
			old = m.state
			if old&mutexStarving != 0 {
				(...)
				delta := int32(mutexLocked - 1<<mutexWaiterShift)
				if !starving || old>>mutexWaiterShift == 1 {
					// Exit starvation mode.
					// Critical to do it here and consider wait time.
					// Starvation mode is so inefficient, that two goroutines
					// can go lock-step infinitely once they switch mutex
					// to starvation mode.
					delta -= mutexStarving
				}
				atomic.AddInt32(&m.state, delta)
				break
			}
			awoke = true
			iter = 0
		} else {
			old = m.state
		}
	}
	(...)
}
```

## 解锁

```go
func (m *Mutex) Unlock() {
	(...)

	// Fast path: drop lock bit.
	new := atomic.AddInt32(&m.state, -mutexLocked)
	if new != 0 {
		// Outlined slow path to allow inlining the fast path.
		// To hide unlockSlow during tracing we skip one extra frame when tracing GoUnblock.
		m.unlockSlow(new)
	}
}

func (m *Mutex) unlockSlow(new int32) {
	(...)
	if new&mutexStarving == 0 {
		old := new
		for {
			// If there are no waiters or a goroutine has already
			// been woken or grabbed the lock, no need to wake anyone.
			// In starvation mode ownership is directly handed off from unlocking
			// goroutine to the next waiter. We are not part of this chain,
			// since we did not observe mutexStarving when we unlocked the mutex above.
			// So get off the way.
			// 如果没有等待着，或者已经存在一个 goroutine 被唤醒或者得到锁，
			// 或处于饥饿模式，无需唤醒任何等待状态的 goroutine
			if old>>mutexWaiterShift == 0 || old&(mutexLocked|mutexWoken|mutexStarving) != 0 {
				return
			}
			// Grab the right to wake someone.
			new = (old - 1<<mutexWaiterShift) | mutexWoken
			if atomic.CompareAndSwapInt32(&m.state, old, new) {
				// 唤醒一个阻塞的 goroutine，但不是唤醒第一个等待者
				runtime_Semrelease(&m.sema, false, 1)
				return
			}
			old = m.state
		}
	} else {
		// Starving mode: handoff mutex ownership to the next waiter.
		// Note: mutexLocked is not set, the waiter will set it after wakeup.
		// But mutex is still considered locked if mutexStarving is set,
        // so new coming goroutines won't acquire it.
        // 饥饿模式: 直接将 mutex 所有权交给等待队列最前端的 goroutine
		runtime_Semrelease(&m.sema, true, 1)
	}
}
```

## 例：并发安全的单例模式

利用原子操作和互斥锁我们可以轻松实现一个非常简单的并发安全单例模式，即 sync.Once。

sync.Once 用来保证绝对一次执行的对象，例如可在单例的初始化中使用。
它内部的结构也相对简单：

```go
// Once 对象可以保证一个动作的绝对一次执行。
type Once struct {
	// done 表明某个动作是否被执行
	// 由于其使用频繁（热路径），故将其放在结构体的最上方
	// 热路径在每个调用点进行内嵌
	// 将 done 放在第一位，在某些架构下（amd64/x86）能获得更加紧凑的指令，
	// 而在其他架构下能更少的指令（用于计算其偏移量）。
	done uint32
	m    Mutex
}
```

<!-- https://go-review.googlesource.com/c/go/+/152697 -->
注意，这个结构在 Go 1.13 中得到了重新调整，在其之前 `done` 字段在 `m` 之后。

源码也非常简单：

```go
// Do 当且仅当第一次调用时，f 会被执行。换句话说，给定
// 	var once Once
// 如果 once.Do(f) 被多次调用则只有第一次会调用 f，即使每次提供的 f 不同。
// 每次执行必须新建一个 Once 实例。
//
// Do 用于变量的一次初始化，由于 f 是无参数的，因此有必要使用函数字面量来捕获参数：
// 	config.once.Do(func() { config.init(filename) })
//
// 因为该调用无返回值，因此如果 f 调用了 Do，则会导致死锁。
//
// 如果 f 发生 panic，则 Do 认为 f 已经返回；之后的调用也不会调用 f。
//
func (o *Once) Do(f func()) {
	// 原子读取 Once 内部的 done 属性，是否为 0，是则进入慢速路径，否则直接调用
	if atomic.LoadUint32(&o.done) == 0 {
		o.doSlow(f)
	}
}

func (o *Once) doSlow(f func()) {
	// 注意，我们只使用原子读读取了 o.done 的值，这是最快速的路径执行原子操作，即 fast-path
	// 但当我们需要确保在并发状态下，是不是有多个人读到 0，因此必须加锁，这个操作相对昂贵，即 slow-path
	o.m.Lock()
	defer o.m.Unlock()

	// 正好我们有一个并发的 goroutine 读到了 0，那么立即执行 f 并在结束时候调用原子写，将 o.done 修改为 1
	if o.done == 0 {
		defer atomic.StoreUint32(&o.done, 1)
		f()
	}
	// 当 o.done 为 0 的 goroutine 解锁后，其他人会继续加锁，这时会发现 o.done 已经为了 1 ，于是 f 已经不用在继续执行了
}
```

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).