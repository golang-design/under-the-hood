---
weight: 2103
title: "4.3 类型别名"
---

# 4.3 类型别名

`type A = B`（类型别名）与 `type A B`（定义新类型）只差一个等号，语义却根本不同。这一小节讲清
二者的区别、别名为何被引入，以及它在 Go 1.24 迎来的新能力。

## 4.3.1 别名 vs 定义类型

`type Celsius float64` **定义了一个新类型**：`Celsius` 与 `float64` 是两个不同的名义类型
（[4.1](./type.md)），有各自的标识、可以挂自己的方法、不能与 `float64` 直接混用。而
`type byte = uint8` **只是一个别名**：`byte` 和 `uint8` 是**同一个类型**的两个名字，完全可以互换,
标准库里 `byte`、`rune`（`= int32`）正是这样定义的。一句话：定义类型造出**新东西**，别名只给
旧东西**取个新名**。

## 4.3.2 别名为何被引入：大规模重构

别名是 Go 1.9（2017）才加入的，动机很具体，也很能说明 Go 的工程取向：**渐进式代码重构**。
想象一个大代码库要把某个类型从 `oldpkg.T` 搬到 `newpkg.T`,在没有别名的年代，这是一次"全有
或全无"的破坏性改动，所有引用必须同一次提交全部改完，对超大代码库（如 Google 内部）几乎不可
操作。有了别名，就能在 `oldpkg` 里写 `type T = newpkg.T`,新旧名字指向同一类型，老代码继续用
`oldpkg.T`、新代码用 `newpkg.T`，二者完全兼容，调用方得以**分批、逐步**迁移，最后再删掉别名。
别名解决的，本质上是一个**软件工程**问题（如何在不破坏兼容的前提下移动类型），而非一个类型论
问题,这与本书反复强调的"软件工程发生在代码被非原作者维护之时"一脉相承。

## 4.3.3 Go 1.24：泛型类型别名

很长一段时间里，别名有一个缺口：不能带类型参数。Go 1.24（2025）补上了它,**泛型类型别名**
现在合法：

```go
type Set[T comparable] = map[T]bool   // 带类型参数的别名
```

这让别名能在泛型代码（[8 泛型](../ch08generics)）里同样发挥"取个简短新名"与"渐进重构"的作用，
把别名机制与泛型这两条 Go 后期演进的主线接到了一起。

## 4.3.4 取舍

别名是一件刻意保持"小"的特性。它不引入新类型、不改变类型标识，只在**命名**层面做文章,正因为
如此，它安全、可预测，适合做重构的脚手架，却不该被滥用成"给类型起一堆花名"。Go 团队当初也
反复权衡过它与定义类型的边界，最终把它定位为重构工具而非日常建模手段。理解"别名只是别名、
定义类型才是新类型"这条线，就能避开许多关于类型相等、方法集、可赋值性的困惑,这些困惑的根，
都在 [4.1](./type.md) 的名义类型标识规则上。

## 延伸阅读的文献

1. Russ Cox 等. *Proposal: Type Aliases*（Go 1.9 的别名提案与动机）.
   https://go.googlesource.com/proposal/+/master/design/18130-type-alias.md
2. Go 1.9 Release Notes（类型别名）. https://go.dev/doc/go1.9 ；
   Go 1.24 Release Notes（泛型类型别名）. https://go.dev/doc/go1.24
3. The Go Programming Language Specification：*Type definitions / Alias declarations.*
   https://go.dev/ref/spec#Type_declarations

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
