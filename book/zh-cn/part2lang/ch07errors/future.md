---
weight: 2405
title: "7.5 错误处理的未来"
---

# 7.5 错误处理的未来

Go 的错误处理是它被讨论得最多、改进提案被否得也最多的部分。回顾这些尝试与它们的结局，
能看清 Go 团队在这件事上的稳定立场,也能对"未来会怎样"有一个清醒的预期。

## 7.5.1 被否决的语法尝试

冗长的 `if err != nil` 催生了一系列简化语法的提案，但它们大多止步于讨论：

- **`check`/`handle`（2018）**：引入 `check` 表达式与 `handle` 块，把错误检查与处理从主干里
  抽出来。社区担心它引入了新的控制流概念、复杂度不小，未被采纳。
- **`try` 内建函数（2019）**：`x := try(f())`,出错时自动从当前函数返回。它引发了 Go 历史上最
  热烈的讨论之一，最终被**撤回**，核心理由是它**隐藏了控制流**：一个不起眼的 `try` 背后藏着一个
  return，与 Go"错误路径应当显式可见"的根本价值冲突。
- **更轻的 `if err != nil` 语法尝试（2020 前后）**：也都未能形成共识。

这一连串"提了又否"本身就是结论：**Go 团队宁可保留冗长，也不愿用语法糖把错误处理藏起来。**
2025 年，团队更是公开表示**不再推进**对 `if err != nil` 的专门语法改造,这场持续多年的讨论
就此告一段落。

## 7.5.2 实际发生的演进

语法没变，能力却在务实地增强,而且都不触动"显式返回"这一根基：

- **Go 1.13（2019）**：`%w` 包装 + `errors.Is`/`As`/`Unwrap`，让错误可分层、可检查
  （[7.2](./inspect.md)）。
- **Go 1.20（2023）**：`errors.Join` 与多重 `%w`，一个错误可包装多个子错误。
- **Go 1.21（2023）**：`log/slog` 结构化日志，让错误更好地融入可观测性。
- **泛型相关**：`errors.AsType[E]` 等泛型化的辅助，让取用类型错误更顺手（[7.2](./inspect.md)）。

可以看到，所有真正落地的改进，都在"包装、检查、记录"这些**库层面**做文章，而非改动语言。

## 7.5.3 一个稳定的哲学

把这段历史压缩成一句话：**Go 的错误处理几乎不会再有重大的语法变革，演进会继续发生在库与
惯用法层面。** 这不是停滞，而是一种深思熟虑的稳定,团队反复用否决来守护"错误即值、错误路径
显式可见"这两条核心价值。对写 Go 的人来说，这意味着可以放心地把 `if err != nil`、`%w` 包装、
`Is`/`As`、断行为（[7.4](./semantics.md)）这套工具学透用熟，而不必担心它们被推倒重来。
一门语言敢于长期对"看起来很烦"的东西说"就这样"，本身就是一种设计自信,Go 在错误处理上，
选择了这种自信。

## 延伸阅读的文献

1. Robert Griesemer 等. *Proposal: A built-in Go error check function, "try"*（已撤回）, 2019.
   https://go.googlesource.com/proposal/+/master/design/32437-try-builtin.md
2. The Go Authors. *Error Handling — Problem Overview / Draft Designs（check/handle）*, 2018.
   https://go.googlesource.com/proposal/+/master/design/go2draft-error-handling-overview.md
3. Russ Cox. *Go 2 草案与错误处理的讨论历程.* https://go.dev/blog/go2-here-we-come
4. Go 官方关于不再推进 `if err != nil` 语法改造的说明（2025）.
   https://go.dev/blog/error-syntax

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
