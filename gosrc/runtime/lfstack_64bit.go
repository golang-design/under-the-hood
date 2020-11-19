// Copyright 2014 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// +build amd64 arm64 mips64 mips64le ppc64 ppc64le riscv64 s390x wasm

package runtime

import "unsafe"

const (
	// addrBits is the number of bits needed to represent a virtual address.
	//
	// See heapAddrBits for a table of address space sizes on
	// various architectures. 48 bits is enough for all
	// architectures except s390x.
	//
	// On AMD64, virtual addresses are 48-bit (or 57-bit) numbers sign extended to 64.
	// We shift the address left 16 to eliminate the sign extended part and make
	// room in the bottom for the count.
	//
	// On s390x, virtual addresses are 64-bit. There's not much we
	// can do about this, so we just hope that the kernel doesn't
	// get to really high addresses and panic if it does.
	// addrBits 是用于表示一个虚拟地址所需要的位数
	//
	// 请参阅 heapAddrBits 以获取地址空间大小表各种架构。
	// 48 位足以满足除了 s390x 之外的架构的需求。
	//
	// 在 AMD64 上，虚拟地址是 48 位（或 57 位）数字符号扩展到 64。
	// 我们将地址左移 16 以消除符号扩展部分，并在底部为计数腾出空间。
	//
	// 再 s390x 上，虚拟地址是 64 位的。对此我们什么也不做，只是希望系统内核
	// 不会增长到如此高的空间并产生崩溃。
	addrBits = 48

	// In addition to the 16 bits taken from the top, we can take 3 from the
	// bottom, because node must be pointer-aligned, giving a total of 19 bits
	// of count.
	// 除了从顶部取 16 位之外，我们可以从底部取 3，因为节点必须是指针对齐的，总计19位计数。
	cntBits = 64 - addrBits + 3

	// On AIX, 64-bit addresses are split into 36-bit segment number and 28-bit
	// offset in segment.  Segment numbers in the range 0x0A0000000-0x0AFFFFFFF(LSA)
	// are available for mmap.
	// We assume all lfnode addresses are from memory allocated with mmap.
	// We use one bit to distinguish between the two ranges.
	aixAddrBits = 57
	aixCntBits  = 64 - aixAddrBits + 3
)

func lfstackPack(node *lfnode, cnt uintptr) uint64 {
	if GOARCH == "ppc64" && GOOS == "aix" {
		return uint64(uintptr(unsafe.Pointer(node)))<<(64-aixAddrBits) | uint64(cnt&(1<<aixCntBits-1))
	}
	return uint64(uintptr(unsafe.Pointer(node)))<<(64-addrBits) | uint64(cnt&(1<<cntBits-1))
}

func lfstackUnpack(val uint64) *lfnode {
	if GOARCH == "amd64" {
		// amd64 systems can place the stack above the VA hole, so we need to sign extend
		// val before unpacking.
		// amd64 系统可以将栈放在虚拟地址孔之上，因此我们需要在解包之前对 val 进行符号扩充。
		return (*lfnode)(unsafe.Pointer(uintptr(int64(val) >> cntBits << 3)))
	}
	if GOARCH == "ppc64" && GOOS == "aix" {
		return (*lfnode)(unsafe.Pointer(uintptr((val >> aixCntBits << 3) | 0xa<<56)))
	}
	return (*lfnode)(unsafe.Pointer(uintptr(val >> cntBits << 3)))
}
