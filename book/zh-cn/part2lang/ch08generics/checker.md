---
weight: 2503
title: "8.3 类型检查技术"
---

# 8.3 类型检查技术

泛型给类型检查器出了远比从前难的题：不再是"这个值是不是这个类型"，而要处理类型参数、约束
满足、类型推断。这一节看 Go 的类型检查器为支撑泛型做了什么,这部分是 [15 编译器](../../part5toolchain/ch15compile)
的前奏。

## 8.3.1 类型集与约束满足

泛型约束的核心概念是**类型集**（type set）：一个约束接口不再只描述"有哪些方法"，而是描述
"**哪些类型属于我**"。`~int` 表示"底层类型为 int 的所有类型"（`~` 即 underlying），`int | string`
表示并集，`comparable` 表示所有可用 `==` 比较的类型。一个类型实参满足约束，当且仅当它落在
该约束的类型集里。检查器要做的，就是计算这些集合并判断归属。

为支持运算符泛型，检查器还引入了**核心类型**（core type）的概念：若一个约束的类型集里所有类型
共享同一个底层类型，这个底层类型就是核心类型,有了它，`a + b`、`a < b` 这类运算在泛型函数里
才有明确定义（编译器知道该用哪种底层操作）。这是"用接口表达运算符约束"能成立的技术基础。

## 8.3.2 类型推断：少写类型实参

若每次调用泛型函数都要显式写出全部类型实参（`Max[int](3, 5)`），会很啰嗦。Go 的类型检查器
实现了**类型推断**，让多数调用能写成 `Max(3, 5)`,编译器从实参类型反推出 `T = int`。推断分几路：
**函数实参推断**（从传入的值类型推）、**约束类型推断**（从约束本身的结构推出未显式给出的类型
参数）。推断算法要在"够强（少写注解）"与"可预测（别推出意外结果、错误信息要好懂）"之间平衡,
Go 有意把它做得相对保守，宁可偶尔要求显式标注，也不愿推断行为变得难以捉摸。这与 Haskell/Rust
那种更激进的全局推断是不同的取舍。

## 8.3.3 types2：一套新的类型检查器

支撑这一切的，是编译器内部一个名为 **`types2`** 的包。它是 `go/types`（标准库的类型检查器）
的姊妹实现，专为编译器前端、且原生支持泛型而写。历史上，Go 编译器前端几经更替（从早期的
语法树到基于 `go/types` 的统一前端），泛型落地时，团队选择在 `types2` 里实现这套复杂的泛型
类型规则。普通用户不会直接接触 `types2`，但 `gopls`（[16 工具与可观测性](../../part5toolchain/ch16tools)）
等工具依赖与之对应的 `go/types` 来理解泛型代码。把类型检查独立成可复用的库，让编辑器、linter、
代码生成器都能共享同一套类型理解,这是 Go 工具生态强大的一块基石。

## 8.3.4 取舍

泛型的类型检查是 Go 类型系统复杂度的一次显著跃升,类型集运算、约束满足、类型推断，每一项都
远比泛型之前繁复。Go 团队接受了这部分**编译器内部**的复杂度，但极力把它**挡在用户之外**：
对用户，约束就是接口、调用大多不必写类型实参、错误信息力求可读。这是 [8.1](./history.md)
"破解泛型两难"的另一面,运行时用 GC 形状加字典控制开销，编译期则用类型集加保守推断控制
认知负担。复杂度没有消失，只是被搬到了最不打扰用户的地方,好的语言设计，往往就是这种"复杂度
的搬运"。

## 延伸阅读的文献

1. Ian Lance Taylor, Robert Griesemer. *Type Parameters Proposal*（类型集、核心类型、推断）.
   https://go.googlesource.com/proposal/+/refs/heads/master/design/43651-type-parameters.md
2. The Go Authors. *go/types 与类型推断文档.* https://pkg.go.dev/go/types ；
   *Type inference in Go.* https://go.dev/blog/type-inference
3. The Go Programming Language Specification：*Type constraints / Type sets / Type inference.*
   https://go.dev/ref/spec#Type_parameter_declarations
4. The Go Authors. *cmd/compile/internal/types2*（编译器前端的泛型类型检查器）.
   https://github.com/golang/go/tree/master/src/cmd/compile/internal/types2

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
