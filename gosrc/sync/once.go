// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package sync

import (
	"sync/atomic"
)

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
	// Note: Here is an incorrect implementation of Do:
	//
	//	if atomic.CompareAndSwapUint32(&o.done, 0, 1) {
	//		f()
	//	}
	//
	// Do guarantees that when it returns, f has finished.
	// This implementation would not implement that guarantee:
	// given two simultaneous calls, the winner of the cas would
	// call f, and the second would return immediately, without
	// waiting for the first's call to f to complete.
	// This is why the slow path falls back to a mutex, and why
	// the atomic.StoreUint32 must be delayed until after f returns.

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
