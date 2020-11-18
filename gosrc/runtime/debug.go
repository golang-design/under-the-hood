// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

import (
	"runtime/internal/atomic"
	"unsafe"
)

// GOMAXPROCS sets the maximum number of CPUs that can be executing
// simultaneously and returns the previous setting. It defaults to
// the value of runtime.NumCPU. If n < 1, it does not change the current setting.
// This call will go away when the scheduler improves.
// GOMAXPROCS 设置能够同时执行线程的最大 CPU 数，并返回原先的设定。
// 如果 n < 1，则他不会进行任何修改。
// 机器上的逻辑 CPU 的个数可以从 NumCPU 调用上获取。
// 该调用会在调度器进行改进后被移除。
func GOMAXPROCS(n int) int {
	if GOARCH == "wasm" && n > 1 {
		n = 1 // WebAssembly has no threads yet, so only one CPU is possible. // WebAssembly 还没有线程支持，只能设置一个 CPU。
	}

	// 当调整 P 的数量时，调度器会被锁住
	lock(&sched.lock)
	ret := int(gomaxprocs)
	unlock(&sched.lock)

	// 返回原有设置
	if n <= 0 || n == ret {
		return ret
	}

	// 停止一切事物，将 STW 的原因设置为 P 被调整
	stopTheWorldGC("GOMAXPROCS")

	// newprocs will be processed by startTheWorld
	// STW 后，修改 P 的数量
	newprocs = int32(n)

	// 重新恢复
	// 在这个过程中，startTheWorld 会调用 procresize 进而动态的调整 P 的数量
	startTheWorldGC()
	return ret
}

// NumCPU returns the number of logical CPUs usable by the current process.
//
// The set of available CPUs is checked by querying the operating system
// at process startup. Changes to operating system CPU allocation after
// process startup are not reflected.
// NumCPU 返回用于并发处理的逻辑 CPU 的数量
//
// 有效的 CPU 集合是在启动阶段从操作系统查询得来。启动后的系统 CPU 分配不会表现出来。
func NumCPU() int {
	return int(ncpu)
}

// NumCgoCall returns the number of cgo calls made by the current process.
// NumCgoCall 返回了当前进程产生的 cgo 调用的数量
func NumCgoCall() int64 {
	var n int64
	for mp := (*m)(atomic.Loadp(unsafe.Pointer(&allm))); mp != nil; mp = mp.alllink {
		n += int64(mp.ncgocall)
	}
	return n
}

// NumGoroutine returns the number of goroutines that currently exist.
// NumGoroutine 返回当前存在的 goroutine 的数量
func NumGoroutine() int {
	return int(gcount())
}

//go:linkname debug_modinfo runtime/debug.modinfo
func debug_modinfo() string {
	return modinfo
}
