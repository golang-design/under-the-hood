---
weight: 2401
title: "7.1 The Evolution of the Problem"
---

# 7.1 The Evolution of the Problem

An error in a program is a situation the program anticipates but cannot complete normally: a file
does not exist, a connection is refused, an input is malformed. How a routine tells its caller about
such a situation, and how the caller responds, is a long-standing question in language design. There
are broadly two traditions: one hands the error to the caller as a return value, the other treats it
as an exception that propagates up the call stack to a handler. Go belongs to the first tradition.
It defines the error as an ordinary interface type that the caller checks explicitly.

This section first reviews the theoretical sources of the two traditions. It then follows the commit
history of the Go repository to trace the `error` type from 2008 to Go 1, explains how `error` is
defined in the language, and states what the claim "errors are values" means. Finally it points out
the problem left by early error-checking practice: attaching context and preserving an error's
identity are hard to achieve together. Go 1.13 resolved this problem; see
[7.2 Inspecting Error Values](./inspect.md).

## 7.1.1 Two Traditions

The classic case of reporting errors through return values is the Unix system call: a failing call
returns `-1` and stores the specific cause in the global variable `errno`. This is simple, but it
has two costs. First, the error information shares a return value with the normal result, so `-1` is
both a number and a failure marker. Second, the caller may ignore the return value entirely, and the
compiler cannot prevent it.

The systematic treatment of exception handling begins with John Goodenough's 1975 CACM paper
*Exception Handling: Issues and a Proposed Notation* [[Goodenough, 1975](#ref-goodenough-1975)]. The
paper classifies exceptions, lists the requirements a handler should meet, and distinguishes two
destinations for control flow once an exception has been handled: resume execution where the
exception was raised (the resumption model), or terminate the operation that raised it (the
termination model). CLU, and later mainstream languages such as C++ and Java, adopted the
termination model.

The 1979 paper *Exception Handling in CLU* by Barbara Liskov and Alan Snyder
[[Liskov and Snyder, 1979](#ref-liskov-snyder-1979)] describes the exception mechanism of CLU, which
resembles Go's error handling in many respects. According to the CLU reference manual of October
1979 [[Liskov et al., 1979](#ref-liskov-et-al-1979)], the exceptions a routine may signal are part
of its type; for example, `string$fetch` has the type
`proctype (string, int) returns (char) signals (bounds)`. A signaled exception always goes to the
immediate caller and must be handled there. A caller that wants to pass it further up must signal it
again explicitly with a `resignal` statement. An unhandled exception is converted to `failure`,
which indicates that some lower-level abstraction failed in an unexpected way. Replace "goes to the
immediate caller" with "is the last return value", `resignal` with `return err`, and `failure` with
`panic`, and the result is nearly Go's practice. The difference is that a CLU exception is still a
control structure, whereas a Go error is just a value.

C++ and Java went in another direction: an exception propagates automatically across any number of
stack frames until it meets a `catch` of a matching type. Java also introduced checked exceptions,
which require a method to declare the exceptions it may throw with `throws` in its signature. This
design later drew heavy criticism. In a 2003 interview explaining why C# did not adopt checked
exceptions, Anders Hejlsberg, the chief designer of C#, named two problems: versionability, since
adding an exception to a method in a new version breaks existing callers; and scalability, since in
a large system every layer aggregates the exceptions of the layers below and the `throws` clauses
grow out of control [[Venners and Eckel, 2003](#ref-venners-eckel-2003)].

Looking back in 2016 at the error model of Microsoft's Midori operating system
[[Duffy, 2016](#ref-duffy-2016)], Joe Duffy drew another key distinction: **recoverable errors**
versus **bugs**. The former usually arise from the program validating data, such as invalid input,
and the program should handle them. The latter are errors the programmer did not anticipate, such as
an out-of-range array index or a nil pointer dereference; the program cannot recover from them
reliably and so should not try. Go's design matches this distinction: recoverable errors are
returned as `error` values, and bugs raise a panic (see
[6.3 The panic and recover Builtins](../ch06func/panic.md) and
[[Gerrand, 2010](#ref-gerrand-2010)]). The Go FAQ's explanation of why Go has no exceptions is
covered in 6.3.7 and is not repeated here.

## 7.1.2 The Origin of error

Go's error type did not start out as it is today. The commit history shows three stages.

The first was returning an `errno`. On September 10, 2008, Rob Pike committed the first sketch of
the `os` package (795004c6b5) [[Pike, 2008a](#ref-pike-2008a)], whose functions handed the error
number returned by the system call straight to the caller:

```go
// src/lib/os/os_file.go (September 2008; the syntax differed from today's)
export func Read(fd int64, b *[]byte) (ret int64, errno int64) {
	r, e := syscall.read(fd, &b[0], int64(len(b)));  // BUG: should be able to return directly
	return r, e
}
```

Later the same day, Pike committed an error type (92ae2cc8a3) [[Pike, 2008b](#ref-pike-2008b)], with
the commit message "add an Error type to be used as a singleton pointer". `ErrnoToError` creates
exactly one `*Error` for each error number, so whether two errors are the same can be decided by
comparing pointers; `nil` means no error:

```go
// src/lib/os/os.go (September 2008)
// Errors are singleton structures. Use the Print()/String() methods to get
// their contents; they handle the nil (no error) case.
export type Error struct {
	s string
}

var ErrorTab = new(map[int64] *Error);

func ErrnoToError(errno int64) *Error {
	if errno == 0 {
		return nil
	}
	err, ok := ErrorTab[errno]
	if ok {
		return err
	}
	e := new(Error);
	e.s = syscall.errstr(errno);
	ErrorTab[errno] = e;
	return e;
}

export func Read(fd int64, b *[]byte) (ret int64, err *Error) {
	r, e := syscall.read(fd, &b[0], int64(len(b)));
	return r, ErrnoToError(e)
}
```

(The comment is paraphrased from the original.) Marking a class of errors with a unique value and
comparing it with `==`, later called a sentinel error, was thus Go's earliest form of error.

The second stage was the interface. On April 17, 2009, Pike completed in steps a change he called
the "Big Error Shift". The first step (aaf63f8d06) [[Pike, 2009](#ref-pike-2009)] turned `os.Error`
from a struct into an interface:

```go
// src/lib/os/error.go (April 2009)
// Error can represent any printable error condition.
type Error interface {
	String() string
}
```

The second step (45ed7297e8) turned the error numbers into a type `Errno` that implements the
interface, so `os.EPERM`, `os.ENOENT` and the like were no longer pointers obtained from a table but
`Errno` values. From then on any type with a `String() string` method could serve as an error, and
an error's representation was no longer confined to a string. In June of that year Russ Cox
introduced `os.EOF` (64684cc2a2).

The third stage was the builtin `error` of Go 1. On November 1, 2011, Russ Cox committed a group of
changes on a single day: adding the predeclared type `error` to the language specification
(d9877e22fe), implementing it in the compiler (2a0e15d36c), creating the `errors` package with a
single function, `New` (e4ae30f5f5), and adding `EOF` to the `io` package in place of the old
`os.EOF` (c06cf03f0b) [[Cox, 2011](#ref-cox-2011)]. The Go 1 release notes
[[Go Authors, 2012](#ref-go-authors-2012)] explain the reasoning. Errors first appeared when the
`os` package was implemented and seemed tied to the operating system, so they were placed in `os`.
It later became clear that errors are more fundamental than the operating system: `syscall`, on
which `os` depends, also needs errors, and keeping them in `os` would introduce unnecessary
dependencies into many packages. The method was renamed from `String` to `Error` so that a type that
merely implements the common `String` method would not satisfy the error interface by accident.

One more detail deserves mention. The 2009 `os.NewError` deduplicated by string, so two calls with
the same text returned the same error. The `errors.New` of Go 1 allocates a new `errorString` on
every call, and the Go 1.26 documentation states explicitly that each call to `New` returns a
distinct error value even if the text is identical. The identity of a sentinel error therefore lies
in the pointer held by its variable, not in its text.

## 7.1.3 error in the Language

The Go language specification [[Go Authors, 2026](#ref-go-authors-2026)] lists `error` as a
predeclared type, defined as:

```go
type error interface {
	Error() string
}
```

In the type checker, `error` is defined in the universe block, like `int` and `string`. In Go 1.26,
`types2` constructs it as follows:

```go
// src/cmd/compile/internal/types2/universe.go
// type error interface{ Error() string }
{
	obj := NewTypeName(nopos, nil, "error", nil)
	typ := (*Checker)(nil).newNamed(obj, nil, nil)

	// error.Error() string
	recv := newVar(RecvVar, nopos, nil, "", typ)
	res := newVar(ResultVar, nopos, nil, "", Typ[String])
	sig := NewSignatureType(recv, nil, nil, nil, NewTuple(res), false)
	err := NewFunc(nopos, nil, "Error", sig)

	// interface{ Error() string }
	ityp := &Interface{methods: []*Func{err}, complete: true}
	computeInterfaceTypeSet(nil, nopos, ityp) // prevent races due to lazy computation of the type set

	typ.fromRHS = ityp
	typ.Underlying()
	def(obj)
}
```

(The comment is paraphrased from the original.) `error` is a named type whose underlying type is an
interface with a single method, and its package is empty. This differs from `any`, which is merely
an alias for `interface{}`. Apart from being predeclared, `error` is no different from a
user-defined interface: it can be embedded in other interfaces (`net.Error` embeds `error`, for
instance), compared with `==`, and stored in slices and maps.

At run time, `error` is a non-empty interface, represented as the `iface` described in 4.2.1 of
[4.2 Interfaces](../ch04type/interface.md): a pointer to the interface table `itab` plus a data
pointer. An `error` equals `nil` only when both words are `nil`. This gives rise to a common
pitfall: a function returns a nil pointer of a concrete type, and the resulting `error` does not
equal `nil`. Section 4.2.2 analyzes this phenomenon with `error` as the example, and the Go FAQ has
a dedicated entry, *Why is my nil error value not equal to nil?*.

## 7.1.4 Errors Are Values

That `error` is an ordinary value is often underrated. Andrew Gerrand's 2011 blog post
[[Gerrand, 2011](#ref-gerrand-2011)] already took this as its starting point for introducing Go's
error handling. In his January 2015 post *Errors are values* [[Pike, 2015](#ref-pike-2015)], Rob
Pike recalls that at GoCon in Tokyo in autumn 2014, an attendee raised once more the familiar
complaint that error-checking code is too repetitive. Pike argues that programmers who hold this
view overlook a basic fact: errors are values. Values can be programmed, and since errors are
values, errors can be programmed.

The example in the post is a sequence of writes. Checking for an error after every write is verbose,
but one can define a type that records the first error, skips all later writes, and checks once at
the end:

```go {run=true}
package main

import (
	"errors"
	"fmt"
	"io"
	"os"
)

// errWriter records the first write error; later writes are not performed
type errWriter struct {
	w   io.Writer
	err error
}

func (ew *errWriter) write(buf []byte) {
	if ew.err != nil {
		return
	}
	_, ew.err = ew.w.Write(buf)
}

// quotaWriter returns an error once n bytes have been written
type quotaWriter struct{ n int }

func (q *quotaWriter) Write(p []byte) (int, error) {
	if len(p) > q.n {
		return 0, errors.New("quota exceeded")
	}
	q.n -= len(p)
	return os.Stdout.Write(p)
}

func main() {
	ew := &errWriter{w: &quotaWriter{n: 8}}
	ew.write([]byte("head\n"))
	ew.write([]byte("body\n")) // over quota; this and later writes are skipped
	ew.write([]byte("tail\n"))
	if ew.err != nil {
		fmt.Println("error:", ew.err)
	}
}
```

```
head
error: quota exceeded
```

The standard library does the same. The `Scan` method of `bufio.Scanner` returns only a boolean; an
error met during scanning is kept inside the `Scanner` and retrieved once after the loop through the
`Err` method. After one write fails, `bufio.Writer` returns the same error from every later write
and from `Flush`. What these examples share is that the error is kept as state and checked later,
rather than tested immediately every time. Pike also cautions at the end of the post that errors
must be checked whatever the style. Only the way the check is written is simplified; the check
itself cannot be omitted.

## 7.1.5 The Dilemma of Checking

Since errors are values, a caller needs a way to decide whether a given error is the one it cares
about. Before Go 1.13 there were three common approaches.

The first is comparing with a sentinel error, such as `err == io.EOF`. The second is a type
assertion on a custom error type, such as `err.(*os.PathError)`, to reach its fields. The third is
searching for a substring in the string returned by `err.Error()`. The third is the least advisable:
it depends on error text meant for humans, and once the text changes the check silently stops
working.

The first two have their own hazards. A sentinel error is an exported variable, not a constant, and
any code that imports the package can overwrite it. Dave Cheney made this point in his 2016 article
*Constant errors* and proposed constant errors with a string underlying type as an alternative
[[Cheney, 2016e](#ref-cheney-2016e)]. The following program demonstrates these properties:

```go {run=true}
package main

import (
	"errors"
	"fmt"
	"io"
)

// constErr has a string underlying type, so it can be declared as a constant
type constErr string

func (e constErr) Error() string { return string(e) }

const ErrClosed = constErr("closed")

func main() {
	// errors.New returns a different pointer each time; equal text is not equal
	fmt.Println(errors.New("EOF") == errors.New("EOF"))

	// an exported sentinel is a variable; code outside the package can overwrite it
	saved := io.EOF
	io.EOF = errors.New("EOF")
	fmt.Println(saved == io.EOF)
	io.EOF = saved

	// a constant error compares by value and cannot be overwritten
	var err error = constErr("closed")
	fmt.Println(err == ErrClosed)

	// once context is attached with %v, the result no longer equals the original
	wrapped := fmt.Errorf("read config: %v", io.EOF)
	fmt.Println(wrapped == io.EOF, wrapped)
}
```

```
false
false
true
false read config: EOF
```

The more fundamental problem is on the last line. As an error propagates upward from a low layer,
each layer usually wants to add a phrase of context saying what it was doing. But once `fmt.Errorf`
with `%v` formats the lower error into a new message, the result is an entirely new error and the
original identity is lost: `==` no longer holds, and type assertions no longer match. The caller
faces a dilemma. Attach context and lose the ability to inspect the root cause, or keep the ability
to inspect and forgo the context.

The community made many attempts at this. `github.com/pkg/errors`, which Dave Cheney created in late
2015, wraps errors with `Wrap`, retrieves the root cause with `Cause`, and records the call stack at
wrapping time; it was widely adopted [[Cheney, 2016d](#ref-cheney-2016d)]. In August 2018 the Go
team published two draft designs for Go 2, on error handling and on error values
[[Lohuizen, 2018](#ref-lohuizen-2018)]. The problem overview that Russ Cox wrote for the error
values draft [[Cox, 2018](#ref-cox-2018)] observes that wrapping an error, whether with `fmt.Errorf`
or with a new type, breaks equality comparison and type assertions. That discourages people from
wrapping errors, and error information ends up less useful. What finally landed was the Go 1.13
design [[Neil, 2019](#ref-neil-2019)] [[Neil and Amsterdam, 2019](#ref-neil-amsterdam-2019)]: the
`%w` verb of `fmt.Errorf` preserves the wrapped error [[Cox, 2019a](#ref-cox-2019a)], and
`errors.Is` and `errors.As` inspect along the wrapping chain. The implementation of this mechanism
is in [7.2 Inspecting Error Values](./inspect.md), the organization of error messages and context is
in [7.3 Error Formatting and Context](./context.md), and the form in which library authors should
expose errors is in [7.4 Error Semantics](./semantics.md).

## 7.1.6 Timeline

| Date | Version | Change | Main contributors |
| :-- | :-- | :-- | :-- |
| September 2008 | early development | `os` functions return `errno int64`; changed the same day to a singleton `*os.Error` | Rob Pike |
| April 2009 | early development | `os.Error` becomes an interface with the method `String() string` | Rob Pike |
| November 2011 | Go 1 | builtin `error` with the method `Error() string`; the `errors` package; `io.EOF` | Russ Cox |
| January 2015 | | blog post *Errors are values* | Rob Pike |
| August 2018 | | Go 2 draft designs for error handling and error values | Russ Cox, Marcel van Lohuizen, Jonathan Amsterdam, Damien Neil |
| July 2019 | | the `try` proposal is declined | Robert Griesemer |
| September 2019 | Go 1.13 | `%w`; `errors.Unwrap`, `Is`, `As` | Marcel van Lohuizen, Damien Neil, Jonathan Amsterdam |
| February 2023 | Go 1.20 | `errors.Join`; `fmt.Errorf` supports multiple `%w` | Damien Neil |
| August 2023 | Go 1.21 | `errors.ErrUnsupported` | Andy Pan |
| June 2025 | | decision to stop pursuing dedicated syntax for error handling | Robert Griesemer |
| February 2026 | Go 1.26 | the generic `errors.AsType` | Julien Cretel |

In this timeline the language itself changed only once, when Go 1 introduced the builtin `error`;
every later improvement happened in the standard library. The `error` interface has always had a
single method, and the added capabilities rest on optional conventions, for instance that an error
may implement one more method, `Unwrap` [[Go Authors, 2023](#ref-go-authors-2023)]. In a 2019 post
Russ Cox summarized Go's way of evolving as "experiment, simplify, ship", and explained that the
`check` and `try` experiments were abandoned because it was not clear they would make Go development
simpler overall [[Cox, 2019b](#ref-cox-2019b)]. The syntaxes proposed to reduce `if err != nil` were
rejected one by one [[Griesemer, 2019](#ref-griesemer-2019)]; that history is in
[7.5 The Future of Error Handling](./future.md).

## Further Reading

- <a id="ref-goodenough-1975"></a>[Goodenough, 1975] John B. Goodenough. *Exception Handling: Issues
  and a Proposed Notation.* Communications of the ACM 18(12):683–696, 1975.
  https://doi.org/10.1145/361227.361230
- <a id="ref-liskov-snyder-1979"></a>[Liskov and Snyder, 1979] Barbara Liskov, Alan Snyder.
  *Exception Handling in CLU.* IEEE Transactions on Software Engineering SE-5(6):546–558, 1979.
  https://doi.org/10.1109/TSE.1979.230191
- <a id="ref-liskov-et-al-1979"></a>[Liskov et al., 1979] Barbara Liskov et al. *CLU Reference
  Manual.* MIT/LCS/TR-225, 1979 (Chapter 12, Exception Handling and Exits).
  https://bitsavers.org/pdf/mit/lcs/tr/MIT-LCS-TR-0225.pdf
- <a id="ref-venners-eckel-2003"></a>[Venners and Eckel, 2003] Bill Venners, Bruce Eckel. *The
  Trouble with Checked Exceptions: A Conversation with Anders Hejlsberg, Part II.* Artima, 2003.
  https://www.artima.com/articles/the-trouble-with-checked-exceptions
- <a id="ref-duffy-2016"></a>[Duffy, 2016] Joe Duffy. *The Error Model.* 2016.
  https://joeduffyblog.com/2016/02/07/the-error-model/
- <a id="ref-gerrand-2010"></a>[Gerrand, 2010] Andrew Gerrand. *Defer, Panic, and Recover.* The Go
  Blog,
  2010. https://go.dev/blog/defer-panic-and-recover
  (background for the "truly exceptional" branch beside the value camp; see
  [6.3 The panic and recover Builtins](../ch06func/panic.md))
- <a id="ref-pike-2008a"></a>[Pike, 2008a] Rob Pike. *rudimentary beginnings of soon-to-be-real os
  library.* Go commit 795004c6b5, 2008. https://go.googlesource.com/go/+/795004c6b5
- <a id="ref-pike-2008b"></a>[Pike, 2008b] Rob Pike. *add an Error type to be used as a singleton
  pointer.* Go commit 92ae2cc8a3, 2008. https://go.googlesource.com/go/+/92ae2cc8a3
- <a id="ref-pike-2009"></a>[Pike, 2009] Rob Pike. *Step 1 of the Big Error Shift.* Go commit
  aaf63f8d06,
  2009. https://go.googlesource.com/go/+/aaf63f8d06 ; Step 2:
  https://go.googlesource.com/go/+/45ed7297e8
- <a id="ref-cox-2011"></a>[Cox, 2011] Russ Cox. *errors: new package.* Go commit e4ae30f5f5, 2011.
  https://go.googlesource.com/go/+/e4ae30f5f5 ; *spec: add error*:
  https://go.googlesource.com/go/+/d9877e22fe
- <a id="ref-go-authors-2012"></a>[Go Authors, 2012] The Go Authors. *Go 1 Release Notes: The error
  type and errors package.* 2012. https://go.dev/doc/go1#errors
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Go programming language
  specification: Errors* and *src/errors/*, *src/fmt/errors.go.* https://go.dev/ref/spec ;
  https://github.com/golang/go/tree/master/src/errors ; Go 1.26
  [src/errors/errors.go](https://github.com/golang/go/blob/release-branch.go1.26/src/errors/errors.go)
- <a id="ref-pike-2015"></a>[Pike, 2015] Rob Pike. *Errors are values.* The Go Blog, 2015.
  https://go.dev/blog/errors-are-values
- <a id="ref-gerrand-2011"></a>[Gerrand, 2011] Andrew Gerrand. *Error handling and Go.* The Go
  Blog, 2011. https://go.dev/blog/error-handling-and-go
- <a id="ref-cheney-2016e"></a>[Cheney, 2016e] Dave Cheney. *Constant errors.* 2016.
  https://dave.cheney.net/2016/04/07/constant-errors
- <a id="ref-cheney-2016d"></a>[Cheney, 2016d] Dave Cheney. *pkg/errors: Simple error handling
  primitives.* https://github.com/pkg/errors
- <a id="ref-lohuizen-2018"></a>[Lohuizen, 2018] Marcel van Lohuizen. *Error Handling, Draft Design
  (check/handle).* 2018.
  https://go.googlesource.com/proposal/+/master/design/go2draft-error-handling.md
- <a id="ref-cox-2018"></a>[Cox, 2018] Russ Cox. *Error Values, Problem Overview.* 2018.
  https://github.com/golang/proposal/blob/master/design/go2draft-error-values-overview.md
  (overview of the evolution problem behind "errors are values" in the Go 2 drafts)
- <a id="ref-neil-2019"></a>[Neil, 2019] Damien Neil. *Go 1.13 launch decision about error
  values.* 2019. https://github.com/golang/go/issues/29934#issuecomment-489682919
  ; <a id="ref-cox-2019a"></a>[Cox, 2019a] Russ Cox. *Response regarding "proposal: Go 2 error
  values".*
  2019. https://github.com/golang/go/issues/29934#issuecomment-490087200
  (the key decision discussions before `%w`, `Is` and `As` took their final shape)
- <a id="ref-neil-amsterdam-2019"></a>[Neil and Amsterdam, 2019] Damien Neil, Jonathan Amsterdam.
  *Working with Errors in Go 1.13.* The Go Blog, 2019. https://go.dev/blog/go1.13-errors (`%w`,
  `Unwrap`, `Is`, `As`)
- <a id="ref-cox-2019b"></a>[Cox, 2019b] Russ Cox. *Experiment, Simplify, Ship.* The Go Blog, 2019.
  https://go.dev/blog/experiment
- <a id="ref-griesemer-2019"></a>[Griesemer, 2019] Robert Griesemer. *Proposal: A built-in Go error
  check function, "try" (golang/go#32437).* 2019. https://github.com/golang/go/issues/32437 (the
  declined `try` proposal; the proposal review committee's statement is at
  https://github.com/golang/go/issues/32437#issuecomment-512035919 )
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. *Go 1.20 Release Notes:
  errors.*
  2023. https://go.dev/doc/go1.20#errors (`errors.Join` and multiple `%w`)
- This book: [6.3 The panic and recover Builtins](../ch06func/panic.md),
  [7.2 Inspecting Error Values](./inspect.md), [7.5 The Future of Error Handling](./future.md).
