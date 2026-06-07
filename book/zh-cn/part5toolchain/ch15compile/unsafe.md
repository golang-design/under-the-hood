---
weight: 5104
title: "15.4 指针检查器"
---

# 15.4 指针检查器

Go 是内存安全的语言,但它留了一个逃生舱口：`unsafe` 包。用 `unsafe.Pointer` 可以绕过类型系统、
直接操纵内存,这在与 C 互操作、做底层优化时偶尔必要，却也极其危险。这一节讲清 `unsafe.Pointer`
的规则，以及编译器/运行时如何用**指针检查器**（checkptr）帮你抓出误用。

## 15.4.1 unsafe.Pointer 的能力与规则

`unsafe.Pointer` 是一种特殊指针：任何指针都能转成它，它也能转回任何指针类型,这就绕过了 Go
的类型安全。它还能与 `uintptr`（一个整数）互转，从而做指针算术。但这份能力有严格的**使用模式**,
语言规范列出了若干**合法的转换模式**（如把 `*T1` 转成 `*T2`、把结构体字段地址通过
`unsafe.Pointer` + `uintptr` 偏移算出来），偏离这些模式就是未定义行为。

最凶险的陷阱是 **`unsafe.Pointer` 与 `uintptr` 的关系**。`uintptr` 只是个整数，**GC 不把它当指针
看待**,如果你把一个 `unsafe.Pointer` 转成 `uintptr` 存起来、过一会儿再转回去用，期间 GC
可能已经回收或移动（栈拷贝，[14.4](../../part4memory/ch14stack)）了它指向的对象，这个 `uintptr`
就成了指向无效内存的垃圾。规则是：**`unsafe.Pointer` 到 `uintptr` 的转换必须"一气呵成"地用在
同一个表达式里**（如指针算术），绝不能把 `uintptr` 跨语句、跨时间地保存。这是 `unsafe` 误用里
最常见、也最隐蔽的一类 bug。

## 15.4.2 checkptr：抓出误用

为帮人抓出 `unsafe` 误用，Go 提供了**指针检查器**（checkptr）：在编译时加 `-race` 或
`-d=checkptr` 时，编译器会在 `unsafe.Pointer` 的转换处**插入运行时检查**,验证指针是否对齐、
是否指向合法的已分配内存、`uintptr↔Pointer` 的用法是否符合规则。一旦发现违规，运行时报错并
指出位置。这把许多本来"平时不出事、偶尔神秘崩溃"的 `unsafe` bug，变成了可被及时发现的明确
错误。checkptr 体现了 Go 的一贯态度：**即便给了你绕过安全的口子，也要尽力帮你别把脚打穿。**

## 15.4.3 unsafe 的定位

`unsafe` 这个名字本身就是警告。Go 的设计哲学是**默认安全**,内存安全、类型安全是常态。`unsafe`
是为少数确实必要的场景（cgo 互操作 [15.6](./cgo.md)、与系统结构体对接、零拷贝转换
[5.1](../../part2lang/ch05data/slice.md) 的 `unsafe.String`、极致性能优化）保留的**例外通道**，
而非日常工具。它的使用应当：尽量少、严格遵循规范的合法模式、并在测试中开启 checkptr 与
race 检测（[16.2](../ch16tools/race.md)）。值得一提，Go 1.17/1.20 还给 `unsafe` 加了
`Slice`/`String`/`SliceData`/`StringData` 等**更安全的辅助函数**，取代过去靠 `reflect.SliceHeader`
那种脆弱写法,即便是逃生舱口，Go 也在努力让它**没那么容易出事**。这就是 Go 对待"不安全"的
态度：承认它有时必要，但用类型系统、规范、工具层层设防，把它的危险性压到最低。

## 延伸阅读的文献

1. The Go Authors. *unsafe 包文档（合法转换模式）.* https://pkg.go.dev/unsafe
2. The Go Authors. *checkptr / runtime pointer checking.*
   https://github.com/golang/go/blob/master/src/cmd/compile/internal/walk/expr.go
3. The Go Authors. *Go 1.17/1.20 Release Notes（unsafe.Add/Slice/String）.*
   https://go.dev/doc/go1.20
4. 本书 [5.1 数组、切片与字符串](../../part2lang/ch05data/slice.md)、[15.6 cgo](./cgo.md)、
   [16.2 竞态检测](../ch16tools/race.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
