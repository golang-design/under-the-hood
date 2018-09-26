// Copyright 2013 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package sync

import (
	"internal/race"
	"runtime"
	"sync/atomic"
	"unsafe"
)

// Pool 是一组能够被*独立存取*临时对象的集合
//
// 任何在 Pool 中存储的对象都有可能在任何时间点被自动移除，且没有通知。如果在移除阶段 Pool 只有
// 一个对象，则对象可能会被重新分配
//
// Pool 对象池在不同 goroutine 之间同时使用是安全的.
//
// Pool's purpose is to cache allocated but unused items for later reuse,
// relieving pressure on the garbage collector. That is, it makes it easy to
// build efficient, thread-safe free lists. However, it is not suitable for all
// free lists.
//
// An appropriate use of a Pool is to manage a group of temporary items
// silently shared among and potentially reused by concurrent independent
// clients of a package. Pool provides a way to amortize allocation overhead
// across many clients.
//
// 使用 Pool 的一个很好的例子是 fmt 包。它维护了一个动态大小的存储缓存。该存储提升了负载性能
//（当多个 goroutine 在活跃的输出时）并将这些负载限制在了相当小的水平.
//
// On the other hand, a free list maintained as part of a short-lived object is
// not a suitable use for a Pool, since the overhead does not amortize well in
// that scenario. It is more efficient to have such objects implement their own
// free list.
//
// Pool 在第一次使用后不能被复制.
type Pool struct {
	noCopy noCopy

	local     unsafe.Pointer // local 固定大小 per-P 池, 实际类型为 [P]poolLocal
	localSize uintptr        // local array 的大小

	// New 方法在 Get 失败的情况下，选择性的创建一个值
	// 即使并发调用 Get 的时候值也可能不会改变（同一个）
	New func() interface{}
}

// Local per-P Pool appendix.
type poolLocalInternal struct {
	private interface{}   // 只能被不同的 P 使用.
	shared  []interface{} // 可以被任意 P 使用.
	Mutex                 // 并发锁
}

type poolLocal struct {
	poolLocalInternal

	// 将 poolLocal 补齐至两个缓存行的倍数，防止 false sharing,
	// 每个缓存行具有 64 bytes，即 512 bit
	pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}

// from runtime
func fastrand() uint32

var poolRaceHash [128]uint64

// poolRaceAddr returns an address to use as the synchronization point
// for race detector logic. We don't use the actual pointer stored in x
// directly, for fear of conflicting with other synchronization on that address.
// Instead, we hash the pointer to get an index into poolRaceHash.
// See discussion on golang.org/cl/31589.
func poolRaceAddr(x interface{}) unsafe.Pointer {
	ptr := uintptr((*[2]unsafe.Pointer)(unsafe.Pointer(&x))[1])
	h := uint32((uint64(uint32(ptr)) * 0x85ebca6b) >> 16)
	return unsafe.Pointer(&poolRaceHash[h%uint32(len(poolRaceHash))])
}

// Put 将 x 放回到池中
func (p *Pool) Put(x interface{}) {
	if x == nil {
		return
	}

	// 停用 race
	if race.Enabled {
		if fastrand()%4 == 0 {
			// Randomly drop x on floor.
			return
		}
		race.ReleaseMerge(poolRaceAddr(x))
		race.Disable()
	}

	// 获取 localPool
	l := p.pin()

	// 优先放入 private
	if l.private == nil {
		l.private = x
		x = nil
	}
	runtime_procUnpin()

	// 如果不能放入 private 则放入 share
	if x != nil {
		l.Lock()
		l.shared = append(l.shared, x)
		l.Unlock()
	}

	// 恢复 race
	if race.Enabled {
		race.Enable()
	}
}

// Get selects an arbitrary item from the Pool, removes it from the
// Pool, and returns it to the caller.
// Get may choose to ignore the pool and treat it as empty.
// Callers should not assume any relation between values passed to Put and
// the values returned by Get.
//
// If Get would otherwise return nil and p.New is non-nil, Get returns
// the result of calling p.New.
func (p *Pool) Get() interface{} {

	// 如果启用了 race 检查，则先停用
	if race.Enabled {
		race.Disable()
	}

	// 返回 poolLocal
	l := p.pin()

	// 先从 private 选择
	x := l.private
	l.private = nil
	runtime_procUnpin()
	if x == nil {

		// 加锁，从 shared 获取
		l.Lock()

		// 从 shared 尾部取缓存对象
		last := len(l.shared) - 1
		if last >= 0 {
			x = l.shared[last]
			l.shared = l.shared[:last]
		}
		l.Unlock()

		// 如果取不到，则获取新的缓存对象
		if x == nil {
			x = p.getSlow()
		}
	}

	// 恢复 race 检查
	if race.Enabled {
		race.Enable()
		if x != nil {
			race.Acquire(poolRaceAddr(x))
		}
	}

	// 如果 getSlow 还是获取不到，则 New 一个
	if x == nil && p.New != nil {
		x = p.New()
	}
	return x
}

func (p *Pool) getSlow() (x interface{}) {
	// See the comment in pin regarding ordering of the loads.
	size := atomic.LoadUintptr(&p.localSize) // load-acquire
	local := p.local                         // load-consume

	// 获取 P.id
	// 从其他 proc (poolLocal) steal 一个对象
	pid := runtime_procPin()
	runtime_procUnpin()
	for i := 0; i < int(size); i++ {
		// 获取目标 poolLocal, 引入 pid 保证不是自身
		l := indexLocal(local, (pid+i+1)%int(size))

		// 对目标 poolLocal 加锁，用于访问 share 区域
		l.Lock()

		// steal 一个缓存对象
		last := len(l.shared) - 1
		if last >= 0 {
			x = l.shared[last]
			l.shared = l.shared[:last]
			l.Unlock()
			break
		}
		l.Unlock()
	}
	return x
}

// pin pins the current goroutine to P, disables preemption and returns poolLocal pool for the P.
// Caller must call runtime_procUnpin() when done with the pool.
func (p *Pool) pin() *poolLocal {
	// 返回当前 P.id
	pid := runtime_procPin()
	// In pinSlow we store to localSize and then to local, here we load in opposite order.
	// Since we've disabled preemption, GC cannot happen in between.
	// Thus here we must observe local at least as large localSize.
	// We can observe a newer/larger local, it is fine (we must observe its zero-initialized-ness).
	s := atomic.LoadUintptr(&p.localSize) // load-acquire
	l := p.local                          // load-consume
	// 如果 P.id 没有超出数组索引限制，则直接返回
	// 考虑 procresize/GOMAXPROCS
	if uintptr(pid) < s {
		return indexLocal(l, pid)
	}
	// 没有结果时，涉及全局加锁
	// 例如重新分配数组内存，添加到全局列表
	return p.pinSlow()
}

func (p *Pool) pinSlow() *poolLocal {
	// M.lock--
	// Retry under the mutex.
	// Can not lock the mutex while pinned.
	runtime_procUnpin()

	// 加锁
	allPoolsMu.Lock()
	defer allPoolsMu.Unlock()

	pid := runtime_procPin()

	// 再次检查是否符合条件，可能中途已被其他线程调用
	// poolCleanup won't be called while we are pinned.
	s := p.localSize
	l := p.local
	if uintptr(pid) < s {
		return indexLocal(l, pid)
	}

	// 如果数组为空，新建
	// 将其添加到 allPools，垃圾回收器从这里获取所有 Pool 实例
	if p.local == nil {
		allPools = append(allPools, p)
	}

	// 根据 P 数量创建 slice
	// If GOMAXPROCS changes between GCs, we re-allocate the array and lose the old one.
	size := runtime.GOMAXPROCS(0)
	local := make([]poolLocal, size)

	// 将底层数组起始指针保存到 p.local，并设置 p.localSize
	atomic.StorePointer(&p.local, unsafe.Pointer(&local[0])) // store-release
	atomic.StoreUintptr(&p.localSize, uintptr(size))         // store-release

	// 返回所需的 pollLocal
	return &local[pid]
}

func poolCleanup() {
	// 该函数会注册到运行时 GC 阶段(前)，此时为 STW 状态，不需要加锁
	// 它必须不处理分配且不调用任何运行时函数，防御性的将一切归零，有以下两点原因:
	// 1. 防止整个 Pool 的 false retention
	// 2. 如果 GC 发生在当有 goroutine 与 l.shared 进行 Put/Get 时，它会保留整个 Pool.
	//    那么下个 GC 周期的内存消耗将会翻倍。
	// 遍历所有 Pool 实例
	for i, p := range allPools {

		// 解除引用
		allPools[i] = nil

		// 遍历 p.localSize 数组
		for i := 0; i < int(p.localSize); i++ {

			// 获取 poolLocal
			l := indexLocal(p.local, i)

			// 清理 private 和 shared 区域
			l.private = nil
			for j := range l.shared {
				l.shared[j] = nil
			}
			l.shared = nil
		}

		// 设置 p.local = nil 除解引用之外的数组空间
		// 同时 p.pinSlow 方法会将其重新添加到 allPool
		p.local = nil
		p.localSize = 0
	}

	// 重置 allPools，需要所有 p.pinSlow 重新添加
	allPools = []*Pool{}
}

var (
	allPoolsMu Mutex
	allPools   []*Pool
)

// 将缓存清理函数注册到运行时 GC 时间段
func init() {
	runtime_registerPoolCleanup(poolCleanup)
}

func indexLocal(l unsafe.Pointer, i int) *poolLocal {
	lp := unsafe.Pointer(uintptr(l) + uintptr(i)*unsafe.Sizeof(poolLocal{}))
	return (*poolLocal)(lp)
}

// 由 runtime 实现
func runtime_registerPoolCleanup(cleanup func())
func runtime_procPin() int
func runtime_procUnpin()
