# 8 runtime.note 与 runtime.mutex


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


## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)