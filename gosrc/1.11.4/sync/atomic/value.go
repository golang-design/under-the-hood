// Copyright 2014 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package atomic

import (
	"unsafe"
)

// Value 提供了相同类型值的原子 load 和 store 操作
// 零值的 Load 会返回 nil
// 一旦 Store 被调用，Value 不能被复制
type Value struct {
	v interface{}
}

// ifaceWords 定义了 interface{} 的内部表示。
type ifaceWords struct {
	typ  unsafe.Pointer
	data unsafe.Pointer
}

// Load 返回最近存储的值集合
// 如果已经没有 Value 调用 Store 则会返回 nil
func (v *Value) Load() (x interface{}) {
	// 获得自身结构的指针，因为 v 存储的是任意类型
	// 在 go 中，interface 的内存布局有类型指针和数据指针两部分表示
	vp := (*ifaceWords)(unsafe.Pointer(v))
	// 获得存储值的类型指针
	typ := LoadPointer(&vp.typ)
	// 如果存储的类型为 nil 或者呈正在存储的状态
	if typ == nil || uintptr(typ) == ^uintptr(0) {
		// 则说明 Value 当前没有保存值
		return nil
	}
	// 否则从 data 字段中读取数据
	data := LoadPointer(&vp.data)
	xp := (*ifaceWords)(unsafe.Pointer(&x))
	// 将复制得到的 typ 给到 x
	xp.typ = typ
	// 将复制出来的 data 给到 x
	xp.data = data
	return
}

// Store 将 Value 的值设置为 x
// Store 的 Value x 必须为相同的类型
// Store 不同类型会导致 panic，nil 也是如此
func (v *Value) Store(x interface{}) {
	// nil 直接 panic
	if x == nil {
		panic("sync/atomic: store of nil value into Value")
	}

	// Value 存储值的指针
	vp := (*ifaceWords)(unsafe.Pointer(v))
	// 要存储的 x 的指针
	xp := (*ifaceWords)(unsafe.Pointer(&x))

	for {
		// 读 Value 存储值的类型
		typ := LoadPointer(&vp.typ)
		// 如果类型还是 nil
		if typ == nil {
			// 说明这是第一次存储
			// 禁止当前 goroutine 可以被抢占，来保证第一次存储顺利完成
			// 否则会导致 GC 发现一个假类型
			runtime_procPin()
			// 先存一个标志位（全 1）
			if !CompareAndSwapPointer(&vp.typ, nil, unsafe.Pointer(^uintptr(0))) {
				// 如果没有成功，则标志为可抢占，下次再试
				runtime_procUnpin()
				continue
			}
			// 如果标志位设置成功，则将数据存入
			StorePointer(&vp.data, xp.data)
			StorePointer(&vp.typ, xp.typ)
			// 存储成功，再标志位可抢占，直接返回
			runtime_procUnpin()
			return
		}
		// 如果第一次保存正在进行，则等待 continue
		if uintptr(typ) == ^uintptr(0) {
			continue
		}
		// 第一次存储完成，检查类型是否正确，不正确直接 panic
		if typ != xp.typ {
			panic("sync/atomic: store of inconsistently typed value into Value")
		}
		// 不替换类型，直接保存数据
		StorePointer(&vp.data, xp.data)
		return
	}
}

// Disable/enable preemption, implemented in runtime.
func runtime_procPin()
func runtime_procUnpin()
