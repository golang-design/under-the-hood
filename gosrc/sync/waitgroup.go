// Copyright 2011 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package sync

import (
	"internal/race"
	"sync/atomic"
	"unsafe"
)

// WaitGroup 用于等待一组 goroutine 执行完毕。
// 主 goroutine 调用 Add 来设置需要等待的 goroutine 的数量
// 然后每个 goroutine 运行并调用 Done 来确认已经执行网完毕
// 同时，Wait 可以用于阻塞并等待所有 goroutine 完成。
//
// WaitGroup 在第一次使用后不能被复制
type WaitGroup struct {
	noCopy noCopy // 空结构，go vet 静态检查标志，不占用内存空间

	// 64 位值: 高 32 位用于计数，低 32 位用于等待计数
	// 64 位的原子操作要求 64 位对齐，但 32 位编译器无法保证这个要求
	// 因此分配 12 字节然后将他们对齐，其中 8 字节作为状态，其他 4 字节用于存储原语
	state1 [3]uint32
}

// state 返回 wg.state1 中存储的状态和原语字段
func (wg *WaitGroup) state() (statep *uint64, semap *uint32) {
	if uintptr(unsafe.Pointer(&wg.state1))%8 == 0 {
		return (*uint64)(unsafe.Pointer(&wg.state1)), &wg.state1[2]
	}
	return (*uint64)(unsafe.Pointer(&wg.state1[1])), &wg.state1[0]
}

// Add 将 delta（可能为负）加到 WaitGroup 的计数器上
// 如果计数器归零，则所有阻塞在 Wait 的 goroutine 被释放
// 如果计数器为负，则 panic
//
// 请注意，当计数器为 0 时发生的带有正的 delta 的调用必须在 Wait 之前。
// 当计数器大于 0 时，带有负 delta 的调用或带有正 delta 调用可能在任何时候发生。
// 通常，这意味着 Add 调用必须发生在 goroutine 创建之前或其他被等待事件之前。
// 如果一个 WaitGroup 被复用于等待几个不同的独立事件集合，必须在前一个 Wait 调用返回后才能调用 Add。
func (wg *WaitGroup) Add(delta int) {
	// 首先获取状态指针和存储指针
	statep, semap := wg.state()

	// race 检查相关
	if race.Enabled {
		_ = *statep // trigger nil deref early
		if delta < 0 {
			// Synchronize decrements with Wait.
			race.ReleaseMerge(unsafe.Pointer(wg))
		}
		race.Disable()
		defer race.Enable()
	}

	// 将 delta 加到 statep 的前 32 位上，即加到计数器上
	state := atomic.AddUint64(statep, uint64(delta)<<32)

	// 计数器的值
	v := int32(state >> 32)
	// 等待器的值
	w := uint32(state)

	// race 相关
	if race.Enabled && delta > 0 && v == int32(delta) {
		// The first increment must be synchronized with Wait.
		// Need to model this as a read, because there can be
		// several concurrent wg.counter transitions from 0.
		race.Read(unsafe.Pointer(semap))
	}

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
	// 这时 goroutine 已经将计数器清零，且等待器大于零，这种情况出现在 Add 和 Done 的并发调用中
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

// Done 为 WaitGroup 计数器减一
func (wg *WaitGroup) Done() {
	wg.Add(-1)
}

// Wait 会保持阻塞直到 WaitGroup 计数器归零
func (wg *WaitGroup) Wait() {

	// 先获得计数器和存储原语
	statep, semap := wg.state()

	// race 相关
	if race.Enabled {
		_ = *statep // trigger nil deref early
		race.Disable()
	}

	// 一个简单的死循环，只有当计数器归零才会结束
	for {
		// 原子读
		state := atomic.LoadUint64(statep)
		// 计数器
		v := int32(state >> 32)
		// 等待器
		w := uint32(state)

		// 如果计数器已经归零，则直接退出循环
		if v == 0 {
			if race.Enabled {
				race.Enable()
				race.Acquire(unsafe.Pointer(wg))
			}
			return
		}

		// 增加等待计数，此处的原语会比较 statep 和 state 的值，如果相同则等待计数加 1
		if atomic.CompareAndSwapUint64(statep, state, state+1) {
			// race 检查
			if race.Enabled && w == 0 {
				// Wait must be synchronized with the first Add.
				// Need to model this is as a write to race with the read in Add.
				// As a consequence, can do the write only for the first waiter,
				// otherwise concurrent Waits will race with each other.
				race.Write(unsafe.Pointer(semap))
			}

			// 会阻塞到存储原语是否 > 0（即睡眠），如果 *semap > 0 则会减 1，因此最终的 semap 理论为 0
			runtime_Semacquire(semap)

			// 在这种情况下，如果 *semap 不等于 0 ，则说明使用失误，直接 panic
			if *statep != 0 {
				panic("sync: WaitGroup is reused before previous Wait has returned")
			}
			if race.Enabled {
				race.Enable()
				race.Acquire(unsafe.Pointer(wg))
			}
			return
		}
	}
}
