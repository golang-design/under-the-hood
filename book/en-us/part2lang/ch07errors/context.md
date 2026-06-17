---
weight: 2403
title: "7.3 Error Format and Context"
---

# 7.3 Error Format and Context

A good error does not merely say "something went wrong." It tells a person what was being done, on account of what, and what went wrong. The evolution of the problem ([7.1](./value.md)) and value inspection ([7.2](./inspect.md)) gave us the mechanisms for propagating and examining errors. This section discusses the engineering practice that sits on top of those mechanisms: how the text of an error should be written, how context accumulates layer by layer along the call chain, and how stack traces and structured logs can be added on demand when human-written words are not enough. Running through all of it is one overall tendency Go has regarding error information: human-written semantic context is preferable to machine-collected stack traces.

## 7.3.1 The `Error() string` Convention

The `error` interface requires only one method:

```go
type error interface {
    Error() string
}
```

Around this single method, the Go community has formed an unwritten yet ubiquitous style convention: error strings begin with a lowercase letter and carry no trailing punctuation. The reason behind the convention is quite practical. Errors rarely appear on their own; they are almost always wrapped layer upon layer, joined end to end into a longer string. Imagine three layers of calls each adding a sentence of context. What the end user finally sees is:

```
read config: open /etc/app.conf: permission denied
```

This is a causal chain of three error segments joined by `: `. If each segment were written like a sentence, with a capitalized first letter and a period at the end, joining them would produce "Read config: Open /etc/app.conf: Permission denied.", a string with uppercase letters and periods scattered through the middle of a sentence, fragmented and hard to read. Only lowercase fragments with no trailing punctuation can slot smoothly into any position and string together into a coherent chain. This convention is small, yet it is the precondition for Go error information to be joined layer by layer without losing readability.

One common claim needs clarifying: it is not `go vet` that checks this convention. Historically it was `golint`'s job, and after `golint` was archived, this check (numbered ST1005) was taken over by third-party tools such as `staticcheck`. `go vet` does not care about the capitalization of error strings, but it does have one check related to errors, aimed at the structured logging calls of `log/slog` (see 7.3.5).

## 7.3.2 Add Context at Every Boundary

As an error propagates upward from the lower layers, every time it crosses a meaningful boundary it should gain a sentence of "what I was doing at the time." This is the primary use of `%w` wrapping ([7.2](./inspect.md)), and a core practice of Go error handling. Below is a typical piece of configuration-loading code that annotates its intent at two different failure points:

```go
func loadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        // Annotate "which config file is being loaded", and use %w to retain the underlying error for inspection
        return nil, fmt.Errorf("load config %q: %w", path, err)
    }

    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        // A parse failure is a different kind of boundary, with different semantics to annotate
        return nil, fmt.Errorf("parse config %q: %w", path, err)
    }
    return &cfg, nil
}
```

When the file does not exist, what the caller ultimately receives is `load config "a.conf": open a.conf: no such file or directory`: a complete chain from high-level intent (loading the config) to low-level cause (the file cannot be opened). While `%w` spells out this readable text, it also keeps the underlying `fs.ErrNotExist` in the error tree, so the caller can both print the whole sentence to the user and use `errors.Is(err, fs.ErrNotExist)` ([7.2](./inspect.md)) to determine the specific cause. The text is for people, the structure is for programs, and the two do not conflict.

This layer-by-layer annotation is, in essence, exchanging human writing for semantics. In exception-based languages, the error is thrown all the way up, and the context along the way is automatically collected by the runtime into a stack trace. Go hands this task back to the programmer: each layer actively writes a sentence, and what is finally joined together is not a string of function names and line numbers, but a human-readable semantic chain describing "what the program was doing when it went wrong." The cost is that one must be diligent: every boundary has to remember to wrap, and missing one layer breaks a link in the chain. The benefit is that the error information often explains the problem better than a machine stack trace, because it speaks of business intent rather than implementation detail.

A discipline worth remembering: the wrapping text describes what this layer is doing, and should not restate what the layer below has already said. In `fmt.Errorf("load config %q: %w", path, err)`, `load config` is this layer's intent, and what follows `%w` is left to the layer below to tell about its own failure. Each of the two layers says its own part, with no duplication and no gap.

## 7.3.3 Standard Library Errors Carry No Stack

Layer-by-layer annotation is good, but when tracking down hard problems, people sometimes still want a machine stack trace to know exactly which line the error emerged from. The standard library's `errors.New` and `fmt.Errorf` collect no stack by default:

```go
func New(text string) error {
    return &errorString{text}
}

type errorString struct {
    s string
}

func (e *errorString) Error() string { return e.s }
```

An `errorString` has only a single string field and nothing else. This is a deliberate trade-off, not an oversight. Collecting a stack trace requires `runtime.Callers` to walk back the call stack and then translate program counters into function names and line numbers, which is no small overhead on paths where errors are produced frequently (for example, using an error to express expected control flow such as "not found" or "reached the end"). Go's judgment is that the vast majority of errors have no use for a stack, and making the stack a default would make everyone pay for a minority of scenarios. So the standard library chooses the minimal error and leaves the stack for those who need it to add on demand. This is exactly the consistent stance of the Go standard library: a minimal core, extended on demand.

## 7.3.4 Adding the Stack and Diagnostic Information Back In

For scenarios that need a stack, the community has long had mature solutions. Dave Cheney's `github.com/pkg/errors` provides `WithStack` and `Wrap`, which record the current call stack while wrapping the error and establish the convention of printing the full diagnostics with the stack via `%+v`:

```go
import "github.com/pkg/errors"

func loadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, errors.Wrap(err, "load config") // record the call stack here
    }
    // ...
}

// Printed at a higher layer: fmt.Printf("%+v\n", err)
// Ordinary %v is still a single line "load config: open a.conf: ...",
// while %+v additionally lists, frame by frame, the function names and file line numbers.
```

`pkg/errors` proved one thing: wrapping, stack traces, and customizable print formats can be layered on top of the `error` interface without changing the language. Many of its ideas later flowed into the standard library. `golang.org/x/xerrors` was the testing ground before Go 1.13's error features officially landed; the prototypes of `%w` wrapping and `Is`/`As`/`Unwrap` were all refined there, and eventually their core was absorbed into the standard library's `errors` and `fmt` ([7.2](./inspect.md)), while the stack trace was left outside the standard library, provided on demand by third-party libraries.

To let a custom error type support rich output like `%+v`, the means is the `fmt.Formatter` interface:

```go
type Formatter interface {
    Format(f State, verb rune)
}
```

A type that implements `Format` can fully take over its own behavior when printed by `fmt`: through `State` it obtains the output target (`State` is also an `io.Writer`) and the format flags, then decides whether to print a brief single line or a multi-line stack based on the `verb` (`v`, `s`, and so on) and the flags (whether `f.Flag('+')` indicates `+` was set). An error type that carries a stack is roughly sketched like this:

```go
// Sketch: an error carrying a stack; ordinary printing is one line, %+v prints the stack
type withStack struct {
    err   error
    stack []uintptr // collected at construction time by runtime.Callers
}

func (w *withStack) Error() string { return w.err.Error() }
func (w *withStack) Unwrap() error { return w.err } // can still be seen through by Is/As

func (w *withStack) Format(s fmt.State, verb rune) {
    switch verb {
    case 'v':
        if s.Flag('+') { // %+v: first print the underlying error, then print the stack frame by frame
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
        fmt.Fprint(s, w.err.Error()) // %v / %s: print only one line
    }
}
```

In this way, the same error value prints as a concise single line in ordinary use, and during troubleshooting `%+v` expands it into diagnostics with a stack. `Format` makes "how detailed to print" a decision made at output time, rather than something fixed at the moment the error is produced.

## 7.3.5 Structured Logging: The Error as a Field

The chain of text concatenation has a ceiling: it is prose for human reading, not convenient for machine retrieval and aggregation. When the error enters a log and is to be filtered, counted, and alerted on by a monitoring system field by field, a single line of string looks clumsy. The `log/slog` introduced in Go 1.21 turns logging from a "format string" toward "structured records of key-value pairs," so an error can be recorded as a keyed field rather than stuffed into a sentence:

```go
import "log/slog"

func handle(path string) {
    cfg, err := loadConfig(path)
    if err != nil {
        // The error is a field named "err", and path is another field
        slog.Error("config load failed",
            slog.String("path", path),
            slog.Any("err", err),
        )
        return
    }
    _ = cfg
}
```

When output with the JSON Handler, this record looks like `{"level":"ERROR","msg":"config load failed", "path":"a.conf","err":"load config \"a.conf\": ..."}`. The `msg` is a stable, clusterable event name, while `path` and `err` are fields that can be retrieved and filtered. The semantic chain accumulated by layer-by-layer annotation now becomes the value of the `err` field, and the two practices join here: human-written context is responsible for "telling clearly what happened," and structured fields are responsible for "letting the machine find and count it." This is precisely the meeting point of error handling and observability ([16 Tooling and Observability](../../part5toolchain/ch16tools)).

The key-value interface of `slog` has a pitfall: it accepts alternating `key, value` variadic arguments, and missing a value or putting a non-string in a key position will not be reported at compile time, only surfacing at run time. The `slog` check of `go vet` mentioned earlier exists exactly for this; during static analysis it reports calls where keys and values do not match, for example a missing final value, or an integer placed in a key position. This section uses `slog.String` and `slog.Any` to explicitly construct `Attr`, which both avoids this pitfall and makes the field types clear at a glance.

## 7.3.6 Design Trade-offs and Lineage

To gather this section into a single sentence: Go leans toward human-written semantic context in error formatting, and makes the machine stack trace an optional item.

- The standard library carries no stack by default, encouraging layer-by-layer annotation with `%w`. Common errors are therefore highly readable and speak of business intent; the cost is that the programmer must be diligent about wrapping, and gets no stack by default.
- When a stack is needed, `fmt.Formatter` plus `runtime.Callers` suffices to layer on diagnostics with a stack. `pkg/errors` tooled this approach up, and its ideas, after being tested in `x/xerrors`, partly entered the standard library. Deep diagnostics are extended on demand, so the majority do not pay for the minority of scenarios.
- When machine queryability is needed, `log/slog` demotes the error to a structured field and connects it to the monitoring system.

Placed within the lineage, this stands in contrast to the route of exception-based languages. Java and Python exchange automatically collected stack traces for "zero-cost context," at the cost of stack traces that are verbose, filled with implementation detail, and unable to express business semantics. Rust's `Result` and `?` likewise carry no stack by default, and the community relies on libraries such as `anyhow` and `thiserror` to add context and (optional) backtraces, which is highly similar to Go's `pkg/errors` approach. A plain `Error() string` interface, paired with community conventions, `%w` wrapping, `fmt.Formatter`, and `log/slog`, supports the entire lineage from "one-sentence error" to "structured diagnostics with a stack." A minimal core, extended on demand, is a shape that recurs again and again in the Go standard library.

## Further Reading

1. Andrew Gerrand. *Error handling and Go.* Go Blog, 2011.
   https://go.dev/blog/error-handling-and-go
2. Russ Cox et al. *Working with Errors in Go 1.13.* Go Blog, 2019.
   https://go.dev/blog/go1.13-errors (the design and trade-offs of `%w`, `Is`/`As`/`Unwrap`)
3. Dave Cheney. *github.com/pkg/errors* (`Wrap`/`WithStack`, `%+v` printing with stack).
   https://github.com/pkg/errors ;
   *Stack traces and the errors package.* 2016.
   https://dave.cheney.net/2016/06/12/stack-traces-and-the-errors-package
   (the author's own account of the stack-trace design in `pkg/errors`)
4. The Go Authors. *golang.org/x/xerrors* (the testing ground for Go 1.13's error features).
   https://pkg.go.dev/golang.org/x/xerrors
5. The Go Authors. *Package log/slog* (Go 1.21 structured logging).
   https://pkg.go.dev/log/slog
6. The Go Authors. *Package fmt* (the `Formatter` and `State` interfaces).
   https://pkg.go.dev/fmt#Formatter
7. Dominik Honnef. *staticcheck ST1005: Incorrectly formatted error string.*
   https://staticcheck.dev/docs/checks#ST1005 (the check for capitalization and punctuation of error strings)
8. This book: [7.1 The Evolution of the Problem](./value.md), [7.2 Error Value Inspection](./inspect.md),
   [16 Tooling and Observability](../../part5toolchain/ch16tools).
