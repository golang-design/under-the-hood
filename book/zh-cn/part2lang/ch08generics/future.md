---
weight: 2504
title: "8.4 泛型的未来"
---

# 8.4 泛型的未来

> 本节内容对标 Go 1.26。泛型自 1.18 落地至今已逾四年，本节不再停留在「将会怎样」的猜想，
> 而是回过头清点：哪些设想兑现了、哪些被有意搁置、以及那个贯穿始终的张力（抽象的代价）今天
> 走到了哪一步。本节作者早年曾就 Go 2 泛型做过一次公开演讲（[YouTube](https://www.youtube.com/watch?v=E16Y6bI2S08)、
> [讲稿](https://changkun.de/s/go2generics/)），如今多数预言已可对照现实检验，下文一并交代。

[8.1](./history.md) 讲过泛型从合约到「接口即约束」的十三年演进，[8.3](./checker.md) 讲过类型检查器
如何消化类型参数与约束。落地之后的故事则是另一条线：一项语言特性发布只是起点，它在标准库里
长出哪些惯用法、社区在使用中撞见哪些边界、团队又据此添了什么、按下了什么，这些才决定它最终
的形状。Go 团队对泛型一向自陈谨慎：先发布最小可用的一版，看真实需求浮现，再小步添加。本节
就沿着「已落地、仍缺席、核心张力、演进哲学」四条来盘点这份谨慎换来了什么。

## 8.4.1 自 1.18 以来落地了什么

泛型在 1.18 只交付了语言层的类型参数与约束。真正让它进入日常代码的，是随后几个版本围绕它
长出的标准库与惯用法。

**`slices`、`maps`、`cmp`：泛型标准库（1.21）。** 在泛型之前，「对任意切片排序、查找、去重」
要么靠 `sort.Slice` 加闭包、要么靠 `interface{}` 加反射，两条路都既不安全也不快。1.21 把这些
操作收进三个泛型包。`cmp` 给出有序类型的约束与比较原语：

```go
// cmp 包：把「可比较大小」抽象成一个约束（速写自 src/cmp）
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 | ~string
}

func Less[T Ordered](x, y T) bool { return (isNaN(x) && !isNaN(y)) || x < y }
```

注意约束里每一项都带波浪号 `~`，意为「底层类型为此」而非「恰为此」，于是用户自定义的
`type Celsius float64` 也落在 `Ordered` 之内。`slices` 与 `maps` 则建在这套约束之上，给出
类型安全、无反射的常用操作：

```go
import ("slices"; "cmp")

s := []int{3, 1, 2}
slices.Sort(s)                       // [1 2 3]，无需 sort.Slice 的闭包
i, ok := slices.BinarySearch(s, 2)   // i=1, ok=true
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age) // cmp.Compare 返回 -1/0/+1
})
```

这是泛型兑现的第一个、也是最直接的承诺：把过去要么牺牲类型安全（反射）、要么牺牲复用（手抄
一遍）的代码，收成一份既安全又高效的通用实现。

**`iter.Seq` 与 range-over-func 迭代器（1.23）。** 真正让泛型从「写库的人才碰」变成「人人受益」
的，是 1.23 引入的迭代器协议。它先在 `iter` 包里把「迭代器」定义成一个普通的泛型函数类型：

```go
// src/iter：迭代器就是一个把元素逐个交给 yield 的函数
type Seq[V any]     func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

`yield` 返回 `false` 表示调用方想提前停止，迭代器据此中断。配套的语言改动是 `for range` 现在
可以直接对这样一个函数取值，编译器把循环体改写成传给迭代器的 `yield` 闭包。于是 `maps.Keys`
这类返回 `iter.Seq` 的函数可以像内建容器一样被遍历：

```go
func Keys[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[K] {
    return func(yield func(K) bool) {
        for k := range m {
            if !yield(k) { // 调用方 break，yield 返回 false，提前收手
                return
            }
        }
    }
}

for name := range maps.Keys(m) { // 用户侧：和遍历内建容器无异
    fmt.Println(name)
}
```

这一步的设计意味深长：它没有为「自定义迭代器」发明新语法，而是用泛型函数类型加一处 `range`
扩展，让任意数据结构都能给出统一的遍历接口。泛型在这里不是主角，却是地基,没有 `iter.Seq[V]`
这个可参数化的函数类型，就谈不上「对任意元素类型统一迭代」。

**泛型类型别名（1.24）。** [4.3](../ch04type/alias.md) 介绍过类型别名 `type A = B`。1.18 的别名
不能带类型参数，于是无法给一个泛型类型起短名。1.24 补上了这一块：

```go
type Set[T comparable] = map[T]struct{} // 1.24 起：别名也能参数化
```

这看似小，却是把泛型织进既有类型系统的必要一针：别名要能转发类型参数，泛型化的重构（给
一个老类型套上类型参数、同时用别名保留旧名）才不至于半途卡住。

**字典间接访问的性能打磨（持续进行）。** [8.1](./history.md) 详述过实现策略,GC 形状 stenciling
加运行时字典。落地后的版本里，编译器与运行时一直在削减这条间接路径的开销（更激进的去虚拟化、
对部分调用的字典内联）。这条线没有「完成」之日，它正是下一节那个核心张力的工程战场。

## 8.4.2 仍然缺席的，以及为什么

清点落地之外，同样要清点有意的留白。下面几项是泛型编程里常见、Go 却至今不提供的能力，缺席
多半不是没想到，而是权衡之后按下了。

**参数化方法（方法不能有自己的类型参数）。** 你可以写泛型函数 `func Map[T, U any](...)`，却
不能写带独立类型参数的方法 `func (s Set[T]) Map[U any](...) Set[U]`。这条限制最常被绊到，原因
在于方法与接口的相互作用。Go 的接口满足是结构化的：一个类型只要具备接口要求的方法集即可。
若允许方法携带自己的类型参数，接口里就得能描述「一个对任意 `U` 都成立的方法」,这等价于在
方法集层面引入了对类型的全称量化，类型检查与运行时的方法表（itab）都要随之复杂化，且与
现有的接口模型不再自洽。Go 团队的取舍是：宁可让用户把这类操作写成顶层泛型函数，也不为方法
打开这道口子（详见 issue [#49085](https://github.com/golang/go/issues/49085) 长达数年的讨论）。

**高阶类型（higher-kinded types）。** Go 的类型参数只能代入具体类型，不能代入「类型构造子」,
你不能写一个对「任意容器 `F[_]`」都成立的 `Functor` 抽象。Haskell 那套 `Functor`/`Monad` 在 Go
里无从表达。这是刻意的简化：高阶类型会把类型系统的复杂度抬上一个量级，与 Go「读懂比写巧更
重要」的取向相左。

**泛型特化（specialization）。** C++ 允许为某个具体类型参数提供一份专门实现（模板特化），
Go 不允许,一个泛型函数对所有满足约束的类型只有一份定义。这避免了「同一个调用因类型不同而
跳到完全不同实现」带来的认知负担，代价是无法为热点类型手写优化版本。

**真正的和类型/枚举（sum types / enums）。** 约束里的 `A | B` 看似一个和类型，其实是**类型集**
（type set）：它约束「类型参数可以是哪些类型」，是一个编译期的类型层概念，而非值层面「此值
要么是 A 要么是 B」的标记联合，更没有编译器强制的穷尽性检查（exhaustiveness）。想用它表达
「一个结果要么是成功要么是错误，且 `switch` 必须覆盖全部分支」做不到。和类型是社区至今活跃
的议题，多份提案在讨论，但尚无定论。这里要分清：`A | B` 是约束语法的复用，不是值层面的和类型。

把这些放在一起看，缺席的并非边角料，而是泛型编程里相当核心的能力。Go 的选择一以贯之：每一项
省略都换来语言模型更小、类型系统更可推理。是否值得，取决于读者更看重表达力还是简洁,这本身
就是一笔没有标准答案的账。

## 8.4.3 核心张力：性能与抽象

泛型最深的那道张力，不在语法而在实现：**抽象的统一，与运行时的零开销，二者难以兼得。** 这道
题有三种经典答案，[8.1](./history.md) 已铺开，此处只锚定坐标，好把落地后的教训摆进去：

| 策略 | 代表 | 代码量 | 运行时开销 |
|------|------|--------|-----------|
| 完全单态化 | C++ 模板、Rust | 每个具体类型一份，膨胀、编译慢 | 零（可内联、可去虚拟化） |
| 完全装箱/类型擦除 | Java | 一份 | 统一的间接与装箱开销 |
| GC 形状 stenciling + 字典 | Go | 每种**指针形状**一份 | 经字典的间接访问 |

Go 走的是第三条折中路：按内存布局（GC 形状）分组生成代码，布局相同的一组类型共用一份机器
码，类型相关的信息（描述符、方法、所用到的其他泛型实例）则在调用时经一个**运行时字典**传入。
它与 [4.2](../ch04type/interface.md) 提到的 Haskell 类型类「字典传递」一脉相承,以一层间接，换
代码量与性能之间的平衡。

代价恰恰藏在这层间接里。PlanetScale 的 Vicent Marti 在 2022 年那篇广为流传的《Generics can make
your Go code slower》中，把机制讲得很具体：当泛型代码调用类型参数上的方法时，调用要先经字典
查到具体类型的方法表（itab），再经 itab 间接跳转。这层间接**击穿了内联与去虚拟化**,编译器既
看不穿调用目标，也无从把它内联展开。结果是反直觉的：在某些场景下，泛型版本不仅没比手写的
具体版本快，甚至比老老实实用 `interface` 的版本还慢，因为它既背上了字典的间接，又没拿到单态化
本该带来的内联收益。其机制细节见 Go 提案库的设计文档《Generics implementation: GC Shape
Stenciling》。

这并非泛型「失败」，而是它的工程本相：

- 泛型最稳的收益场景是把**数据结构**（容器、算法）通用化,这类代码本就少有性能敏感的小方法调用，
  字典间接被均摊掉，`slices`/`maps` 正属此列。
- 在性能敏感的热路径上，对类型参数频繁调用小方法时，应当实测，单态化的手写版本可能仍然更快。
- 编译器对这条间接路径的优化（去虚拟化、字典内联）是 [8.1](./history.md) 那条演进线上仍在推进
  的工作，今天的结论未必是明天的结论。

性能的提升从不白来。Go 用一层字典间接，买下了「一份代码服务多种类型」的统一与可控的代码膨胀；
谁要更极致的速度，就得退回单态化、自己承担代码量与编译时间。说到底，泛型给的不是「免费的抽象」，
而是一个**新的、需要按场景权衡的选项**。

## 8.4.4 小步、由实践驱动的演进

回看 1.18 至今这条轨迹，会发现它印证了 Go 团队反复申明的方法：先发布最小可用的一版，在真实
使用中观察需求，再审慎添加。1.18 只给类型参数与约束；`slices`/`maps`/`cmp` 等到 1.21 才补；
迭代器等到 1.23；泛型别名等到 1.24。每一步都不是一次性把蓝图浇筑成形，而是等惯用法在社区里
沉淀、需求被反复印证之后，才落一子。

这套谨慎并非 Go 独有。早年的 Bjarne Stroustrup 在回顾 C++ 模板时坦言（[Stroustrup 1994]，
第 15 章）：

> 「我确实认为，在开始描述模板机制时，自己是过于谨慎和保守了。我们原来就应该把许多特性加
> 进来……这些特性并没有给实现者增加多少负担，但是却对用户特别有帮助。」

> 「以模板为界，此前我一直靠『实现、使用、讨论、再实现』来打磨一项语言特征；模板之后，实现
> 常与讨论并行，讨论得不够广，我也缺乏批判性的实现经验，于是后来又据使用经验对模板做了多
> 方面修订。」

两段话指向同一条经验：泛型这种深嵌进类型系统的特性，光靠纸面讨论推不到位，得靠大量真实实现
与使用来校准。C++ 模板定稿时，STL 这样的大型泛型库其实已经在用了。Go 把这条经验吸收成了
明确的节奏,先发布、再观察、后扩充。它的代价是「想要的能力得等」（参数化方法、和类型至今未到），
换来的是每一步扩充都踩在已被验证的需求上，而非押注于设想。

也正因如此，8.4.2 那张缺席清单不该被读成「尚未完成的待办」。其中一些也许永远不会加入,Go 对
语言复杂度的克制，本身就是设计的一部分。泛型的未来，大概率不是某个特性大爆发的版本，而是这种
小步慢走的延续：在抽象与简洁、表达力与可读性、性能与通用之间，一次次地、审慎地重新落点。

## 延伸阅读的文献

- [slices] The Go Authors. _Package slices_. https://pkg.go.dev/slices
- [maps] The Go Authors. _Package maps_. https://pkg.go.dev/maps
- [cmp] The Go Authors. _Package cmp_. https://pkg.go.dev/cmp
- [iter] The Go Authors. _Package iter_. https://pkg.go.dev/iter
- [Go1.21] The Go Authors. _Go 1.21 Release Notes_ (新增 `slices`/`maps`/`cmp`). https://go.dev/doc/go1.21
- [Go1.23] The Go Authors. _Go 1.23 Release Notes_ (range-over-func 与 `iter`). https://go.dev/doc/go1.23
- [Go1.24] The Go Authors. _Go 1.24 Release Notes_ (泛型类型别名). https://go.dev/doc/go1.24
- [RangeFunc] The Go Blog. _Range Over Function Types_. https://go.dev/blog/range-functions ; 提案 [#61405](https://github.com/golang/go/issues/61405)
- [GCShape] Keith Randall. _Generics implementation: GC Shape Stenciling_ (Go 设计文档). https://github.com/golang/proposal/blob/master/design/generics-implementation-gcshape.md
- [Marti2022] Vicent Marti. _Generics can make your Go code slower_. PlanetScale, 2022. https://planetscale.com/blog/generics-can-make-your-go-code-slower
- [Issue49085] The Go Authors. _proposal: spec: allow type parameters in methods (parameterized methods)_. https://github.com/golang/go/issues/49085
- [Stroustrup 1994] Bjarne Stroustrup. _The Design and Evolution of C++_. Addison-Wesley, 1994. Chapter 15: Templates.
