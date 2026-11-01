---
weight: 2403
title: "7.3 错误格式与上下文"
---

# 7.3 错误格式与上下文

一条有用的错误消息，应当说明程序当时在做什么、因为什么而失败。[7.2](./inspect.md) 讨论了程序
如何检查错误，本节讨论错误如何呈现给人：错误消息应当怎样书写，上下文如何沿调用链逐层累积，
以及当人写的上下文不够用时，调用栈与结构化日志如何补充。

Go 在这方面的倾向是：由程序员在每一层写下语义上的上下文，而不是由运行时自动采集调用栈。
标准库的错误默认不带调用栈，需要时由第三方库或用户自己的类型添加。

## 7.3.1 错误消息的书写约定

Go 的错误消息有一条广为遵循的约定：首字母小写，末尾不加标点。Go 官方的代码评审指南（Go Code Review
Comments）[[Go Wiki, n.d.](#ref-go-wiki-nd)]解释了原因：错误消息通常会被拼接在其他上下文之后打印，例如
`log.Printf("Reading %s: %v", filename, err)`，若错误消息首字母大写，整句话中间就会出现一个多余的大写字
母。指南同时说明，这条约定不适用于日志消息，因为日志本身以行为单位，不会被嵌入其他消息之中。

错误消息因此可以层层拼接。三层调用各自补充一段，最终得到的是一条以 `: ` 分隔、从高层意图
到底层原因的消息：

```
load config: open /etc/app.conf: permission denied
```

Effective Go 还建议 [[Go Authors, 2009](#ref-go-authors-2009)]，错误消息应当尽可能标明来源，
例如以产生错误的操作或包名作为前缀：`image` 包因格式未知而解码失败时，错误消息是 `image: unknown format`。`os.PathError`
是这一建议的范例，它的消息包含操作、文件路径与系统调用返回的错误，如
`open /etc/passwx: no such file or directory`，即使在远离出错位置的地方打印，也能看出发生了什么。

这条约定过去由 `golint` 检查。Ian Lance Taylor 于 2020 年 5 月提议冻结并弃用 `golint`（go.dev/issue/38968），
其仓库随后归档 [[Taylor, 2020](#ref-taylor-2020)]；同样的检查现在由 Staticcheck
的 ST1005 提供 [[Honnef, n.d.](#ref-honnef-nd)]。`go vet` 不检查错误消息的写法。

## 7.3.2 在每个边界补充上下文

错误向上传播时，每经过一个有意义的边界，都应当补充一句本层正在做什么。Andrew Gerrand 在
2011 年的博文中写道，概括上下文是错误的实现者的责任 [[Gerrand, 2011](#ref-gerrand-2011)]。这正是 `%w`
的主要用途。下面是一个读取配置文件的函数，它在两个失败点各自补充了不同的上下文：

```go {run=true}
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
)

type Config struct{ Addr string }

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		// *fs.PathError 的消息已经包含路径，这里不再重复
		return nil, fmt.Errorf("load config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		// json 的错误不包含路径，这里补上
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	return &cfg, nil
}

func main() {
	_, err := loadConfig("a.conf")
	fmt.Println(err)
	fmt.Println(errors.Is(err, fs.ErrNotExist))
}
```

```
load config: open a.conf: no such file or directory
true
```

调用方拿到的消息从高层意图（加载配置）一直讲到底层原因（文件不存在），而 `%w` 又把底层的错误
保留在错误树中，调用方可以用 `errors.Is` 判断具体原因。消息供人阅读，错误树供程序检查，二者
互不妨碍。

这里有一条值得遵守的规则：每一层只描述本层的操作，不重复下层已经说过的内容。`os.ReadFile`
返回的 `*fs.PathError` 已经包含了操作与路径，若再写成 `fmt.Errorf("load config %s: %w", path, err)`，
路径就会在消息中出现两次；而 `json.Unmarshal` 的错误并不知道数据来自哪个文件，路径就应当在这一层
补上。

这种逐层书写的上下文，与异常语言自动采集的调用栈不同。调用栈记录的是函数名与行号，是实现细节；
逐层写下的消息记录的是程序当时的意图，往往更能说明问题。代价是需要程序员在每个边界都记得包装，
漏掉一层，消息中便少了一段。

## 7.3.3 标准库的错误不带调用栈

`errors.New` 与 `fmt.Errorf` 都不记录调用栈。`errorString` 只有一个字符串字段，`wrapError` 只多了
一个指向下层错误的字段（见 [7.2.1](./inspect.md)）。

这是有意的选择。记录调用栈需要调用 `runtime.Callers` 回溯栈帧，打印时还要把程序计数器转换为函数名与行号。
下表是在 Go 1.26.10、Apple M5 Pro 上的测量结果：在调用深度为 10 与 30 的位置分别创建一个错误，一种用
`errors.New`，另一种在 `errors.New` 之外再用 `runtime.Callers` 记录至多 32 帧的程序计数器（不做符号化），
每项运行 5 次取中位数：

| 操作 | 深度 10 | 深度 30 |
| :-- | --: | --: |
| `errors.New` | 17.7 ns，1 次分配 | 34.1 ns，1 次分配 |
| `errors.New` 加 `runtime.Callers` | 322.0 ns，3 次分配 | 618.3 ns，3 次分配 |

仅记录程序计数器，开销就增加了一个数量级以上，并且随调用深度增长。许多错误属于预期之内的控制流，
例如 `io.EOF`，或者「未找到」这类结果，为它们一律记录调用栈并不值得。

Go 1.13 的开发周期中，错误值的实现原本包含帧信息：`fmt.Errorf` 与 `errors.New` 会记录调用位置，`%+v`
会打印出来。这部分在发布前被删除，原因见 [7.2.5](./inspect.md)
[[Neil and Amsterdam, 2019](#ref-neil-amsterdam-2019)]。此后标准库没有再加入这一功能，
调用栈留给需要它的程序自行添加。

## 7.3.4 为错误加上调用栈

需要调用栈的场合，社区早有成熟的方案。Dave Cheney 于 2015 年底创建的 `github.com/pkg/errors` 提供 `Wrap`
与 `WithStack`，在包装错误的同时记录调用栈，并约定以 `%+v` 打印带调用栈的详细信息
[[Cheney, 2016c](#ref-cheney-2016c)]。它的许多做法后来影响了标准库：Go 1.13 之前，`golang.org/x/xerrors`
作为试验场打磨了 `%w`、`Is`、`As` 与 `Unwrap` [[Go Authors, 2019](#ref-go-authors-2019)]，
其中的核心进入了标准库，调用栈则没有。随着 Go 2 错误提案的推进，`pkg/errors` 的 README
宣布该项目进入维护状态 [[Cheney, 2016d](#ref-cheney-2016d)]。

要让自定义的错误类型支持 `%+v` 这样的详细格式，需要实现 `fmt.Formatter` 接口
[[Go Authors, 2026](#ref-go-authors-2026)]：

```go
// src/fmt/print.go
type State interface {
	// Write 用于输出格式化的结果。
	Write(b []byte) (n int, err error)
	// Width 返回宽度选项的值，以及它是否被设置。
	Width() (wid int, ok bool)
	// Precision 返回精度选项的值，以及它是否被设置。
	Precision() (prec int, ok bool)

	// Flag 报告标志 c（一个字符）是否被设置。
	Flag(c int) bool
}

// Formatter 由任何具有 Format 方法的值实现。
// 由实现决定如何解释 State 与 rune，
// 并可以调用 Sprint 或 Fprint(f) 等来生成输出。
type Formatter interface {
	Format(f State, verb rune)
}
```

（注释为笔者所译。）实现了 `Format` 的类型完全接管自己被 `fmt` 打印时的行为：通过 `State` 写出
结果、查询标志，再根据动词与标志（例如 `f.Flag('+')`）决定输出简短的一行还是带调用栈的多行。
下面的程序定义了一个记录调用栈的错误类型：

```go {run=true}
package main

import (
	"errors"
	"fmt"
	"io/fs"
	"runtime"
	"strings"
)

// withStack 在创建时记录调用栈，以 %+v 打印时输出各帧的函数名
type withStack struct {
	err error
	pcs []uintptr
}

func wrapStack(err error) error {
	var pcs [32]uintptr
	n := runtime.Callers(2, pcs[:]) // 跳过 runtime.Callers 与 wrapStack 本身
	return &withStack{err, pcs[:n]}
}

func (w *withStack) Error() string { return w.err.Error() }
func (w *withStack) Unwrap() error { return w.err }

func (w *withStack) Format(s fmt.State, verb rune) {
	switch verb {
	case 'v':
		if s.Flag('+') {
			fmt.Fprint(s, w.err.Error())
			frames := runtime.CallersFrames(w.pcs)
			for {
				f, more := frames.Next()
				if strings.HasPrefix(f.Function, "main.") {
					fmt.Fprintf(s, "\n\t%s", f.Function)
				}
				if !more {
					break
				}
			}
			return
		}
		fallthrough
	case 's':
		fmt.Fprint(s, w.err.Error())
	}
}

func open(path string) error {
	return wrapStack(&fs.PathError{Op: "open", Path: path, Err: fs.ErrNotExist})
}

func loadConfig(path string) error {
	if err := open(path); err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	return nil
}

func main() {
	err := loadConfig("a.conf")
	fmt.Printf("%v\n", err)
	fmt.Printf("%+v\n", err) // 最外层的 *fmt.wrapError 不实现 Formatter
	if ws, ok := errors.AsType[*withStack](err); ok {
		fmt.Printf("%+v\n", ws)
	}
	fmt.Println(errors.Is(err, fs.ErrNotExist))
}
```

```
load config: open a.conf: file does not exist
load config: open a.conf: file does not exist
open a.conf: file does not exist
	main.open
	main.loadConfig
	main.main
true
```

程序的输出揭示了一个容易忽略的问题：调用栈记录在内层的 `withStack` 中，而最外层是 `fmt.Errorf`
生成的 `*fmt.wrapError`，它没有实现 `Formatter`，因此对整个错误使用 `%+v`，得到的仍然只是一行
消息。要打印调用栈，必须先用 `errors.AsType` 找到 `withStack`。`pkg/errors` 的做法是让自己的每一种
包装类型都实现 `Format`，以 `%+v` 打印时逐层递归；可一旦中间夹了一层标准库的 `%w` 包装，这条链
就断了。这也说明，调用栈之类的附加信息若不进入标准库的约定，就很难在不同来源的包装之间保持。

## 7.3.5 结构化日志：错误作为字段

以 `: ` 拼接的消息是写给人看的，不便于机器检索与统计。错误进入日志系统、需要按字段过滤与告警时，
一行字符串就显得不够。Go 1.21 加入的 `log/slog`（Jonathan Amsterdam，2023
年）[[Amsterdam, 2023](#ref-amsterdam-2023)]把日志从格式化的字符串改为键值对构成的记录，
错误可以作为一个字段记录下来。

`slog` 的 JSON 处理程序在输出一个值时，若该值是错误且没有实现 `json.Marshaler`，就输出它的
`Error()` 字符串：

```go
// src/log/slog/json_handler.go（appendJSONValue 节选）
case KindAny:
	a := v.Any()
	_, jm := a.(json.Marshaler)
	if err, ok := a.(error); ok && !jm {
		s.appendString(err.Error())
	} else {
		return appendJSONMarshal(s.buf, a)
	}
```

处理程序在输出之前会先解析实现了 `slog.LogValuer` 接口的值，因此一个错误类型可以通过实现
`LogValue` 方法，把自己展开为一组结构化的字段：

```go {run=true}
package main

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
)

// QueryError 实现了 slog.LogValuer，记录日志时展开为一组字段
type QueryError struct {
	Query string
	Code  int
	Err   error
}

func (e *QueryError) Error() string { return fmt.Sprintf("query %q: %v", e.Query, e.Err) }
func (e *QueryError) Unwrap() error { return e.Err }

func (e *QueryError) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("query", e.Query),
		slog.Int("code", e.Code),
		slog.String("cause", e.Err.Error()),
	)
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		// 去掉时间字段，使输出稳定
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey && len(groups) == 0 {
				return slog.Attr{}
			}
			return a
		},
	}))

	qe := &QueryError{Query: "select 1", Code: 1205, Err: errors.New("lock wait timeout")}
	logger.Error("query failed", "err", qe)

	wrapped := fmt.Errorf("handle request: %w", qe)
	logger.Error("request failed", "path", "/users", "err", wrapped)
}
```

```
{"level":"ERROR","msg":"query failed","err":{"query":"select 1","code":1205,"cause":"lock wait timeout"}}
{"level":"ERROR","msg":"request failed","path":"/users","err":"handle request: query \"select 1\": lock wait timeout"}
```

第二条记录再次出现了上一小节的问题：`QueryError` 一旦被 `%w` 包装，最外层的 `*fmt.wrapError` 不是
`LogValuer`，日志中只剩下一行字符串。`slog` 只看传给它的那个值，并不遍历错误树。若需要结构化的
字段，应当在记录日志之前用 `errors.AsType` 取出具体的错误。

`slog` 的便捷函数接受交替出现的键与值，例如 `slog.Info(msg, "path", p)`。漏写一个值，或者把
非字符串放在键的位置，编译器都不会报错。为此，Go 1.21 的 `go vet` 加入了 `slog` 检查
（6d4d71c5ab）。对下面两行代码：

```go
slog.Info("config loaded", "path", "a.conf", "retries")
slog.Warn("slow", 42, "ms")
```

`go vet` 报告：

```
main.go:6:2: call to slog.Info missing a final value
main.go:7:20: slog.Warn arg "42" should be a string or a slog.Attr (possible missing key or value)
```

用 `slog.String`、`slog.Int` 等函数显式构造 `slog.Attr`，可以从根本上避免这类错误。

## 7.3.6 比较与小结

Java 与 Python 的异常在创建或抛出时自动记录调用栈，上下文的获得不需要额外的代码，代价是每个异常都要付出采
集调用栈的开销，并且栈中充满实现细节，不表达业务语义。Rust 的 `Result` 与 Go 的错误一样默认不带调用栈；Rust
1.65（2022 年）稳定了 `std::backtrace::Backtrace` [[Rust, 2022](#ref-rust-2022)]，社区常用的
`anyhow` 与 `thiserror` 则分别提供不透明的错误与结构化的错误类型，按需附加上下文与调用栈，思路与 Go 的
`pkg/errors` 相近。

Go 的选择可以概括为三层：

- 标准库的错误不带调用栈，鼓励以 `%w` 逐层补充上下文。错误消息讲的是程序的意图，但需要程序员
  勤于包装，默认也拿不到调用栈。
- 需要调用栈时，用 `runtime.Callers` 与 `fmt.Formatter` 自行添加，或使用第三方库。代价是每次
  创建错误的开销，以及附加信息在不同来源的包装之间难以保持。
- 需要机器检索时，用 `log/slog` 把错误作为结构化字段记录，必要时实现 `LogValuer`。

## 延伸阅读

- <a id="ref-gerrand-2011"></a>[Gerrand, 2011] Andrew Gerrand. *Error handling and Go.* The Go Blog, 2011.
  https://go.dev/blog/error-handling-and-go
- <a id="ref-neil-amsterdam-2019"></a>[Neil and Amsterdam, 2019] Damien Neil, Jonathan Amsterdam. *Working
  with Errors in Go 1.13.* The Go Blog, 2019. https://go.dev/blog/go1.13-errors
  （`%w`、`Is`/`As`/`Unwrap` 的设计与取舍）
- <a id="ref-cheney-2016d"></a>[Cheney, 2016d] Dave Cheney. *github.com/pkg/errors*（`Wrap`/`WithStack`、`%+v`
  带栈打印）. https://github.com/pkg/errors ；
  <a id="ref-cheney-2016c"></a>[Cheney, 2016c] Dave Cheney. *Stack traces and the errors package.* 2016.
  https://dave.cheney.net/2016/06/12/stack-traces-and-the-errors-package
  （`pkg/errors` 栈轨迹设计的作者自述）
- <a id="ref-go-authors-2019"></a>[Go Authors, 2019] The Go Authors. *golang.org/x/xerrors*（Go 1.13
  错误特性的试验田）. https://pkg.go.dev/golang.org/x/xerrors
- <a id="ref-amsterdam-2023"></a>[Amsterdam, 2023] The Go Authors. *Package log/slog*（Go 1.21
  结构化日志）. https://pkg.go.dev/log/slog ；Jonathan Amsterdam. *Structured Logging with slog.* The Go
  Blog,
  2023. https://go.dev/blog/slog ；`go vet` 的 slog 检查：https://go.googlesource.com/go/+/6d4d71c5ab
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Package fmt*（`Formatter`、`State`
  接口）. https://pkg.go.dev/fmt#Formatter
- <a id="ref-honnef-nd"></a>[Honnef, n.d.] Dominik Honnef. *staticcheck ST1005: Incorrectly formatted
  error string.* https://staticcheck.dev/docs/checks#ST1005 （错误字符串大小写与标点的检查）
- <a id="ref-go-wiki-nd"></a>[Go Wiki, n.d.] The Go Authors. *Go Code Review Comments: Error Strings.*
  https://go.dev/wiki/CodeReviewComments#error-strings
- <a id="ref-go-authors-2009"></a>[Go Authors, 2009] The Go Authors. *Effective Go: Errors.*
  https://go.dev/doc/effective_go#errors
- <a id="ref-taylor-2020"></a>[Taylor, 2020] Ian Lance Taylor. *x/lint: freeze and deprecate.* 2020.
  https://go.dev/issue/38968
- <a id="ref-rust-2022"></a>[Rust, 2022] The Rust Release Team. *Announcing Rust 1.65.0.* 2022.
  https://blog.rust-lang.org/2022/11/03/Rust-1.65.0/
- 本书 [7.1 问题的演化](./value.md)、[7.2 错误值检查](./inspect.md)、[16
  工具与可观测性](../../part5toolchain/ch16tools).
