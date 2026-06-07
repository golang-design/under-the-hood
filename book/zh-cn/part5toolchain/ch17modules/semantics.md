---
weight: 5302
title: "17.2 语义化版本管理"
---

# 17.2 语义化版本管理

要管理版本，先得让版本号**有意义**。Go 模块建立在**语义化版本**（Semantic Versioning, semver）
之上，并在此之上提出了一条独特而强硬的规则,**语义化导入版本**。这一节讲清这两者，它们是
[17.3](./minimum.md) 那套版本选择算法能成立的前提。

## 17.2.1 语义化版本

语义化版本规定版本号形如 **`vMAJOR.MINOR.PATCH`**（如 `v1.4.2`），且每一段都**有约定的含义**：

- **PATCH**（补丁）递增：只修 bug，向后兼容。
- **MINOR**（次版本）递增：加了新功能，但**向后兼容**,老代码无需改动仍能用。
- **MAJOR**（主版本）递增：有**破坏性变更**,可能让老代码编译不过或行为改变。

这套约定的价值在于：版本号本身就**承诺了兼容性**。看到从 `v1.4` 升到 `v1.5`，你知道这是兼容的
（放心升）;看到升到 `v2.0`，你知道可能要改代码。Go 模块**强依赖**这个约定,它的整个版本选择
逻辑（[17.3](./minimum.md)）都建立在"同一主版本内向后兼容"这个假设上。

## 17.2.2 语义化导入版本：把主版本写进路径

Go 在 semver 之上加了一条**与众不同**的强硬规则,**语义化导入版本**（Semantic Import
Versioning）：**当一个包升到 v2 或更高主版本时，它的导入路径必须带上主版本号。** 比如
`example.com/mod` 的 v2，导入路径变成 `example.com/mod/v2`。

这条规则源自一个朴素而深刻的原则,**"导入兼容性规则"**（Import Compatibility Rule，Russ Cox）：
**"如果一个旧包和一个新包导入路径相同，那么新包必须向后兼容旧包。"** 反过来，不兼容的新版本
（v2）就**必须**用不同的导入路径。这带来一个强大的后果：`example.com/mod`（v1）与
`example.com/mod/v2` 在编译器看来是**两个不同的包**,于是它们可以**同时**存在于一个程序里！
这恰好化解了 [17.1](./challenges.md) 的钻石依赖里最棘手的一类：当 A 要 C 的 v1、B 要 C 的 v2，
不必二选一,两个主版本可以共存，各用各的。

## 17.2.3 一条规则解开一个死结

语义化导入版本是 Go 依赖管理里最聪明、也最有争议的设计之一。聪明在于：它把"版本"从一个需要
求解器去协调的**外部约束**，变成了**导入路径的一部分**,不兼容的版本天然就是不同的包，冲突在
路径层面就消解了，无需复杂求解。它也强制了一种好习惯：发布破坏性变更时，你必须显式地改路径
（升主版本），让下游清清楚楚地看到"这是不兼容的新版本"。

争议在于它的**严格**：升 v2 要改导入路径、要在仓库里特殊处理（子目录或分支），给库作者添了
麻烦，社区一度颇有怨言。但它换来的，是整个版本选择算法（[17.3](./minimum.md)）能变得异常简单,
因为最难缠的"不兼容版本共存"问题，已经被这条路径规则提前解决了。这是一处典型的"把复杂度
前移到一条强约束上、从而让后续一切变简单"的设计,与 Go 处处可见的"用约束换简单"一脉相承。

## 延伸阅读的文献

1. Tom Preston-Werner. *Semantic Versioning 2.0.0.* https://semver.org/
2. Russ Cox. *Semantic Import Versioning.* https://research.swtch.com/vgo-import ；
   *The Import Compatibility Rule.* https://research.swtch.com/vgo-import
3. The Go Authors. *Go Modules Reference：Module paths and versions.* https://go.dev/ref/mod
4. 本书 [17.1 依赖管理的难点](./challenges.md)、[17.3 最小版本选择算法](./minimum.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
