// Copyright 2012 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package sync

import "unsafe"

// defined in package runtime

// Semacquire 阻塞到 *s > 0，然后会减 1
// 它的目的是作为一个简单的睡眠原语，仅用于同步库，不应该直接使用。
func runtime_Semacquire(s *uint32)

// SemacquireMutex is like Semacquire, but for profiling contended Mutexes.
// If lifo is true, queue waiter at the head of wait queue.
// skipframes is the number of frames to omit during tracing, counting from
// runtime_SemacquireMutex's caller.
func runtime_SemacquireMutex(s *uint32, lifo bool, skipframes int)

// Semrelease 自动增加 *s 的值，如果一个等待的 goroutine 被 Semacquire 阻塞则会被通知
// 它的目的是作为一个简单的唤醒原语，用于同步库，不应该被直接使用。
// 如果 handoff 为真，则将计数直接传递给下一个等待的 goroutine
// skipframes 表示在 tracing 过程中忽略的帧的数量，从 runtime_Semrelease 调用方开始计数
func runtime_Semrelease(s *uint32, handoff bool, skipframes int)

// runtime/sema.go 中的 notifyList 的近似，大小和对齐必须一致。
type notifyList struct {
	wait   uint32
	notify uint32
	lock   uintptr
	head   unsafe.Pointer
	tail   unsafe.Pointer
}

// See runtime/sema.go for documentation.
func runtime_notifyListAdd(l *notifyList) uint32

// See runtime/sema.go for documentation.
func runtime_notifyListWait(l *notifyList, t uint32)

// See runtime/sema.go for documentation.
func runtime_notifyListNotifyAll(l *notifyList)

// See runtime/sema.go for documentation.
func runtime_notifyListNotifyOne(l *notifyList)

// Ensure that sync and runtime agree on size of notifyList.
func runtime_notifyListCheck(size uintptr)
func init() {
	var n notifyList
	runtime_notifyListCheck(unsafe.Sizeof(n))
}

// Active spinning runtime support.
// runtime_canSpin reports whether is spinning makes sense at the moment.
func runtime_canSpin(i int) bool

// runtime_doSpin does active spinning.
func runtime_doSpin()

func runtime_nanotime() int64
