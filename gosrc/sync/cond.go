// Copyright 2011 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package sync

import (
	"sync/atomic"
	"unsafe"
)

// Cond 实现了条件变量，用于等待或宣布事件发生的 goroutines 的同步点。
//
// 每个 Cond 都有一个与之关联的锁 L （*Mutex 或 *RWMutex）
// 在改变条件和调用 Wait 方法时必须保持这种状态。
//
// 一个 Cond 使用后则不允许复制
type Cond struct {
	noCopy noCopy

	// L i在观察或者改变条件时持有
	L Locker

	notify  notifyList
	checker copyChecker
}

// NewCond 新建并返回包含锁 l 的 Cond
func NewCond(l Locker) *Cond {
	return &Cond{L: l}
}

// Wait 原子式的 unlock c.L， 并暂停执行调用的 goroutine。
// 在稍后执行后，Wait 会在返回前 lock c.L. 与其他系统不同，
// 除非被 Broadcast 或 Signal 唤醒，否则等待无法返回。
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

// copyChecker 保存指向自身的指针来检测对象的复制行为。
type copyChecker uintptr

func (c *copyChecker) check() {
	if uintptr(*c) != uintptr(unsafe.Pointer(c)) &&
		!atomic.CompareAndSwapUintptr((*uintptr)(c), 0, uintptr(unsafe.Pointer(c))) &&
		uintptr(*c) != uintptr(unsafe.Pointer(c)) {
		panic("sync.Cond is copied")
	}
}

// noCopy 用于嵌入一个结构体中来保证其第一次使用后不会被复制
//
// 见 https://golang.org/issues/8005#issuecomment-190753527
type noCopy struct{}

// Lock 是一个空操作用来给 `go ve` 的 -copylocks 静态分析
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
