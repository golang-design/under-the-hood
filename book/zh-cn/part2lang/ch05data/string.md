---
weight: 2202
title: "5.2 字符串与零拷贝转换"
---

# 5.2 字符串与零拷贝转换

字符串在运行时中的表示与切片相近，都由一个头部和位于别处的一段字节组成（[5.1.1](./slice.md)），但字符串
**不可变**。不可变性使字符串可以自由地共享而无须复制，也带来一项直接的代价：`string` 与 `[]byte` 之间的
转换原则上必须复制字节。本节先讨论字符串的表示、不可变性的保证方式以及 Go 字符串与 UTF-8 的关系，再讨论
这项复制的代价，以及编译器在哪些情形下能够省去它；最后介绍 Go 1.20 提供的手动零拷贝工具及其使用约定，并
讨论子串导致的内存滞留与字符串驻留。

## 5.2.1 表示与不可变性

字符串的头部只有两个字：指向字节的指针与字节数（`runtime/string.go` 中的
`stringStruct`）[[Go Authors, 2026a](#ref-go-authors-2026a)]。与切片不同，它没有容量字段，
因为字符串的内容与长度一经确定便不再改变。

不可变性有两层保证。在语言层面，字符串不支持对元素赋值，`s[0] = 'x'` 无法通过编译，所有看似修改字符串的
操作（拼接、替换等）都会产生新的字符串。在实现层面，字符串字面量由编译器放在可执行文件的只读数据段中，
程序运行时这段内存被映射为只读。若借助 `unsafe` 绕过语言的限制去修改一个字面量：

```go
package main

import "unsafe"

func main() {
	s := "hello"
	b := unsafe.Slice(unsafe.StringData(s), len(s))
	b[0] = 'j' // 字面量位于只读内存
}
```

程序会因写入只读内存而崩溃：

```
unexpected fault address 0x100f78fd3
fatal error: fault
```

其后的信号名称与操作系统有关，在笔者的 macOS/arm64 环境中为 SIGBUS。这一行为说明，不可变性不只是语言规则，
对字面量而言也有硬件层面的保护；而对于运行时构造的字符串，不可变性只能依靠程序遵守约定来维持，5.2.4 将
回到这一点。

## 5.2.2 字节、字符与 UTF-8

Go 的字符串是字节序列，并不要求其内容是合法的 UTF-8；但 Go 的源文件规定使用 UTF-8 编码，`for range`
遍历字符串时也按 UTF-8 解码。这一选择与 Go 设计者的经历直接相关。按照 Rob Pike 在 2003 年的回忆
[[Pike, 2003](#ref-pike-2003)]，UTF-8 是 1992 年 9 月的一个晚上，Ken Thompson 在新泽西州一家餐馆的餐垫上设
计出来的：Thompson 设计了编码的位布局，Pike 在一旁协助。几天之内，他们就把 Plan 9
操作系统全面改为使用这种编码，并于 9 月 8 日把设计寄给了 X/Open。次年，二人在 USENIX 冬季会议上发表了介绍
Plan 9 采用 UTF-8 的论文 [[Pike and Thompson, 1993](#ref-pike-thompson-1993)]。

UTF-8 用 1 至 4 个字节编码一个 Unicode 码点，ASCII 字符只占一个字节，且任何多字节序列的各个字节都不会与
ASCII 字符混淆。在 Go 中，`len(s)` 返回的是字节数，下标 `s[i]` 取得的是第 `i` 个字节，而 `for range`
每次解码一个码点（类型为 `rune`，即 `int32`），遇到非法的字节序列时得到替换字符 U+FFFD
[[Pike, 2013](#ref-pike-2013)]：

```go {run=true}
package main

import (
	"fmt"
	"unicode/utf8"
)

func main() {
	s := "Go语言"
	fmt.Println(len(s), utf8.RuneCountInString(s)) // 字节数与字符数
	for i, r := range s {
		fmt.Printf("%d:%c ", i, r) // i 是字节偏移
	}
	fmt.Println()
	fmt.Println(s[2], s[2:5]) // 按字节索引与切片

	for _, r := range "a\xffb" { // \xff 不是合法的 UTF-8
		fmt.Printf("%U ", r)
	}
	fmt.Println()
}
```

```
8 4
0:G 1:o 2:语 5:言
232 语
U+0061 U+FFFD U+0062
```

「语」与「言」各占 3 个字节，所以字符串共 8 个字节、4 个字符，`range` 给出的偏移依次为 0、1、2、5。`s[2]`
是「语」的第一个字节 232（0xE8），而 `s[2:5]` 恰好截取了完整的「语」。若切片边界落在一个字符的中间，结果
便不再是合法的 UTF-8，但它仍然是一个合法的 Go 字符串。

## 5.2.3 转换的代价与编译器的优化

`[]byte` 是可写的。若 `[]byte(s)` 直接指向字符串 `s` 的字节，通过它写入就会改变一个本应不可变的字符串；
反之，若 `string(b)` 直接引用切片 `b` 的字节，之后对 `b` 的修改也会反映到字符串上。因此，
二者之间的转换在语义上必须复制。`[]byte` 到 `string` 的转换由运行时的 `slicebytetostring` 完成（Go 1.26，
省略了竞态检测等代码）：

```go
func slicebytetostring(buf *tmpBuf, ptr *byte, n int) string {
	if n == 0 {
		return ""
	}
	if n == 1 { // 单个字节：指向静态数组，无须分配
		p := unsafe.Pointer(&staticuint64s[*ptr])
		if goarch.BigEndian {
			p = add(p, 7)
		}
		return unsafe.String((*byte)(p), 1)
	}

	var p unsafe.Pointer
	if buf != nil && n <= len(buf) { // 结果不逃逸且不超过 32 字节：使用栈上的缓冲区
		p = unsafe.Pointer(buf)
	} else {
		p = mallocgc(uintptr(n), nil, false)
	}
	memmove(p, unsafe.Pointer(ptr), uintptr(n))
	return unsafe.String((*byte)(p), n)
}
```

参数 `buf` 是编译器在调用方栈帧上预留的 32 字节缓冲区（`tmpBuf`），仅当转换结果不逃逸时才会传入。反方向的
`stringtoslicebyte` 也有同样的安排。

除此之外，编译器还能识别若干转换结果只被临时读取、不可能被保留或修改的情形，在这些情形下完全省去复制。
对于 `string(b)`，运行时源码的注释列出了以下几种：以 `string(b)` 作为键查询 map（`m[string(b)]`），在拼接
表达式中使用（如 `"<" + string(b) + ">"`），以及与另一个字符串比较（`string(b) == "foo"`）。编译器在这些
位置使用 `slicebytetostringtmp`，它直接返回指向 `b` 中字节的字符串，不复制。

对于反方向的 `[]byte(s)`，Go 1.22 加入了一项基于逃逸分析的优化：若能证明转换得到的切片从未被修改，它便可以
直接共享字符串的字节。下面的程序测量各种情形下的分配次数：

```go {run=true}
package main

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

var (
	sinkS string
	m     = map[string]int{}
)

//go:noinline
func countA(s string) int {
	n := 0
	for _, c := range []byte(s) { // 只读，不修改
		if c == 'a' {
			n++
		}
	}
	return n
}

//go:noinline
func upper(s string) int {
	b := []byte(s) // 下文会修改 b
	b[0] = 'A'
	return len(b)
}

func main() {
	s := strings.Repeat("a", 40+len(os.Args)) // 41 字节，运行时构造
	b := []byte(s)

	fmt.Println(testing.AllocsPerRun(100, func() { sinkS = string(b) }))  // 结果逃逸
	fmt.Println(testing.AllocsPerRun(100, func() { _ = m[string(b)] }))   // 查 map
	fmt.Println(testing.AllocsPerRun(100, func() { _ = string(b) == s })) // 比较
	fmt.Println(testing.AllocsPerRun(100, func() { countA(s) }))          // 只读的 []byte(s)
	fmt.Println(testing.AllocsPerRun(100, func() { upper(s) }))           // 被修改的 []byte(s)
	fmt.Println(testing.AllocsPerRun(100, func() { upper(s[:8]) }))       // 不超过 32 字节
}
```

```
1
0
0
0
1
0
```

只有两种情形需要分配：结果逃逸的 `string(b)`，以及转换后会被修改且超过 32 字节的 `[]byte(s)`。以
`-gcflags=-m` 编译，可以看到编译器对两处转换给出的报告：

```
./main.go:18:27: zero-copy string->[]byte conversion
./main.go:35:14: zero-copy string->[]byte conversion
```

第一处是 `countA` 中的 `[]byte(s)`；第二处是 `main` 中的 `b := []byte(s)`，`b` 此后同样从未被修改。

这项优化的实现是在逃逸分析中为每个位置记录一个「可能被修改」的属性。它于 2023 年 8 月提交，次日即因发现
出错的情形被撤销，当天又以调试开关 `-d=zerocopy` 的形式重新提交并默认开启，随 Go 1.22 发布。

## 5.2.4 手动零拷贝：`unsafe.String` 与相关函数

编译器的优化只覆盖它能够证明安全的情形。当程序员确知某段字节此后不会再被修改时，可以使用 Go 1.20
引入的四个函数手动完成零拷贝转换：`unsafe.String(ptr, len)` 由字节指针与长度构造字符串，
`unsafe.StringData(s)` 取得字符串底层字节的指针，`unsafe.Slice` 与 `unsafe.SliceData`
是切片一侧的对应函数 [[Go Authors, 2023](#ref-go-authors-2023)]。

在此之前，常见的做法是借助 `reflect.StringHeader` 与 `reflect.SliceHeader` 手工构造头部。
这种写法的问题在于这两个结构体的 `Data` 字段是 `uintptr`，垃圾回收器并不把它视为指针，
因此仅凭这个字段无法保证所引用的内存不被回收，程序必须另外保留一个类型正确的指针。这两个类型已在 Go 1.21
中被标记为弃用，文档建议改用上述函数。

标准库中的 `strings.Builder` 就使用了这种手法：它在内部的 `[]byte` 中积累内容，`String` 方法直接以
`unsafe.String(unsafe.SliceData(b.buf), len(b.buf))` 返回结果，不做复制。这是安全的，因为 `Builder` 只会在
已写入内容之后追加，从不修改已经写入的字节。

使用这些函数的前提是程序员自行保证：转换之后，那段字节不再被修改。一旦违反，不可变性便被破坏：

```go {run=true}
package main

import (
	"fmt"
	"unsafe"
)

func main() {
	b := []byte("hello")
	s := unsafe.String(unsafe.SliceData(b), len(b)) // 零拷贝：s 与 b 共享字节
	fmt.Println(s)
	b[0] = 'j' // 违反约定：转换之后又修改了字节
	fmt.Println(s)
}
```

```
hello
jello
```

字符串 `s` 的内容在没有任何赋值的情况下发生了变化。若 `s` 此前已被用作 map 的键，或者被其他 goroutine
读取，后果便难以预料。

## 5.2.5 子串、内存滞留与驻留

子串与子切片一样共享原字符串的字节（[5.1.5](./slice.md)）。从一个很大的字符串中截取一小段并长期保存，
会使整个大字符串无法被回收。Go 1.18 引入的 `strings.Clone` 可以解决这一问题：它保证把内容复制到一块新的内
存中。文档同时提醒，复制本身也消耗内存，`Clone` 应当只在性能剖析表明需要时才使用。

与此相反的需求是**驻留**（interning）：程序中大量重复出现的字符串（例如日志中的主机名、解析得到的字段名）
只保留一份。Go 1.23 引入的 `unique` 包提供了这一功能 [[Go Authors, 2026b](#ref-go-authors-2026b)]：
`unique.Make` 返回一个句柄，内容相同的值得到相等的句柄，比较两个句柄只需比较一个指针：

```go {run=true}
package main

import (
	"fmt"
	"unique"
)

func main() {
	a := unique.Make("golang")
	b := unique.Make(string([]byte{'g', 'o', 'l', 'a', 'n', 'g'}))
	fmt.Println(a == b, a.Value()) // 句柄相等，比较只需比较指针
}
```

```
true golang
```

`unique` 内部维护一张全局表，表中以弱指针（weak pointer）引用各个值，因此不再被引用的值仍可以被回收。Go
1.25 起，编译器还会省去 `unique.Make(string(b))` 中的那次复制。

## 5.2.6 与其他语言的比较

各语言对字符串的设计在两个方面有所不同：是否可变，以及内部采用何种编码。

- **Java** 的 `String` 不可变，内部最初以 UTF-16 存储；Java 9 引入了紧凑字符串（JEP 254），只含
  Latin-1 字符的字符串每个字符只占一个字节。
- **Python 3** 的 `str` 不可变，以码点为单位；自 Python 3.3 起（PEP 393），内部根据字符串中最大的码点在
  每字符 1、2、4 个字节之间选择表示，因此可以按码点在常数时间内索引。
- **Rust** 区分拥有内存的 `String` 与借用的 `&str`，二者都保证内容是合法的 UTF-8，由字节构造字符串时须经过
  校验。
- **C++** 的 `std::string` 是可变的字节序列，不规定编码。

Go 的选择介于其间：字符串不可变，内部是字节序列，约定（而非强制）使用 UTF-8。不强制校验使 `string(b)`
等转换无须扫描内容，也使字符串可以承载任意二进制数据；代价是程序在需要合法 UTF-8 时须自行用
`utf8.ValidString` 检查。

## 延伸阅读

- <a id="ref-pike-2013"></a>[Pike, 2013] Rob Pike. "Strings, bytes, runes and characters in Go." The Go
  Blog, 2013. https://go.dev/blog/strings
  字符串、字节与 rune 的关系，以及 `for range` 的解码规则。
- <a id="ref-pike-2003"></a>[Pike, 2003] Rob Pike. "UTF-8 history." 2003.
  https://www.cl.cam.ac.uk/~mgk25/ucs/utf-8-history.txt
  UTF-8 设计经过的亲历记述，附有 1992 年的原始邮件。
- <a id="ref-pike-thompson-1993"></a>[Pike and Thompson, 1993] Rob Pike, Ken Thompson. "Hello World or
  Καλημέρα κόσμε or こんにちは 世界." *Proceedings of the Winter 1993 USENIX Conference*, 43–50, 1993.
  Plan 9 采用 UTF-8 的经过与设计考虑。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. `runtime/string.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/string.go
  https://github.com/golang/go/blob/master/src/runtime/string.go
  `slicebytetostring`、`slicebytetostringtmp` 与 `stringtoslicebyte` 的实现。
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. Go 1.20 Release Notes.
  https://go.dev/doc/go1.20
  `unsafe.String`、`unsafe.StringData` 与 `unsafe.SliceData` 的引入。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `unique` 包文档.
  https://pkg.go.dev/unique
  Go 1.23 引入的值驻留机制。

