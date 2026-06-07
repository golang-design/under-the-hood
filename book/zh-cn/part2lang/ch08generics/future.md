---
weight: 2504
title: "8.4 泛型的未来"
---

# 8.4 泛型的未来

Go 1.18 落地的是一版**刻意最小**的泛型（[8.1](./history.md)）。它有意省略了不少别家有的能力，
也留下了已知的性能与表达力问题。这一节看泛型已被补全了什么、还缺什么，以及它可能的走向。

## 8.4.1 已经发生的补全

泛型并非一次定稿，而在持续打磨：

- **标准库泛型工具（Go 1.21）**：`slices`、`maps`、`cmp` 包,把过去要为每种类型重写的
  `Contains`、`Sort`、`Keys`、`Min`/`Max` 等做成了泛型，是泛型最普惠的落地。
- **泛型类型别名（Go 1.24）**：`type Set[T comparable] = map[T]bool` 合法了
  （[4.3](../ch04type/alias.md)），让别名也能参与泛型。
- **性能优化**：GC 形状 stenciling 加字典（[8.1](./history.md)）带来的间接开销，在后续版本里被
  逐步改善（更好的去虚化、内联、字典布局）。

## 8.4.2 仍然缺席的能力

与 C++、Rust、Haskell 相比，Go 泛型有意不做的事仍有一长串：

- **参数化方法**：方法不能有自己的类型参数（只有类型和函数能）,这是一个明确的、由实现复杂度
  （尤其与接口、虚分发的交互）决定的限制。
- **更强的类型构造**：没有高阶类型（对类型构造子的抽象，如 Haskell 的 `Functor`）、没有泛型
  特化（specialization）、没有变长类型参数。
- **真正的和类型 / 枚举**：约束里的 `A | B` 是类型集，不是值层面的和类型(sum type);Go 至今
  没有带穷尽检查的代数数据类型，这是社区长期讨论的话题。

这些缺席多半是**有意**的:团队的策略是"先发布最小可用的泛型，观察实践真正需要什么，再逐步
增补"，避免一上来就背负一堆可能用不上的复杂特性。

## 8.4.3 核心张力：性能与抽象

泛型最受关注的开放问题是**性能**。GC 形状分组让不同具体类型共享代码，省了体积与编译时间，
但经字典的间接访问，使泛型代码有时比手写的具体类型版本慢,尤其在热路径上。这与 C++/Rust
的完全单态化"零成本抽象"形成对比。未来的优化方向包括：对常见情形做更激进的单态化与去虚化、
改进字典访问、更好地内联泛型函数。如何在不牺牲编译速度与代码体积的前提下逼近"零成本"，
是 Go 泛型长期的功课,这本身就是 [8.1](./history.md) 那个"泛型两难"的余响：三者难以兼得，
优化就是在三者之间不断微调。

## 8.4.4 一个审慎演进的样本

泛型的故事尚未结束，但它的演进节奏已经清晰：**小步、务实、由实践驱动。** 不追求一次性补齐
所有学术上漂亮的特性，而是先给最有用的（容器、算法的类型安全复用），再根据真实需求谨慎增补。
这种克制有代价,缺少参数化方法、和类型等能力，确实让某些抽象写起来不如别的语言优雅;但它也
保护了 Go 最看重的东西：简单、可读、编译快。泛型是否会、以及如何继续生长，仍是观察 Go 语言
价值观的一扇活生生的窗口,而它至今的每一步，都踩在"复杂度必须挣得其位置"这条 Go 的铁律上。

## 延伸阅读的文献

1. The Go Authors. *slices / maps / cmp 包*（Go 1.21 泛型标准库）.
   https://pkg.go.dev/slices ，https://pkg.go.dev/maps ，https://pkg.go.dev/cmp
2. Go 1.18 / 1.21 / 1.24 Release Notes（泛型及其后续）.
   https://go.dev/doc/go1.18 ，https://go.dev/doc/go1.21 ，https://go.dev/doc/go1.24
3. PlanetScale / Vicent Marti. *Generics can make your Go code slower*（字典开销实测讨论）, 2022.
   https://planetscale.com/blog/generics-can-make-your-go-code-slower
4. golang/go#49085 等关于参数化方法的讨论.
   https://github.com/golang/go/issues/49085

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
