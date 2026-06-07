---
weight: 2403
title: "7.3 错误格式与上下文"
---

# 7.3 错误格式与上下文

一个好的错误，不只是"出错了"，而是能告诉人**在做什么时、因何、出了什么错**。这一节谈错误的
文本表示、如何沿调用链累积上下文，以及栈轨迹与结构化日志这两个相关话题。

## 7.3.1 Error() 的约定

`error` 接口只要求 `Error() string`。围绕这个方法，Go 社区形成了一套不成文的风格约定：错误
字符串**首字母小写、结尾不加标点**。原因很实际,错误常被层层包装拼接（`"read config: open
file: permission denied"`），若每段都大写、带句号，拼起来就是一串支离破碎的句子。小写无标点的
片段才能顺畅地串成一条因果链。这是一条细小却处处可见的工程约定，`go vet` 也会检查它。

## 7.3.2 在每一层加上下文

错误从底层向上传播时，每经过一个有意义的边界，都该**补一句"我当时在干什么"**,这正是 `%w`
包装（[7.2](./inspect.md)）的首要用途：

```go
func loadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("load config %q: %w", path, err) // 补上"在加载哪个配置"
    }
    // ...
}
```

最终用户看到的 `load config "a.conf": open a.conf: no such file or directory`，是一条从高层意图
到底层原因的完整链。这种"逐层标注"是 Go 错误处理的核心实践,它把异常语言里那条隐式的栈轨迹，
换成了一条显式的、人类可读的、由程序员主动书写的语义链。代价是要勤快地写包装，收益是错误
信息往往比一条机器栈轨迹更说明问题。

## 7.3.3 栈轨迹与结构化错误

逐层标注虽好，有时仍想要机器栈轨迹来定位。标准库的 `error` 默认不带栈,这是有意的取舍
（栈采集有成本，且多数错误用不上）。需要时，社区曾用 `github.com/pkg/errors`（`WithStack`、
`%+v` 打印栈）填补，其许多理念后来影响了标准库的 `errors` 设计;实验包 `golang.org/x/xerrors`
则是 1.13 错误特性的试验田。今天，配合 `fmt.Formatter` 接口，自定义错误类型可以实现 `%+v`
输出更丰富的诊断信息;而 Go 1.21 的结构化日志 `log/slog` 让错误能作为带键值的结构化字段记录，
而非仅一行文本。错误处理与可观测性（[16 工具与可观测性](../../part5toolchain/ch16tools)）在此
交汇。

## 7.3.4 取舍

Go 在错误格式上的整体倾向，是**人写的语义上下文优于机器采的栈轨迹**：默认不带栈、鼓励逐层
标注。这让常见错误的信息高度可读，代价是程序员要勤于包装、且默认拿不到栈。需要深度诊断的
场景，则用自定义错误类型、`%+v`、结构化日志去补。一个朴素的 `Error() string` 接口，配上
社区约定与按需扩展，撑起了从"一句话错误"到"带栈结构化诊断"的整个谱系,这种"核心极简、按需
扩展"的风格，是 Go 标准库一贯的样子。

## 延伸阅读的文献

1. The Go Authors. *Error handling and Go.* Go 博客, 2011. https://go.dev/blog/error-handling-and-go
2. Dave Cheney. *github.com/pkg/errors*（WithStack、%+v 栈轨迹）.
   https://github.com/pkg/errors
3. The Go Authors. *golang.org/x/xerrors*（1.13 错误特性试验田）.
   https://pkg.go.dev/golang.org/x/xerrors
4. The Go Authors. *log/slog：结构化日志*（Go 1.21）. https://pkg.go.dev/log/slog

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
