// Copyright 2012 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Lock-free stack.

package runtime

import (
	"runtime/internal/atomic"
	"unsafe"
)

// lfstack is the head of a lock-free stack.
//
// The zero value of lfstack is an empty list.
//
// This stack is intrusive. Nodes must embed lfnode as the first field.
//
// The stack does not keep GC-visible pointers to nodes, so the caller
// is responsible for ensuring the nodes are not garbage collected
// (typically by allocating them from manually-managed memory).
// lfstack 是无锁栈的栈顶
//
// lfstack 的零值是一个空列表。
//
// 这个栈是侵入式的。Node 必须作为 lfnode 的第一个字段嵌入。
//
// 栈不会保留节点的 GC 可见指针，因此调用者需要确保节点不被垃圾搜集（通常通过从手动管理的内存中分配他们）。
type lfstack uint64

func (head *lfstack) push(node *lfnode) {
	node.pushcnt++
	new := lfstackPack(node, node.pushcnt)
	if node1 := lfstackUnpack(new); node1 != node {
		print("runtime: lfstack.push invalid packing: node=", node, " cnt=", hex(node.pushcnt), " packed=", hex(new), " -> node=", node1, "\n")
		throw("lfstack.push")
	}
	for {
		old := atomic.Load64((*uint64)(head))
		node.next = old
		if atomic.Cas64((*uint64)(head), old, new) {
			break
		}
	}
}

func (head *lfstack) pop() unsafe.Pointer {
	for {
		old := atomic.Load64((*uint64)(head))
		if old == 0 {
			return nil
		}
		node := lfstackUnpack(old)
		next := atomic.Load64(&node.next)
		if atomic.Cas64((*uint64)(head), old, next) {
			return unsafe.Pointer(node)
		}
	}
}

func (head *lfstack) empty() bool {
	return atomic.Load64((*uint64)(head)) == 0
}

// lfnodeValidate panics if node is not a valid address for use with
// lfstack.push. This only needs to be called when node is allocated.
func lfnodeValidate(node *lfnode) {
	if lfstackUnpack(lfstackPack(node, ^uintptr(0))) != node {
		printlock()
		println("runtime: bad lfnode address", hex(uintptr(unsafe.Pointer(node))))
		throw("bad lfnode address")
	}
}
