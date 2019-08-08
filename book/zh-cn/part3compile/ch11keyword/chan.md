# 关键字: chan 与 select

[TOC]

Tony Hoare 于 1977 年提出通信顺序进程（CSP）理论。
简单来说，CSP 的模型由并发执行的实体（线程或者进程）所组成，实体之间通过发送消息进行通信，
这里发送消息时使用的就是通道（channel）。也就是我们常说的
『 Don't communicate by sharing memory; share memory by communicating 』。

Go 语言实现了部分 CSP 理论，goroutine 就是 CSP 理论中的并发实体，而 channel 则对应 CSP 中的 channel。

## channel 的基本使用

channel 主要有两种：

- buffered channel: `make(chan interface{}, n)`
- unbuffered channel: `make(chan interface{})`

没有使用 make 创建的 channel 无法向其发送数据，相反会造成死锁。这两种 channel 的读写操作都非常简单：

```go
ch := make(chan interface{}, 10)
// 读
v <- ch
// 写
ch <- v
```

他们之间的本质区别在于其内存模型的差异，在垃圾回收器中我们讨论过了这些 Go 内存模型的差异：

- buffered channel: `ch <- v` < `v <- ch`
- buffered channel: `close(ch)` < `v <- ch & v == isZero(v)`
- unbuffered channel: `ch <- v` > `v <- ch`
- unbuffered channel: `len(ch) == C` => `从 channel 中收到第 k 个值` < `k+C 个值得发送完成`

直观上我们很好理解他们之间的差异，
对于 buffered channel 而言，内部有一个缓冲队列，数据会优先进入缓冲队列，而后被消费，即 `ch <- v` < `v <- ch`；
对于 unbuffered channel 而言，内部没有缓冲队列，`v <- ch` 会一直阻塞到 `ch <- v` 执行完毕，因此 `ch <- v` > `v <- ch`

Go 内建了 close() 函数来关闭一个 channel，但：

- 关闭一个已关闭的 channel 会导致 panic
- 向关闭的 channel 发送数据会导致 panic
- 向关闭的 channel 读取数据不会导致 panic，但读取的值为 channel 缓存数据的零值，可以通过第二个返回值来检查 channel 是否关闭

select 语句伴随 channel 一起出现，常见的用法是：

```go
select {
case ch <- v:
    // ...
default:
    // ...
}
```

或者：

```go
select {
case v := <- ch:
    // ...
default:
    // ...
}
```

用于处理多个不同类型的 v 的发送与接收，并提供默认处理方式。

## channel 底层结构

实现 channel 的结构并不神秘，本质上就是一个 mutex 锁 机上一个环状队列

```go
type hchan struct {
	qcount   uint           // 队列中的所有数据数
	dataqsiz uint           // 环形队列的大小
	buf      unsafe.Pointer // 指向大小为 dataqsiz 的数组
	elemsize uint16
	closed   uint32
	(...)
	recvq    waitq  // recv 等待列表，即（ <-ch ）
	sendq    waitq  // send 等待列表，即（ ch<- ）

	// lock 保护了 hchan 的所有字段，以及在此 channel 上阻塞的 sudog 的一些字段
	//
	// 当持有此锁时不改变其他 G 的状态（特别的，不 ready 一个 G），因为
	// 它会在栈收缩时发生死锁
	//
	lock mutex
}

type waitq struct { // 等待队列 sudog 双向队列
	first *sudog
	last  *sudog
}

// sudog 表示了一个等待队列中的 g，例如在一个 channel 中进行发送和接受
//
// sudog 是必要的，因为 g <-> 同步对象之间的关系是多对多。一个 g 可以在多个等待列表上，
// 因此可以有很多的 sudog 为一个 g 服务；并且很多 g 可能在等待同一个同步对象，
// 因此也会有很多 sudog 为一个同步对象服务。
//
// 所有的 sudog 分配在一个特殊的池中。使用 acquireSudog 和 releaseSudog 来分配并释放它们。
type sudog struct {
	// 下面的字段由这个 sudog 阻塞的通道的 hchan.lock 进行保护。
	// shrinkstack 依赖于它服务于 sudog 相关的 channel 操作。

	g *g

	// isSelect 表示 g 正在参与一个 select，因此 g.selectDone 必须以 CAS 的方式来避免唤醒时候的 data race。
	isSelect bool
	next     *sudog
	prev     *sudog
	elem     unsafe.Pointer // 数据元素（可能指向栈）

	// 下面的字段永远不会并发的被访问。对于 channel waitlink 只会被 g 访问
	// 对于 semaphores，所有的字段（包括上面的）只会在持有 semaRoot 锁时被访问

	acquiretime int64
	releasetime int64
	ticket      uint32
	parent      *sudog // semaRoot 二叉树
	waitlink    *sudog // g.waiting 列表或 semaRoot
	waittail    *sudog // semaRoot
	c           *hchan // channel
}
```

## channel 的创生

channel 的创建由编译器完成翻译工作：

```go
make(chan type, n)

=>

runtime.makechan(type, n)
```

而具体的 makechan 实现如下，从 `mallocgc` 可以看出，channel 总是在堆上进行分配，它们会被垃圾回收器进行回收，这也是为什么 channel 不一定总是需要显式进行关闭。

```go
// 将 hchan 的大小对齐
const hchanSize = unsafe.Sizeof(hchan{}) + uintptr(-int(unsafe.Sizeof(hchan{}))&7)

func makechan(t *chantype, size int) *hchan {
	elem := t.elem
	(...)

	// 检查 elem.size 和 size 的乘积是否溢出
	mem, overflow := math.MulUintptr(elem.size, uintptr(size))
	if overflow || mem > maxAlloc-hchanSize || size < 0 {
		panic(plainError("makechan: size out of range"))
	}

	// hchan 在当元素存储在 buf 切不包含指针时，不则不会包含需要被 GC 进行处理的指针，
	// buf 指向了相同的分配区，elemtype 则是恒定的。
	// SudoG 则被他们拥有的线程索引，因此他们无法被搜集。
	var c *hchan
	switch {
	case mem == 0:
		// 队列或元素大小为零
		c = (*hchan)(mallocgc(hchanSize, nil, true))
		// 竞争检查使用此位置进行同步
		c.buf = c.raceaddr()
	case elem.ptrdata == 0:
		// 元素不包含指针
		// 在一个调用中分配 hchan 和 buf
		c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
		c.buf = add(unsafe.Pointer(c), hchanSize)
	default:
		// 元素包含指针
		c = new(hchan)
		c.buf = mallocgc(mem, elem, true)
	}

	c.elemsize = uint16(elem.size)
	c.elemtype = elem
	c.dataqsiz = uint(size)

	(...)
	return c
}
```

channel 并不严格支持 `int64` 大小的缓冲，当 `make(chan type, n)` 中 n 为 int64 类型时，
运行时的实现仅仅只是将其强转为 int，提供了对 int 转型是否成功的检查：

```go
func makechan64(t *chantype, size int64) *hchan {
	if int64(int(size)) != size {
		panic(plainError("makechan: size out of range"))
	}

	return makechan(t, int(size))
}
```

## channel 的死亡

关闭 channel 主要是完成以下翻译工作：

```go
close(ch)

=>

runtime.closechan(ch)
```

具体的实现中，首先将 channel 阻塞自身的锁上，而后依次将阻塞在 channel 的 g 添加到一个
gList 中，当所有的 g 均从 channel 上移除时，可释放锁，并唤醒 gList 中的所有 reader 和 writer：

```go
func closechan(c *hchan) {
	if c == nil { // close 一个空的 channel 会 panic
		panic(plainError("close of nil channel"))
	}

	lock(&c.lock)
	if c.closed != 0 { // close 一个已经关闭的的 channel 会 panic
		unlock(&c.lock)
		panic(plainError("close of closed channel"))
	}

	(...)
	c.closed = 1

	var glist gList

	// 释放所有的读者
	// 此处的 reader 都是阻塞在 channel 上的，先统一将他们加到一个 gList 上
	for {
		sg := c.recvq.dequeue()
		if sg == nil { // 队列已空
			break
		}
		if sg.elem != nil {
			typedmemclr(c.elemtype, sg.elem) // 清零
			sg.elem = nil
		}
		if sg.releasetime != 0 {
			sg.releasetime = cputicks()
		}
		gp := sg.g
		gp.param = nil
		(...)
		glist.push(gp)
	}

	// 释放所有的写者 (panic)
	// 写者同理
	for {
		sg := c.sendq.dequeue()
		if sg == nil { // 队列已空
			break
		}
		sg.elem = nil
		if sg.releasetime != 0 {
			sg.releasetime = cputicks()
		}
		gp := sg.g
		gp.param = nil
		(...)
		glist.push(gp)
	}
	// 就绪所有的 G 时可释放 channel 的锁
	unlock(&c.lock)

	for !glist.empty() {
		gp := glist.pop()
		gp.schedlink = 0
		goready(gp, 3)
	}
}
```

## 向 channel 发送数据

发送数据完成的是如下的翻译过程：

```go
ch <- v

=>

runtime.chansend1(ch, v)
```

而本质上它会去调用更为通用的 `chansend`：

```go
//go:nosplit
func chansend1(c *hchan, elem unsafe.Pointer) {
	chansend(c, elem, true, getcallerpc())
}
```

chansend 的具体实现为：

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
	// 当向 nil channel 发送数据时，会调用 gopark
	// 而 gopark 会将当前的 goroutine 休眠，并用过第一个参数的 unlockf 来回调唤醒
	// 但此处传递的参数为 nil，因此向 channel 发送数据的 goroutine 和接收数据的 goroutine 都会阻塞，
	// 进而死锁
	if c == nil {
		if !block {
			return false
		}
		gopark(nil, nil, waitReasonChanSendNilChan, traceEvGoStop, 2)
		throw("unreachable")
	}

	(...)

	// Fast path: check for failed non-blocking operation without acquiring the lock.
	if !block && c.closed == 0 && ((c.dataqsiz == 0 && c.recvq.first == nil) ||
		(c.dataqsiz > 0 && c.qcount == c.dataqsiz)) {
		return false
	}

	var t0 int64
	if blockprofilerate > 0 {
		t0 = cputicks()
	}

	lock(&c.lock)

	if c.closed != 0 { // 不允许向已经 close 的 channel 发送数据
		unlock(&c.lock)
		panic(plainError("send on closed channel"))
	}

	// 1. 找到了阻塞在 channel 上的读者，直接发送
	if sg := c.recvq.dequeue(); sg != nil {
		send(c, sg, ep, func() { unlock(&c.lock) }, 3)
		return true
	}

	// 2. 判断 channel 中缓存是否仍然有空间剩余
	if c.qcount < c.dataqsiz {
		// 有空间剩余，入队
		qp := chanbuf(c, c.sendx)
		(...)
		typedmemmove(c.elemtype, qp, ep)
		c.sendx++
		if c.sendx == c.dataqsiz {
			c.sendx = 0
		}
		c.qcount++
		unlock(&c.lock)
		return true
	}

	if !block {
		unlock(&c.lock)
		return false
	}

	// 3. 阻塞在 channel 上，等待接收方接收数据
	gp := getg()
	mysg := acquireSudog()
	(...)
	c.sendq.enqueue(mysg)
	goparkunlock(&c.lock, waitReasonChanSend, traceEvGoBlockSend, 3)
	(...)

	// 唤醒
	gp.waiting = nil
	if gp.param == nil {
		if c.closed == 0 {
			throw("chansend: spurious wakeup")
		}
		panic(plainError("send on closed channel"))
	}
	gp.param = nil
	if mysg.releasetime > 0 {
		blockevent(mysg.releasetime-t0, 2)
	}
	mysg.c = nil
	releaseSudog(mysg)
	return true
}
```

最终的 send，将消息直接发送：

```go
func send(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
	(...)
	if sg.elem != nil {
		sendDirect(c.elemtype, sg, ep)
		sg.elem = nil
	}
	gp := sg.g
	unlockf()
	gp.param = unsafe.Pointer(sg)
	if sg.releasetime != 0 {
		sg.releasetime = cputicks()
	}
	goready(gp, skip+1)
}
func sendDirect(t *_type, sg *sudog, src unsafe.Pointer) {
    dst := sg.elem
	typeBitsBulkBarrier(t, uintptr(dst), uintptr(src), t.size)
	memmove(dst, src, t.size)
}
// 为了确保发送的数据能够被立刻观察到，需要写屏障支持
//go:nosplit
func typeBitsBulkBarrier(typ *_type, dst, src, size uintptr) {
	(...)
	if !writeBarrier.needed {
		return
	}
	ptrmask := typ.gcdata
	buf := &getg().m.p.ptr().wbBuf
	var bits uint32
	for i := uintptr(0); i < typ.ptrdata; i += sys.PtrSize {
		if i&(sys.PtrSize*8-1) == 0 {
			bits = uint32(*ptrmask)
			ptrmask = addb(ptrmask, 1)
		} else {
			bits = bits >> 1
		}
		if bits&1 != 0 {
			dstx := (*uintptr)(unsafe.Pointer(dst + i))
			srcx := (*uintptr)(unsafe.Pointer(src + i))
			if !buf.putFast(*dstx, *srcx) {
				wbBufFlush(nil, 0)
			}
		}
	}
}
```

## 从 channel 接收数据

接收数据主要是完成以下翻译工作：

```go
v <- ch

=>

runtime.chanrecv1(ch, v)
```

或者

```go
v, ok <- ch

=>

ok := runtime.chanrecv2(ch, v)
```

他们的本质都是调用 `runtime.chanrecv`：

```go
//go:nosplit
func chanrecv1(c *hchan, elem unsafe.Pointer) {
	chanrecv(c, elem, true)
}
//go:nosplit
func chanrecv2(c *hchan, elem unsafe.Pointer) (received bool) {
	_, received = chanrecv(c, elem, true)
	return
}
```

chansend 的具体实现为：

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
	(...)
	// nil channel，同 send，会导致两个 goroutine 的死锁
	if c == nil {
		if !block {
			return
		}
		gopark(nil, nil, waitReasonChanReceiveNilChan, traceEvGoStop, 2)
		throw("unreachable")
	}

	// Fast path: check for failed non-blocking operation without acquiring the lock.
	if !block && (c.dataqsiz == 0 && c.sendq.first == nil ||
		c.dataqsiz > 0 && atomic.Loaduint(&c.qcount) == 0) &&
		atomic.Load(&c.closed) == 0 {
		return
	}

	var t0 int64
	if blockprofilerate > 0 {
		t0 = cputicks()
	}

	lock(&c.lock)

    // 1. channel 已经 close，且 channel 中没有数据，则直接返回
	if c.closed != 0 && c.qcount == 0 {
		(...)
		unlock(&c.lock)
		if ep != nil {
			typedmemclr(c.elemtype, ep)
		}
		return true, false
	}

	// 2. 找到接收方，直接接收
	if sg := c.sendq.dequeue(); sg != nil {
		recv(c, sg, ep, func() { unlock(&c.lock) }, 3)
		return true, true
	}

	// 3. channel 的 buf 不空
	if c.qcount > 0 {
		// 直接从队列中接收
		qp := chanbuf(c, c.recvx)
		(...)
		if ep != nil {
			typedmemmove(c.elemtype, ep, qp)
		}
		typedmemclr(c.elemtype, qp)
		c.recvx++
		if c.recvx == c.dataqsiz {
			c.recvx = 0
		}
		c.qcount--
		unlock(&c.lock)
		return true, true
	}

	if !block {
		unlock(&c.lock)
		return false, false
	}

	// 4. 没有更多的发送方，阻塞 channel
	gp := getg()
	mysg := acquireSudog()
	(...)
	c.recvq.enqueue(mysg)
	goparkunlock(&c.lock, waitReasonChanReceive, traceEvGoBlockRecv, 3)

	(...)
	// 唤醒
	gp.waiting = nil
	if mysg.releasetime > 0 {
		blockevent(mysg.releasetime-t0, 2)
	}
	closed := gp.param == nil
	gp.param = nil
	mysg.c = nil
	releaseSudog(mysg)
	return true, !closed
}
```

```go
func chanbuf(c *hchan, i uint) unsafe.Pointer {
	return add(c.buf, uintptr(i)*uintptr(c.elemsize))
}
func recv(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
	if c.dataqsiz == 0 {
		(...)
		if ep != nil {
			// copy data from sender
			recvDirect(c.elemtype, sg, ep)
		}
	} else {
		// 队列已满
		// Queue is full. Take the item at the
		// head of the queue. Make the sender enqueue
		// its item at the tail of the queue. Since the
		// queue is full, those are both the same slot.
		qp := chanbuf(c, c.recvx)
		(...)
		// copy data from queue to receiver
		if ep != nil {
			typedmemmove(c.elemtype, ep, qp)
		}
		// copy data from sender to queue
		typedmemmove(c.elemtype, qp, sg.elem)
		c.recvx++
		if c.recvx == c.dataqsiz {
			c.recvx = 0
		}
		c.sendx = c.recvx // c.sendx = (c.sendx+1) % c.dataqsiz
	}
	sg.elem = nil
	gp := sg.g
	unlockf()
	gp.param = unsafe.Pointer(sg)
	if sg.releasetime != 0 {
		sg.releasetime = cputicks()
	}
	goready(gp, skip+1)
}
```

## select 的本质

select 的诸多用法其实本质上仍然是 channel 操作，编译器会完成如下翻译工作：

```go
// 编译器会将这段语法：
//
//	select {
//	case c <- v:
//		... foo
//	default:
//		... bar
//	}
//
// 转换为：
//
//	if selectnbsend(c, v) {
//		... foo
//	} else {
//		... bar
//	}
//
func selectnbsend(c *hchan, elem unsafe.Pointer) (selected bool) {
	return chansend(c, elem, false, getcallerpc())
}

// 编译器会将这段语法：
//
//	select {
//	case v = <-c:
//		... foo
//	default:
//		... bar
//	}
//
// 转换为：
//
//	if selectnbrecv(&v, c) {
//		... foo
//	} else {
//		... bar
//	}
//
func selectnbrecv(elem unsafe.Pointer, c *hchan) (selected bool) {
	selected, _ = chanrecv(c, elem, false)
	return
}

// 编译器会将这段语法：
//
//	select {
//	case v, ok = <-c:
//		... foo
//	default:
//		... bar
//	}
//
// 转换为
//
//	if c != nil && selectnbrecv2(&v, &ok, c) {
//		... foo
//	} else {
//		... bar
//	}
//
func selectnbrecv2(elem unsafe.Pointer, received *bool, c *hchan) (selected bool) {
	// TODO(khr): just return 2 values from this function, now that it is in Go.
	selected, *received = chanrecv(c, elem, false)
	return
}
```

## 总结

channel 的实现是一个典型的环形队列+mutex锁的实现，与 channel 同步出现的 select 更像是一个语法糖，其本质仍然是一个 `chansend` 和 `chanrecv` 的两个通用实现。

考虑到整个 channel 操作带锁的成本加高，官方也曾考虑过使用无锁 channel 的设计，但由于年代久远，该改进目前处于搁置状态 [Vyukov, 2014b]。

## 进一步阅读的参考文献

- [Vyukov, 2014a] [Dmitry Vyukov, Go channels on steroids, January 2014](https://docs.google.com/document/d/1yIAYmbvL3JxOKOjuCyon7JhW4cSv1wy5hC0ApeGMV9s/pub)
- [Vyukov, 2014b] [Dmitry Vyukov, runtime: lock-free channels, October 2014](https://github.com/golang/go/issues/8899)
- [Vyukov, 2014c] [Dmitry Vyukov, runtime: chans on steroids, October 2014](https://codereview.appspot.com/12544043)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)