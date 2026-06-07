---
weight: 2502
title: "8.2 基于合约的泛型"
---

# 8.2 基于合约的泛型

[8.1](./history.md) 提到，Go 泛型在落地前曾走过一版"合约"（contracts）设计，后来才转向"接口即
约束"。这段被放弃的设计值得专门一看,它解释了今天 `[T any]` 语法的由来，也展示了一个好设计
是如何在简化中诞生的。

## 8.2.1 合约想解决的问题

泛型的核心难题之一是**约束**：`func Max[T](a, b T) T` 里的 `T` 不能是任意类型,要支持 `>` 才能
比较。必须有一种方式声明"`T` 得能做哪些操作"。2018 年的合约提案给出的答案，是用一段**形似
函数体的代码**来描述这些要求：

```go
// 2018 年合约提案的设想写法（已废弃，仅作历史展示）
contract Ordered(t T) {
    t < t
}
func Max(type T Ordered)(a, b T) T { ... }
```

合约体里写上"`t < t`"，意思是"凡满足本合约的类型都得支持 `<`"。它很有表达力,能描述运算符、
方法、甚至类型之间的关系。

## 8.2.2 为何被放弃

问题恰恰出在"表达力"上。社区与团队反馈：合约**像是嵌进 Go 里的第二种语言**,你要学一套
专门的、只在合约体里有效的语法去描述约束，而它又和真正的 Go 代码似是而非。它太灵活、规则
太多，违背了 Go"少即是多"的口味。

转折点是一个简化的洞察：**约束所要表达的"一个类型必须支持哪些操作"，和接口要表达的东西高度
重合。** 接口本来就描述"一个类型得有哪些方法"。如果把接口从"方法集"推广为"**类型集**"
（[8.1](./history.md)），它就能同时描述方法**与**运算符要求,于是不必再发明合约这门小语言，
复用接口即可。`Ordered` 不再是一段合约代码，而是一个普通（约束）接口：

```go
type Ordered interface {
    ~int | ~int64 | ~float64 | ~string | /* ... */
}
func Max[T Ordered](a, b T) T { ... }
```

## 8.2.3 这次取舍说明了什么

从合约到类型集，是 Go 设计过程的一个缩影：**先有一个表达力强但复杂的方案，再反复追问"能不能
用已有的概念来表达"，最终把新机制压到最小。** 合约被否，不是因为它做不到，而是因为它要求
用户学习一套新东西;而类型集复用了人人已懂的接口，认知负担小得多。这正呼应 [8.1](./history.md)
那条主线,Go 对引入新概念极度审慎，宁可在已有抽象上做推广，也不轻易增添"第二种语言"。
读懂了这段被放弃的历史，就更能体会今天 `[T Constraint]` 语法那份"恰到好处的朴素"是如何
得来的。

## 延伸阅读的文献

1. Ian Lance Taylor, Robert Griesemer. *Contracts — Draft Design*（2018，已被取代）.
   https://go.googlesource.com/proposal/+/master/design/go2draft-contracts.md
2. Ian Lance Taylor, Robert Griesemer. *Type Parameters Proposal*（最终方案，接口即约束）.
   https://go.googlesource.com/proposal/+/refs/heads/master/design/43651-type-parameters.md
3. The Go Authors. *Why Generics?* Go 博客, 2019. https://go.dev/blog/why-generics
4. The Go Authors. *The Next Step for Generics.* 2020. https://go.dev/blog/generics-next-step

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
