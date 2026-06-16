---
weight: 2403
title: "7.3 错误格式与上下文"
---

# 7.3 错误格式与上下文

一个好的错误，不只是「出错了」，而是能告诉人：在做什么的时候、因为什么、出了什么错。问题的
演化（[7.1](./value.md)）与值检查（[7.2](./inspect.md)）给了我们传递与检视错误的机制，这一节
谈机制之上的工程实践，错误的文本应当怎么写、上下文如何沿调用链一层层累积、以及当人写的文字
不够用时，栈轨迹与结构化日志如何按需补上。贯穿其间的，是 Go 在错误信息上的一个总体倾向：
人写的语义上下文，优于机器采的栈轨迹。

## 7.3.1 `Error() string` 的约定

`error` 接口只要求一个方法：

```go
type error interface {
    Error() string
}
```

围绕这唯一的方法，Go 社区形成了一套不成文却处处可见的风格约定：错误字符串首字母小写、
结尾不加标点。约定背后的原因很实际。错误极少独立出现，它们几乎总是被层层包装、首尾相接，
拼成一条更长的字符串。设想三层调用各自补一句上下文，最终用户看到的是：

```
read config: open /etc/app.conf: permission denied
```

这是三段错误用 `: ` 拼接而成的一条因果链。若每一段都按句子的写法首字母大写、末尾加句号，
拼起来便成了「Read config: Open /etc/app.conf: Permission denied.」，一串大写字母与句号
散落在句子中间，读起来支离破碎。小写、无尾标点的片段，才能顺畅地嵌进任意位置，串成一条
连贯的链。这条约定细小，却是 Go 错误信息能层层拼接而不失可读的前提。

需要澄清一处常见的说法：检查这条约定的并不是 `go vet`。历史上它由 `golint` 负责，`golint`
归档后，这项检查（编号 ST1005）由 `staticcheck` 等第三方工具承担。`go vet` 不管错误字符串
的大小写，但它确实有一个与错误相关的检查，针对 `log/slog` 的结构化日志调用（见 7.3.5）。

## 7.3.2 在每一个边界补上上下文

错误从底层向上传播时，每经过一个有意义的边界，都该补一句「我当时在干什么」。这正是 `%w`
包装（[7.2](./inspect.md)）的首要用途，也是 Go 错误处理的核心实践。下面是一段典型的
配置加载代码，它在两个不同的失败点各自标注了当时的意图：

```go
func loadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        // 标注「在加载哪个配置文件」，并用 %w 保留底层 error 供判定
        return nil, fmt.Errorf("load config %q: %w", path, err)
    }

    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        // 解析失败是另一类边界，标注的语义也不同
        return nil, fmt.Errorf("parse config %q: %w", path, err)
    }
    return &cfg, nil
}
```

文件不存在时，调用者最终拿到的是 `load config "a.conf": open a.conf: no such file or
directory`：一条从高层意图（加载配置）到底层原因（文件打不开）的完整链。`%w` 在拼出这句
可读文字的同时，把底层的 `fs.ErrNotExist` 保留在错误树里，调用者既能把整句打印给用户，也能
用 `errors.Is(err, fs.ErrNotExist)`（[7.2](./inspect.md)）判定具体原因。文字给人看，结构
给程序看，两者并不冲突。

这种逐层标注，本质上是用人工书写换取语义。异常语言里，错误一路向上抛，沿途的上下文由运行时
自动采集成一条栈轨迹；Go 把这件事交还给程序员：每一层主动写一句话，最终拼成的不是一串函数名
与行号，而是一条人类可读的、描述「程序在做什么时出了错」的语义链。代价是要勤快，每个边界都
得记得包装，漏掉一层，链上就断一节；收益是错误信息往往比一条机器栈轨迹更说明问题，因为它讲的
是业务意图，而非实现细节。

一个值得记住的纪律：包装的文字描述本层在做什么，而不要复述下层已经说过的话。`fmt.Errorf("load
config %q: %w", path, err)` 里，`load config` 是本层的意图，`%w` 后面交给下层去讲它自己的失败，
两层各说一段，不重不漏。

## 7.3.3 标准库的 error 不带栈

逐层标注虽好，定位疑难问题时，人们有时仍想要一条机器栈轨迹，知道错误究竟从哪一行冒出来。
标准库的 `errors.New` 与 `fmt.Errorf` 默认都不采集栈：

```go
func New(text string) error {
    return &errorString{text}
}

type errorString struct {
    s string
}

func (e *errorString) Error() string { return e.s }
```

一个 `errorString` 只有一个字符串字段，别无他物。这是有意的取舍，而非疏漏。采集栈轨迹需要
`runtime.Callers` 回溯调用栈，再把程序计数器翻译成函数名与行号，这在错误高频产生的路径上
（例如以 error 表示「未找到」「已到末尾」这类预期内的控制流）是不小的开销。Go 的判断是：
绝大多数错误用不上栈，把栈做成默认会让所有人为少数场景买单。于是标准库选择最小的 error，
把栈留给需要的人按需添加。这正是 Go 标准库一贯的姿态：核心极简，扩展按需。

## 7.3.4 把栈与诊断信息加回来

需要栈的场景，社区早有成熟方案。Dave Cheney 的 `github.com/pkg/errors` 提供 `WithStack`
与 `Wrap`，在包装错误的同时记下当前调用栈，并约定用 `%+v` 打印出带栈的完整诊断：

```go
import "github.com/pkg/errors"

func loadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, errors.Wrap(err, "load config") // 记下此处的调用栈
    }
    // ...
}

// 上层打印：fmt.Printf("%+v\n", err)
// 普通 %v 仍是一行 "load config: open a.conf: ..."，
// %+v 则额外逐帧列出函数名与文件行号。
```

`pkg/errors` 验证了一件事：包装、栈轨迹、可定制的打印格式，可以叠在 `error` 接口之上而不必
改动语言。它的许多理念后来流入标准库。`golang.org/x/xerrors` 是 Go 1.13 错误特性正式落地前的
试验田，`%w` 包装、`Is`/`As`/`Unwrap` 的雏形都在那里打磨过，最终其中的核心被吸收进标准库的
`errors` 与 `fmt`（[7.2](./inspect.md)），而把栈轨迹留在了标准库之外，交由第三方库按需提供。

要让自定义错误类型支持 `%+v` 这类丰富输出，靠的是 `fmt.Formatter` 接口：

```go
type Formatter interface {
    Format(f State, verb rune)
}
```

实现了 `Format` 的类型，可以完全接管自己被 `fmt` 打印时的行为：通过 `State` 拿到输出目标
（`State` 同时是 `io.Writer`）和格式标志，再根据 `verb`（`v`、`s` 等）与标志（`f.Flag('+')`
是否设置了 `+`）决定打印简略的一行还是带栈的多行。一个携带栈的错误类型大致这样裁剪：

```go
// 速写：一个带栈的错误，普通打印一行，%+v 打印栈
type withStack struct {
    err   error
    stack []uintptr // 构造时由 runtime.Callers 采集
}

func (w *withStack) Error() string { return w.err.Error() }
func (w *withStack) Unwrap() error { return w.err } // 仍可被 Is/As 穿透

func (w *withStack) Format(s fmt.State, verb rune) {
    switch verb {
    case 'v':
        if s.Flag('+') { // %+v：先打印底层错误，再逐帧打印栈
            fmt.Fprintf(s, "%+v", w.err)
            for _, pc := range w.stack {
                fn := runtime.FuncForPC(pc)
                file, line := fn.FileLine(pc)
                fmt.Fprintf(s, "\n\t%s\n\t\t%s:%d", fn.Name(), file, line)
            }
            return
        }
        fallthrough
    case 's':
        fmt.Fprint(s, w.err.Error()) // %v / %s：只打印一行
    }
}
```

这样，同一个错误值，平时打印是简洁的一行，排障时 `%+v` 就能展开成带栈的诊断。`Format` 让
「打印多详细」成为输出时才决定的事，而不必在产生错误时就固定下来。

## 7.3.5 结构化日志：错误作为字段

文本拼接的链有一个天花板：它是给人读的散文，不便机器检索与聚合。当错误进入日志、要被监控
系统按字段过滤、统计、告警时，一行字符串就显得笨拙。Go 1.21 引入的 `log/slog` 把日志从
「格式化字符串」转向「键值对的结构化记录」，错误于是能作为一个带键的字段被记录，而非塞进
一句话里：

```go
import "log/slog"

func handle(path string) {
    cfg, err := loadConfig(path)
    if err != nil {
        // 错误是一个名为 "err" 的字段，path 是另一个字段
        slog.Error("config load failed",
            slog.String("path", path),
            slog.Any("err", err),
        )
        return
    }
    _ = cfg
}
```

以 JSON Handler 输出时，这条记录形如 `{"level":"ERROR","msg":"config load failed",
"path":"a.conf","err":"load config \"a.conf\": ..."}`。`msg` 是稳定的、可聚类的事件名，
`path` 与 `err` 是可被检索过滤的字段。逐层标注积累出的那条语义链，此刻成为 `err` 字段的值，
两套实践在这里衔接：人写的上下文负责「讲清楚发生了什么」，结构化字段负责「让机器查得到、
统计得出」。这正是错误处理与可观测性（[16 工具与可观测性](../../part5toolchain/ch16tools)）的
交汇点。

`slog` 的键值接口有一处易错：它接受交替的 `key, value` 变长参数，写漏一个值或把非字符串
放在键的位置，编译期不会报错，运行期才出问题。前面提到的 `go vet` 的 `slog` 检查正是为此
而生，它会在静态分析时报出键值不匹配的调用，例如缺了最后一个值、或键的位置放了个整数。
本节用 `slog.String`、`slog.Any` 显式构造 `Attr`，既避开了这个坑，也让字段类型一目了然。

## 7.3.6 设计取舍与谱系

把这一节收束成一句话：Go 在错误格式上倾向于人写的语义上下文，而把机器栈轨迹做成可选项。

- 标准库默认不带栈，鼓励逐层用 `%w` 标注。常见错误因此高度可读，讲的是业务意图；代价是
  程序员要勤于包装，且默认拿不到栈。
- 需要栈时，`fmt.Formatter` 加 `runtime.Callers` 即可把带栈的诊断叠加上去，`pkg/errors`
  把这套做法工具化，其理念经 `x/xerrors` 试验后部分进入标准库。深度诊断按需扩展，不让多数人
  为少数场景买单。
- 需要机器可查时，`log/slog` 把错误降格为一个结构化字段，与监控系统对接。

放进谱系看，这与异常语言的路线恰成对照。Java、Python 用自动采集的栈轨迹换取「零成本的
上下文」，代价是栈轨迹冗长、充斥实现细节、且无法表达业务语义；Rust 的 `Result` 与 `?` 同样
默认不带栈，社区靠 `anyhow`、`thiserror` 等库补充上下文与（可选的）回溯，与 Go 的
`pkg/errors` 思路高度相似。一个朴素的 `Error() string` 接口，配上社区约定、`%w` 包装、
`fmt.Formatter` 与 `log/slog`，撑起了从「一句话错误」到「带栈结构化诊断」的整个谱系。核心
极简、按需扩展，是 Go 标准库反复出现的样子。

## 延伸阅读的文献

1. Andrew Gerrand. *Error handling and Go.* Go 博客, 2011.
   https://go.dev/blog/error-handling-and-go
2. Russ Cox 等. *Working with Errors in Go 1.13.* Go 博客, 2019.
   https://go.dev/blog/go1.13-errors （`%w`、`Is`/`As`/`Unwrap` 的设计与取舍）
3. Dave Cheney. *github.com/pkg/errors*（`Wrap`/`WithStack`、`%+v` 带栈打印）.
   https://github.com/pkg/errors ；
   *Stack traces and the errors package.* 2016.
   https://dave.cheney.net/2016/06/12/stack-traces-and-the-errors-package
   （`pkg/errors` 栈轨迹设计的作者自述）
4. The Go Authors. *golang.org/x/xerrors*（Go 1.13 错误特性的试验田）.
   https://pkg.go.dev/golang.org/x/xerrors
5. The Go Authors. *Package log/slog*（Go 1.21 结构化日志）.
   https://pkg.go.dev/log/slog
6. The Go Authors. *Package fmt*（`Formatter`、`State` 接口）.
   https://pkg.go.dev/fmt#Formatter
7. Dominik Honnef. *staticcheck ST1005: Incorrectly formatted error string.*
   https://staticcheck.dev/docs/checks#ST1005 （错误字符串大小写与标点的检查）
8. 本书 [7.1 问题的演化](./value.md)、[7.2 错误值检查](./inspect.md)、
   [16 工具与可观测性](../../part5toolchain/ch16tools).
