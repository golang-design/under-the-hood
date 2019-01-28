// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// 固定大小对象分配器。返回的内存没有归零。
//
// 见 malloc.go 中的综述.

package runtime

import "unsafe"

// FixAlloc 是一个简单的固定大小对象的自由表内存分配器。
// Malloc 使用围绕 sysAlloc 的 FixAlloc 来管理其 mcache 和 mspan 对象。
//
// fixalloc.alloc 返回的内存默认为零，但调用者可以通过将 zero 标志设置为 false
// 来自行负责将分配归零。如果这部分内存永远不包含堆指针，则这样的操作是安全的。
//
// 调用方负责锁定 FixAlloc 调用。调用方可以在对象中保持状态，
// 但当释放和重新分配时第一个字会被破坏。
//
// 考虑使 fixalloc 的类型变为 go:notinheap.
type fixalloc struct {
	size   uintptr
	first  func(arg, p unsafe.Pointer) // 首次调用时返回 p
	arg    unsafe.Pointer
	list   *mlink
	chunk  uintptr // 使用 uintptr 而非 unsafe.Pointer 来避免 write barrier
	nchunk uint32
	inuse  uintptr // 正在使用的字节
	stat   *uint64
	zero   bool // 归零的分配
}

// 通用的 block 链表（通常 block 大于 sizeof(MLink)）
// 由于对 mlink.next 的赋值将导致执行 write barrier，因此某些内部 GC 结构无法使用。
// 例如，当 sweeper 将未标记的对象放置在空闲列表上时，它不希望调用 write barrier，因为这可能导致对象可到达。
//
//go:notinheap
type mlink struct {
	next *mlink
}

// 初始化 f 来分配给定大小的对象。
// 使用分配器来按 chunk 获取
func (f *fixalloc) init(size uintptr, first func(arg, p unsafe.Pointer), arg unsafe.Pointer, stat *uint64) {
	f.size = size
	f.first = first
	f.arg = arg
	f.list = nil
	f.chunk = 0
	f.nchunk = 0
	f.inuse = 0
	f.stat = stat
	f.zero = true
}

func (f *fixalloc) alloc() unsafe.Pointer {
	// fixalloc 的个字段必须先被 init
	if f.size == 0 {
		print("runtime: use of FixAlloc_Alloc before FixAlloc_Init\n")
		throw("runtime: internal error")
	}

	// 如果 f.list 不是 nil, 则说明还存在已经释放、可复用的内存，直接将其分配
	if f.list != nil {
		// 取出 f.list
		v := unsafe.Pointer(f.list)
		// 并将其指向下一段区域
		f.list = f.list.next
		// 增加使用的(分配)大小
		f.inuse += f.size
		// 如果需要对内存清零，则对取出的内存执行初始化
		if f.zero {
			memclrNoHeapPointers(v, f.size)
		}
		// 返回分配的内存
		return v
	}

	// f.list 中没有可复用的内存

	// 如果此时 nchunk 不足以分配一个 size
	if uintptr(f.nchunk) < f.size {
		// 则向操作系统申请内存，大小为 16 << 10 pow(2,14)
		f.chunk = uintptr(persistentalloc(_FixAllocChunk, 0, f.stat))
		f.nchunk = _FixAllocChunk
	}

	// 指向申请好的内存
	v := unsafe.Pointer(f.chunk)
	if f.first != nil { // first 只有在 fixalloc 作为 spanalloc 时候，才会被设置为 recordspan
		f.first(f.arg, v) // 用于为 heap.allspans 添加新的 span
	}
	// 扣除并保留 size 大小的空间
	f.chunk = f.chunk + f.size
	f.nchunk -= uint32(f.size)
	f.inuse += f.size // 记录已经使用的大小
	return v
}

func (f *fixalloc) free(p unsafe.Pointer) {
	// 减少使用的字节数
	f.inuse -= f.size
	// 将要释放的内存地址作为 mlink 指针插入到 f.list 内，完成回收
	v := (*mlink)(p)
	v.next = f.list
	f.list = v
}
