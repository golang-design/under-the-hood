---
weight: 1308
title: "3.8 运行时类型系统"
---

# 3.8 运行时类型系统



Go 语言是一种静态类型语言，但感觉又像是动态解释性语言。

Go 的类型系统不太常见，而且非常简单。内建类型包括结构体、函数和接口。
任何实现了接口的方法的类型都可以成为实现了该接口。类型可以被隐式的从表达式中推导，
而且不需要被显式的指定。
有关接口的特殊处理以及隐式的类型推导使得 Go 看起来像是一种轻量级的动态类型语言。

运行时类型结构

```go
type _type struct {
	size       uintptr
	ptrdata    uintptr // size of memory prefix holding all pointers
	hash       uint32
	tflag      tflag
	align      uint8
	fieldAlign uint8
	kind       uint8 // 类型
	// function for comparing objects of this type
	// (ptr to object A, ptr to object B) -> ==?
	equal func(unsafe.Pointer, unsafe.Pointer) bool
	// gcdata stores the GC type data for the garbage collector.
	// If the KindGCProg bit is set in kind, gcdata is a GC program.
	// Otherwise it is a ptrmask bitmap. See mbitmap.go for details.
	gcdata    *byte
	str       nameOff
	ptrToThis typeOff
}
```

所有的类型

```go
const (
	kindBool          = 1 + iota // 0000 0001
	kindInt                      // 0000 0010
	kindInt8                     // 0000 0011
	kindInt16                    // 0000 0100
	kindInt32                    // 0000 0101
	kindInt64                    // 0000 0110
	kindUint                     // 0000 0111
	kindUint8                    // 0000 1000
	kindUint16                   // 0000 1001
	kindUint32                   // 0000 1010
	kindUint64                   // 0000 1011
	kindUintptr                  // 0000 1100
	kindFloat32                  // 0000 1101
	kindFloat64                  // 0000 1110
	kindComplex64                // 0000 1111
	kindComplex128               // 0001 0000
	kindArray                    // 0001 0001
	kindChan                     // 0001 0010
	kindFunc                     // 0001 0011
	kindInterface                // 0001 0100
	kindMap                      // 0001 0101
	kindPtr                      // 0001 0110
	kindSlice                    // 0001 0111
	kindString                   // 0001 1000
	kindStruct                   // 0001 1001
	kindUnsafePointer            // 0001 1010

	kindDirectIface = 1 << 5       // 0010 0000
	kindGCProg      = 1 << 6       // 0100 0000
	kindMask        = (1 << 5) - 1 // 0001 1111
)
// isDirectIface 报告了 t 是否直接存储在一个 interface 值中
func isDirectIface(t *_type) bool {
	return t.kind&kindDirectIface != 0
}

```

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
