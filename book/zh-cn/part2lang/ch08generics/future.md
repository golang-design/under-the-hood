---
weight: 2504
title: "8.4 泛型的未来"
---

# 8.4 泛型的未来

泛型随 Go 1.18 于 2022 年 3 月发布，至 2026 年 8 月的 Go 1.27 已历经十个版本。一项语言特性的发布只是起点：
它在标准库中形成哪些惯用法，使用者在实践中遇到哪些边界，团队据此补充了什么、搁置了什么，
这些共同决定了它最终的形状。本节据此回顾泛型落地之后的演进：哪些能力已经补齐，Go 1.27
的泛型方法如何改变了团队多年的立场，哪些能力仍被有意省略，实现层面的性能张力走到了哪一步，
以及这一过程所体现的演进方式。笔者曾于 2020 年 3 月在 Go 夜读第 80 期介绍当时的泛型设计
[[Ou, 2020](#ref-ou-2020)]，那时的约束仍以合约表达（[8.2](./contracts.md)），与今天的设计对照，
可以看出其间变化之大。

## 8.4.1 已经补齐的能力

Go 1.18 只交付了语言层面的类型参数与约束。发布说明坦言，这些新特性依赖大量尚未经过生产环境检验的新代码，
团队虽然相信其实现质量，却「无法以真实世界的经验来支持这一信念」，因此建议使用者在生产环境中部署泛型代码时
保持适当的谨慎 [[Go Authors, 2022](#ref-go-authors-2022)]。此后各版本的补充大体沿两条线展开：
语言与类型检查方面的放宽，以及围绕泛型建立的标准库。

| 版本 | 语言与类型检查 | 标准库 |
|------|----------------|--------|
| Go 1.18（2022） | 类型参数、约束、类型推断 |  |
| Go 1.20（2023） | 泛型函数与方法内可以声明类型；普通接口类型可以满足 `comparable` |  |
| Go 1.21（2023） | 类型推断的多项增强（[8.3.3](./checker.md)） | `slices`、`maps`、`cmp`；`sync.OnceValue` |
| Go 1.23（2024） | 对函数类型的 `range` | `iter`；`maps.Keys`、`slices.All` 等迭代器；`unique` |
| Go 1.24（2025） | 泛型类型别名 | `weak` |
| Go 1.25（2025） | 规范删除核心类型的概念（[8.3.2](./checker.md)） |  |
| Go 1.26（2026） | 约束可以引用正在声明的泛型类型 | `errors.AsType`（[7.2](../ch07errors/inspect.md)） |
| Go 1.27（2026） | 泛型方法；函数类型推断适用于所有赋值上下文 | `(*rand.Rand).N` |

**`slices`、`maps` 与 `cmp`（Go 1.21）。** 在泛型之前，对任意切片排序、查找或去重，要么借助 `sort.Slice`
与闭包，要么借助 `interface{}` 与反射，前者需要为每次调用书写比较逻辑，后者既失去了编译期的类型检查，
也付出了运行时的代价。Go 1.21 把这些操作收入三个泛型包 [[Go Authors, 2023b](#ref-go-authors-2023b)]。`cmp`
定义了有序类型的约束与比较原语 [[Go Authors, 2026c](#ref-go-authors-2026c)]：

```go
// Go 1.26 src/cmp/cmp.go（有删节，注释为笔者所译）
type Ordered interface {
	~int | ~int8 | ~int16 | ~int32 | ~int64 |
		~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
		~float32 | ~float64 |
		~string
}

// Less 报告 x 是否小于 y。NaN 被视为小于任何非 NaN 的值。
func Less[T Ordered](x, y T) bool {
	return (isNaN(x) && !isNaN(y)) || x < y
}

// isNaN 对任何 Ordered 类型都成立：只有 NaN 不等于其自身。
func isNaN[T Ordered](x T) bool {
	return x != x
}
```

约束中的每一项都带有 `~`，因此 `type Celsius float64` 这样的自定义类型同样满足 `Ordered`。`isNaN`
的写法也值得注意：泛型函数无法针对浮点类型单独调用 `math.IsNaN`，于是利用「只有 NaN 不等于其自身」
这一性质，写出一个对整数与字符串同样成立（恒为假）的判断。`slices`
[[Go Authors, 2026a](#ref-go-authors-2026a)]与 `maps` [[Go Authors, 2026b](#ref-go-authors-2026b)]
建立在这些约束之上：

```go {run=true}
package main

import (
	"cmp"
	"fmt"
	"maps"
	"slices"
)

type Person struct {
	Name string
	Age  int
}

func main() {
	s := []int{3, 1, 2}
	slices.Sort(s) // 无需 sort.Slice 的比较闭包
	i, ok := slices.BinarySearch(s, 2)
	fmt.Println(s, i, ok)

	people := []Person{{"Alice", 30}, {"Bob", 25}}
	slices.SortFunc(people, func(a, b Person) int {
		return cmp.Compare(a.Age, b.Age) // 返回 -1、0 或 +1
	})
	fmt.Println(people)

	ages := map[string]int{"Carol": 35, "Alice": 30, "Bob": 25}
	for _, name := range slices.Sorted(maps.Keys(ages)) { // Go 1.23 起
		fmt.Println(name, ages[name])
	}
}
```

```
[1 2 3] 1 true
[{Bob 25} {Alice 30}]
Alice 30
Bob 25
Carol 35
```

**迭代器与对函数类型的 `range`（Go 1.23）。** 上例最后一段用到的 `maps.Keys`，本身就是泛型演进方式的一个缩
影。Go 1.21 发布前夕，`maps.Keys` 与 `maps.Values` 已经实现，却在发布分支上被移除，提交说明写道：
「保留这两个名字，以便将来让它们返回迭代器」[[Taylor, 2023c](#ref-taylor-2023c)]。两年之后，Go 1.23
引入了迭代器协议 [[Go Authors, 2024](#ref-go-authors-2024)]。`iter` 包把迭代器定义为一个普通的泛型函数类型
[[Go Authors, 2026d](#ref-go-authors-2026d)]：

```go
// Go 1.26 src/iter/iter.go
type Seq[V any] func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

迭代器把元素逐个交给 `yield`；`yield` 返回 `false`，表示调用方不再需要更多的值，迭代器应当停止。
与之配套的语言改动是 `for range` 可以直接作用于这样的函数：编译器把循环体改写为一个函数，作为 `yield`
传给迭代器，循环中的 `break` 等提前退出使 `yield` 返回 `false` [[Taylor, 2024](#ref-taylor-2024)]。于是
`maps.Keys` 以返回 `iter.Seq` 的形式重新加入标准库：

```go
// Go 1.26 src/maps/iter.go（注释为笔者所加）
func Keys[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[K] {
	return func(yield func(K) bool) {
		for k := range m {
			if !yield(k) { // 调用方提前退出循环
				return
			}
		}
	}
}
```

这一设计没有为自定义迭代器引入新的语法，而是以一个泛型函数类型加上 `range` 的一处扩展，
使任意数据结构都能提供统一的遍历接口。泛型在这里并不显眼，却是基础：没有可参数化的函数类型 `iter.Seq[V]`，
便无法对任意元素类型给出统一的迭代器类型。

**泛型类型别名（Go 1.24）。** [4.3](../ch04type/alias.md) 介绍的类型别名在 Go 1.18 中不能带有类型参数，
因此无法为泛型类型提供一个仍然泛型的别名。Go 1.24 完整支持了泛型类型别名
[[Go Authors, 2025](#ref-go-authors-2025)]：

```go
type Set[T comparable] = map[T]struct{} // Go 1.24 起，别名可以带有类型参数
```

别名的设计初衷是支持大规模重构中类型的迁移；有了泛型别名，泛型类型在包之间迁移时，旧的名字同样可以保留。

**约束引用自身（Go 1.26）。** Go 1.26 取消了泛型类型不能在其类型参数列表中引用自身的限制
[[Go Authors, 2026e](#ref-go-authors-2026e)]：

```go
type Adder[A Adder[A]] interface { // Go 1.26 起合法
	Add(A) A
}

func algo[A Adder[A]](x, y A) A {
	return x.Add(y)
}
```

这种类型参数受到一个以其自身为实参的约束所限定的写法，在类型理论中称为 **F-有界多态**（F-bounded
polymorphism），由 Canning 等人于 1989 年为面向对象语言提出
[[Canning et al., 1989](#ref-canning-et-al-1989)]，Java 的 `<T extends Comparable<T>>` 即是一例。Go 自
1.18 起就允许在函数的类型参数列表中写出这样的约束，例如 `func Max[T Lesser[T]](a, b T) T`，其中
`type Lesser[T any] interface{ Less(T) bool }`；被禁止的只是泛型类型在自己的类型参数列表中引用自身，Go
1.20 编译上面的 `Adder` 时报告 `invalid recursive type: Adder refers to itself`。这一限制的起因是开发期间
的类型推断在递归约束的类型参数列表中陷入死锁（#49439）；对泛型类型实参的推断后来被移除，Go 1.18
正式版也未提供这项推断，这一限制随之失去了存在的理由 [[Griesemer, 2025](#ref-griesemer-2025)]。

## 8.4.2 泛型方法：立场的转变

在所有缺失的能力中，使用者呼声最高的是**泛型方法**，即方法声明自己的类型参数。2021 年的类型参数提案专门讨
论了它的困难 [[Taylor and Griesemer, 2021](#ref-taylor-griesemer-2021)]。设想类型 `S` 有一个泛型方法
`Identity[T any](v T) T`，另一个包中的接口 `HasIdentity` 要求这样一个方法，第三个包对任意实现了
`HasIdentity` 的值调用 `Identity[int]`。由于 Go 的接口满足是结构化的，编译 `S` 所在的包时无从得知
`Identity` 将以哪些类型实参被调用。提案列举了三种出路：在链接期分析整个程序的调用图，
但反射使这种分析不可能完备；在运行时实例化，这需要即时编译或基于反射的实现，既复杂又出人意料地慢；
或者规定泛型方法不参与接口的满足，但提案认为，这样一来就不清楚为什么还需要方法，因为任何泛型方法都可以写成
泛型函数。Go 的 FAQ 进一步列出四种选择，认为禁止泛型方法满足接口「从设计角度无法接受」，并曾写道「我们预计
Go 永远不会加入泛型方法」[[Go Authors, 2026g](#ref-go-authors-2026g)]。允许方法带有类型参数的提案
（#49085）于 2021 年提出，获得了九百余个赞同，却长期没有进展 [[Macias, 2021](#ref-macias-2021)]。

2026 年 1 月，Griesemer 提出了题为「Generic Methods for Go」的新提案，其背景一节的标题就是「A change of
view」[[Griesemer, 2026a](#ref-griesemer-2026a)]。提案指出，过去拒绝泛型方法，
是因为把方法的首要角色视为实现接口；但方法并不只是实现接口的手段：方法是与某个类型相关联、
通过该类型的命名空间访问的函数，即使从不用于实现接口，也有组织代码的价值；`x.a().b().c()`
可以自左向右阅读，而 `c(b(a(x)))` 需要由内向外求值。既然具体方法就是带有接收者的函数，
泛型具体方法也就可以是带有接收者的泛型函数；接口方法在语法上不能带有类型参数，
泛型方法自然不会与任何接口方法相匹配，这是一个正交的问题。2021 年提案中被认为不够清楚的第三条出路，
就这样被重新评价为正确的选择。该提案于 2026 年 2 月 25 日被接受，随 Go 1.27 发布
[[Go Authors, 2026f](#ref-go-authors-2026f)]：

```go
package main

import (
	"fmt"
	"strconv"
)

type List[E any] []E

// Apply 对 l 的每个元素应用 f，返回由结果构成的新列表
func (l List[E]) Apply[F any](f func(E) F) List[F] {
	r := make(List[F], len(l))
	for i, x := range l {
		r[i] = f(x)
	}
	return r
}

func main() {
	l := List[int]{1, 2, 3}
	s := l.Apply(strconv.Itoa)                         // F 由实参推断为 string
	n := s.Apply(func(x string) int { return len(x) }) // 方法调用可以自左向右连缀
	fmt.Println(s, n)
	fmt.Println(l.Apply[float64](func(x int) float64 { return float64(x) / 2 })) // 显式给出类型实参
}
```

```
[1 2 3] [1 1 1]
[0.5 1 1.5]
```

这段代码需要 Go 1.27；在 `go.mod` 声明 `go 1.26` 时，编译器报告
`generic method requires go1.27 or later`。泛型方法不参与接口的满足：

```go
type Stringer interface{ String() string }

type H struct{}

func (H) String[P any]() string { return "" }

var _ Stringer = H{} // 错误
```

```
cannot use H{} (value of struct type H) as Stringer value in variable declaration: H does not implement Stringer (wrong type for method String)
		have String[P any]() string
		want String() string
```

提案同时规定，泛型方法不能通过反射按名字或下标访问，原因与未实例化的泛型函数相同：`reflect`
包没有实例化泛型的机制。Go 1.27 的标准库中，唯一的泛型方法是 `math/rand/v2` 的 `(*Rand).N`，
与早已存在的顶层泛型函数 `rand.N` 行为一致。

泛型方法的实现仍受到形状模板化（[8.1.3](./history.md)）的约束。下面的方法在每次实例化 `T[X]`
时都会产生类型 `T[T[X]]`，而一个泛型类型被实例化时，它的全部方法都必须生成，因为该类型可能在另一个包中被用
于满足某个接口；如此递归下去，实例化永远不会终止，编译器的单态化检查因此拒绝这段代码：

```go
type T[P any] struct{}

func (T[P]) m() T[T[P]] { panic("unimplemented") } // instantiation cycle: P instantiated as T[P]
```

写成顶层泛型函数 `func m[P any](T[P]) T[T[P]]` 则可以通过编译，因为函数只在被调用时才实例化。Griesemer
指出，泛型方法既然不能用于满足接口，编译器便可以按泛型函数的方式处理它们，从而解除这一限制；
截至本文写作时，这项工作仍在调查之中 [[Griesemer, 2026b](#ref-griesemer-2026b)]。

## 8.4.3 仍然缺席的能力

Go 1.18 的发布说明列出了泛型实现的六项已知限制 [[Go Authors, 2022](#ref-go-authors-2022)]。以 Go 1.27
检验，其中只有一项被解除：

| Go 1.18 列出的限制 | Go 1.27 中的状况 |
|--------------------|------------------|
| 泛型函数与方法内部不能声明类型 | Go 1.20 解除 [[Go Authors, 2023a](#ref-go-authors-2023a)] |
| `real`、`imag`、`complex` 不接受类型参数类型的实参 | 仍然存在 |
| 只能调用约束中显式声明的方法，即使类型集中的每个类型都有该方法 | 仍然存在 |
| 不能访问类型集中所有结构体共有的字段 | 仍然存在（[8.3.5](./checker.md)） |
| 不能在结构体或接口中嵌入类型参数 | 仍然存在 |
| 多项的联合中不能包含带有方法的接口 | 仍然存在 |

后五项在 Go 1.27 中仍然报告编译错误，例如 `embedded field type cannot be a (pointer to a) type parameter`
与 `cannot use fmt.Stringer in union (fmt.Stringer contains methods)`。除这些实现上的限制外，
类型参数提案还在「省略」一节中明确列出了不打算提供的能力
[[Taylor and Griesemer, 2021](#ref-taylor-griesemer-2021)]，其中几项是其他语言中泛型编程的核心手段。

**特化**（specialization）。C++ 允许为特定的模板实参提供专门的实现，Go 不允许：一个泛型函数对所有满足约束
的类型只有一份定义。同一个调用不会因类型实参的不同而转到完全不同的实现，代价是无法为热点类型手写优化的版
本。

**元编程**（metaprogramming）。Go 没有在编译期执行、用于生成运行时代码的机制。C++ 模板是图灵完备的，
模板元编程因此成为一种独立的编程范式；Go 的泛型则只做类型替换。

**高阶抽象**。泛型函数除了被调用或实例化之外不能以其他方式使用，泛型类型除了实例化之外也不能以其他方式使
用。因此无法把未实例化的 `List` 作为类型实参传递，Haskell 中 `Functor`、`Monad` 这类对**类型构造器**的抽
象，即所谓高阶类型（higher-kinded types），在 Go 中无从表达。

此外，提案还省略了协变与逆变、运算符方法（泛型容器不能以 `c[k]` 的语法访问）、可变数目的类型参数、在约束中
定义适配器，以及以常量作为参数（如 `Matrix[n int] [n][n]float64`）。

**和类型**。约束中的 `A | B` 形似和类型，实际上是类型集（[8.3.1](./checker.md)）：
它限定类型参数可以是哪些类型，是编译期类型层面的概念，而不是值层面「此值要么是 `A` 要么是 `B`」
的标记联合，也没有编译器强制的穷尽性检查。早在 2017 年就有提案要求加入和类型
[[Obenour, 2017](#ref-obenour-2017)]；2023 年，Taylor 提出以联合约束为基础定义和类型，
即允许把含有联合的接口当作普通类型使用 [[Taylor, 2023a](#ref-taylor-2023a)]。两份提案至今都没有结论。

这些省略并非边角，而是泛型编程中相当核心的能力。Go 的选择一以贯之：每一项省略都使语言模型更小、
类型系统更易于推理。泛型方法的经历也表明，这些选择并非一成不变：当对问题的理解发生变化，
一度被断言「永远不会加入」的特性也可能以受限的形式加入。

## 8.4.4 性能与抽象：间接调用的代价

泛型最深的张力不在语法，而在实现：抽象的统一与运行时的零开销难以兼得。完全单态化、类型擦除与 Go 的 GC
形状模板化加字典这三种策略各自的代码量与运行时开销，[8.1.3](./history.md) 与 [8.1.4](./history.md)
已有详细的讨论，Randall 在设计文档中也预见了对类型参数的方法调用无法在编译期确定这一代价
[[Randall, 2020](#ref-randall-2020)]。这里关注的是落地之后的实践经验：形状模板化的代价究竟落在何处，
编译器又做了哪些改进。

Go 1.18 发布两周后，PlanetScale 的 Vicent Marti 发表了一篇广为流传的分析
[[Marti, 2022](#ref-marti-2022)]。Marti 发现，所有指针类型共用同一个形状，
因此在泛型代码中对类型参数调用方法时，方法的信息只有运行时才能从字典中取得，
原本可以内联的指针方法调用退化为「两次间接的接口调用」，编译器既无法去虚化，也无法内联；
把接口值作为类型实参传入泛型函数，开销更大。文章的建议可以归纳为：
泛型最适合数据结构与以回调类型为参数的函数式辅助函数；不要指望借助泛型实现去虚化或内联；
不要把接口传给泛型函数；也不必把以接口为参数的现有 API 改写为泛型。

此后的版本对字典的间接访问做了若干改进。下例中 `TotalArea` 对类型参数调用 `Area` 方法，并被内联到 `run`
中：

```go
type Shape interface{ Area() float64 }

type Square struct{ side float64 }

func (q *Square) Area() float64 { return q.side * q.side }

func TotalArea[T Shape](xs []T) (t float64) {
	for _, x := range xs {
		t += x.Area()
	}
	return
}

//go:noinline
func run(xs []*Square) float64 { return TotalArea(xs) } // TotalArea 被内联到这里
```

内联之后，`run` 中使用的字典是一个确定的只读符号 `main..dict.TotalArea[*main.Square]`。Go 1.20
仍在运行时从中读出方法的入口地址：

```asm
// Go 1.20，GOARCH=amd64
MOVQ  main..dict.TotalArea[*main.Square](SB), SI  // 运行时从字典读出 Area 的入口地址
LEAQ  main..dict.TotalArea[*main.Square](SB), DX
MOVQ  BX, AX                                      // 接收者
CALL  SI
```

Go 1.21 加入了一组 SSA 改写规则：从常量字典或类型描述符中读取的值在编译期折叠为常量
[[Randall, 2023](#ref-randall-2023)]。同一段代码在 Go 1.26 中编译为：

```asm
// Go 1.26，GOARCH=amd64
LEAQ  main..dict.TotalArea[*main.Square](SB), DX
LEAQ  main.(*Square).Area(SB), CX                 // 入口地址在编译期折叠为常量
CALL  CX
```

访存消失了，调用目标在编译期已经确定，但调用依然存在：内联在 SSA 之前的中间表示上完成，等到 SSA
阶段确定了调用目标，内联的时机已经错过。作为对照，手写的具体版本 `for _, x := range xs { t += x.Area() }`
中，`(*Square).Area` 会被内联为一次乘法。其他改进也大多属于这一类：Go 1.26 消除了对字典参数的空指针检查，Go
1.27 在形状实例中删去不可能匹配的类型断言分支，例如 `S` 的形状为 `string` 时，`switch any(x).(type)`
中的 `case []byte` 永远不会成立 [[Bailey, 2025](#ref-bailey-2025)]。Taylor 于 2023 年提出的「更好地优化泛
型实例中的类型分支」的问题至今仍未关闭 [[Taylor, 2023b](#ref-taylor-2023b)]。

由此可以得到几点工程上的结论：

- 泛型最稳妥的收益在于把**数据结构与算法**通用化。这类代码很少在热路径上频繁调用类型参数的小方法，
  字典的间接访问被摊薄，`slices` 与 `maps` 正属此列；
- 在性能敏感的热路径上，若频繁对类型参数调用小方法，应当实际测量，单态化的手写版本可能仍然更快；
- 编译器对这条间接路径的优化仍在进行，今天的测量结论未必适用于将来的版本。

Go 以一层字典间接访问，换取了一份代码服务多种类型与可控的代码膨胀；需要极致性能的场景，仍须回到单态化，
自行承担代码量与编译时间的代价。泛型提供的不是「零开销的抽象」，而是一个需要按场景权衡的新选项。

## 8.4.5 小步、由实践驱动的演进

回看 Go 1.18 至今的轨迹，可以看到一种一贯的节奏：先发布最小可用的版本，在真实使用中观察需求，
再审慎地补充。Go 1.18 只提供类型参数与约束；`slices`、`maps` 与 `cmp` 到 Go 1.21 才加入；`maps.Keys`
为了等待迭代器协议，推迟到 Go 1.23；泛型别名到 Go 1.24；泛型方法则到 Go 1.27。每一步都在惯用法沉淀、
需求被反复印证之后才落定，而不是一次性把蓝图浇筑成形。

这种谨慎并非 Go 独有。Stroustrup 在回顾 C++ 模板的设计时写道 [[Stroustrup, 1994](#ref-stroustrup-1994)]：

> 我确实认为，在开始描述模板机制时，自己是过于谨慎和保守了。我们原来就应该把许多特性加进来……这些特性并没有
> 给实现者增加多少负担，但是却对用户特别有帮助。

Stroustrup 还谈到，在模板之前，自己一直依靠「实现、使用、讨论、再实现」的循环来打磨语言特性；
模板的实现却常与讨论并行，缺乏充分的实现经验，此后只能根据使用经验对模板做多方面的修订。C++
标准化的历史印证了这一点：模板于 1990 年被 ANSI 委员会接受，那时还没有大型的泛型库；STL 直到 1994 年
10 月才进入标准草案，成员模板（1994 年）、模板偏特化（1996 年）等扩充都是此后才陆续加入的。Stroustrup
认为，C++98 比 ARM 时代的 C++ 灵活得多，主要原因正是成员模板这类改进的累积效果
[[Stroustrup, 2007](#ref-stroustrup-2007)]。

两段历史指向同一条经验：泛型这种深嵌于类型系统的特性，仅靠纸面讨论无法设计到位，需要大量真实的实现与使用来
校准。Go 把这条经验化为明确的节奏：先发布，再观察，后扩充。其代价是使用者想要的能力需要等待，
和类型至今未到，泛型方法等了四年；换来的是每一步扩充都建立在已被验证的需求之上，而不是押注于设想。

因此，8.4.3 中的缺席清单不应被读作尚未完成的待办事项。其中一些也许永远不会加入，Go
对语言复杂度的克制本身就是设计的一部分；另一些则可能像泛型方法那样，在对问题的理解改变之后，
以受限而清晰的形式加入。泛型的未来大概不会是某个特性集中爆发的版本，而是这种小步演进的延续：在抽象与简洁、
表达力与可读性、性能与通用之间，一次次审慎地重新权衡。

## 延伸阅读

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Package slices*.
  https://pkg.go.dev/slices
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Package maps*.
  https://pkg.go.dev/maps
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Package cmp*.
  https://pkg.go.dev/cmp
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Package iter*.
  https://pkg.go.dev/iter
- <a id="ref-go-authors-2023b"></a>[Go Authors, 2023b] The Go Authors. Go 1.21 Release Notes（新增
  `slices`、`maps`、 `cmp`）. https://go.dev/doc/go1.21
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. Go 1.23 Release Notes（对函数类型的
  `range` 与 `iter`）. https://go.dev/doc/go1.23
- <a id="ref-go-authors-2025"></a>[Go Authors, 2025] The Go Authors. Go 1.24 Release
  Notes（泛型类型别名）. https://go.dev/doc/go1.24
- <a id="ref-taylor-2024"></a>[Taylor, 2024] Ian Lance Taylor. "Range Over Function Types." The Go Blog,
  2024-08-20. https://go.dev/blog/range-functions ；提案
  [#61405](https://github.com/golang/go/issues/61405)
- <a id="ref-randall-2020"></a>[Randall, 2020] Keith Randall. "Generics implementation - GC Shape
  Stenciling." Go design document, 2020.
  https://github.com/golang/proposal/blob/master/design/generics-implementation-gcshape.md
- <a id="ref-marti-2022"></a>[Marti, 2022] Vicent Marti. "Generics can make your Go code slower."
  PlanetScale, 2022-03-30. https://planetscale.com/blog/generics-can-make-your-go-code-slower
- <a id="ref-macias-2021"></a>[Macias, 2021] Mario Macias. "proposal: spec: allow type parameters in
  methods." golang/go#49085, 2021-10-20. https://github.com/golang/go/issues/49085
  2026 年 4 月作为 #77273 的重复项关闭。
- <a id="ref-stroustrup-1994"></a>[Stroustrup, 1994] Bjarne Stroustrup. *The Design and Evolution of C++*.
  Addison-Wesley, 1994. Chapter 15: Templates.
- <a id="ref-ou-2020"></a>[Ou, 2020] 欧长坤.「带你提前玩 Go 2 新特性：泛型」. Go 夜读第 80 期，2020-03-18.
  视频：https://www.youtube.com/watch?v=E16Y6bI2S08 ；讲稿：https://changkun.de/s/go2generics/
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. Go 1.18 Release Notes.
  https://go.dev/doc/go1.18
  泛型的发布声明、使用上的谨慎提示与六项已知限制。
- <a id="ref-go-authors-2023a"></a>[Go Authors, 2023a] The Go Authors. Go 1.20 Release Notes.
  https://go.dev/doc/go1.20
  新的编译器前端使泛型函数与方法内部可以声明类型。
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors. Go 1.26 Release Notes.
  https://go.dev/doc/go1.26
  泛型类型可以在其类型参数列表中引用自身。
- <a id="ref-go-authors-2026f"></a>[Go Authors, 2026f] The Go Authors. Go 1.27 Release Notes.
  https://go.dev/doc/go1.27
  泛型方法、结构体字面量中的提升字段键，以及推广到所有赋值上下文的函数类型推断。
- <a id="ref-go-authors-2026g"></a>[Go Authors, 2026g] The Go Authors. Frequently Asked Questions (FAQ),
  "Why does Go not support methods with type parameters?" https://go.dev/doc/faq#generic_methods
- <a id="ref-taylor-griesemer-2021"></a>[Taylor and Griesemer, 2021] Ian Lance Taylor, Robert Griesemer.
  "Type Parameters Proposal." Go design document, 2021.
  https://go.googlesource.com/proposal/+/refs/heads/master/design/43651-type-parameters.md
  「No parameterized methods」与「Omissions」两节。
- <a id="ref-griesemer-2026a"></a>[Griesemer, 2026a] Robert Griesemer. "spec: generic methods for Go."
  golang/go#77273, 2026-01-22（2026-02-25 接受）. https://github.com/golang/go/issues/77273
- <a id="ref-griesemer-2026b"></a>[Griesemer, 2026b] Robert Griesemer. "cmd/compile: investigate
  relaxation of mono-checker restrictions for generic methods." golang/go#81699, 2026-09-23.
  https://github.com/golang/go/issues/81699
- <a id="ref-griesemer-2025"></a>[Griesemer, 2025] Robert Griesemer. "go/types, types2: permit type cycles
  through type parameter lists." Go commit 1abc6b0204, 2025-10-13（Go 1.26）.
  https://github.com/golang/go/commit/1abc6b0204
- <a id="ref-canning-et-al-1989"></a>[Canning et al., 1989] Peter Canning, William Cook, Walter Hill,
  Walter Olthoff, John C. Mitchell. "F-bounded polymorphism for object-oriented programming." *Proceedings
  of the Fourth International Conference on Functional Programming Languages and Computer Architecture
  (FPCA '89)*, 273–280, 1989. https://doi.org/10.1145/99370.99392
- <a id="ref-taylor-2023a"></a>[Taylor, 2023a] Ian Lance Taylor. "proposal: spec: sum types based on
  general interfaces." golang/go#57644, 2023-01-05. https://github.com/golang/go/issues/57644
- <a id="ref-obenour-2017"></a>[Obenour, 2017] Demi Marie Obenour. "proposal: spec: add sum types /
  discriminated unions." golang/go#19412, 2017-03-05. https://github.com/golang/go/issues/19412
- <a id="ref-taylor-2023b"></a>[Taylor, 2023b] Ian Lance Taylor. "cmd/compile: better optimization of type
  switches in instantiated generic functions." golang/go#59591, 2023-04-13.
  https://github.com/golang/go/issues/59591
- <a id="ref-taylor-2023c"></a>[Taylor, 2023c] Ian Lance Taylor. "[release-branch.go1.21] maps: remove
  Keys and Values." Go commit b25266c58d, 2023-07-26. https://github.com/golang/go/commit/b25266c58d
- <a id="ref-randall-2023"></a>[Randall, 2023] Keith Randall. "cmd/compile: constant-fold loads from
  constant dictionaries and types." Go commit bd3f44e4ff, 2023-05-02（Go 1.21）.
  https://github.com/golang/go/commit/bd3f44e4ff
- <a id="ref-bailey-2025"></a>[Bailey, 2025] Jake Bailey. "cmd/compile: eliminate nil checks on .dict
  arg"（Go 1.26）与 "cmd/compile: eliminate impossible type assertions in generic functions"（Go 1.27）.
  Go commits 97da068774 与 343fbe2971, 2025-09. https://github.com/golang/go/commit/97da068774
  ；https://github.com/golang/go/commit/343fbe2971
- <a id="ref-stroustrup-2007"></a>[Stroustrup, 2007] Bjarne Stroustrup. "Evolving a language in and for
  the real world: C++ 1991–2006." *Proceedings of the Third ACM SIGPLAN Conference on History of
  Programming Languages (HOPL III)*, 2007. https://doi.org/10.1145/1238844.1238848
  模板（1990）与 STL（1994）被接受的时间，以及 C++98 中模板的逐步扩充。
