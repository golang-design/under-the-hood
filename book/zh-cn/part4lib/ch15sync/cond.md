---
weight: 4106
title: "15.6 条件变量"
---

# 15.6 条件变量

[TOC]

sync.Cond 在生产者消费者模型中非常典型，带有互斥锁的队列当元素满时，
如果生产在向队列插入元素时将队列锁住，会产生既不能读，也不能写的情况。
sync.Cond 就解决了这个问题。

```go
func main() {
    cond := sync.NewCond(new(sync.Mutex))
    condition := 0

    // 消费者
    go func() {
        for {
            // 消费者开始消费时，锁住
            cond.L.Lock()
            // 如果没有可消费的值，则等待
            for condition == 0 {
                cond.Wait()
            }
            // 消费
            condition--
            fmt.Printf("Consumer: %d\n", condition)

            // 唤醒一个生产者
            cond.Signal()
            // 解锁
            cond.L.Unlock()
        }
    }()

    // 生产者
    for {
        // 生产者开始生产
        cond.L.Lock()

        // 当生产太多时，等待消费者消费
        for condition == 100 {
            cond.Wait()
        }
        // 生产
        condition++
        fmt.Printf("Producer: %d\n", condition)

        // 通知消费者可以开始消费了
        cond.Signal()
        // 解锁
        cond.L.Unlock()
    }
}
```

我们来看一看内部的实现原理。

## 结构

sync.Cond 的内部结构包含一个锁（Locker）、通知列表（notifyList）以及一个复制检查器 copyChecker。

```go
type Locker interface {
	Lock()
	Unlock()
}
type Cond struct {
	L Locker

	notify  notifyList
	checker copyChecker
}
func NewCond(l Locker) *Cond {
	return &Cond{L: l}
}
```

L 的类型为 Locker 因此可以包含任何实现了 Lock 和 Unlock 的锁，这包括 Mutex 和 RWMutex。

## copyChecker

copyChecker 非常简单，它实现了一个 `check()` 方法，这个方法以 copyChecker 的指针作为 reciever，
因为 copyChecker 在一个 Cond 中并非指针，因此当 Cond 发生拷贝行为后，这个 reciever 会
发生变化，从而检测到拷贝行为，使用 panic 以警示用户：

```go
// copyChecker 保存指向自身的指针来检测对象的复制行为。
type copyChecker uintptr

func (c *copyChecker) check() {
	if uintptr(*c) != uintptr(unsafe.Pointer(c)) &&
		!atomic.CompareAndSwapUintptr((*uintptr)(c), 0, uintptr(unsafe.Pointer(c))) &&
		uintptr(*c) != uintptr(unsafe.Pointer(c)) {
		panic("sync.Cond is copied")
	}
}
```

## Wait / Signal / Broadcast

Wait/Signal/Broadcast 的是由同时列表来实现的，撇开 copyChecker，
Wait 无非就是向 notifyList 注册一个通知，而后阻塞到被通知，
Signal 则负责通知一个在 notifyList 注册过的 waiter 发出通知，
Broadcast 更是直接粗暴的向所有人都发出通知。

```go
// Wait 原子式的 unlock c.L， 并暂停执行调用的 goroutine。
// 在稍后执行后，Wait 会在返回前 lock c.L. 与其他系统不同，
// 除非被 Broadcase 或 Signal 唤醒，否则等待无法返回。
//
// 因为等待第一次 resume 时 c.L 没有被锁定，所以当 Wait 返回时，
// 调用者通常不能认为条件为真。相反，调用者应该在循环中使用 Wait()：
//
//    c.L.Lock()
//    for !condition() {
//        c.Wait()
//    }
//    ... make use of condition ...
//    c.L.Unlock()
//
func (c *Cond) Wait() {
	c.checker.check()
	t := runtime_notifyListAdd(&c.notify)
	c.L.Unlock()
	runtime_notifyListWait(&c.notify, t)
	c.L.Lock()
}
// Signal 唤醒一个等待 c 的 goroutine（如果存在）
//
// 在调用时它可以（不必须）持有一个 c.L
func (c *Cond) Signal() {
	c.checker.check()
	runtime_notifyListNotifyOne(&c.notify)
}
// Broadcast 唤醒等待 c 的所有 goroutine
//
// 调用时它可以（不必须）持久有个 c.L
func (c *Cond) Broadcast() {
	c.checker.check()
	runtime_notifyListNotifyAll(&c.notify)
}
```

那么它的核心实现其实就落到了 notifyList 上。

## notifyList

notifyList 结构本质上是一个队列：

```go
// notifyList 基于 ticket 实现通知列表
type notifyList struct {
	// wait 为下一个 waiter 的 ticket 编号
	// 在没有 lock 的情况下原子自增
	wait uint32

	// notify 是下一个被通知的 waiter 的 ticket 编号
	// 它可以在没有 lock 的情况下进行读取，但只有在持有 lock 的情况下才能进行写
	//
	// wait 和 notify 会产生 wrap around，只要它们 "unwrapped"
	// 的差别小于 2^31，这种情况可以被正确处理。对于 wrap around 的情况而言，
	// 我们需要超过 2^31+ 个 goroutine 阻塞在相同的 condvar 上，这是不可能的。
	//
	notify uint32

	// waiter 列表.
	lock mutex
	head *sudog
	tail *sudog
}
```

当一个 Cond 调用 Wait 方法时候，向 wait 字段加 1，并返回一个 ticket 编号：

```go
// notifyListAdd 将调用者添加到通知列表，以便接收通知。
// 调用者最终必须调用 notifyListWait 等待这样的通知，并传递返回的 ticket 编号。
//go:linkname notifyListAdd sync.runtime_notifyListAdd
func notifyListAdd(l *notifyList) uint32 {
	// 这可以并发调用，例如，当在 read 模式下保持 RWMutex 时从 sync.Cond.Wait 调用时。
	return atomic.Xadd(&l.wait, 1) - 1
}
```

而后使用这个 ticket 编号来等待通知，这个过程会将等待通知的 goroutine 进行停泊，进入等待状态，
并将其 M 与 P 解绑，从而将 G 从 M 身上剥离，放入等待队列 sudog 中：

```go
// notifyListWait 等待通知。如果在调用 notifyListAdd 后发送了一个，则立即返回。否则，它会阻塞。
//go:linkname notifyListWait sync.runtime_notifyListWait
func notifyListWait(l *notifyList, t uint32) {
	lock(&l.lock)

	// 如果 ticket 编号对应的 goroutine 已经被通知到，则立刻返回
	if less(t, l.notify) {
		unlock(&l.lock)
		return
	}
	s := acquireSudog()
	s.g = getg()
	s.ticket = t
	s.releasetime = 0
	t0 := int64(0)
	if blockprofilerate > 0 {
		t0 = cputicks()
		s.releasetime = -1
	}
	if l.tail == nil {
		l.head = s
	} else {
		l.tail.next = s
	}
	l.tail = s
	// 将 M/P/G 解绑，并将 G 调整为等待状态，放入 sudog 等待队列中
	goparkunlock(&l.lock, waitReasonSyncCondWait, traceEvGoBlockCond, 3)
	if t0 != 0 {
		blockevent(s.releasetime-t0, 2)
	}
	releaseSudog(s)
}
// 将当前 goroutine 置于等待状态并解锁 lock。
// 通过调用 goready(gp) 可让 goroutine 再次 runnable
func goparkunlock(lock *mutex, reason waitReason, traceEv byte, traceskip int) {
	gopark(parkunlock_c, unsafe.Pointer(lock), reason, traceEv, traceskip)
}
```

当调用 Signal 时，会有一个在等待的 goroutine 被通知到，具体过程就是从 sudog 列表中找到
要通知的 goroutine，而后将其 `goready` 来等待调度循环将其调度：

```go
// notifyListNotifyOne 通知列表中的一个条目
//go:linkname notifyListNotifyOne sync.runtime_notifyListNotifyOne
func notifyListNotifyOne(l *notifyList) {
	// Fast-path: 如果上次通知后没有新的 waiter
	// 则无需加锁
	if atomic.Load(&l.wait) == atomic.Load(&l.notify) {
		return
	}

	lock(&l.lock)

	// slow-path 的二次检查
	t := l.notify
	if t == atomic.Load(&l.wait) {
		unlock(&l.lock)
		return
	}

	// 更新下一个需要唤醒的 ticket 编号
	atomic.Store(&l.notify, t+1)

	// 尝试找到需要被通知的 g
	// 如果目前还没来得及入队，是无法找到的
	// 但是，当它看到通知编号已经发生改变是不会被 park 的
	//
	// 这个查找过程看起来是线性复杂度，但实际上很快就停了
	// 因为 g 的队列与获取编号不同，因而队列中会出现少量重排，但我们希望找到靠前的 g
	// 而 g 只有在不再 race 后才会排在靠前的位置，因此这个迭代也不会太久，
	// 同时，即便找不到 g，这个情况也成立：
	// 它还没有休眠，并且已经失去了我们在队列上找到的（少数）其他 g 的 race。
	for p, s := (*sudog)(nil), l.head; s != nil; p, s = s, s.next {
		if s.ticket == t {
			n := s.next
			if p != nil {
				p.next = n
			} else {
				l.head = n
			}
			if n == nil {
				l.tail = p
			}
			unlock(&l.lock)
			s.next = nil
			readyWithTime(s, 4)
			return
		}
	}
	unlock(&l.lock)
}
func readyWithTime(s *sudog, traceskip int) {
	if s.releasetime != 0 {
		s.releasetime = cputicks()
	}
	goready(s.g, traceskip)
}
```

如果是全员通知，基本类似：

```go
// notifyListNotifyAll 通知列表里的所有人
//go:linkname notifyListNotifyAll sync.runtime_notifyListNotifyAll
func notifyListNotifyAll(l *notifyList) {
	// Fast-path: 如果上次通知后没有新的 waiter
	// 则无需加锁
	if atomic.Load(&l.wait) == atomic.Load(&l.notify) {
		return
	}

	// 从列表中取一个，保存到局部变量，waiter 则可以在无锁的情况下 ready
	lock(&l.lock)
	s := l.head
	l.head = nil
	l.tail = nil

	// 更新要通知的下一个 ticket。
	// 可以将它设置为等待的当前值，因为任何以前的 waiter 已经在列表中，
	// 或者会他们在尝试将自己添加到列表时已经收到通知。
	atomic.Store(&l.notify, atomic.Load(&l.wait))
	unlock(&l.lock)

	// 遍历整个本地列表，并 ready 所有的 waiter
	for s != nil {
		next := s.next
		s.next = nil
		readyWithTime(s, 4)
		s = next
	}
}
```

比较简单，不再赘述。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)