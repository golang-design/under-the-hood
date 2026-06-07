---
weight: 2401
title: "7.1 问题的演化"
---

# 7.1 问题的演化

Go 的错误处理是它最具辨识度、也最受争议的设计之一。满屏的 `if err != nil` 让一些人皱眉，却
也让错误路径无处遁形。这一节讲清"错误即值"这一核心主张的由来、它如何随版本演化，以及社区
为改进它做过的尝试与争论。理解这段历史，比记住 API 更重要。

## 7.1.1 错误即值

Go 没有异常式的 `try/catch`（[6.3](../ch06func/panic.md) 解释了 panic 为何不算）。它的主张是
**错误是普通的值**：`error` 只是一个内建接口，只要求一个 `Error() string` 方法;函数把错误作为
**最后一个返回值**显式交还，调用方用 `if err != nil` 显式处理。

```go
type error interface { Error() string }

f, err := os.Open(name)
if err != nil {
    return err   // 显式传递，无处可藏
}
```

这套设计的哲学，Rob Pike 用一句话概括："**Errors are values**",既然是值，就能被编程,被比较、
被包装、被存进结构体、被函数处理，而不是一种特殊的、只能 `catch` 的控制流。代价是冗长，
收益是错误路径白纸黑字、显式可见、可被工具检查。这与 [6.3](../ch06func/panic.md) 的"异常 vs 值"
之争一脉相承：Go 坚定地站在"值"这一边。

## 7.1.2 从字符串到可检查的错误

最初，错误几乎只是带文字的值（`errors.New`、`fmt.Errorf`）。但实践很快暴露需求：调用方常常
不只想知道"出错了"，还想知道"是不是某种特定的错误"（如 `io.EOF`、`os.ErrNotExist`），以便
分别处理。早期只能比较字符串或用类型断言，既脆弱又不统一。

转折点是 **Go 1.13（2019）的错误包装**。`fmt.Errorf` 增加了 `%w` 动词，把一个底层错误**包进**
一个新错误，形成一条**错误链**;配套的 `errors.Unwrap`、`errors.Is`、`errors.As` 让调用方能
穿过这条链去检查：

- `errors.Is(err, target)`：沿链查找是否有某个**哨兵错误**（如 `errors.Is(err, io.EOF)`），
  取代脆弱的 `err == io.EOF`。
- `errors.As(err, &target)`：沿链查找是否有某个**类型**的错误，并取出它（如取出
  `*os.PathError` 读它的字段）。

这让"错误即值"真正好用起来：错误可以分层包装（每层加上下文），又能被可靠地检查。
Go 1.20 进一步加了 `errors.Join`,把多个错误合成一个（一个错误可以有多个被包装者），
以及 `fmt.Errorf` 支持多个 `%w`。错误从"一句话"演化成了"一棵可检查、可携带上下文的结构"。

## 7.1.3 改进语法的尝试与争论

冗长的 `if err != nil` 一直是改进呼声的焦点，但历次尝试都未被采纳，这本身很说明 Go 的取舍。
2018–2019 年的 **`check`/`handle`** 提案想引入专门的错误处理语法;2019 年的 **`try`** 内建函数
提案想用 `x := try(f())` 在出错时自动返回。后者引发了社区极其激烈的讨论，最终因"隐藏了控制流、
与'错误路径要显式'的核心价值冲突"等理由被**撤回**。团队的结论是：与其用语法糖把错误处理藏
起来，不如保持它的显式,哪怕啰嗦。这场争论是观察 Go 设计价值观的绝佳样本：**显式与简单，
被置于简洁之上。** 此后改进转向务实的小步：1.13 的包装、1.20 的 `Join`，都在不改变"显式返回"
这一根基的前提下，让错误更好用。

## 7.1.4 跨语言对照

错误处理是语言哲学的分水岭（[6.3](../ch06func/panic.md) 已概述异常 vs 值）。这里补充"值派"内部
的差异：**Rust** 同样用值（`Result<T, E>`），但提供了 `?` 运算符,`f()?` 在出错时自动向上返回，
既保持显式又消除样板，可谓"Go 的 `try` 提案想要、却没做成的东西"。**Swift** 用 `throws` + `try`，
是介于异常与值之间的折中（错误是值，但传播靠 `throw`/`try` 标注）。**Haskell** 用 `Either`/`Maybe`
单子，把错误传播抽象成单子组合。相比之下，Go 的选择最"朴素"：不引入任何专门的传播语法，
全靠普通的 `if`,它用最大的冗长，换取了最小的语言机制与最强的显式性。是否值得，至今仍是
社区津津乐道的话题,而这场持续的讨论，恰恰证明了这个设计触及了语言哲学的根本。

## 延伸阅读的文献

1. Rob Pike. *Errors are values.* Go 博客, 2015. https://go.dev/blog/errors-are-values
2. The Go Authors. *Working with Errors in Go 1.13*（%w 包装、Is/As）, 2019.
   https://go.dev/blog/go1.13-errors
3. Robert Griesemer 等. *Proposal: A built-in Go error check function, "try"*（已撤回）, 2019.
   https://go.googlesource.com/proposal/+/master/design/32437-try-builtin.md
4. Go 1.20 Release Notes（errors.Join、多 %w）. https://go.dev/doc/go1.20

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
