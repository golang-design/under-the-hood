---
weight: 1505
title: "5.5 同步组"
---

# 5.5 同步组

sync.WaitGroup 可以达到并发 Goroutine 的执行屏障的效果，等待多个 Goroutine 执行完毕。

## 结构

我们首先来看 WaitGroup 的内部结构：

```go
// WaitGroup 用于等待一组 Goroutine 执行完毕。
// 主 Goroutine 调用 Add 来设置需要等待的 Goroutine 的数量
// 然后每个 Goroutine 运行并调用 Done 来确认已经执行网完毕
// 同时，Wait 可以用于阻塞并等待所有 Goroutine 完成。
//
// WaitGroup 在第一次使用后不能被复制
type WaitGroup struct {
	// 64 位值: 高 32 位用于计数，低 32 位用于等待计数
	// 64 位的原子操作要求 64 位对齐，但 32 位编译器无法保证这个要求
	// 因此分配 12 字节然后将他们对齐，其中 8 字节作为状态，其他 4 字节用于存储原语
	state1 [3]uint32
}
```

可以看到，WaitGroup 内部仅仅只是一个 uint32 类型的数组。由于需要考虑 32 位机器的兼容性，
这里采用了 uint32 结构的数组，保证在不同类型的机器上都是 12 个字节。

通过 `state()` 函数来确定实际的存储情况：

```go
// state 返回 wg.state1 中存储的状态和原语字段
func (wg *WaitGroup) state() (statep *uint64, semap *uint32) {
	if uintptr(unsafe.Pointer(&wg.state1))%8 == 0 {
		return (*uint64)(unsafe.Pointer(&wg.state1)), &wg.state1[2]
	}
	return (*uint64)(unsafe.Pointer(&wg.state1[1])), &wg.state1[0]
}
```

- 在 64 位机器上 `state1[0]` 和 `state1[1]` 分别用于等待计数和计数，而最后一个 `state1[2]` 用于存储原语。
- 在 32 位机器上 `state1[0]` 作为存储原语，而 `state[1]` 和 `state[2]` 用于等待计数和计数

## `Add()`/`Done()`

先来看简单的 Done 操作：

```go
func (wg *WaitGroup) Done() {
	wg.Add(-1)
}
```

所以 Done 调用本质上还是 Add 操作，再来看 Add：

```go
// Add 将 delta（可能为负）加到 WaitGroup 的计数器上
// 如果计数器归零，则所有阻塞在 Wait 的 Goroutine 被释放
// 如果计数器为负，则 panic
//
// 请注意，当计数器为 0 时发生的带有正的 delta 的调用必须在 Wait 之前。
// 当计数器大于 0 时，带有负 delta 的调用或带有正 delta 调用可能在任何时候发生。
// 通常，这意味着 Add 调用必须发生在 Goroutine 创建之前或其他被等待事件之前。
// 如果一个 WaitGroup 被复用于等待几个不同的独立事件集合，必须在前一个 Wait 调用返回后才能调用 Add。
func (wg *WaitGroup) Add(delta int) {
	// 首先获取状态指针和存储指针
	statep, semap := wg.state()

	(...)

	// 将 delta 加到 statep 的前 32 位上，即加到计数器上
	state := atomic.AddUint64(statep, uint64(delta)<<32)

	// 计数器的值
	v := int32(state >> 32)
	// 等待器的值
	w := uint32(state)

	(...)

	// 如果实际技术为负则直接 panic，因此是不允许计数为负值的
	if v < 0 {
		panic("sync: negative WaitGroup counter")
	}

	// 如果等待器不为零，但 delta 是处于增加的状态，而且存储计数与 delta 的值相同，则立即 panic
	if w != 0 && delta > 0 && v == int32(delta) {
		panic("sync: WaitGroup misuse: Add called concurrently with Wait")
	}

	// 如果计数器 > 0 或者等待器为 0 则一切都很好，直接返回
	if v > 0 || w == 0 {
		return
	}
    // 这时 Goroutine 已经将计数器清零，且等待器大于零（并发调用导致）
	// 这时不允许出现并发使用导致的状态突变，否则就应该 panic
	// - Add 不能与 Wait 并发调用
	// - Wait 在计数器已经归零的情况下，不能再继续增加等待器了
	// 仍然检查来保证 WaitGroup 不会被滥用
	if *statep != state {
		panic("sync: WaitGroup misuse: Add called concurrently with Wait")
	}
	// 结束后将等待器清零
	*statep = 0
	// 等待器大于零，减少 runtime_Semrelease 产生的阻塞
	for ; w != 0; w-- {
		runtime_Semrelease(semap, false, 0)
	}
}
```

Add 将 statep 的值作为两段来处理，前 32 位处理为计数器，后 32 位处理为等待器。

- 在初始阶段，等待器为 0 ，计数器随着 Add 正数的调用而增加。
- 如果 Add 使用错误导致计数器为负，则会立即 panic
- 由于并发的效果，计数器和等待器的值是分开操作的，因此可能出现计数器已经为零（说明当前 Add 的操作为负，即 Done），但等待器为正的情况，依次调用存储原语释放产生的阻塞（本质上为加 1 操作）

我们来考虑一个使用场景，首先刚创建的 WaitGroup 所有值为零：

```
statep 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000
```

这时候调用 Add(1)：

> 注意，有符号数为补码表示，最高位为符号位

```
int64(delta)      0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0001
int64(delta)<<32  0000 0000 0000 0000 0000 0000 0000 0001 0000 0000 0000 0000 0000 0000 0000 0000
statep            0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000
state             0000 0000 0000 0000 0000 0000 0000 0001 0000 0000 0000 0000 0000 0000 0000 0000
```

那么这时候的 `v` （计数器）为 1，而 `w` 等待器为 0。

再来执行一遍减一的操作。再减一之前：

```
statep            0000 0000 0000 0000 0000 0000 0000 0001 0000 0000 0000 0000 0000 0000 0000 0000
```

减一：

> 注意，有符号数为补码表示，最高位为符号位

```
int64(delta)      1111 1111 1111 1111 1111 1111 1111 1111 1111 1111 1111 1111 1111 1111 1111 1111
int64(delta)<<32  1111 1111 1111 1111 1111 1111 1111 1111 0000 0000 0000 0000 0000 0000 0000 0000
statep            0000 0000 0000 0000 0000 0000 0000 0001 0000 0000 0000 0000 0000 0000 0000 0000
state            10000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000
```

即计数器归零。

## `Wait()`

当 Add 和 Done 都被合理的设置后，我们希望等待所有的 Goroutine 结束，Wait 提供了这样的机制：

```go
// Wait 会保持阻塞直到 WaitGroup 计数器归零
func (wg *WaitGroup) Wait() {

	// 先获得计数器和存储原语
	statep, semap := wg.state()

	(...)

	// 一个简单的死循环，只有当计数器归零才会结束
	for {
		// 原子读
		state := atomic.LoadUint64(statep)
		// 计数
		v := int32(state >> 32)
		// 无符号计数
		w := uint32(state)

		// 如果计数器已经归零，则直接退出循环
		if v == 0 {
			(...)
			return
		}

		// 增加等待计数，此处的原语会比较 statep 和 state 的值，如果相同则等待计数加 1
		if atomic.CompareAndSwapUint64(statep, state, state+1) {
			(...)

			// 会阻塞到存储原语是否 > 0（即睡眠），如果 *semap > 0 则会减 1，因此最终的 semap 理论为 0
			runtime_Semacquire(semap)

			// 在这种情况下，如果 *semap 不等于 0 ，则说明使用失误，直接 panic
			if *statep != 0 {
				panic("sync: WaitGroup is reused before previous Wait has returned")
			}
			(...)
			return
		}
	}
}
```

可以看到 Wait 使用的是一个简单的死循环来进行操作。在循环体中，每次先读取计数器和等待器的值。
然后增加等待计数，如果增加成功，会调用 `runtime_Semacquire` 来阻塞当前的死循环，
直到存储原语的值被 `runtime_Semrelease` 减少后才会解除阻塞状态进入下一个循环。

我们来完成考虑一下整个流程：

```go
wg := sync.WaitGroup{}
wg.Add(1)
go func() { wg.Done() }()
wg.Wait()
```

在 wg 创建之初，计数器、等待器、存储原语的值均初始化为零值。不妨假设调用 `wg.Add(1)`，则计数器加 1
等待器、存储原语保持不变，均为 0。

`wg.Done()` 和 `wg.Wait()` 的调用顺序可能成两种情况：

**情况 1**：先调用 `wg.Done()` 再调用 `wg.Wait()`。

这时候 `wg.Done()` 使计数器减 1 ，这时计数器、等待器、存储原语均为 0，由于等待器为 0 则 `runtime_Semrelease` 不会被调用。
于是当 `wg.Wait()` 开始调用时，读取到计数器已经为 0，循环退出，`wg.Wait()` 调用完毕。

**情况 2**：先调用 `wg.Wait()` 再调用 `wg.Done()`。

这时候 `wg.Wait()` 开始调用时，读取到计数器为 1，则为等待器加 1，并调用 `runtime_Semacquire` 开始阻塞在存储原语为 0 的状态。

在阻塞的过程中，Goroutine 被调度器调度，开始执行 `wg.Done()`，于是计数器清零，但由于等待器为 1 大于零。
这时将等待器也清零，并调用与等待器技术相同次数（此处为 1 次）的 `runtime_Semrelease`，这导致存储原语的值变为 1，计数器和等待器均为零。
这时，`runtime_Semacquire` 在存储原语大于零后被唤醒，这时检查计数器和等待器是否为零（如果不为零则说明 Add 与 Wait 产生并发调用，直接 panic），这时他们为 0，因此进入下一个循环，当再次读取计数器时，发现计数器已经清理，于是退出 `wg.Wait()` 调用，结束阻塞。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
