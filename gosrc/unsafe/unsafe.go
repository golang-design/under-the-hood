// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/*
Package unsafe contains operations that step around the type safety of Go programs.
Package unsafe 包含了所有绕过 Go 程序类型安全的操作。
Packages that import unsafe may be non-portable and are not protected by the
Go 1 compatibility guidelines.
引入 unsafe 包可能导致不可移植，不受 Go 1 兼容性指南保护。
*/
package unsafe

// ArbitraryType is here for the purposes of documentation only and is not actually
// part of the unsafe package. It represents the type of an arbitrary Go expression.
// ArbitraryType 只用于文档展示的目的，其本身并非 unsafe 包的一部分。它表示了任意 Go 表达式的类型。
type ArbitraryType int

// Pointer represents a pointer to an arbitrary type. There are four special operations
// available for type Pointer that are not available for other types:
//	- A pointer value of any type can be converted to a Pointer.
//	- A Pointer can be converted to a pointer value of any type.
//	- A uintptr can be converted to a Pointer.
//	- A Pointer can be converted to a uintptr.
// Pointer therefore allows a program to defeat the type system and read and write
// arbitrary memory. It should be used with extreme care.
//
// The following patterns involving Pointer are valid.
// Code not using these patterns is likely to be invalid today
// or to become invalid in the future.
// Even the valid patterns below come with important caveats.
//
// Running "go vet" can help find uses of Pointer that do not conform to these patterns,
// but silence from "go vet" is not a guarantee that the code is valid.
//
// (1) Conversion of a *T1 to Pointer to *T2.
//
// Provided that T2 is no larger than T1 and that the two share an equivalent
// memory layout, this conversion allows reinterpreting data of one type as
// data of another type. An example is the implementation of
// math.Float64bits:
//
//	func Float64bits(f float64) uint64 {
//		return *(*uint64)(unsafe.Pointer(&f))
//	}
//
// (2) Conversion of a Pointer to a uintptr (but not back to Pointer).
//
// Converting a Pointer to a uintptr produces the memory address of the value
// pointed at, as an integer. The usual use for such a uintptr is to print it.
//
// Conversion of a uintptr back to Pointer is not valid in general.
//
// A uintptr is an integer, not a reference.
// Converting a Pointer to a uintptr creates an integer value
// with no pointer semantics.
// Even if a uintptr holds the address of some object,
// the garbage collector will not update that uintptr's value
// if the object moves, nor will that uintptr keep the object
// from being reclaimed.
//
// The remaining patterns enumerate the only valid conversions
// from uintptr to Pointer.
//
// (3) Conversion of a Pointer to a uintptr and back, with arithmetic.
//
// If p points into an allocated object, it can be advanced through the object
// by conversion to uintptr, addition of an offset, and conversion back to Pointer.
//
//	p = unsafe.Pointer(uintptr(p) + offset)
//
// The most common use of this pattern is to access fields in a struct
// or elements of an array:
//
//	// equivalent to f := unsafe.Pointer(&s.f)
//	f := unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Offsetof(s.f))
//
//	// equivalent to e := unsafe.Pointer(&x[i])
//	e := unsafe.Pointer(uintptr(unsafe.Pointer(&x[0])) + i*unsafe.Sizeof(x[0]))
//
// It is valid both to add and to subtract offsets from a pointer in this way.
// It is also valid to use &^ to round pointers, usually for alignment.
// In all cases, the result must continue to point into the original allocated object.
//
// Unlike in C, it is not valid to advance a pointer just beyond the end of
// its original allocation:
//
//	// INVALID: end points outside allocated space.
//	var s thing
//	end = unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Sizeof(s))
//
//	// INVALID: end points outside allocated space.
//	b := make([]byte, n)
//	end = unsafe.Pointer(uintptr(unsafe.Pointer(&b[0])) + uintptr(n))
//
// Note that both conversions must appear in the same expression, with only
// the intervening arithmetic between them:
//
//	// INVALID: uintptr cannot be stored in variable
//	// before conversion back to Pointer.
//	u := uintptr(p)
//	p = unsafe.Pointer(u + offset)
//
// Note that the pointer must point into an allocated object, so it may not be nil.
//
//	// INVALID: conversion of nil pointer
//	u := unsafe.Pointer(nil)
//	p := unsafe.Pointer(uintptr(u) + offset)
//
// (4) Conversion of a Pointer to a uintptr when calling syscall.Syscall.
//
// The Syscall functions in package syscall pass their uintptr arguments directly
// to the operating system, which then may, depending on the details of the call,
// reinterpret some of them as pointers.
// That is, the system call implementation is implicitly converting certain arguments
// back from uintptr to pointer.
//
// If a pointer argument must be converted to uintptr for use as an argument,
// that conversion must appear in the call expression itself:
//
//	syscall.Syscall(SYS_READ, uintptr(fd), uintptr(unsafe.Pointer(p)), uintptr(n))
//
// The compiler handles a Pointer converted to a uintptr in the argument list of
// a call to a function implemented in assembly by arranging that the referenced
// allocated object, if any, is retained and not moved until the call completes,
// even though from the types alone it would appear that the object is no longer
// needed during the call.
//
// For the compiler to recognize this pattern,
// the conversion must appear in the argument list:
//
//	// INVALID: uintptr cannot be stored in variable
//	// before implicit conversion back to Pointer during system call.
//	u := uintptr(unsafe.Pointer(p))
//	syscall.Syscall(SYS_READ, uintptr(fd), u, uintptr(n))
//
// (5) Conversion of the result of reflect.Value.Pointer or reflect.Value.UnsafeAddr
// from uintptr to Pointer.
//
// Package reflect's Value methods named Pointer and UnsafeAddr return type uintptr
// instead of unsafe.Pointer to keep callers from changing the result to an arbitrary
// type without first importing "unsafe". However, this means that the result is
// fragile and must be converted to Pointer immediately after making the call,
// in the same expression:
//
//	p := (*int)(unsafe.Pointer(reflect.ValueOf(new(int)).Pointer()))
//
// As in the cases above, it is invalid to store the result before the conversion:
//
//	// INVALID: uintptr cannot be stored in variable
//	// before conversion back to Pointer.
//	u := reflect.ValueOf(new(int)).Pointer()
//	p := (*int)(unsafe.Pointer(u))
//
// (6) Conversion of a reflect.SliceHeader or reflect.StringHeader Data field to or from Pointer.
//
// As in the previous case, the reflect data structures SliceHeader and StringHeader
// declare the field Data as a uintptr to keep callers from changing the result to
// an arbitrary type without first importing "unsafe". However, this means that
// SliceHeader and StringHeader are only valid when interpreting the content
// of an actual slice or string value.
//
//	var s string
//	hdr := (*reflect.StringHeader)(unsafe.Pointer(&s)) // case 1
//	hdr.Data = uintptr(unsafe.Pointer(p))              // case 6 (this case)
//	hdr.Len = n
//
// In this usage hdr.Data is really an alternate way to refer to the underlying
// pointer in the string header, not a uintptr variable itself.
//
// In general, reflect.SliceHeader and reflect.StringHeader should be used
// only as *reflect.SliceHeader and *reflect.StringHeader pointing at actual
// slices or strings, never as plain structs.
// A program should not declare or allocate variables of these struct types.
//
//	// INVALID: a directly-declared header will not hold Data as a reference.
//	var hdr reflect.StringHeader
//	hdr.Data = uintptr(unsafe.Pointer(p))
//	hdr.Len = n
//	s := *(*string)(unsafe.Pointer(&hdr)) // p possibly already lost
//
// Pointer 表示指向任意类型的指针。有四种特殊操作可以用于指针类型而不能用于其他类型：
//	- 任意类型的指针值可以转换为 Pointer
//	- Pointer 均可转换为任意类型的指针值
//	- uintptr 均可以转换为 Pointer
//	- Pointer 均可以转换为 uintptr
// 因此 Pointer 允许程序破坏类型系统并对任意的内存进行读写。使用应非常小心。
//
// 按照下面的模式使用 Pointer 是有效的。没有使用以下模式的代码可能会失效。
// 即便是下面提到的有效模式也伴随一些重要的警告。
//
// 运行 "go vet" 可以帮助寻找使用 Pointer 是否准讯下面这些模式，但没有运行 go vet 的代码则不会有任何保证。
//
// (1) 将 *T1 转换为 *T2.
//
// 提供的 T2 不比 T1 大，且双方拥有相同的内存布局。该转换允许将数据以另一种类型进行表示。
// 例如 math.Float64bits 的实现:
//
//	func Float64bits(f float64) uint64 {
//		return *(*uint64)(unsafe.Pointer(&f))
//	}
//
// (2) 将 Pointer 转换为 uintptr (但不转换回 Pointer).
//
// 将一个 Pointer 转换到 uintptr 会将该值指向的内存地址转为整型。一个常见的用法是
// 用于打印输出。
//
// 将 uintptr 转回 Pointer 通常情况下是不允许的。
//
// uintptr 是一个整数，而非引用。将一个 Pointer 转换到 uintptr 会创建一个没有指针语义的整数值。
// 即使一个 uintptr 保留了某个对象的地址，垃圾回收如果移动了对象，也不会更新 uintptr 的值。
// uintptr 也不会作为对象不被回收的依据。
//
// 剩下的模式枚举了从 uintptr 转到 Pointer 的所有有效转换。
//
// (3) 将 Pointer 转换为 uintptr 再转回，包含运算
//
// 如果 p 指向一个已分配的对象，则可以先通过该对象转换到 uintptr，添加偏移量，再转换回 Pointer。
//
//	p = unsafe.Pointer(uintptr(p) + offset)
//
// 最常见的用法是访问结构体中的字段或则数组的元素：
//
//	// 等价于 f := unsafe.Pointer(&s.f)
//	f := unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Offsetof(s.f))
//
//	// equivalent to e := unsafe.Pointer(&x[i])
//	e := unsafe.Pointer(uintptr(unsafe.Pointer(&x[0])) + i*unsafe.Sizeof(x[0]))
//
// 这种方式增加和减少指针的偏移量都是有效的，使用 &^ 同样有效，通常用于对齐。
// 所有情况下，指针必须指向原始分配的对象。
//
// 与 C 不同，将指针移动移至原有内存区外是无效的：
//
//	// 无效: end 指针在已分配内存区外
//	var s thing
//	end = unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Sizeof(s))
//
//	// 无效: end 指针在已分配内存区外
//	b := make([]byte, n)
//	end = unsafe.Pointer(uintptr(unsafe.Pointer(&b[0])) + uintptr(n))
//
// 注意，两个转换必须出现在同一个表达式中，他们之间只有普通的计算行为：
//
//	// 无效: uintptr 在转回 Pointer 时不能存储在一个变量中
//	u := uintptr(p)
//	p = unsafe.Pointer(u + offset)
//
// 注意，指针还必须指向一个已经分配的对象，因此它可能不是 nil
//
//	// 无效: nil 指针的转换
//	u := unsafe.Pointer(nil)
//	p := unsafe.Pointer(uintptr(u) + offset)
//
// (4) 当调用 syscall.Syscall 时候将 Pointer 转换为 uintptr
//
// syscall 包中的 Syscall 函数直接传递 uintptr 参数给操作系统，根据调用的细节，
// 可以将他们中的一些重新解释为指针。也就是说，系统调用实现隐式地将某些参数从 uintptr 转换回指针。
//
// 也就是说，如果必须将指针参数转换为 uintptr 用作参数，则改转换必须出现在表达式本身之中：
//
//	syscall.Syscall(SYS_READ, uintptr(fd), uintptr(unsafe.Pointer(p)), uintptr(n))
//
// 编译器处理了在调用汇编代码的函数参数表中将一个 Pointer 转换为 uintptr 的情况。
// 通过引用分配的对象（如果有），则在调用完成前都不会被移动，及时该变量可能不再需要。
//
// 为了让编译器识别这种模式，这种转换必须出现在参数表中：
//
//	// 无效: uintptr 不能存储在变量中
//	u := uintptr(unsafe.Pointer(p))
//	syscall.Syscall(SYS_READ, uintptr(fd), u, uintptr(n))
//
// (5) 将 reflect.Value.Pointer 或 reflect.Value.UnsafeAddr
// 的结果 uintptr 转换到 Pointer.
//
// reflect 包的 Value 方法将 Pointer 和 UnsafeAddr 返回为一个 uintptr 而非 unsafe.Pointer
// 用以防止调用者在不导入 unsafe 的情况下使用结果更改任意类型。但这个结果非常脆弱，并且必须在调用后
// 在同一表达式内立即转为指针：
//
//	p := (*int)(unsafe.Pointer(reflect.ValueOf(new(int)).Pointer()))
//
// 由于上面的情况，转换前进行任何存储都是无效的：
//
//	// 无效: uintptr 在转回 Pointer 前不能被存储在一个变量中
//	u := reflect.ValueOf(new(int)).Pointer()
//	p := (*int)(unsafe.Pointer(u))
//
// (6) 将 reflect.SliceHeader 或 reflect.StringHeader Data 字段与 Pointer 的互相转换.
//
// 与前面的情况一样，反射数据结构 SliceHeader 和 StringHeader 将 Data 字段声明为 uintptr，
// 以防止调用者在不导入 unsafe 的情况下修改为任意类型。但是，这意味着 SliceHeader 和 StringHeader
// 仅在解释实际切片或字符串值的内容时有效。
//
//	var s string
//	hdr := (*reflect.StringHeader)(unsafe.Pointer(&s)) // 情况 1
//	hdr.Data = uintptr(unsafe.Pointer(p))              // 情况 6 (此情况)
//	hdr.Len = n
//
// 在这种用法中，hdr.Data 实际上是一种引用字符串投的底层指针的替代方案，而非 uintptr 变量本身
//
// 通常 reflect.SliceHeader 和 reflect.StringHeader 只能作 *reflect.SliceHeader
// 和 *reflect.StringHeader 指向实际的切片或字符串，而不是普通的结构。
// 程序不应声明或分配这些结构类型的变量。
//
//	// 无效: 一个直接声明的 header 不会被 Data 作为引用保存
//	var hdr reflect.StringHeader
//	hdr.Data = uintptr(unsafe.Pointer(p))
//	hdr.Len = n
//	s := *(*string)(unsafe.Pointer(&hdr)) // p 可能已经丢失
//
type Pointer *ArbitraryType

// Sizeof takes an expression x of any type and returns the size in bytes
// of a hypothetical variable v as if v was declared via var v = x.
// The size does not include any memory possibly referenced by x.
// For instance, if x is a slice, Sizeof returns the size of the slice
// descriptor, not the size of the memory referenced by the slice.
// The return value of Sizeof is a Go constant.
// Sizeof 返回任意类型 x 的假象变量（如果 v 通过 var v = x 声明）表达式所占用的字节数。
// 该大小不包括 x 占用的内存。例如，x 是一个 slice，则 Sizeof 返回 slice 描述符的大小，
// 而非 slice 指向的内存块的大小
// 返回的值为 Go 常量
func Sizeof(x ArbitraryType) uintptr

// Offsetof returns the offset within the struct of the field represented by x,
// which must be of the form structValue.field. In other words, it returns the
// number of bytes between the start of the struct and the start of the field.
// The return value of Offsetof is a Go constant.
// Offsetof 返回由 x 所代表的结构中字段的偏移量，它必须为 stuctValue.field 的形式。
// 换句话说，它返回了该结构起始处于该字段起始数之间的字节数。
// 返回的值为 Go 常量
func Offsetof(x ArbitraryType) uintptr

// Alignof takes an expression x of any type and returns the required alignment
// of a hypothetical variable v as if v was declared via var v = x.
// It is the largest value m such that the address of v is always zero mod m.
// It is the same as the value returned by reflect.TypeOf(x).Align().
// As a special case, if a variable s is of struct type and f is a field
// within that struct, then Alignof(s.f) will return the required alignment
// of a field of that type within a struct. This case is the same as the
// value returned by reflect.TypeOf(s.f).FieldAlign().
// The return value of Alignof is a Go constant.
// Alignof 返回任意类型的表达式 x 的对齐方式。其返回值 m 满足变量 v 的类型地址与 m 取模为 0 的最大值。
// 它与 reflect.TypeOf(x).Align() 返回的值相同。
// 作为特殊情况，一个变量 s 如果是结构体类型且 f 是结构体的一个字段，那么 Alignof(s.f) 将返回
// 结构体内部该类型要求对齐的值，与 reflect.TypeOf(s.f).FieldAlign() 值相同。
// 返回的值为 Go 常量
func Alignof(x ArbitraryType) uintptr
