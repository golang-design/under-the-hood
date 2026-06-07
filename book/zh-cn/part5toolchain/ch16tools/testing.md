---
weight: 5204
title: "16.4 代码测试"
---

# 16.4 代码测试

测试在 Go 里不是外挂，而是**语言工具链的一等公民**。`go test` 内建、`testing` 包标准、约定优于
配置,这套设计深刻影响了 Go 的工程文化。这一节讲清 Go 测试的机制与哲学，以及 Go 1.18 加入的
模糊测试。

## 16.4.1 约定优于配置

Go 的测试靠**约定**运转，几乎零配置：测试文件以 `_test.go` 结尾、测试函数形如
`func TestXxx(t *testing.T)`、放在被测包同目录,`go test` 自动发现并运行它们。没有 XML 配置、
没有外部测试框架、没有注解。这种"约定优于配置"让测试**毫无门槛**:任何 Go 项目，`go test ./...`
就跑全部测试。它也统一了整个生态,所有 Go 项目的测试方式一致，工具（CI、覆盖率、IDE）无需
适配各色框架。

`testing` 包刻意**极简**：`t.Error`/`t.Fatal` 报告失败，没有内建的丰富断言库（`assertEqual`
那一套）。这是有意的,Go 团队认为断言库会鼓励"写一行断言"而非"想清楚失败时该报告什么"，
故鼓励直接用 `if got != want { t.Errorf(...) }`。这点常引发争论，但它体现了 Go 一贯的"少即是多"
与"显式优于魔法"。

## 16.4.2 表驱动测试与子测试

Go 社区最具代表性的测试范式是**表驱动测试**：把多组输入与期望写成一张表（一个切片），用一个
循环逐组跑。配合 Go 1.7 引入的**子测试**（`t.Run`），每组可以是一个独立命名、可单独运行、
可并行（`t.Parallel`）的子测试。表驱动 + 子测试，让"为一个函数覆盖众多边界情形"既紧凑又清晰,
加一个用例只是往表里加一行。这种范式如此普遍，几乎成了 Go 测试的代名词,它也再次体现 Go
偏爱"用朴素的数据与循环"而非"专门的框架机制"来解决问题。

## 16.4.3 模糊测试与基准

Go 1.18 把**模糊测试**（fuzzing）也纳入了标准工具链：`func FuzzXxx(f *testing.F)`,`go test
-fuzz` 会自动生成大量随机/变异输入去轰击你的函数，专门寻找会导致 panic 或违反不变式的输入。
模糊测试擅长发现人想不到的边界 bug（畸形输入、整数溢出、解析器崩溃），过去要靠第三方工具，
如今一个 `-fuzz` 标志即可。再加上基准测试（`func BenchmarkXxx(b *testing.B)`，
[16.5](./perf.md)）,单元测试、表驱动、子测试、模糊测试、基准测试，全都收在同一个 `testing`
包、同一个 `go test` 命令之下。

把测试做成工具链的一等公民，影响是文化层面的：它让"写测试"成为 Go 项目的默认习惯而非额外
负担,零门槛、统一、内建。这是 Go"工程友好"哲学（[1.1](../../part1overview/ch01intro/history.md)）
最落地的体现之一,一门语言对测试的态度，深刻塑造着用它写出的软件的质量文化。

## 延伸阅读的文献

1. The Go Authors. *testing 包文档.* https://pkg.go.dev/testing
2. The Go Authors. *Go Fuzzing.* https://go.dev/doc/security/fuzz/ ；Go 1.18 Release Notes.
3. Dave Cheney. *Prefer table driven tests.*
   https://dave.cheney.net/2019/05/07/prefer-table-driven-tests
4. The Go Authors. *Add a test（教程）.* https://go.dev/doc/tutorial/add-a-test

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
