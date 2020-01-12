---
weight: 3301
title: "13.1 指针检查器"
---

# 13.1 指针检查器

[TOC]

本文涉及的 Go 源码包括以下文件：

```
src/unsafe/unsafe.go
```

`unsafe` 包会绕过所有的 Go 类型安全检查，几乎是 Cgo 的灵魂，也是支撑 Go 运行时、`reflect`、系统调用等机制的核心。
本文内容几乎直接翻译自官方文档。

## 任意类型 `ArbitraryType`

`ArbitraryType` 只用于文档展示的目的，其本身并非 `unsafe` 包的一部分。它表示了任意 Go 表达式的类型。

```go
type ArbitraryType int
```

## Go 指针 `Pointer`

`Pointer` 表示指向任意类型的指针。有四种特殊操作可以用于指针类型而不能用于其他类型：

- 任意类型的指针值可以转换为 `Pointer`
- `Pointer` 均可转换为任意类型的指针值
- `uintptr` 均可以转换为 `Pointer`
- `Pointer` 均可以转换为 `uintptr`

因此 `Pointer` 允许程序破坏类型系统并对任意的内存进行读写。使用应非常小心。

```go
type Pointer *ArbitraryType
```

`unsafe.Pointer` 可以在下面提及的这些情况下安全的使用。没有使用以下模式的代码可能会失效。
即便是下面提到的有效模式也伴随一些重要的警告。

运行 `go vet` 可以帮助寻找使用 `unsafe.Pointer` 是否准讯下面这些模式，但没有运行 `go vet` 的代码则不会有任何保证。

### 情况 1: 将 `*T1` 转换为 `*T2`.

提供的 `T2` 不比 `T1` 大，且双方拥有相同的内存布局。该转换允许将数据以另一种类型进行表示。
例如 `math.Float64bits` 的实现:

```go
func Float64bits(f float64) uint64 {
    return *(*uint64)(unsafe.Pointer(&f))
}
```

### 情况 2: 将 `Pointer` 转换为 `uintptr` (但不转换回 `Pointer`).

将一个 `Pointer` 转换到 `uintptr` 会将该值指向的内存地址转为整型。一个常见的用法是
用于打印输出。将 `uintptr` 转回 `Pointer` 通常情况下是不允许的。`uintptr` 是一个整数，
而非引用。将一个 `Pointer` 转换到 `uintptr` 会创建一个没有指针语义的整数值。
即使一个 `uintptr` 保留了某个对象的地址，垃圾回收如果移动了对象，也不会更新 `uintptr` 的值。
`uintptr` 也不会作为对象不被回收的依据。

剩下的模式枚举了从 `uintptr` 转到 `Pointer` 的所有有效转换。

### 情况 3: 将 `Pointer` 转换为 `uintptr` 再转回，包含运算

如果 `p` 指向一个已分配的对象，则可以先通过该对象转换到 `uintptr`，添加偏移量，再转换回 `Pointer`。

```go
p = unsafe.Pointer(uintptr(p) + offset)
```

最常见的用法是访问结构体中的字段或则数组的元素：

```go
// 等价于 f := unsafe.Pointer(&s.f)
f := unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Offsetof(s.f))
// equivalent to e := unsafe.Pointer(&x[i])
e := unsafe.Pointer(uintptr(unsafe.Pointer(&x[0])) + i*unsafe.Sizeof(x[0]))
```

这种方式增加和减少指针的偏移量都是有效的，使用 `&^` 同样有效，通常用于对齐。
所有情况下，指针必须指向原始分配的对象。与 C 不同，将指针移动移至原有内存区外是无效的：

```go
// 无效: end 指针在已分配内存区外
var s thing
end = unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Sizeof(s))
// 无效: end 指针在已分配内存区外
b := make([]byte, n)
end = unsafe.Pointer(uintptr(unsafe.Pointer(&b[0])) + uintptr(n))
```

注意，两个转换必须出现在同一个表达式中，他们之间只有普通的计算行为：

```go
// 无效: uintptr 在转回 Pointer 时不能存储在一个变量中
u := uintptr(p)
p = unsafe.Pointer(u + offset)
```

注意，指针还必须指向一个已经分配的对象，因此它可能不是 nil

```go
// 无效: nil 指针的转换
u := unsafe.Pointer(nil)
p := unsafe.Pointer(uintptr(u) + offset)
```

### 情况 4: 当调用 `syscall.Syscall` 时候将 `Pointer` 转换为 `uintptr`

`syscall` 包中的 `Syscall` 函数直接传递 `uintptr` 参数给操作系统，根据调用的细节，
可以将他们中的一些重新解释为指针。也就是说，系统调用实现隐式地将某些参数从 `uintptr` 转换回指针。
也就是说，如果必须将指针参数转换为 `uintptr` 用作参数，则改转换必须出现在表达式本身之中：

```go
syscall.Syscall(SYS_READ, uintptr(fd), uintptr(unsafe.Pointer(p)), uintptr(n))
```

编译器处理了在调用汇编代码的函数参数表中将一个 `Pointer` 转换为 `uintptr` 的情况。
通过引用分配的对象（如果有），则在调用完成前都不会被移动，及时该变量可能不再需要。
为了让编译器识别这种模式，这种转换必须出现在参数表中：

```go
// 无效: uintptr 不能存储在变量中
u := uintptr(unsafe.Pointer(p))
syscall.Syscall(SYS_READ, uintptr(fd), u, uintptr(n))
```

### 情况 5: 将 `reflect.Value.Pointer` 或 `reflect.Value.UnsafeAddr` 返回的 `uintptr` 转换到 `Pointer`

`reflect` 包的 `Value` 方法将 `Pointer` 和 `UnsafeAddr` 返回为一个 `uintptr` 而非 `unsafe.Pointer`
用以防止调用者在不导入 `unsafe` 的情况下使用结果更改任意类型。但这个结果非常脆弱，并且必须在调用后
在同一表达式内立即转为指针：

```go
p := (*int)(unsafe.Pointer(reflect.ValueOf(new(int)).Pointer()))
```

由于上面的情况，转换前进行任何存储都是无效的：

```go
// 无效: uintptr 在转回 Pointer 前不能被存储在一个变量中
u := reflect.ValueOf(new(int)).Pointer()
p := (*int)(unsafe.Pointer(u))
```

### 情况 6: 将 `reflect.SliceHeader` 或 `reflect.StringHeader` `Data` 字段与 `Pointer` 的互相转换

与前面的情况一样，反射数据结构 `SliceHeader` 和 `StringHeader` 将 `Data` 字段声明为 `uintptr`，
以防止调用者在不导入 `unsafe` 的情况下修改为任意类型。但是，这意味着 `SliceHeader` 和 `StringHeader`
仅在解释实际切片或字符串值的内容时有效。

```go
var s string
hdr := (*reflect.StringHeader)(unsafe.Pointer(&s)) // 情况 1
hdr.Data = uintptr(unsafe.Pointer(p))              // 情况 6 (此情况)
hdr.Len = n
```

在这种用法中，`hdr.Data` 实际上是一种引用字符串投的底层指针的替代方案，而非 `uintptr` 变量本身。
通常 `reflect.SliceHeader` 和 `reflect.StringHeader` 只能作 `*reflect.SliceHeader`
和 `*reflect.StringHeader` 指向实际的切片或字符串，而不是普通的结构。
程序不应声明或分配这些结构类型的变量。

```go
// 无效: 一个直接声明的 header 不会被 Data 作为引用保存
var hdr reflect.StringHeader
hdr.Data = uintptr(unsafe.Pointer(p))
hdr.Len = n
s := *(*string)(unsafe.Pointer(&hdr)) // p 可能已经丢失
```

## 指针操作

`Sizeof` 返回任意类型 `x` 的表达式所占用的字节数。该大小不包括 `x` 占用的内存。
例如，`x` 是一个 slice，则 `Sizeof` 返回 slice 描述符的大小，而非 slice 指向的内存块的大小。

```go
func Sizeof(x ArbitraryType) uintptr
```

`Offsetof` 返回由 x 所代表的结构中字段的偏移量，它必须为 `stuctValue.field` 的形式。
换句话说，它返回了该结构起始处于该字段起始数之间的字节数。

```go
func Offsetof(x ArbitraryType) uintptr
```

`Alignof` 返回任意类型的表达式 x 的对齐方式。其返回值 m 满足变量 v 的类型地址与 m 取模为 0 的最大值。
它与 `reflect.TypeOf(x).Align()` 返回的值相同。
作为特殊情况，一个变量 s 如果是结构体类型且 f 是结构体的一个字段，那么 `Alignof(s.f)` 将返回
结构体内部该类型要求对齐的值，与 `reflect.TypeOf(s.f).FieldAlign()` 值相同。

```go
func Alignof(x ArbitraryType) uintptr
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)