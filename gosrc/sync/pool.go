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

	victim     unsafe.Pointer // 来自前一个周期的 local
	victimSize uintptr        // victim 数组的大小

	// New 方法在 Get 失败的情况下，选择性的创建一个值
	// 即使并发调用 Get 的时候值也可能不会改变（同一个）
	New func() interface{}
}

// Local per-P Pool appendix.
type poolLocalInternal struct {
	private interface{} // 只能被不同的 P 使用.
	shared  poolChain   // Local P 可以进行 pushHead/popHead 操作; 任何 P 都可以进行 popTail
}

type poolLocal struct {
	poolLocalInternal

	// 将 poolLocal 补齐至两个缓存行的倍数，防止 false sharing,
	// 每个缓存行具有 64 bytes，即 512 bit
	pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}

// 来自运行时
func fastrand() uint32

// 此结构用于 race 检查器
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
	l, _ := p.pin()

	// 优先放入 private
	if l.private == nil {
		l.private = x
		x = nil
	}

	// 如果不能放入 private 则放入 shared
	if x != nil {
		l.shared.pushHead(x)
	}
	runtime_procUnpin()

	// 恢复 race
	if race.Enabled {
		race.Enable()
	}
}

// Get 从 Pool 中选择一个任意的对象，将其移出 Pool, 并返回给调用方.
// Get 可能会返回一个非零值对象（被其他人使用过），因此调用方不应假设
// 返回的对象具有任何形式的状态.
func (p *Pool) Get() interface{} {

	// 如果启用了 race 检查，则先停用
	if race.Enabled {
		race.Disable()
	}

	// 返回 poolLocal
	l, pid := p.pin()

	// 先从 private 选择
	x := l.private
	l.private = nil
	if x == nil {
		// 尝试从 localPool 的 shared 队列队头读取，因为队头的内存局部性比队尾更好。
		x, _ = l.shared.popHead()

		// 如果取不到，则获取新的缓存对象
		if x == nil {
			x = p.getSlow(pid)
		}
	}
	runtime_procUnpin()

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

func (p *Pool) getSlow(pid int) interface{} {
	// See the comment in pin regarding ordering of the loads.
	size := atomic.LoadUintptr(&p.localSize) // load-acquire
	locals := p.local                        // load-consume
	// 从其他 proc (poolLocal) steal 一个对象
	for i := 0; i < int(size); i++ {
		// 获取目标 poolLocal, 引入 pid 保证不是自身
		l := indexLocal(locals, (pid+i+1)%int(size))
		if x, _ := l.shared.popTail(); x != nil {
			return x
		}
	}

	// Try the victim cache. We do this after attempting to steal
	// from all primary caches because we want objects in the
	// victim cache to age out if at all possible.
	size = atomic.LoadUintptr(&p.victimSize)
	if uintptr(pid) >= size {
		return nil
	}
	locals = p.victim
	l := indexLocal(locals, pid)
	if x := l.private; x != nil {
		l.private = nil
		return x
	}
	for i := 0; i < int(size); i++ {
		l := indexLocal(locals, (pid+i)%int(size))
		if x, _ := l.shared.popTail(); x != nil {
			return x
		}
	}

	// Mark the victim cache as empty for future gets don't bother
	// with it.
	atomic.StoreUintptr(&p.victimSize, 0)

	return nil
}

// pin 会将当前的 goroutine 固定到 P 上，禁用抢占，并返回 localPool 池以及当前 P 的 pid。
func (p *Pool) pin() (*poolLocal, int) {
	// 返回当前 P.id
	pid := runtime_procPin()
	// 在 pinSlow 中会存储 local 后再存储 localSize，因此这里反过来读取
	// 因为我们已经禁用了抢占，这时不会发生 GC
	// 因此，我们必须观察 local 和 localSize 是否对应
	// 观察到一个全新或很大的的 local 是正常行为
	s := atomic.LoadUintptr(&p.localSize) // load-acquire
	l := p.local                          // load-consume
	// 因为可能存在动态的 P（运行时调整 P 的个数）procresize/GOMAXPROCS
	// 如果 P.id 没有越界，则直接返回
	if uintptr(pid) < s {
		return indexLocal(l, pid), pid
	}
	// 没有结果时，涉及全局加锁
	// 例如重新分配数组内存，添加到全局列表
	return p.pinSlow()
}

func (p *Pool) pinSlow() (*poolLocal, int) {
	// 这时取消 P 的禁止抢占，因为使用 mutex 时候 P 必须可抢占
	runtime_procUnpin()

	// 加锁
	allPoolsMu.Lock()
	defer allPoolsMu.Unlock()

	// 当锁住后，再次固定 P 取其 id
	pid := runtime_procPin()

	// 并再次检查是否符合条件，因为可能中途已被其他线程调用
	// 当再次固定 P 时 poolCleanup 不会被调用
	s := p.localSize
	l := p.local
	if uintptr(pid) < s {
		return indexLocal(l, pid), pid
	}

	// 如果数组为空，新建
	// 将其添加到 allPools，垃圾回收器从这里获取所有 Pool 实例
	if p.local == nil {
		allPools = append(allPools, p)
	}

	// 根据 P 数量创建 slice，如果 GOMAXPROCS 在 GC 间发生变化
	// 我们重新分配此数组并丢弃旧的
	size := runtime.GOMAXPROCS(0)
	local := make([]poolLocal, size)

	// 将底层数组起始指针保存到 p.local，并设置 p.localSize
	atomic.StorePointer(&p.local, unsafe.Pointer(&local[0])) // store-release
	atomic.StoreUintptr(&p.localSize, uintptr(size))         // store-release

	// 返回所需的 pollLocal
	return &local[pid], pid
}

func poolCleanup() {
	// 该函数会注册到运行时 GC 阶段(前)，此时为 STW 状态，不需要加锁
	// 它必须不处理分配且不调用任何运行时函数。

	// 由于此时是 STW，不存在用户态代码能尝试读取 localPool，进而所有的 P 都已固定（与 goroutine 绑定）

	// 从所有的 oldPols 中删除 victim
	for _, p := range oldPools {
		p.victim = nil
		p.victimSize = 0
	}

	// 将主缓存移动到 victim 缓存
	for _, p := range allPools {
		p.victim = p.local
		p.victimSize = p.localSize

		p.local = nil
		p.localSize = 0
	}

	// 具有非空主缓存的池现在具有非空的 victim 缓存，并且没有任何 pool 具有主缓存。
	oldPools, allPools = allPools, nil
}

var (
	allPoolsMu Mutex

	// allPools 是一组 pool 的集合，具有非空主缓存。
	// 有两种形式来保护它的读写：1. allPoolsMu 锁; 2. STW.
	allPools []*Pool

	// oldPools 是一组 pool 的集合，具有非空 victim 缓存。由 STW 保护
	oldPools []*Pool
)

// 将缓存清理函数注册到运行时 GC 时间段
func init() {
	runtime_registerPoolCleanup(poolCleanup)
}

func indexLocal(l unsafe.Pointer, i int) *poolLocal {
	// 简单的通过 p.local 的头指针与索引来第 i 个 pooLocal
	lp := unsafe.Pointer(uintptr(l) + uintptr(i)*unsafe.Sizeof(poolLocal{}))
	return (*poolLocal)(lp)
}

// 由 runtime 实现
func runtime_registerPoolCleanup(cleanup func())
func runtime_procPin() int
func runtime_procUnpin()
