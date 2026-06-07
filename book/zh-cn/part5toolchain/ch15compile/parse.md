---
weight: 5101
title: "15.1 词法与文法"
---

# 15.1 词法与文法

编译的第一站，是把源码文本变成结构化的**抽象语法树**（AST）。这要经过**词法分析**（把字符流切成
token）与**语法分析**（按文法把 token 组织成树）。[3.2](../../part1overview/ch03life/compile.md)
鸟瞰过整条流水线，这一节专看它的前端,以及 Go 的文法为何被设计得如此"好解析"。

## 15.1.1 为快速解析而设计的文法

Go 的文法是**刻意为快速解析而设计**的（[1.1](../../part1overview/ch01intro/history.md) 的编译速度
执念）。它有几个关键特性：文法基本是 **LALR(1) / 可递归下降**的，解析时无需复杂的回溯或符号表
查询,编译器读一遍 token 流就能建出 AST。这与 C++ 那种"必须先知道一个名字是类型还是变量
才能正确解析"（著名的 most vexing parse）形成鲜明对比,Go 的语法避免了这类歧义，解析器
因此又快又简单。

最有名的细节是**分号自动插入**：Go 语句以分号结尾，但你几乎从不写分号,因为**词法分析器**会
按规则（一行以特定 token 结尾时）自动插入。这也是"`{` 不能另起一行"这条风格强制的由来,
若把 `{` 放到下一行，词法器会在上一行末尾插入分号，改变语义。一个看似武断的格式规定，根子在
词法器的设计。

## 15.1.2 从 token 到 AST

词法分析器（`cmd/compile/internal/syntax` 的 scanner）把源码切成 token 流:标识符、关键字、
字面量、运算符等。语法分析器（recursive descent parser）按 Go 文法把 token 组织成 **AST**,
一棵忠实反映源码结构的树（函数、语句、表达式各成节点）。这一步还做最基本的语法正确性检查
（括号匹配、语句结构合法）。AST 是后续所有阶段的输入:类型检查（[8.3](../../part2lang/ch08generics/checker.md)
的 types2）在它上面标注类型、报类型错误，之后才降到中间表示（[15.2](./ssa.md)）。

## 15.1.3 简单文法的回报

Go 把"语言文法的简单"放在很高的优先级，回报是多方面的。**编译快**:解析是编译的第一步，
它快，整条流水线才快。**工具好写**:`gofmt`、`goimports`、`gopls`（[16.7](../ch16tools/gopls.md)）
等工具都要解析 Go 代码，简单无歧义的文法让它们的解析既快又可靠,这是 Go 工具生态繁荣的隐形
地基。**可读性**:无歧义的文法也意味着人读代码时不会困惑于"这到底怎么解析"。这再次印证 Go 的
价值观（[1.2](../../part1overview/ch01intro/go.md)）：在"语言的表达力"与"简单、快速、可工具化"
之间，它坚定地选后者。一门语言的文法设计，看似最底层的技术细节，实则深刻影响着它的编译速度、
工具生态乃至日常书写体验。

## 延伸阅读的文献

1. The Go Programming Language Specification：*Lexical elements / Semicolons.*
   https://go.dev/ref/spec#Semicolons
2. The Go Authors. *cmd/compile/internal/syntax（scanner 与 parser）.*
   https://github.com/golang/go/tree/master/src/cmd/compile/internal/syntax
3. The Go Authors. *cmd/compile/README（编译器前端总览）.*
   https://github.com/golang/go/blob/master/src/cmd/compile/README.md
4. 本书 [3.2 编译流程](../../part1overview/ch03life/compile.md)、
   [8.3 类型检查技术](../../part2lang/ch08generics/checker.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
