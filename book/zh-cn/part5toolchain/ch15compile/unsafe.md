---
weight: 5104
title: "15.4 指针检查器"
---

# 15.4 指针检查器

Go 的内存安全建立在一个前提之上：编译器知道每个值的类型。类型系统保证指针只指向其声明类型的对象，
编译器据此为每个栈帧生成指针位图，垃圾回收器（[第 13 章](../../part4memory/ch13gc/readme.md)）与栈的拷贝
（[14.4](../../part4memory/ch14stack/copy.md)）都依赖这些位图找到全部指针。少数场合需要越过类型系统：
与 C 代码交换数据（[15.6](./cgo.md)），按操作系统规定的布局填写系统调用的参数，在 `[]byte` 与 `string`
之间零拷贝地转换（[5.2](../../part2lang/ch05data/string.md)）。`unsafe` 包为这些场合提供了出口。

越过类型系统之后，原先由编译器保证的性质改由程序员自己维持。本节先说明 `unsafe.Pointer` 的合法用法及其
规则的来由，再说明编译器与运行时如何配合这些规则，最后讨论**指针检查器**（checkptr）：它在运行时检查
`unsafe.Pointer` 的转换，把平时不发作的误用变为当场的错误。

## 15.4.1 unsafe.Pointer 的合法模式

`unsafe.Pointer` 的文档开宗明义地列出了它的四种特殊操作 [[Go Authors, n.d.a](#ref-go-authors-nda)]：

```go
// Pointer represents a pointer to an arbitrary type. There are four special operations
// available for type Pointer that are not available for other types:
//   - A pointer value of any type can be converted to a Pointer.
//   - A Pointer can be converted to a pointer value of any type.
//   - A uintptr can be converted to a Pointer.
//   - A Pointer can be converted to a uintptr.
//
// Pointer therefore allows a program to defeat the type system and read and write
// arbitrary memory. It should be used with extreme care.
```

前两种操作合起来，可以把任意 `*T1` 转换为任意 `*T2`，以另一种类型解释同一段内存；后两种操作使指针与整数
可以互相转换，从而对地址做算术。文档随后列出六种合法的模式，并声明不符合这些模式的代码现在或将来可能是
无效的。`go vet` 可以发现部分不符合模式的用法，但文档特意指出，`go vet` 没有报错并不保证代码有效。

| 模式 | 转换 | 要点 |
|:---|:---|:---|
| (1) | `*T1` → `Pointer` → `*T2` | `T2` 不大于 `T1`，且二者内存布局相容 |
| (2) | `Pointer` → `uintptr` | 只用于取得地址的数值，例如打印；不得再转换回去 |
| (3) | `Pointer` → `uintptr` → `Pointer`，中间做算术 | 两次转换必须在同一个表达式中；结果必须仍指向原来的分配 |
| (4) | 调用 `syscall.Syscall` 等函数时 `Pointer` → `uintptr` | 转换必须直接出现在调用的参数列表中 |
| (5) | `reflect.Value.Pointer` 或 `UnsafeAddr` 的结果 → `Pointer` | 必须在调用之后立即转换，在同一个表达式中 |
| (6) | `reflect.SliceHeader` 或 `StringHeader` 的 `Data` 字段与 `Pointer` 互相转换 | 头部只能是指向真实切片或字符串的指针，不得单独声明 |

模式 (1) 的典型例子是 `math.Float64bits`，它不做任何浮点运算，只是把 `float64` 的 8 个字节按 `uint64` 读出
[[Go Authors, 2026c](#ref-go-authors-2026c)]：

```go
func Float64bits(f float64) uint64 { return *(*uint64)(unsafe.Pointer(&f)) }
```

模式 (3) 用于访问结构体字段或数组元素，偏移量由 `unsafe.Offsetof` 与 `unsafe.Sizeof` 给出，二者与
`unsafe.Alignof` 一样在编译期求值。偏移可以加也可以减，也可以用 `&^` 把地址向下对齐，但结果必须仍落在
原来的分配之内。与 C 不同，Go 不允许把指针移到分配末尾之后哪怕一个字节的位置：

```go
// 无效：end 指向分配之外
var s thing
end = unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Sizeof(s))
```

这条限制来自垃圾回收器：一个恰好指向分配末尾的地址，可能正是下一个对象的起点，它会使下一个对象被误认为
仍被引用，原来的对象却失去了引用。按文档的说法，(3) 至 (6) 列举了把 `uintptr` 转换回
`Pointer` 的全部合法方式，它们都要求转换紧跟在产生地址的操作之后。下一小节说明其原因。

## 15.4.2 uintptr 只是整数

`unsafe` 的文档对 `uintptr` 的性质说得很明确 [[Go Authors, n.d.a](#ref-go-authors-nda)]：

```go
// A uintptr is an integer, not a reference.
// Converting a Pointer to a uintptr creates an integer value
// with no pointer semantics.
// Even if a uintptr holds the address of some object,
// the garbage collector will not update that uintptr's value
// if the object moves, nor will that uintptr keep the object
// from being reclaimed.
```

编译器生成的指针位图只标记指针类型的槽位，`uintptr` 类型的变量不在其中。于是有两种后果。其一，
如果一个对象只剩一个 `uintptr` 记着它的地址，垃圾回收器会把它当作不可达的对象回收。其二，对象可能移动。Go
的堆对象目前不会移动，但 goroutine 的栈会：栈增长或收缩时，运行时把整个栈复制到新的位置，
并按位图调整所有指向栈内的指针（[14.4](../../part4memory/ch14stack/copy.md)），记在 `uintptr`
中的栈地址却保持原值，此后指向已经废弃的旧栈。

两种后果都只在 `uintptr` 存活期间恰好发生垃圾回收或栈复制时才会出现。模式 (3) 要求两次转换出现在同一个
表达式中，就是把这段时间缩短到一次地址算术：

```go
// 合法
p = unsafe.Pointer(uintptr(p) + offset)

// 无效：uintptr 在转换回 Pointer 之前被存入变量
u := uintptr(p)
p = unsafe.Pointer(u + offset)
```

编译器与运行时分别为此提供了保证。其一，在生成 SSA 时，指针与整数之间的转换不是简单地复制一个值，
而是生成一个专门的 `Convert` 操作 [[Go Authors, 2026c](#ref-go-authors-2026c)]：

```go
	// Convert converts between pointers and integers.
	// We have a special op for this so as to not confuse GC
	// (particularly stack maps).  It takes a memory arg so it
	// gets correctly ordered with respect to GC safepoints.
	// It gets compiled to nothing, so its result must in the same
	// register as its argument. regalloc knows it can use any
	// allocatable integer register for OpConvert.
	// arg0=ptr/int arg1=mem, output=int/ptr
	{name: "Convert", argLength: 2, zeroWidth: true, resultInArg0: true},
```

`Convert` 以内存状态为参数，因而不会被调度到它前后的函数调用之外。同一个表达式中的两次转换之间只有算术，
没有函数调用，也就没有同步的安全点，栈不会在这里增长，垃圾回收也不会在这里精确地扫描这个栈帧。
其二是异步抢占（[9.7](../../part3concurrency/ch09sched/preemption.md)）：goroutine
可能在任意指令处被打断，但运行时对被打断的最内层栈帧做保守扫描，寄存器中任何看起来像指针的整数都使对象存
活；处于异步安全点的 goroutine 的栈也不会被收缩 [[Go Authors, 2026c](#ref-go-authors-2026c)]。`uintptr`
一旦被存入变量、跨越语句，这两项保证都不再成立。

模式 (4) 的情形不同：`syscall.Syscall` 的参数类型是 `uintptr`，指针必须先转换为整数才能传入，
而内核在调用期间会把其中一些参数当作指针使用。标准库用两个编译指示处理这个问题
[[Go Authors, 2026c](#ref-go-authors-2026c)]：

```go
// N.B. For the Syscall functions below:
//
// //go:uintptrkeepalive because the uintptr argument may be converted pointers
// that need to be kept alive in the caller.
//
// //go:nosplit because stack copying does not account for uintptrkeepalive, so
// the stack must not grow. Stack copying cannot blindly assume that all
// uintptr arguments are pointers, because some values may look like pointers,
// but not really be pointers, and adjusting their value would break the call.
```

对标有 `//go:uintptrkeepalive` 的函数，逃逸分析把参数列表中的 `uintptr(unsafe.Pointer(p))` 改写为先把 `p`
存入一个临时变量，并让这个变量一直存活到调用返回。`//go:nosplit` 则保证调用期间栈不会增长，编译器会检查
标有前者的函数是否同时标有后者。`//go:uintptrkeepalive` 只允许在标准库中使用；另一个指示
`//go:uintptrescapes` 则让这类参数所指的对象逃逸到堆上，栈增长因而不再构成问题。这正是模式 (4) 要求转换
「直接出现在参数列表中」的原因：编译器只在那里识别这种写法。

## 15.4.3 checkptr

上述规则并不复杂，违反它们的代码却往往通过所有测试：只有垃圾回收或栈复制恰好落在危险的窗口中，
程序才会读到错误的数据或崩溃。2017 年的提案 #22218 提出在转换处插入运行时检查，起因是另一类问题：
栈复制时如果遇到 0 到 `minLegalPointer` 之间的指针值，运行时会以 invalid pointer found on stack 终止程序，
提案希望在产生这种值的转换处就报告错误 [[amscanne, 2017](#ref-amscanne-2017)]。Matthew Dempsky 于
2019 年实现了编译器选项 `-d=checkptr`，随 Go 1.14 发布 [[Dempsky, 2019a](#ref-dempsky-2019a)；
[Go Authors, 2020](#ref-go-authors-2020)]。它在两类转换处插入对运行时函数的调用：

- `unsafe.Pointer` 转换为 `*T` 时，调用 `checkptrAlignment`，检查地址是否满足 `T` 的对齐要求，以及
  `T` 所覆盖的内存是否横跨了多个分配。对齐只对本身含指针的类型强制要求。
- `uintptr` 转换为 `unsafe.Pointer` 时，调用 `checkptrArithmetic`。编译器在 walk
  阶段分析这次转换的操作数，收集算术表达式中所有由 `unsafe.Pointer` 转换而来的「原始指针」（加法的两侧，
  减法与 `&^` 的左侧），连同计算结果一起交给运行时 [[Go Authors, 2026b](#ref-go-authors-2026b)]。

`checkptrArithmetic` 的实现很短 [[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
func checkptrArithmetic(p unsafe.Pointer, originals []unsafe.Pointer) {
	if 0 < uintptr(p) && uintptr(p) < minLegalPointer {
		throw("checkptr: pointer arithmetic computed bad pointer value")
	}

	// Check that if the computed pointer p points into a heap
	// object, then one of the original pointers must have pointed
	// into the same object.
	base := checkptrBase(p)
	if base == 0 {
		return
	}

	for _, original := range originals {
		if base == checkptrBase(original) {
			return
		}
	}

	throw("checkptr: pointer arithmetic result points to invalid allocation")
}
```

第一项检查对应提案 #22218 的起因。第二项检查是模式 (3) 中「结果必须仍指向原来的分配」的运行时版本：
`checkptrBase` 依次判断地址是否位于当前 goroutine 的栈中、某个堆对象中（借助垃圾回收器的 `findObject`，
[12.2](../../part4memory/ch12alloc/component.md)），或者某个模块的 data 段与 bss 段中，
返回所在分配的基址。计算结果与某个原始指针的基址相同，才算合法。若算术的操作数中根本没有
`unsafe.Pointer`，例如地址先被存进了一个 `uintptr` 变量，`originals` 就是空的，只要结果指向堆对象，
检查必然失败。跨越语句保存 `uintptr` 的写法因此会被当场发现，无须等到垃圾回收恰好发生。

下面的 `second` 违反了模式 (3)（输出以 Go 1.26.10 为准）：

```go
package main

import (
	"fmt"
	"unsafe"
)

type pair struct{ a, b int }

var sink *pair

func second(p *pair) int {
	u := uintptr(unsafe.Pointer(p))
	q := unsafe.Pointer(u + unsafe.Offsetof(p.b)) // u 跨越了语句，无效
	return *(*int)(q)
}

func main() {
	sink = &pair{1, 2}
	fmt.Println(second(sink))
}
```

```shell
$ go run .
2
$ go vet .
main.go:14:7: possible misuse of unsafe.Pointer
$ go run -race . 2>&1 | head -1
fatal error: checkptr: pointer arithmetic result points to invalid allocation
```

不加检查时，程序输出了正确的结果，错误被掩盖。`go vet` 能从语法形式上识别这种写法；`-race` 隐含了
`-d=checkptr`，运行时检查在第 14 行终止了程序。两种工具各有盲区：把同一个程序中的转换改写为模式 (3)
的形式、但让结果越过分配的末尾，`go vet` 不再报错，checkptr 则仍会在结果落入相邻堆对象时报告同样的错误。

checkptr 在 Go 1.14 中即与 `-race`、`-msan` 绑定，当时 Windows 除外，因为 Windows 部分的标准库中有大量需要
修改的转换 [[Dempsky, 2019b](#ref-dempsky-2019b)]。在 Go 1.26 中，`-race`、`-msan` 与 `-asan` 三者都隐含
`-d=checkptr`，除非显式指定了别的值，`-gcflags=all=-d=checkptr=0` 可以将其关闭。`-d=checkptr=2` 更进一步，
迫使所有转换为 `unsafe.Pointer` 的值分配在堆上，使基于堆对象的检查覆盖更多情形。运行时本身不使用 checkptr
[[Go Authors, 2026b](#ref-go-authors-2026b)]。

检查也有已知的局限。`checkptrBase` 对栈上的地址一律返回同一个伪基址 1，同一个栈帧中不同变量之间的越界
算术因此无法发现；`checkptrStraddles` 只比较一段内存首尾两端的基址，中间完整包含了别的分配的情形也检查
不出来，源码中以 TODO 注明了这两点 [[Go Authors, 2026a](#ref-go-authors-2026a)]。与竞争检查
（[16.2](../ch16tools/race.md)）一样，checkptr 只能发现测试中实际执行到的错误。

确实需要违反规则的函数可以标注 `//go:nocheckptr`，编译器不为其插入检查。标准库中的 `internal/abi.NoEscape`
是一个例子，它故意经由整数转换使逃逸分析看不到指针的流向 [[Go Authors, 2026c](#ref-go-authors-2026c)]：

```go
//go:nosplit
//go:nocheckptr
func NoEscape(p unsafe.Pointer) unsafe.Pointer {
	x := uintptr(p)
	return unsafe.Pointer(x ^ 0)
}
```

`//go:nosplit` 与 `//go:cgo_unsafe_args` 都隐含 `//go:nocheckptr`。启用 checkptr 时，内联器也不内联标有
`//go:nocheckptr` 的函数（[15.3](./optimize.md)），否则函数体展开到调用者中之后，又会被插入检查。

## 15.4.4 更安全的原语

模式 (6) 是六种模式中最脆弱的一种。`reflect.SliceHeader` 与 `reflect.StringHeader` 的 `Data` 字段是
`uintptr`，只有当头部本身是一个真实切片或字符串的别名时，这个字段才同时是指针；单独声明的头部变量中，
`Data` 只是一个整数，不能使底层数据存活。Go 1.17 加入了 `unsafe.Add` 与 `unsafe.Slice`
[[Dempsky, 2021](#ref-dempsky-2021)]，Go 1.20 又加入 `unsafe.SliceData`、`unsafe.String` 与
`unsafe.StringData`，至此不依赖头部的内存表示也能构造与拆解切片和字符串
[[Go Authors, 2021](#ref-go-authors-2021)；[Go Authors, 2023](#ref-go-authors-2023)]。
它们的签名如下（节选）[[Go Authors, n.d.a](#ref-go-authors-nda)]：

```go
func Add(ptr Pointer, len IntegerType) Pointer
// ……
func Slice(ptr *ArbitraryType, len IntegerType) []ArbitraryType
// ……
func SliceData(slice []ArbitraryType) *ArbitraryType
// ……
func String(ptr *byte, len IntegerType) string
// ……
func StringData(str string) *byte
```

Go 1.17 的发布说明强调，这些函数是为了让符合规则的代码更容易编写，规则本身没有改变
[[Go Authors, 2021](#ref-go-authors-2021)]。它们的好处在于检查可以附着在函数上：`unsafe.Slice`
总会检查长度是否为负、`ptr` 与长度相乘是否溢出、`ptr` 为 nil 时长度是否为零；启用 checkptr 时，
编译器改为调用 `unsafeslicecheckptr`，再检查结果是否横跨多个分配，`unsafe.String` 也是如此
[[Go Authors, 2026b](#ref-go-authors-2026b)；[Go Authors, 2026c](#ref-go-authors-2026c)]。两个头部类型自
Go 1.20 起被标记为弃用，文档建议改用这些函数 [[hopehook, 2022](#ref-hopehook-2022)；
[Go Authors, n.d.b](#ref-go-authors-ndb)]。这些函数用于零拷贝转换的方式与前提见
[5.2.4](../../part2lang/ch05data/string.md)。

## 15.4.5 其他语言的做法

带垃圾回收的语言在提供裸地址时都要处理同一个矛盾：回收器希望自由地回收与移动对象，裸地址却要求对象留在
原处。C# 的 `fixed` 语句在一个代码块期间固定一个可移动的变量，块内声明的指针只能在块内使用
[[Microsoft, n.d.](#ref-microsoft-nd)]。Go 对纯 Go 代码没有这样的语法，而是把「固定」的时间限制在一次地址
算术之内，由编译器与运行时隐式保证；需要让 C 代码长期持有 Go 指针时，Go 1.21 起提供 `runtime.Pinner`
显式地固定对象（[15.6](./cgo.md)）。

Java 的演进方向与 `unsafe.Slice` 的引入相似。长期以来，Java 的底层库依赖非公开的 `sun.misc.Unsafe`
读写堆内外的内存，分配与释放完全由程序员控制。JEP 454 认为这种模型给了开发者过多的控制：
多个内存区域之间可以互相引用，释放顺序一旦出错，悬空指针就会造成释放后使用。Java 22
中定稿的外部函数与内存 API 以 `MemorySegment` 表示一段内存，每个内存段都有空间与时间两方面的界，
保证不访问未分配的内存、不在释放之后访问 [[OpenJDK, 2024](#ref-openjdk-2024)]。

Rust 没有垃圾回收，不存在对象在地址算术期间被移动或回收的问题，但它同样把绕过检查的代码圈在显式的
`unsafe` 块中，并在语言参考中逐项列出只能在其中进行的操作，例如解引用裸指针
[[Rust Project, n.d.](#ref-rust-project-nd)]。Go 的 `unsafe` 是一个包而不是一种语法，绕过类型系统的代码
必须导入它，导入列表因此成为审查的入口；`reflect.Value.Pointer` 返回 `uintptr` 而非 `unsafe.Pointer`，也是
为了让不导入 `unsafe` 的代码无法把结果转换为任意类型。

## 15.4.6 小结

`unsafe.Pointer` 的规则看似繁琐，实际都围绕一个事实：编译器生成的指针位图不认识 `uintptr`。六种合法模式
要么不把整数转换回指针，要么把整数存活的时间压缩到编译器能够照顾的范围之内。编译器以 `Convert` 操作、
`//go:uintptrkeepalive` 与 `//go:nosplit` 维持这些范围，运行时以保守扫描兜住异步抢占。checkptr 则把规则
变成可以执行的检查，使违反规则的代码在测试中立即失败，而不是在生产环境中偶然崩溃。

## 延伸阅读

- <a id="ref-amscanne-2017"></a>[amscanne, 2017] amscanne. golang/go#22218.
  *proposal: add GOEXPERIMENT=checkptr.* 2017. https://go.dev/issue/22218
  提出在 `unsafe.Pointer` 转换处插入运行时检查，由 [Dempsky, 2019a] 实现并关闭。
- <a id="ref-dempsky-2019a"></a>[Dempsky, 2019a] Matthew Dempsky. cmd/compile: add -d=checkptr to validate
  unsafe.Pointer rules. Go commit 80a6fedea0, 2019. https://go.dev/cl/162237
  随 Go 1.14 发布。
- <a id="ref-dempsky-2019b"></a>[Dempsky, 2019b] Matthew Dempsky. cmd/compile: enable -d=checkptr when
  -race or -msan is specified. Go commit dded58760d, 2019. https://go.dev/cl/201783
  随 Go 1.14 发布。
- <a id="ref-dempsky-2021"></a>[Dempsky, 2021] Matthew Dempsky. spec: add unsafe.Add and unsafe.Slice. Go
  commit 1da05eb0ce, 2021. https://go.dev/cl/312212
  随 Go 1.17 发布。
- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *Package unsafe*（`Pointer`
  的合法转换模式、`Add`/`Slice`/`String`/`SliceData`/`StringData`）. https://pkg.go.dev/unsafe
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *reflect.SliceHeader / StringHeader*
  的 Deprecated 说明. https://pkg.go.dev/reflect#SliceHeader
- <a id="ref-go-authors-2020"></a>[Go Authors, 2020] The Go Authors. *Go 1.14 Release Notes*: Compiler.
  2020. https://go.dev/doc/go1.14
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.17 Release Notes*: Changes to
  the language（`unsafe.Add`、`unsafe.Slice`）. 2021. https://go.dev/doc/go1.17
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. *Go 1.20 Release Notes*: Changes to
  the language（`unsafe.String`、`unsafe.SliceData`、`unsafe.StringData`）. 2023.
  https://go.dev/doc/go1.20
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors.
  runtime/checkptr.go（`checkptrAlignment`、`checkptrStraddles`、`checkptrArithmetic`、`checkptrBase`）.
  Go 1.26 源码. https://github.com/golang/go/blob/master/src/runtime/checkptr.go
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. cmd/compile/internal/walk:
  convert.go 与 builtin.go（checkptr 转换处的插桩、`unsafeslicecheckptr`/`unsafestringcheckptr`）；另见
  cmd/compile/internal/base/flag.go. Go 1.26 源码.
  https://github.com/golang/go/tree/master/src/cmd/compile/internal/walk
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. src/math/unsafe.go、
  src/cmd/compile/internal/ssa/_gen/genericOps.go、src/runtime/mgcmark.go、src/runtime/stack.go、
  src/syscall/syscall_linux.go、src/internal/abi/escape.go、src/runtime/unsafe.go、src/runtime/pinner.go.
  Go 1.26 源码. https://github.com/golang/go/tree/release-branch.go1.26/src
- <a id="ref-hopehook-2022"></a>[hopehook, 2022] hopehook. reflect: deprecate SliceHeader and
  StringHeader. Go commit d734203e39, 2022. https://go.dev/cl/428757
  随 Go 1.20 发布。
- <a id="ref-microsoft-nd"></a>[Microsoft, n.d.] Microsoft. *fixed statement - pin a variable for pointer
  operations.* C# language reference.
  https://learn.microsoft.com/dotnet/csharp/language-reference/statements/fixed
- <a id="ref-openjdk-2024"></a>[OpenJDK, 2024] OpenJDK. *JEP 454: Foreign Function & Memory API*（Java 22
  定稿， `MemorySegment` 作为 `sun.misc.Unsafe` 的受控替代）. 2024. https://openjdk.org/jeps/454
- <a id="ref-rust-project-nd"></a>[Rust Project, n.d.] The Rust Project. *The Rust Reference*: Unsafety.
  https://doc.rust-lang.org/reference/unsafety.html
- 本书 [5.1 数组与切片](../../part2lang/ch05data/slice.md)、
  [5.2 字符串与零拷贝转换](../../part2lang/ch05data/string.md)、
  [9.7 协作与抢占](../../part3concurrency/ch09sched/preemption.md)、
  [12.2 组件](../../part4memory/ch12alloc/component.md)、
  [14.4 栈的拷贝与指针调整](../../part4memory/ch14stack/copy.md)、[15.3 优化器](./optimize.md)、
  [15.6 cgo](./cgo.md)、[16.2 竞争检查](../ch16tools/race.md)。
