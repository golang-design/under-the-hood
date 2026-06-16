---
weight: 2202
title: "5.2 字符串与零拷贝转换"
---

# 5.2 字符串与零拷贝转换

字符串与切片同源，运行时里都是「头部 + 别处的内存」（布局见 [5.1.1](./slice.md#511-三种内存布局)），
但它**只读、不可变**，自成一类。不可变换来共享与免拷贝的好处，也带来一个直接代价：`string` 与
`[]byte` 互转默认要拷贝一份字节。本节剖开这份拷贝，看编译器在哪些场景下能把它省掉，再到 Go 1.20
给出的手动零拷贝工具，以及由此而来的安全契约。

## 5.2.1 字符串与 []byte 的转换

字符串不可变带来一个直接代价：`string` 与 `[]byte` 互转默认要**拷贝一份字节**。原因正是不可变,
`[]byte` 可写，若让它直接指向某个字符串的底层字节，改 `[]byte` 就等于改了那个「不可变」的字符串，
破坏了一切共享假设。所以运行时老老实实 `memmove` 一份：

```go
// runtime: []byte → string（string.go，节选）
func slicebytetostring(buf *tmpBuf, ptr *byte, n int) string {
    // ...
    p := mallocgc(uintptr(n), nil, false) // 分配新内存
    memmove(p, unsafe.Pointer(ptr), uintptr(n)) // 拷贝字节
    return unsafe.String((*byte)(p), n)
}
```

这份拷贝在热路径上可能可观。好在编译器认得几类「转换后字节立刻被读、不可能被改」的模式，把拷贝
省掉。最常见的两个是用 `[]byte` 临时当 map 键查询，与对 `[]byte(s)` 直接 range：

```go
var m map[string]int
_ = m[string(b)]      // 编译器：临时 string 仅用于查 map，无需拷贝（走 slicebytetostringtmp）
for i, c := range []byte(s) { // 编译器：仅遍历，不持久化，无需真正建切片
    _, _ = i, c
}
```

要在自己代码里手动零拷贝转换，Go 1.20 给了正式工具：`unsafe.String(*byte, len)` 把一段字节当
字符串看，`unsafe.StringData(string) *byte` 取字符串底层指针，`unsafe.Slice` / `unsafe.SliceData`
是切片侧的对应物。它们取代了过去靠 `reflect.StringHeader` / `reflect.SliceHeader` 手工拼头部
的脆弱写法（那种写法在有 GC 移动与字段对齐变化时并不可靠）。代价是你要自己担保**转换之后那段
字节不再被修改**，否则就把不可变契约捅破了：

```go
// 零拷贝、且你能保证 b 此后只读时，才可这样转
s := unsafe.String(unsafe.SliceData(b), len(b))
```

## 延伸阅读的文献

1. The Go Authors. *runtime/string.go：`slicebytetostring` / `stringStruct`*（字符串布局与转换）.
   https://github.com/golang/go/blob/master/src/runtime/string.go
2. The Go Authors. *Go 1.20 Release Notes*（`unsafe.String` / `unsafe.StringData` /
   `unsafe.SliceData`）. https://go.dev/doc/go1.20
3. Rob Pike. *Strings, bytes, runes and characters in Go.* The Go Blog, 2013.
   https://go.dev/blog/strings
