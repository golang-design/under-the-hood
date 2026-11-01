---
weight: 2403
title: "7.3 Error Formatting and Context"
---

# 7.3 Error Formatting and Context

A useful error message says what the program was doing and why it failed. [7.2](./inspect.md)
covered how a program inspects errors; this section covers how errors are presented to people: how
messages should be written, how context accumulates layer by layer along the call chain, and how
call stacks and structured logs fill in when hand-written context is not enough.

Go's inclination is that the programmer writes semantic context at each layer, rather than the
runtime collecting a call stack automatically. Errors in the standard library carry no call stack by
default; third-party libraries or user-defined types add one when needed.

## 7.3.1 Conventions for Error Messages

Go error messages follow a widely observed convention: start with a lowercase letter and end without
punctuation. The official Go Code Review Comments [[Go Wiki, n.d.](#ref-go-wiki-nd)] explain why:
error messages are usually printed after other context, as in
`log.Printf("Reading %s: %v", filename, err)`, and a capitalized message would leave a stray capital
letter in the middle of the sentence. The guidance adds that the convention does not apply to log
messages, which are line-oriented and are never embedded in other messages.

Error messages can therefore be concatenated layer by layer. Three calls each add a fragment, and
the result is a message separated by `: ` that runs from the high-level intent to the low-level
cause:

```
load config: open /etc/app.conf: permission denied
```

Effective Go also recommends [[Go Authors, 2009](#ref-go-authors-2009)] that error messages identify
their origin, for example by prefixing the name of the operation or package that produced them: when
the `image` package fails to decode an unknown format, the message is `image: unknown format`.
`os.PathError` is the model for this advice. Its message contains the operation, the file path and
the error returned by the system call, as in `open /etc/passwx: no such file or directory`, so it
remains informative even when printed far from where the failure occurred.

This convention used to be checked by `golint`. In May 2020 Ian Lance Taylor proposed freezing and
deprecating `golint` (go.dev/issue/38968), and its repository was subsequently archived
[[Taylor, 2020](#ref-taylor-2020)]; the same check is now provided by Staticcheck as ST1005
[[Honnef, n.d.](#ref-honnef-nd)]. `go vet` does not check how error messages are written.

## 7.3.2 Adding Context at Every Boundary

As an error propagates upward, each meaningful boundary it crosses should add a phrase saying what
that layer was doing. Andrew Gerrand wrote in a 2011 blog post that summarizing the context is the
responsibility of whoever implements the error [[Gerrand, 2011](#ref-gerrand-2011)]. This is the
main use of `%w`. The following function reads a configuration file and adds different context at
its two failure points:

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
		// The message of *fs.PathError already contains the path; do not repeat it
		return nil, fmt.Errorf("load config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		// json errors do not contain the path; add it here
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

The message the caller receives runs from the high-level intent (loading the configuration) down to
the low-level cause (the file does not exist), while `%w` keeps the underlying error in the error
tree, so the caller can use `errors.Is` to identify the specific cause. The message is for people
and the error tree is for programs; neither interferes with the other.

One rule is worth following: each layer describes only its own operation and does not repeat what
the layer below has already said. The `*fs.PathError` returned by `os.ReadFile` already contains the
operation and the path, so writing `fmt.Errorf("load config %s: %w", path, err)` would print the
path twice. The error from `json.Unmarshal` does not know which file the data came from, so the path
belongs at this layer.

Context written layer by layer differs from the call stack that exception-based languages collect
automatically. A call stack records function names and line numbers, which are implementation
details; the messages written at each layer record what the program intended to do, and often
explain more. The cost is that the programmer must remember to wrap at every boundary, and each
layer that is skipped leaves a gap in the message.

## 7.3.3 Standard Library Errors Carry No Call Stack

Neither `errors.New` nor `fmt.Errorf` records a call stack. `errorString` has a single string field,
and `wrapError` adds only a field pointing to the underlying error (see [7.2.1](./inspect.md)).

This is deliberate. Recording a call stack requires walking the stack frames with `runtime.Callers`,
and printing it requires converting program counters to function names and line numbers. The table
below shows measurements on Go 1.26.10 on an Apple M5 Pro. An error is created at call depths 10 and
30, once with `errors.New` and once with `errors.New` plus `runtime.Callers` recording up to 32
program counters (without symbolization); each entry is the median of 5 runs:

| Operation | Depth 10 | Depth 30 |
| :-- | --: | --: |
| `errors.New` | 17.7 ns, 1 allocation | 34.1 ns, 1 allocation |
| `errors.New` plus `runtime.Callers` | 322.0 ns, 3 allocations | 618.3 ns, 3 allocations |

Recording program counters alone raises the cost by more than an order of magnitude, and it grows
with call depth. Many errors are expected control flow, such as `io.EOF` or a "not found" result,
and recording a call stack for all of them is not worthwhile.

During the Go 1.13 development cycle, the error value implementation originally included frame
information: `fmt.Errorf` and `errors.New` recorded the call location, and `%+v` printed it. This
was removed before the release, for the reasons given in [7.2.5](./inspect.md)
[[Neil and Amsterdam, 2019](#ref-neil-amsterdam-2019)]. The standard library has not added the
feature since; call stacks are left to the programs that need them.

## 7.3.4 Adding Call Stacks to Errors

Where a call stack is needed, the community has long had mature solutions. `github.com/pkg/errors`,
created by Dave Cheney in late 2015, provides `Wrap` and `WithStack`, which record the call stack as
they wrap an error, and prints the detailed form with `%+v` by convention
[[Cheney, 2016c](#ref-cheney-2016c)]. Many of its ideas later influenced the standard library:
before Go 1.13, `golang.org/x/xerrors` served as a testing ground that refined `%w`, `Is`, `As` and
`Unwrap` [[Go Authors, 2019](#ref-go-authors-2019)]; the core of it entered the standard library,
but the call stack did not. As the Go 2 error proposals progressed, the `pkg/errors` README
announced that the project had entered maintenance mode [[Cheney, 2016d](#ref-cheney-2016d)].

For a custom error type to support a detailed format such as `%+v`, it must implement the
`fmt.Formatter` interface [[Go Authors, 2026](#ref-go-authors-2026)]:

```go
// src/fmt/print.go
type State interface {
	// Write is the function to call to emit formatted output to be printed.
	Write(b []byte) (n int, err error)
	// Width returns the value of the width option and whether it has been set.
	Width() (wid int, ok bool)
	// Precision returns the value of the precision option and whether it has been set.
	Precision() (prec int, ok bool)

	// Flag reports whether the flag c, a character, has been set.
	Flag(c int) bool
}

// Formatter is implemented by any value that has a Format method.
// The implementation controls how State and rune are interpreted,
// and may call Sprint or Fprint(f) etc. to generate its output.
type Formatter interface {
	Format(f State, verb rune)
}
```

A type that implements `Format` takes complete control of how `fmt` prints it: it writes the result
through `State`, queries the flags, and decides from the verb and flags (for example `f.Flag('+')`)
whether to print a short single line or multiple lines with a call stack. The following program
defines an error type that records the call stack:

```go {run=true}
package main

import (
	"errors"
	"fmt"
	"io/fs"
	"runtime"
	"strings"
)

// withStack records the call stack at creation and prints the function name of each frame with %+v
type withStack struct {
	err error
	pcs []uintptr
}

func wrapStack(err error) error {
	var pcs [32]uintptr
	n := runtime.Callers(2, pcs[:]) // skip runtime.Callers and wrapStack itself
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
	fmt.Printf("%+v\n", err) // the outermost *fmt.wrapError does not implement Formatter
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

The output reveals an easily overlooked problem. The call stack is recorded in the inner
`withStack`, while the outermost error is the `*fmt.wrapError` produced by `fmt.Errorf`, which does
not implement `Formatter`. Applying `%+v` to the whole error therefore still yields a single line of
message. To print the call stack, `errors.AsType` must first find the `withStack`. `pkg/errors`
handles this by having each of its own wrapper types implement `Format`, recursing layer by layer
when printed with `%+v`; but once a standard-library `%w` wrapper sits in the middle, the chain
breaks. It also shows that additional information such as a call stack is hard to preserve across
wrappers from different sources unless it becomes part of the standard library's conventions.

## 7.3.5 Structured Logging: Errors as Fields

A message concatenated with `: ` is written for people and is hard to search or aggregate by
machine. Once an error enters a logging system and must be filtered and alerted on by field, a
single string is not enough. `log/slog`, added in Go 1.21 (Jonathan Amsterdam, 2023)
[[Amsterdam, 2023](#ref-amsterdam-2023)], turns logging from formatted strings into records made of
key-value pairs, and an error can be recorded as one of the fields.

When the JSON handler of `slog` outputs a value that is an error and does not implement
`json.Marshaler`, it outputs the string returned by `Error()`:

```go
// src/log/slog/json_handler.go (excerpt from appendJSONValue)
case KindAny:
	a := v.Any()
	_, jm := a.(json.Marshaler)
	if err, ok := a.(error); ok && !jm {
		s.appendString(err.Error())
	} else {
		return appendJSONMarshal(s.buf, a)
	}
```

Before output, the handler resolves values that implement the `slog.LogValuer` interface, so an
error type can expand itself into a group of structured fields by implementing the `LogValue`
method:

```go {run=true}
package main

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
)

// QueryError implements slog.LogValuer and expands into a group of fields when logged
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
		// drop the time field to keep the output stable
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

The second record shows the problem from the previous subsection again: once `QueryError` is wrapped
with `%w`, the outermost `*fmt.wrapError` is not a `LogValuer`, and only a single string remains in
the log. `slog` looks only at the value passed to it and does not traverse the error tree. To obtain
structured fields, extract the concrete error with `errors.AsType` before logging.

The convenience functions of `slog` accept alternating keys and values, as in
`slog.Info(msg, "path", p)`. Omitting a value, or placing a non-string where a key belongs, produces
no compiler error. For this reason `go vet` gained a `slog` check in Go 1.21 (6d4d71c5ab). For the
following two lines:

```go
slog.Info("config loaded", "path", "a.conf", "retries")
slog.Warn("slow", 42, "ms")
```

`go vet` reports:

```
main.go:6:2: call to slog.Info missing a final value
main.go:7:20: slog.Warn arg "42" should be a string or a slog.Attr (possible missing key or value)
```

Constructing `slog.Attr` values explicitly with functions such as `slog.String` and `slog.Int`
avoids this class of error altogether.

## 7.3.6 Comparison and Summary

Exceptions in Java and Python record the call stack automatically when created or thrown, so context
comes without extra code; the price is that every exception pays for collecting a call stack, and
the stack is full of implementation details that carry no business meaning. Rust's `Result`, like
Go's errors, carries no call stack by default; Rust 1.65 (2022) stabilized
`std::backtrace::Backtrace` [[Rust, 2022](#ref-rust-2022)], and the community crates `anyhow` and
`thiserror` provide an opaque error type and structured error types respectively, attaching context
and call stacks on demand, much as `pkg/errors` does in Go.

Go's choice can be summarized in three layers:

- Standard library errors carry no call stack and encourage supplying context layer by layer with
  `%w`. The messages describe the program's intent, but they depend on programmers wrapping
  diligently, and no call stack is available by default.
- When a call stack is needed, add one yourself with `runtime.Callers` and `fmt.Formatter`, or use a
  third-party library. The costs are the overhead of each error creation and the difficulty of
  preserving the additional information across wrappers from different sources.
- When machine searching is needed, record the error as a structured field with `log/slog`,
  implementing `LogValuer` where necessary.

## Further Reading

- <a id="ref-gerrand-2011"></a>[Gerrand, 2011] Andrew Gerrand. *Error handling and Go.* The Go
  Blog, 2011. https://go.dev/blog/error-handling-and-go
- <a id="ref-neil-amsterdam-2019"></a>[Neil and Amsterdam, 2019] Damien Neil, Jonathan Amsterdam.
  *Working with Errors in Go 1.13.* The Go Blog, 2019. https://go.dev/blog/go1.13-errors (the design
  and trade-offs of `%w` and `Is`/`As`/`Unwrap`)
- <a id="ref-cheney-2016d"></a>[Cheney, 2016d] Dave Cheney. *github.com/pkg/errors*
  (`Wrap`/`WithStack`, printing with the stack via `%+v`). https://github.com/pkg/errors
  ; <a id="ref-cheney-2016c"></a>[Cheney, 2016c] Dave Cheney. *Stack traces and the errors
  package.* 2016. https://dave.cheney.net/2016/06/12/stack-traces-and-the-errors-package (the
  author's own account of the stack trace design in `pkg/errors`)
- <a id="ref-go-authors-2019"></a>[Go Authors, 2019] The Go Authors. *golang.org/x/xerrors* (the
  testing ground for the Go 1.13 error features). https://pkg.go.dev/golang.org/x/xerrors
- <a id="ref-amsterdam-2023"></a>[Amsterdam, 2023] The Go Authors. *Package log/slog* (structured
  logging in Go 1.21). https://pkg.go.dev/log/slog ; Jonathan Amsterdam. *Structured Logging with
  slog.* The Go Blog,
  2023. https://go.dev/blog/slog ; the `go vet` slog check:
        https://go.googlesource.com/go/+/6d4d71c5ab
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Package fmt* (the `Formatter`
  and `State` interfaces). https://pkg.go.dev/fmt#Formatter
- <a id="ref-honnef-nd"></a>[Honnef, n.d.] Dominik Honnef. *staticcheck ST1005: Incorrectly
  formatted error string.* https://staticcheck.dev/docs/checks#ST1005 (the check for capitalization
  and punctuation of error strings)
- <a id="ref-go-wiki-nd"></a>[Go Wiki, n.d.] The Go Authors. *Go Code Review Comments: Error
  Strings.* https://go.dev/wiki/CodeReviewComments#error-strings
- <a id="ref-go-authors-2009"></a>[Go Authors, 2009] The Go Authors. *Effective Go: Errors.*
  https://go.dev/doc/effective_go#errors
- <a id="ref-taylor-2020"></a>[Taylor, 2020] Ian Lance Taylor. *x/lint: freeze and deprecate.* 2020.
  https://go.dev/issue/38968
- <a id="ref-rust-2022"></a>[Rust, 2022] The Rust Release Team. *Announcing Rust 1.65.0.* 2022.
  https://blog.rust-lang.org/2022/11/03/Rust-1.65.0/
- This book: [7.1 The Evolution of the Problem](./value.md),
  [7.2 Inspecting Error Values](./inspect.md),
  [16 Tooling and Observability](../../part5toolchain/ch16tools).
