---
weight: 2405
title: "7.5 错误处理的未来"
---

# 7.5 错误处理的未来

前几节讨论的 `%w`、`errors.Is`、`errors.As` 等改进，解决的是错误如何检查、如何携带上下文。
另一个问题始终悬而未决：`if err != nil` 这几行样板代码，能否用新的语法写得更短？从 2018 年到
2025 年，Go 团队先后提出了 `check`/`handle`、`try` 与 `?` 三套完整的方案，社区提出的方案更是
数以百计，但没有一个被采纳。2025 年 6 月，Go 团队宣布在可预见的将来不再为错误处理寻求语法上的
改变 [[Griesemer, 2025](#ref-griesemer-2025)]。

本节依次介绍这三次尝试及其被放弃的原因，2025 年这一决定的理由，以及同一时期在标准库中实际
落地的改进。

## 7.5.1 check 与 handle：2018 年的草案

2018 年 8 月，Go 团队随 Go 2 的草案设计发布了错误处理的问题概述
[[Cox, 2018b](#ref-cox-2018b)]与 Marcel van Lohuizen 的草案设计 [[Lohuizen, 2018](#ref-lohuizen-2018)]。
草案引入两个关键字：`check` 是一个表达式，作用于返回 `(T, error)` 的调用，错误为 `nil` 时得到
`T`，否则把错误交给处理程序；`handle` 是一个语句，声明检查失败时执行的处理程序。问题概述中的
`CopyFile` 在草案下写成这样：

```go
func CopyFile(src, dst string) error {
	handle err {
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}

	r := check os.Open(src)
	defer r.Close()

	w := check os.Create(dst)
	handle err {
		w.Close()
		os.Remove(dst) // （仅当某个 check 失败时）
	}

	check io.Copy(w, r)
	check w.Close()
	return nil
}
```

按照草案的规定，一个 `check` 失败时，会按声明的相反顺序依次执行词法作用域内的所有处理程序，
直到其中一个执行了 `return`。与 `defer` 不同，`handle` 是词法作用域的，循环体中声明的处理程序
不会随迭代累积；处理程序总是在所有延迟函数之前执行。

这套设计的问题也在这里：要弄清某一行 `check` 失败之后会发生什么，读者需要在脑中维护一条处理
程序链，而它与 `defer` 的执行顺序相互独立又彼此交织。Go 团队后来的总结是，`check` 与 `handle`
被认为过于复杂，于是转向了一个简单得多的方案 [[Griesemer, 2025](#ref-griesemer-2025)]。

## 7.5.2 try：2019 年被拒绝的提案

2019 年 6 月，Robert Griesemer 按照 Go 2 的提案流程 [[Griesemer, 2018](#ref-griesemer-2018)]
提出了内建函数 `try`（提案 32437）[[Griesemer, 2019](#ref-griesemer-2019)]。`try` 作用于最后一个结果为
`error` 的调用：错误为 `nil` 时返回其余的结果，否则以该错误作为结果，从所在函数立即返回。
为错误补充上下文的工作，则交给 `defer` 与具名的结果参数。提案中的 `CopyFile` 是这样的：

```go
func CopyFile(src, dst string) (err error) {
	defer func() {
		if err != nil {
			err = fmt.Errorf("copy %s %s: %v", src, dst, err)
		}
	}()

	r := try(os.Open(src))
	defer r.Close()

	w := try(os.Create(dst))
	defer func() {
		w.Close()
		if err != nil {
			os.Remove(dst) // 仅当某个「try」失败时
		}
	}()

	try(io.Copy(w, r))
	try(w.Close())
	return nil
}
```

`try` 不引入新的关键字，也不引入新的控制结构，但这个议题在 GitHub 上收到了八百余条评论。反对
意见的核心在于，`try` 会让所在函数返回，却写成一个普通函数调用的样子：`x := try(f())` 读起来与
`x := len(f())` 没有区别，返回点因此不再一目了然。

2019 年 7 月 16 日，Griesemer 代表提案评审委员会宣布提前拒绝这一提案，并说明了原因：讨论指出了
一些设计时忽略的问题，最突出的是对插入调试输出与分析代码覆盖率的影响；更重要的是，许多人明确
表示，这个提案针对的根本不是一个值得解决的问题。Griesemer 承认，团队在前一年 8 月的问题概述中阐述了要
解决的问题，却没有引导足够的讨论去确认这个问题本身是否正确；那份问题概述甚至可能被同一天发布的
泛型草案抢走了全部注意力 [[Griesemer, 2019](#ref-griesemer-2019)]。

## 7.5.3 ?：2025 年的提案

2025 年 1 月，Ian Lance Taylor 提交了提案 71203 [[Taylor, 2025](#ref-taylor-2025)]，借鉴 Rust 的 `?`
运算符（Rust 1.13 起提供，2016 年 [[Rust, 2016](#ref-rust-2016)]）。按照提案，赋值语句或表达式语句
之后可以跟一个 `?`，它检查最后一个值是否为 `nil`；不为 `nil` 时执行 `?` 之后的语句块，块中隐式
声明的 `err` 即为该错误。语句块可以省略，省略时直接返回该错误：

```go
func CopyFile(src, dst string) error {
	r := os.Open(src) ? {
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}
	defer r.Close()
	// ...
}

func Run() error {
	Start() ? // Start 返回的错误不为 nil 时，将其返回
	Wait() ?  // Wait 返回的错误不为 nil 时，将其返回
	return nil
}
```

与 `try` 不同，带语句块的形式让错误处理的代码仍然显式可见。但这个提案同样迅速被大量评论和细节修改的建议淹
没。Taylor 关闭了提案，把讨论转到 GitHub Discussions（71460）[[Taylor, 2025](#ref-taylor-2025)]。
修改后的版本反响稍好，但仍未获得广泛的支持 [[Griesemer, 2025](#ref-griesemer-2025)]。

三次正式的尝试可以列成下表：

| 时间 | 方案 | 形式 | 结局 |
| :-- | :-- | :-- | :-- |
| 2018 年 8 月 | `check` / `handle` | 关键字与处理程序链 | 被认为过于复杂，未形成正式提案 |
| 2019 年 6 月 | `try(...)` | 内建函数，隐式返回 | 2019 年 7 月被拒绝 |
| 2025 年 1 月 | `expr ?` | 后缀运算符，可带语句块 | 转为讨论，未获广泛支持 |
| 2025 年 6 月 | （全部） | 错误处理的专门语法 | 决定不再寻求 |

## 7.5.4 2025 年的决定

2025 年 6 月 3 日，Griesemer 在 Go 博客上发表了 *[ On | No ] syntactic support for error handling*。
文章宣布，在可预见的将来，Go 团队将停止寻求错误处理方面的语法改变，并将关闭所有主要关注错误处理
语法的现有提案与新提案，不再逐一深究 [[Griesemer, 2025](#ref-griesemer-2025)]。

文章并不讳言支持改变的理由：在 Go 的用户调查中，缺少更好的错误处理支持始终是最主要的抱怨。但
Go 团队列出的反对理由更多：

- **现状已经可用。** Go 处理错误的方式虽然有时显得冗长，但完全可行。连 Go 团队内部对问题本身
  都没有共同的理解，更没有一致认为问题确实存在。
- **语言的改变会波及所有人。** 一旦引入新语法，几乎所有人都得开始使用它，否则代码就显得不合
  惯例；这也违背了 Go「不为同一件事提供多种写法」的原则。
- **真正处理了错误，冗长就不再显眼。** 如果错误确实得到了处理，例如补充了上下文，样板代码在
  其中所占的比例就小得多。
- **工具可以减轻书写的负担。** 今天的 IDE 提供了强大的代码补全，甚至有大语言模型的辅助，写下
  基本的错误检查并不费事；支持 Go 的 IDE 也可以提供一个开关，在显示时隐藏错误处理的代码。
- **显式的检查便于调试。** 如果错误处理的逻辑都藏在 `check`、`try` 或 `?` 背后，为了插入断点或
  调试输出，可能先得把代码改回显式的写法。
- **改变代价高昂。** 语言的改变代价很高，Go 团队规模不大，还有许多其他优先事项。
- **询问过的用户都反对。** 文章提到，Go 团队在 Google Cloud Next 2025 的展台与 Go 聚会上询问过的
  每一位 Go 用户，都坚决认为不应为了错误处理而改变语言；许多人说，缺少专门的错误处理语法这一点，
  在刚从其他语言转来时感受最明显。
文章给出的替代方案都不是语法：用辅助函数为错误补充上下文，以及借助标准库的新功能减少样板代码，
这正是 Rob Pike 在 2015 年的《Errors are values》中所提倡的思路 [[Pike, 2015](#ref-pike-2015)]。
例如，Go 1.22 加入的 `cmp.Or` 返回第一个不等于零值的参数，`error` 是可比较的接口类型，因此可以用
它一次处理一组错误：

```go {run=true}
package main

import (
	"cmp"
	"fmt"
	"strconv"
)

func printSum(a, b string) error {
	x, err1 := strconv.Atoi(a)
	y, err2 := strconv.Atoi(b)
	if err := cmp.Or(err1, err2); err != nil {
		return err
	}
	fmt.Println("result:", x+y)
	return nil
}

func main() {
	fmt.Println(printSum("1", "2"))
	fmt.Println(printSum("1", "x"))
	fmt.Println(printSum("y", "x")) // 只返回第一个非 nil 的错误
}
```

```
result: 3
<nil>
strconv.Atoi: parsing "x": invalid syntax
strconv.Atoi: parsing "y": invalid syntax
```

## 7.5.5 落地的是库，而不是语法

与语法上的屡次失败相对，错误处理这些年真正落地的改进，全部发生在标准库中，没有改动语言的文法：

- **Go 1.13（2019）：包装与检查。** `%w`、`errors.Unwrap`、`errors.Is`、`errors.As`
  [[Neil and Amsterdam, 2019](#ref-neil-amsterdam-2019)] [[Amsterdam, 2019](#ref-amsterdam-2019)]，
  见 [7.2](./inspect.md)。
- **Go 1.20（2023）：多重包装。** `errors.Join` 与 `fmt.Errorf` 中的多个 `%w`，错误链由此成为
  错误树 [[Go Authors, 2023](#ref-go-authors-2023)]。

  ```go
  err := errors.Join(errClose, errFlush) // 两个独立的错误合并为一个
  if errors.Is(err, errFlush) { /* 仍可分别检查 */ }
  ```

- **Go 1.21（2023）：结构化日志。** `log/slog` 使错误可以作为带键的字段记录
  [[Amsterdam, 2023](#ref-amsterdam-2023)]，见 [7.3](./context.md)。
- **Go 1.26（2026）：泛型的 `errors.AsType`。** 借助泛型取代 `As` 需要传入指针的接口
  [[Go Authors, 2026](#ref-go-authors-2026)]：

  ```go
  if pe, ok := errors.AsType[*fs.PathError](err); ok {
  	fmt.Println("失败路径:", pe.Path)
  }
  ```

`AsType` 恰好说明了 2025 年决定背后的逻辑：泛型这种通用的语言能力具备之后，错误处理可以在库的
层面随之改进，而不需要任何专为错误处理设计的语法。Russ Cox 在 2019 年把 Go 的演进方式概括为
「实验、简化、发布」，`check` 与 `try` 正是在实验之后被放弃的 [[Cox, 2019b](#ref-cox-2019b)]。
库的改动是增量的，旧代码照常工作，新功能按需取用；语法的改动则会影响每一份代码与每一位读者。Go
在错误处理上的实际策略，是把能放进库的改进都放进库，而让语言的文法保持不变。

## 7.5.6 显式优于简洁

回顾这七年，Go 团队并非因循守旧，而是在显式与简洁之间一再选择了前者，并且每次都公开说明了理由。`check`/`handle`
被放弃，是因为它以复杂换取简短；`try` 被拒绝，是因为它把返回藏进了一个看似普通
的表达式。被反复申明的底线是：阅读一段 Go 代码时，控制流应当一目了然。

放在语言谱系中看，这一选择的含义更加清楚。异常把错误交给隐式的控制转移，Go 从一开始就没有
采用（见 [7.1.1](./value.md)）。Rust 的 `?` 则是另一种做法：错误仍然是值，只是用一个后缀运算符
省去手写的分支。`?` 正是 `try` 想要提供的东西，Rust 接受了它，因为 Rust 本就允许表达式改变控制流；Go
看到了同样的设计，却没有接受。两种语言在同一个问题上做出了相反的选择，反映的是对「控制流是否
应当始终显式可见」这一问题的不同回答。把错误当作普通的返回值、用普通的控制流处理，是 Go 自诞生
起的立场，2025 年的决定只是把这一立场又一次明确地写了下来。

## 延伸阅读

- <a id="ref-griesemer-2025"></a>[Griesemer, 2025] Robert Griesemer. *[ On | No ] syntactic support for
  error handling.* The Go Blog, 2025-06-03. https://go.dev/blog/error-syntax （Go 团队决定不再追求
  错误处理语法的正式声明与理由）
- <a id="ref-griesemer-2019"></a>[Griesemer, 2019] Robert Griesemer. *Proposal: A built-in Go error check
  function, "try".* 2019, issue 32437（已被拒绝）. https://github.com/golang/go/issues/32437 ；
  设计文档 https://go.googlesource.com/proposal/+/master/design/32437-try-builtin.md ；
  拒绝说明 https://github.com/golang/go/issues/32437#issuecomment-512035919
- <a id="ref-cox-2018b"></a>[Cox, 2018b] Russ Cox. *Error Handling, Problem Overview（check/handle）.*
  2018. https://go.googlesource.com/proposal/+/master/design/go2draft-error-handling-overview.md
- <a id="ref-griesemer-2018"></a>[Griesemer, 2018] Robert Griesemer. *Go 2, here we come!* The Go Blog,
  2018-11-29. https://go.dev/blog/go2-here-we-come （Go 2 提案流程的说明，本节所述各提案均经此流程）
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. *Go 1.20 Release Notes（errors.Join
  与多重 %w）.* 2023. https://go.dev/doc/go1.20#errors
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Package errors（含 1.26 引入的泛型
  AsType）.* https://pkg.go.dev/errors ；*Go 1.26 Release Notes.* https://go.dev/doc/go1.26
- <a id="ref-neil-amsterdam-2019"></a>[Neil and Amsterdam, 2019] Damien Neil, Jonathan Amsterdam. *Working
  with Errors in Go 1.13（%w 包装与错误链）.* The Go Blog, 2019. https://go.dev/blog/go1.13-errors
- <a id="ref-cox-2019b"></a>[Cox, 2019b] Russ Cox. *Experiment, Simplify, Ship.* The Go Blog, 2019.
  https://go.dev/blog/experiment （「先库后语言、先实验再固化」的演进哲学，正是本节主线的注脚）
- <a id="ref-amsterdam-2019"></a>[Amsterdam, 2019] Jonathan Amsterdam. *proposal: Go 2 error values（#29934）.* 2019.
  https://github.com/golang/go/issues/29934 （错误值演进的总提案，串起被否决与被
  采纳的诸多方案）
- <a id="ref-lohuizen-2018"></a>[Lohuizen, 2018] Marcel van Lohuizen. *Error Handling, Draft Design.*
  2018. https://go.googlesource.com/proposal/+/master/design/go2draft-error-handling.md
- <a id="ref-taylor-2025"></a>[Taylor, 2025] Ian Lance Taylor. *proposal: spec: reduce error handling
  boilerplate using ? (#71203).* 2025. https://go.dev/issue/71203 ；讨论
  https://github.com/golang/go/discussions/71460
- <a id="ref-rust-2016"></a>[Rust, 2016] The Rust Project. *Rust 1.13.0 Release Notes: Stabilize the `?`
  operator.* 2016. https://github.com/rust-lang/rust/blob/master/RELEASES.md#version-1130-2016-11-10
- <a id="ref-pike-2015"></a>[Pike, 2015] Rob Pike. *Errors are values.* The Go Blog, 2015.
  https://go.dev/blog/errors-are-values
- <a id="ref-amsterdam-2023"></a>[Amsterdam, 2023] Jonathan Amsterdam. *Structured Logging with slog.* The
  Go Blog, 2023. https://go.dev/blog/slog
