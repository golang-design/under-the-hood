---
weight: 1503
title: "5.3 原子操作"
---

# 5.3 原子操作

`atomic` 包中包含了很多原子型操作。它们均基于运行时中 `runtime/internal/atomic` 的实现。

## 5.3.1 原子操作

原子操作依赖硬件指令的支持，但同时还需要运行时调度器的配合。我们以
`atomic.CompareAndSwapPointer` 为例，介绍 `sync/atomic` 包提供的同步模式。

`CompareAndSwapPointer` 它在包中只有函数定义，没有函数体：

```go
func CompareAndSwapPointer(addr *unsafe.Pointer, old, new unsafe.Pointer) (swapped bool)
```

其本身由运行时实现。

我们简单看过了两个属于公共包的方法 `atomic.Value` 和 `atomic.CompareAndSwapPointer`，
我们来看一下运行时实现：

```go
//go:linkname sync_atomic_CompareAndSwapUintptr sync/atomic.CompareAndSwapUintptr
func sync_atomic_CompareAndSwapUintptr(ptr *uintptr, old, new uintptr) bool

//go:linkname sync_atomic_CompareAndSwapPointer sync/atomic.CompareAndSwapPointer
//go:nosplit
func sync_atomic_CompareAndSwapPointer(ptr *unsafe.Pointer, old, new unsafe.Pointer) bool {
	if writeBarrier.enabled {
		atomicwb(ptr, new)
	}
	return sync_atomic_CompareAndSwapUintptr((*uintptr)(noescape(unsafe.Pointer(ptr))), uintptr(old), uintptr(new))
}
```

可以看到 `sync_atomic_CompareAndSwapUintptr` 函数在运行时中也是没有方法本体的，
说明其实现由编译器完成。那么我们来看一下编译器究竟干了什么：

```go
package main

import (
	"sync/atomic"
	"unsafe"
)

func main() {
	var p unsafe.Pointer
	newP := 42
	atomic.CompareAndSwapPointer(&p, nil, unsafe.Pointer(&newP))

	v := (*int)(p)
	println(*v)
}
```

编译结果：

```asm
TEXT sync/atomic.CompareAndSwapUintptr(SB) /usr/local/Cellar/go/1.11/libexec/src/sync/atomic/asm.s
  asm.s:31		0x1001070		e91b0b0000		JMP runtime/internal/atomic.Casuintptr(SB)	
  :-1			0x1001075		cc			INT $0x3					
  (...)

TEXT runtime/internal/atomic.Casuintptr(SB) /usr/local/Cellar/go/1.11/libexec/src/runtime/internal/atomic/asm_amd64.s
  asm_amd64.s:44	0x1001b90		e9dbffffff		JMP runtime/internal/atomic.Cas64(SB)	
  :-1			0x1001b95		cc			INT $0x3				
  (...)
```

可以看到 `atomic.CompareAndSwapUintptr` 本质上转到了 `runtime/internal/atomic.Cas64`，我们来看一下它的实现：

```asm
// bool	runtime∕internal∕atomic·Cas64(uint64 *val, uint64 old, uint64 new)
// Atomically:
//	if(*val == *old){
//		*val = new;
//		return 1;
//	} else {
//		return 0;
//	}
TEXT runtime∕internal∕atomic·Cas64(SB), NOSPLIT, $0-25
	MOVQ	ptr+0(FP), BX
	MOVQ	old+8(FP), AX
	MOVQ	new+16(FP), CX
	LOCK
	CMPXCHGQ	CX, 0(BX)
	SETEQ	ret+24(FP)
	RET
```

可以看到，实现的本质是使用 CPU 的 `LOCK`+`CMPXCHGQ` 指令：首先将 ptr 的值放入 BX，将假设的旧值放入 AX，
要比较的新值放入 CX。然后 LOCK CMPXCHGQ 与累加器 AX 比较并交换 CX 和 BX。

因此原子操作本质上均为使用 CPU 指令进行实现（理所当然）。由于原子操作的方式比较单一，很容易举一反三，
其他操作不再穷举。

## 5.3.2 原子值

原子值需要运行时的支持，在原子值进行修改时，Goroutine 不应该被抢占，因此需要锁定 MP 之间的绑定关系：

```go
//go:linkname sync_runtime_procPin sync.runtime_procPin
//go:nosplit
func sync_runtime_procPin() int {
	return procPin()
}
//go:nosplit
func procPin() int {
	_g_ := getg()
	mp := _g_.m

	mp.locks++
	return int(mp.p.ptr().id)
}
//go:linkname sync_atomic_runtime_procUnpin sync/atomic.runtime_procUnpin
//go:nosplit
func sync_atomic_runtime_procUnpin() {
	procUnpin()
}
//go:nosplit
func procUnpin() {
	_g_ := getg()
	_g_.m.locks--
}
```

原子值 `atomic.Value` 提供了一种具备原子存取的结构。其自身的结构非常简单，
只包含一个存放数据的 `interface{}`：

```go
type Value struct {
	v interface{}
}
```

它仅仅只是对要存储的值进行了一层封装。要对这个值进行原子的读取，依赖 `Load` 方法：

```go
func (v *Value) Load() (x interface{}) {
	// 获得 interface 结构的指针
	// 在 go 中，interface 的内存布局有类型指针和数据指针两部分表示
	vp := (*ifaceWords)(unsafe.Pointer(v))
	// 获得存储值的类型指针
	typ := LoadPointer(&vp.typ)
	if typ == nil || uintptr(typ) == ^uintptr(0) {
		return nil
	}
	// 获得存储值的实际数据
	data := LoadPointer(&vp.data)

	// 将复制得到的 typ 和 data 给到 x
	xp := (*ifaceWords)(unsafe.Pointer(&x))
	xp.typ = typ
	xp.data = data
	return
}
// ifaceWords 定义了 interface{} 的内部表示。
type ifaceWords struct {
	typ  unsafe.Pointer
	data unsafe.Pointer
}
```

从这个 Load 方法实际上使用了 Go 运行时类型系统中的 `interface{}` 这一类型本质上由
两段内容组成，一个是类型 typ 区域，另一个是实际数据 data 区域。
这个 Load 方法的实现，本质上就是将内部存储的类型和数据都复制一份并返回。

再来看 `Store`。存储的思路与读取其实是类似的，但由于类型系统的两段式表示（typ 和 data）
的存在，存储操作比读取操作的实现要更加小心，要考虑当两个不同的 Goroutine 对两段值进行写入时，
如何才能避免写竞争：

```go
func (v *Value) Store(x interface{}) {
	if x == nil {
		panic("sync/atomic: store of nil value into Value")
	}
	// Value 存储值的指针和要存储的 x 的指针
	vp := (*ifaceWords)(unsafe.Pointer(v))
	xp := (*ifaceWords)(unsafe.Pointer(&x))

	for {
		typ := LoadPointer(&vp.typ)

		// v 还未被写入过任何数据
		if typ == nil {
			// 禁止抢占当前 Goroutine 来确保存储顺利完成
			runtime_procPin()
			// 先存一个标志位，宣告正在有人操作此值
			if !CompareAndSwapPointer(&vp.typ, nil, unsafe.Pointer(^uintptr(0))) {
				// 如果没有成功，取消不可抢占，下次再试
				runtime_procUnpin()
				continue
			}

			// 如果标志位设置成功，说明其他人都不会向 interface{} 中写入数据
			StorePointer(&vp.data, xp.data)
			StorePointer(&vp.typ, xp.typ)
			// 存储成功，再标志位可抢占，直接返回
			runtime_procUnpin()
			return
		}

		// 有其他 Goroutine 正在对 v 进行写操作
		if uintptr(typ) == ^uintptr(0) {
			continue
		}

		// 如果本次存入的类型与前次存储的类型不同
		if typ != xp.typ {
			panic("sync/atomic: store of inconsistently typed value into Value")
		}

		// 类型已经写入，直接保存数据
		StorePointer(&vp.data, xp.data)
		return
	}
}
```

可以看到 `atomic.Value` 的存取通过 `unsafe.Pointer(^uintptr(0))` 作为第一次存取的标志位，
当 `atomic.Value` 第一次写入数据时，会将当前 Goroutine 设置为不可抢占，
并将要存储类型进行标记，再存入实际的数据与类型。当存储完毕后，即可解除不可抢占，返回。

在不可抢占期间，且有并发的 Goroutine 再此存储时，如果标记没有被类型替换掉，
则说明第一次存储还未完成，形成 CompareAndSwap 循环进行等待。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).