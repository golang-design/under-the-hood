---
weight: 5104
title: "15.4 指针检查器"
---

# 15.4 指针检查器

Go 是一门内存安全的语言。在常规代码里，类型系统保证每个指针都指向它声明类型的合法对象，
垃圾回收（[13](../../part4memory/ch13gc)）保证对象在仍被引用时不会被回收，运行时保证越界访问
被挡在边界检查里。这套保证不是免费的，它建立在「编译器始终知道每个值的类型与布局」之上。
可总有少数场景需要跳出这套体系：与 C 互操作（[15.6](./cgo.md)）要按 C 的内存布局解释一段字节，
对接操作系统的系统结构体要逐字节摆放，零拷贝地把 `[]byte` 重解释成 `string`
（[5.1](../../part2lang/ch05data/slice.md)）要让两个类型共享同一段底层内存。Go 为这些场景留了
一个逃生舱口：`unsafe` 包。

逃生舱口的代价是，一旦用它绕过类型系统，编译器与运行时原先提供的保证就部分失效，误用不再被
语言挡住，而要靠程序员自己遵守一组并不直观的规则。这一节先讲清 `unsafe.Pointer` 的能力边界与
规范列出的合法模式，再讲清其中最隐蔽的一类陷阱（`uintptr` 与垃圾回收的关系），最后讲编译器与
运行时如何用「指针检查器」（checkptr）把这类潜伏的误用变成当场报错。

## 15.4.1 unsafe.Pointer：绕过类型系统的四条特权

普通指针 `*T` 之间不能随意转换，类型系统不允许把 `*int` 当作 `*float64` 来读写。`unsafe.Pointer`
是一种特殊指针，它在类型系统里开了一道口子，规范赋予它四条普通类型没有的特权：

- 任意类型的指针 `*T` 都可以转换为 `unsafe.Pointer`；
- `unsafe.Pointer` 可以转换回任意类型的指针 `*T`；
- `uintptr` 可以转换为 `unsafe.Pointer`；
- `unsafe.Pointer` 可以转换为 `uintptr`。

前两条合起来，意味着借道 `unsafe.Pointer` 可以把任意 `*T1` 转成任意 `*T2`，从而以另一种类型解释
同一段内存，这正是类型系统本想禁止的事。后两条让指针与整数互转，从而能对地址做算术。规范因此
明确写道：`Pointer` 允许程序破坏类型系统、对任意内存读写，使用应格外小心。

```go
// unsafe 包对 Pointer 的定义（ArbitraryType 仅用于文档，表示任意类型）
type ArbitraryType int
type Pointer *ArbitraryType
```

口子开得这么大，规范并不是说怎么用都行。它列出了若干「合法的转换模式」，承诺只有落在这些模式
里的用法才有定义，偏离则是未定义行为。`go vet` 会检查代码是否落在这些模式内，没过 `go vet` 的
`unsafe` 代码不受任何保证。下面逐一过这些模式，它们覆盖了 `unsafe` 几乎全部的正当用途。

**模式一：把 `*T1` 转成 `*T2`，要求 `T2` 不大于 `T1` 且两者内存布局相容。** 这是最常见、也最安全的
一类，用于把一段内存重新解释成另一种类型。标准库 `math.Float64bits` 就是范例，它不做任何浮点
运算，只是把 `float64` 的 8 个字节原样读成 `uint64`：

```go
func Float64bits(f float64) uint64 {
	return *(*uint64)(unsafe.Pointer(&f))
}
```

**模式二：把结构体字段或数组元素的地址，通过 `Pointer` 加 `uintptr` 偏移算出来。** 如果 `p` 指向
一个已分配的对象，可以先转成 `uintptr`、加上偏移、再转回 `Pointer`：

```go
// 取结构体字段 s.f 的地址，等价于 &s.f
f := unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Offsetof(s.f))
// 取数组元素 x[i] 的地址，等价于 &x[i]
e := unsafe.Pointer(uintptr(unsafe.Pointer(&x[0])) + i*unsafe.Sizeof(x[0]))
```

偏移可以是加也可以是减，用 `&^` 把地址向下取整做对齐也合法。但有一条铁律：算出的指针必须仍指向
原来那个已分配对象的内部。与 C 不同，把指针移到对象边界之外（哪怕只越过末尾一个字节）就是无效的，
因为越界后的地址不再对应任何活对象，垃圾回收无从判断它该不该被保留：

```go
// 无效：end 落在已分配内存区之外
var s thing
end := unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Sizeof(s))
```

这里要点出 `unsafe` 包提供的三个编译期常量函数，它们是合法做偏移的基础。`Sizeof(x)` 给出类型占用
的字节数（对切片返回的是切片头的大小，不含底层数组），`Offsetof(s.f)` 给出字段在结构体内的偏移，
`Alignof(x)` 给出类型要求的对齐。三者在类型大小确定时都是 Go 常量，由编译器算出，不产生运行时开销。

**模式三：调用 `syscall.Syscall` 时把 `Pointer` 转成 `uintptr` 作参数。** 系统调用按 `uintptr` 传参，
但有些参数会被内核重新解释为指针。这里编译器有一条特殊约定：只要 `uintptr(unsafe.Pointer(p))` 的
转换直接出现在调用的参数列表里，编译器就保证 `p` 指向的对象在调用返回前不被移动或回收：

```go
syscall.Syscall(SYS_READ, uintptr(fd), uintptr(unsafe.Pointer(p)), uintptr(n))
```

**模式四：与反射头部的 `Data` 字段互转。** `reflect.SliceHeader` 与 `reflect.StringHeader` 把 `Data`
声明为 `uintptr` 而非 `unsafe.Pointer`，是为了让不导入 `unsafe` 的代码无法借它改写任意内存。代价是
这两个结构只有在覆盖一个真实切片或字符串时才有意义，绝不能单独声明一个 `SliceHeader` 变量再去
填 `Data`，那样 `Data` 只是个普通整数，不会让垃圾回收认为底层数据仍被引用。这条模式脆弱到 Go
官方已把这两个类型标记为 `Deprecated`，下文 15.4.4 会给出取代它们的安全写法。

## 15.4.2 最凶险的陷阱：uintptr 只是一个整数

把上面四条模式串起来看，危险几乎都集中在 `unsafe.Pointer` 与 `uintptr` 的互转上。理解这一点，
要先认清一件容易被忽略的事实：**在 Go 的运行时眼里，`uintptr` 只是一个整数，垃圾回收完全不把它
当指针看待。**

这意味着两件事。其一，如果一个对象只被某个 `uintptr` 持有的地址「指向」，垃圾回收不会因此认为它
存活，该对象随时可能被回收。其二，如果垃圾回收移动了对象（栈拷贝就是典型，goroutine 栈增长时
整段栈连同其上的对象会被搬到新位置，地址随之改变，见 [14.4](../../part4memory/ch14stack)），它会
更新所有真正的指针，却不会更新任何 `uintptr`，因为它根本不知道哪些整数其实是地址。于是一个曾经
正确的 `uintptr` 会在某次垃圾回收后悄悄指向一片无效内存或别的对象。

把这个事实代入模式二，规范那条「两次转换必须在同一个表达式里完成」的规则就有了由来。看似等价的
两种写法，命运截然不同：

```go
// 合法：Pointer→uintptr→Pointer 一气呵成，中间没有可被 GC 打断的时刻
p = unsafe.Pointer(uintptr(p) + offset)

// 无效：uintptr 被存进变量 u，跨越了语句边界
u := uintptr(p)
// 此处若发生 GC，p 指向的对象可能被回收或移动，u 随即失效
p = unsafe.Pointer(u + offset)
```

差别不在语法，而在「`uintptr` 是否跨越了语句边界」。在第一种写法里，从 `unsafe.Pointer` 到 `uintptr`
再回到 `unsafe.Pointer` 发生在同一条表达式求值的过程中，编译器保证这中间不会插入垃圾回收的安全点，
对象在整个算术过程里始终被原 `Pointer` 引用着、不会被动。第二种写法把中间的 `uintptr` 存进了变量 `u`，
两次转换被语句边界隔开，`u` 存活期间发生的任何一次垃圾回收都可能让它失效。同理，模式二里指向 `nil`
或越界地址的 `uintptr` 算术也无效，因为它们压根不对应一个活对象。

这类 bug 之所以凶险，在于它平时不发作。只有当垃圾回收恰好在那个危险窗口里触发、又恰好回收或移动了
那个对象，程序才会读到垃圾值或崩溃。它依赖时序，难以复现，可能潜伏很久才在生产环境某次高负载下
现身。规则本身（「`Pointer` 到 `uintptr` 必须在同一表达式内用于算术，绝不跨语句保存」）并不复杂，
难的是写代码时未必意识到自己违反了它。这正是下一节那个工具要解决的问题。

## 15.4.3 checkptr：把潜伏的误用变成当场报错

依赖人去严守上述规则并不可靠，于是 Go 给编译器和运行时加了一道「指针检查器」（checkptr）。它的
思路是在 `unsafe` 转换处插入运行时检查，把原本「平时不出事、偶尔神秘崩溃」的潜伏 bug，变成发生在
案发现场的明确报错。

checkptr 默认关闭，由编译器的调试开关 `-d=checkptr` 控制。更常见的是间接打开它：编译 `cmd/compile`
里有一条约定，`-race`、`-msan`、`-asan` 任一开启都会顺带把 `-d=checkptr` 置为 1（[16.2](../ch16tools/race.md)）。
所以平时跑 `go test -race`，指针检查器就已经在工作了。机制上，编译器在 walk 阶段（[15.3](./ssa.md) 之前
把语法树降级为更接近运行时调用的形式）扫描那些会破坏类型安全的转换，在其后插入对运行时检查函数的
调用。运行时 `runtime/checkptr.go` 提供这些检查，核心是三类：

- **对齐检查**（`checkptrAlignment`）：当把 `unsafe.Pointer` 转成 `*T` 时，验证地址满足 `T` 的对齐要求。
  在多数硬件上，从未对齐的地址读取含指针的类型会出错，因此运行时只对「指向的类型本身含指针」的情形
  强制对齐，对纯标量类型放宽（见 issue 37298）。检查失败抛出 `checkptr: misaligned pointer conversion`。
- **跨分配检查**（`checkptrStraddles`，由对齐检查顺带触发）：验证 `(*[n]T)(p)` 覆盖的这段内存不会横跨
  多个独立的分配。两个相邻对象在地址上挨着，不代表可以当作一个数组一并访问。失败抛出
  `checkptr: converted pointer straddles multiple allocations`。
- **算术检查**（`checkptrArithmetic`）：对模式二那样的指针算术，验证算出的指针若落进某个堆对象，则它
  必须落进参与运算的某个「原始指针」所在的同一个对象里。这正是「不得越界到原分配之外」那条规则的
  运行时落实。失败抛出 `checkptr: pointer arithmetic result points to invalid allocation`，
  或在结果是个非法低地址时抛出 `checkptr: pointer arithmetic computed bad pointer value`。

判断一个地址属于哪个分配，靠的是运行时的 `checkptrBase`，它依次在当前 goroutine 栈、堆（`findObject`，
复用 GC 的对象查找，见 [12.2](../../part4memory/ch12alloc/component.md)）、以及全局 data/bss 段里定位
地址的基址。两个地址基址相同，才算同属一个分配。

`unsafe.Slice` 与 `unsafe.String` 这两个把指针和长度拼成切片、字符串的辅助函数，也各有专门的检查
入口（运行时的 `unsafeslicecheckptr`、`unsafestringcheckptr`），在构造出新的切片或字符串视图前先核对
指针与长度，确保得到的视图不会越过原始分配的边界。

checkptr 也留了豁免的出口。极少数确实需要绕过检查的函数，可以用编译指示 `//go:nocheckptr` 标注，
让编译器对该函数不插入检查。运行时与某些底层库正是靠它处理那些「确知安全、但形式上会触发误报」的
转换。这道工具体现了 Go 一贯的态度：即便给了你绕过安全的口子，也要尽力帮你别把脚打穿。

## 15.4.4 unsafe 的定位与更安全的辅助函数

`unsafe` 这个名字本身就是警告。Go 的设计立场是默认安全，内存安全与类型安全是常态，`unsafe` 是
为少数确实必要的场景保留的例外通道，而非日常工具。它的正当用途集中在几处：与 C 互操作时按 C 的
布局解释内存（[15.6](./cgo.md)），对接系统调用与系统结构体，以及零拷贝地在 `[]byte` 与 `string`
之间转换（[5.1](../../part2lang/ch05data/slice.md)）以避开一次内存拷贝。这些场景的共同点是，要么
跨越了 Go 类型系统管不到的边界（C、内核），要么是在性能热点上为省一次拷贝而精确控制内存布局。

即便在这些场景里，`unsafe` 的用法也该尽量收窄：用得少、严格落在规范的合法模式内、并在测试中开启
race 与 checkptr。Go 还在持续把这个逃生舱口本身变得不那么容易出事。早年要构造一个指定底层数组的
切片，常见写法是借 `reflect.SliceHeader`，手动填它的 `Data`、`Len`、`Cap` 字段，这正是 15.4.1 模式四
里那种脆弱写法：`Data` 是 `uintptr`，稍不留神就让底层数据失去被引用的凭据而被回收。Go 1.17 引入
`unsafe.Add` 与 `unsafe.Slice`，Go 1.20 又补上 `unsafe.String`、`unsafe.SliceData`、`unsafe.StringData`，
把这些操作收进类型安全、且被 checkptr 覆盖的内建函数里：

```go
// Go 1.17+：在 Pointer 上做带类型的偏移，取代手写 uintptr 算术
func Add(ptr Pointer, len IntegerType) Pointer

// Go 1.17+：由指针与长度构造切片，取代填写 reflect.SliceHeader
func Slice(ptr *ArbitraryType, len IntegerType) []ArbitraryType
// Go 1.20+：反向取出切片底层数组的首地址
func SliceData(slice []ArbitraryType) *ArbitraryType

// Go 1.20+：由 *byte 与长度构造字符串，及反向取出字符串底层字节
func String(ptr *byte, len IntegerType) string
func StringData(str string) *byte
```

这组函数把过去散落在用户代码里、靠手写 `uintptr` 算术和反射头部完成的危险操作，收敛成几个语义
明确的原语。`unsafe.Slice(ptr, n)` 等价于 `(*[n]T)(unsafe.Pointer(ptr))[:]`，但会在运行时检查 `n`
非负、`ptr` 与 `n` 不越界；`unsafe.String(b, n)` 与 `unsafe.StringData(s)` 让 `[]byte` 与 `string` 的
零拷贝互转有了规范的写法，而不必再去碰 `StringHeader`。配套地，`reflect.SliceHeader` 与
`reflect.StringHeader` 已被官方标记 `Deprecated`，文档直接指向这些新函数。

这就是 Go 对待「不安全」的完整态度。它承认 `unsafe` 有时必要，并不假装能取消它；但它用类型系统把
危险收进 `unsafe.Pointer` 这一个口子，用规范钉死合法模式，用 checkptr 在测试中把误用变成当场报错，
再用 1.17/1.20 的新原语把最常见的危险写法替换成安全写法。安全从不是一道是非题，逃生舱口必须存在，
能做的是层层设防，把它被用错的概率和被用错时的代价都压到最低。

## 15.4.5 别家的逃生舱口

把 Go 的设计放进谱系里看，会更清楚它的取舍落在哪。带垃圾回收的语言几乎都得面对同一个矛盾：
既要让 GC 自由地移动对象以整理内存，又要偶尔允许程序拿到裸地址做底层操作，而移动与裸地址天然
冲突。各家的解法不同，恰好照出 Go 这条「`uintptr` 不得跨语句」规则的位置。

C# 给出的是显式的钉扎（pinning）。它的 `fixed` 语句会在一个代码块的期间把一个托管对象「钉」住，
告诉 GC 在这段时间内不要移动它，于是块内对该对象做指针算术是安全的。Go 没有 `fixed` 这样的构造，
它用另一种方式达到同样的「对象在算术期间不会被搬走」的保证：禁止承载地址的 `uintptr` 活过那条
表达式。换句话说，C# 靠程序员显式声明一段钉扎窗口，Go 靠把窗口压缩到单条表达式、由编译器隐式
保证其间对象始终被原指针引用。两者目标一致，一个把责任交给语法，一个把责任交给规则。

Java 的演进路线则与 Go 的辅助函数演进高度同构。早年 Java 底层代码依赖未公开的 `sun.misc.Unsafe`，
它的字段偏移同样只是一个 `long` 整数，带着和 `uintptr` 一模一样的「GC 移动后偏移失效」的隐患。
近年 Java 用 Foreign Function & Memory API（Project Panama，于 Java 22 定稿）取而代之，以
`MemorySegment` 这种带边界检查、带生命周期作用域的抽象，把裸内存访问收进受控的接口。这正是
Go 用 `unsafe.Slice`/`unsafe.String` 取代手填 `reflect.SliceHeader` 的同一种思路：把脆弱的裸操作
升级成有检查、有边界的原语。

Rust 的 `unsafe` 块提供的是另一个维度的参照。它和 Go 共享「逃生舱口必须是被命名、被划定、可审计
的一小块」这一立场，`unsafe` 关键字把绕过检查的代码圈在显眼的边界内，便于审查。但要说清楚的是，
Rust 没有垃圾回收，因而没有「算术期间对象被移动」这一类危险，它的 `unsafe` 防的是别的东西
（解引用裸指针、数据竞争等）。可借鉴的是「把不安全显式圈起来」的姿态，而非具体的危险模型。

放在一起看，Go 的选择是一种克制的折中：不引入 `fixed` 那样的显式钉扎构造，把绕过安全的能力收进
`unsafe.Pointer` 一个口子，用一条「不得跨语句保存 `uintptr`」的规则替代显式窗口，再用 checkptr
和新原语补上工具与人体工程。它换来的是语言表面的简单，付出的是这条规则不够直观、需要工具兜底。

## 延伸阅读的文献

1. The Go Authors. *Package unsafe（`Pointer` 的合法转换模式、`Add`/`Slice`/`String`/`SliceData`/`StringData`）.*
   https://pkg.go.dev/unsafe
2. The Go Authors. *runtime/checkptr.go（`checkptrAlignment`、`checkptrStraddles`、`checkptrArithmetic`、`checkptrBase`）.*
   https://github.com/golang/go/blob/master/src/runtime/checkptr.go
3. The Go Authors. *cmd/compile/internal/walk: convert.go 与 builtin.go（checkptr 转换处的插桩、`unsafeslicecheckptr`/`unsafestringcheckptr`）.*
   https://github.com/golang/go/tree/master/src/cmd/compile/internal/walk
4. The Go Authors. *Go 1.17 Release Notes（`unsafe.Add`、`unsafe.Slice`）.* https://go.dev/doc/go1.17
5. The Go Authors. *Go 1.20 Release Notes（`unsafe.String`、`unsafe.SliceData`、`unsafe.StringData`）.* https://go.dev/doc/go1.20
6. The Go Authors. *reflect.SliceHeader / StringHeader 的 Deprecated 说明.* https://pkg.go.dev/reflect#SliceHeader
7. JEP 454: *Foreign Function & Memory API（Java 22 定稿，`MemorySegment` 作为 `sun.misc.Unsafe` 的受控替代）.*
   https://openjdk.org/jeps/454 ；C# `fixed` 语句与对象钉扎，https://learn.microsoft.com/dotnet/csharp/language-reference/statements/fixed
8. 本书 [5.1 数组、切片与字符串](../../part2lang/ch05data/slice.md)、[12.2 组件](../../part4memory/ch12alloc/component.md)、[14.4 栈管理](../../part4memory/ch14stack)、[15.6 cgo](./cgo.md)、[16.2 竞态检测](../ch16tools/race.md).
