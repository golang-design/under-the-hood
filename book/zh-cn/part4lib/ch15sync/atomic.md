---
weight: 4101
title: "15.1 原子操作"
---

# 15.1 原子操作

[TOC]

`atomic` 包中包含了很多原子型操作。它们均基于运行时中 `runtime/internal/atomic` 的实现。

## 公共包方法

### `atomic.Value`

`atomic.Value` 提供了一种具备原子存取的结构。其自身的结构非常简单，只包含一个存放数据的 `interface{}`：

```go
type Value struct {
	v interface{}
}
```

它仅仅只是对要存储的值进行了一层封装。我们来看它的 `Load` 方法：

```go
// ifaceWords 定义了 interface{} 的内部表示。
type ifaceWords struct {
	typ  unsafe.Pointer
	data unsafe.Pointer
}

// Load 返回最近存储的值，如果已经没有 Value 调用 Store 则会返回 nil
func (v *Value) Load() (x interface{}) {
	// 获得自身结构的指针，因为 v 存储的是任意类型
	// 在 go 中，interface 的内存布局有类型指针和数据指针两部分表示
	vp := (*ifaceWords)(unsafe.Pointer(v))
	// 获得存储值的类型指针
	typ := LoadPointer(&vp.typ)
	// 如果存储的类型为 nil 或者呈正在存储的状态（全 1，在 Store 中解释）
	if typ == nil || uintptr(typ) == ^uintptr(0) {
		// 则说明 Value 当前没有保存值
		return nil
	}
	// 否则从 data 字段中读取数据，将复制得到的 typ 和 data 给到 x
	data := LoadPointer(&vp.data)
	xp := (*ifaceWords)(unsafe.Pointer(&x))
	xp.typ = typ
	xp.data = data
	return
}
```

从这个 Load 方法中我们了解到了 Go 中的 `interface{}` 本质上有两段内容组成，一个是 type 区域，另一个是实际的数据区域。
这个 Load 方法的实现，本质上就是将内部存储的类型和数据都复制一份并返回（避免逃逸）。

再来看 Store。

```go
// Store 将 Value 的值设置为 x
// Store 的 Value x 必须为相同的类型
// Store 不同类型会导致 panic，nil 也是如此
func (v *Value) Store(x interface{}) {
	// nil 直接 panic
	if x == nil {
		panic("sync/atomic: store of nil value into Value")
	}

	// Value 存储值的指针和要存储的 x 的指针
	vp := (*ifaceWords)(unsafe.Pointer(v))
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
```

可以看到 `atomic.Value` 的存取通过 `unsafe.Pointer(^uintptr(0))` 作为第一次存取的标志位，当 `atomic.Value`
进行第一次存储时，会将当前 goroutine 设置为不可抢占，并将要存储类型进行标记，再存入实际的数据与类型。当存储完毕后，即可解除不可抢占，返回。
在不可抢占期间，有并发的 goroutine 再此存储时，如果标记没有被类型替换掉，则说明第一次存储还未完成，由 for 循环进行等待。

### `atomic.CompareAndSwapPointer`

`atomic.CompareAndSwapPointer` 提供了 CAS 原语，使得我们可以通过 for 循环避免数据竞争：

```
for {
	复制旧数据
	基于旧数据构造新数据
	if CompareAndSwap(内存地址，旧数据，新数据) {
		break
	}
}
```

它在包中只有函数定义，没有函数体：

```go
func CompareAndSwapPointer(addr *unsafe.Pointer, old, new unsafe.Pointer) (swapped bool)
```

其本身由运行时实现。

## 运行时实现

我们简单看过了两个属于公共包的方法 `atomic.Value` 和 `atomic.CompareAndSwapPointer`，我们来看一下运行时实现：

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

可以看到该函数在运行时中是没有方法本体的，说明其实现由编译器完成。那么我们来看一下编译器究竟干了什么：

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

## 原子操作的内存模型

TODO:

## sync.Once

TODO: 考虑重新放到哪里？

sync.Once 用来保证绝对一次执行的对象，例如可在单例的初始化中使用。
它内部的结构也相对简单：

```go
// Once 对象可以保证一个动作的绝对一次执行。
type Once struct {
	// done 表明某个动作是否被执行
	// 由于其使用频繁（热路径），故将其放在结构体的最上方
	// 热路径在每个调用点进行内嵌
	// 将 done 放在第一位，在某些架构下（amd64/x86）能获得更加紧凑的指令，
	// 而在其他架构下能更少的指令（用于计算其偏移量）。
	done uint32
	m    Mutex
}
```

<!-- https://go-review.googlesource.com/c/go/+/152697 -->
注意，这个结构在 Go 1.13 中得到了重新调整，在其之前 `done` 字段在 `m` 之后。

源码也非常简单：

```go
// Do 当且仅当第一次调用时，f 会被执行。换句话说，给定
// 	var once Once
// 如果 once.Do(f) 被多次调用则只有第一次会调用 f，即使每次提供的 f 不同。
// 每次执行必须新建一个 Once 实例。
//
// Do 用于变量的一次初始化，由于 f 是无参数的，因此有必要使用函数字面量来捕获参数：
// 	config.once.Do(func() { config.init(filename) })
//
// 因为该调用无返回值，因此如果 f 调用了 Do，则会导致死锁。
//
// 如果 f 发生 panic，则 Do 认为 f 已经返回；之后的调用也不会调用 f。
//
func (o *Once) Do(f func()) {
	// 原子读取 Once 内部的 done 属性，是否为 0，是则进入慢速路径，否则直接调用
	if atomic.LoadUint32(&o.done) == 0 {
		o.doSlow(f)
	}
}

func (o *Once) doSlow(f func()) {
	// 注意，我们只使用原子读读取了 o.done 的值，这是最快速的路径执行原子操作，即 fast-path
	// 但当我们需要确保在并发状态下，是不是有多个人读到 0，因此必须加锁，这个操作相对昂贵，即 slow-path
	o.m.Lock()
	defer o.m.Unlock()

	// 正好我们有一个并发的 goroutine 读到了 0，那么立即执行 f 并在结束时候调用原子写，将 o.done 修改为 1
	if o.done == 0 {
		defer atomic.StoreUint32(&o.done, 1)
		f()
	}
	// 当 o.done 为 0 的 goroutine 解锁后，其他人会继续加锁，这时会发现 o.done 已经为了 1 ，于是 f 已经不用在继续执行了
}
```

## 进一步阅读的参考文献

- [Russ Cox, doc: define how sync/atomic interacts with memory model, 2013](https://github.com/golang/go/issues/5045)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)