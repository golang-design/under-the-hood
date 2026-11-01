---
weight: 2405
title: "7.5 The Future of Error Handling"
---

# 7.5 The Future of Error Handling

The improvements covered in the previous sections, `%w`, `errors.Is`, `errors.As` and the like,
address how errors are inspected and how they carry context. One question has stayed open
throughout: can the boilerplate of `if err != nil` be made shorter with new syntax? Between 2018 and
2025 the Go team put forward three complete proposals, `check`/`handle`, `try` and `?`, and the
community proposed hundreds more, yet none was adopted. In June 2025 the Go team announced that it
would no longer pursue syntactic changes for error handling for the foreseeable future
[[Griesemer, 2025](#ref-griesemer-2025)].

This section describes the three attempts and why each was abandoned, the reasoning behind the 2025
decision, and the improvements that actually landed in the standard library during the same period.

## 7.5.1 check and handle: The 2018 Draft

In August 2018, along with the Go 2 draft designs, the Go team published a problem overview for
error handling [[Cox, 2018b](#ref-cox-2018b)] and a draft design by Marcel van Lohuizen
[[Lohuizen, 2018](#ref-lohuizen-2018)]. The draft introduced two keywords. `check` is an expression
applied to a call that returns `(T, error)`: when the error is `nil` it yields `T`, and otherwise it
passes the error to a handler. `handle` is a statement that declares the handler to run when a check
fails. The `CopyFile` from the problem overview reads as follows under the draft:

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
		os.Remove(dst) // (only if a check fails)
	}

	check io.Copy(w, r)
	check w.Close()
	return nil
}
```

According to the draft, when a `check` fails, all handlers in the lexical scope run in the reverse
order of their declaration until one of them executes a `return`. Unlike `defer`, `handle` is
lexically scoped, so handlers declared in a loop body do not accumulate across iterations; handlers
always run before any deferred functions.

The weakness of this design shows here: to work out what happens after a particular `check` fails,
the reader has to maintain a chain of handlers in their head, and that chain is independent of, yet
interleaved with, the execution order of `defer`. The Go team's later assessment was that `check`
and `handle` were considered too complicated, and the team moved to a much simpler proposal
[[Griesemer, 2025](#ref-griesemer-2025)].

## 7.5.2 try: The Proposal Rejected in 2019

In June 2019, following the Go 2 proposal process [[Griesemer, 2018](#ref-griesemer-2018)], Robert
Griesemer proposed the built-in function `try` (proposal 32437)
[[Griesemer, 2019](#ref-griesemer-2019)]. `try` applies to a call whose last result is an `error`:
when the error is `nil` it returns the remaining results, and otherwise it returns immediately from
the enclosing function with that error as its result. Adding context to errors is left to `defer`
and named result parameters. The `CopyFile` in the proposal looks like this:

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
			os.Remove(dst) // only if a "try" fails
		}
	}()

	try(io.Copy(w, r))
	try(w.Close())
	return nil
}
```

`try` introduces neither a new keyword nor a new control structure, yet the issue drew more than
eight hundred comments on GitHub. The core of the objection was that `try` makes the enclosing
function return while looking like an ordinary function call: `x := try(f())` reads no differently
from `x := len(f())`, so the return point is no longer obvious.

On July 16, 2019, Griesemer announced on behalf of the proposal review committee that the proposal
was declined early, and explained why. The discussion had pointed out problems the design had
overlooked, most prominently its effect on inserting debugging output and on analyzing code
coverage. More importantly, many people said explicitly that the proposal did not address a problem
worth solving at all. Griesemer acknowledged that the team had described the problem in its overview
the previous August but had not led enough discussion to confirm that it was the right problem; the
overview may even have been overshadowed entirely by the generics draft published the same day
[[Griesemer, 2019](#ref-griesemer-2019)].

## 7.5.3 ?: The 2025 Proposal

In January 2025, Ian Lance Taylor filed proposal 71203 [[Taylor, 2025](#ref-taylor-2025)], drawing
on Rust's `?` operator (available since Rust 1.13 in 2016 [[Rust, 2016](#ref-rust-2016)]). Under the
proposal, an assignment or expression statement may be followed by a `?`, which checks whether the
last value is `nil`; if it is not, the block after `?` runs, in which an implicitly declared `err`
holds the error. The block may be omitted, in which case the error is returned directly:

```go
func CopyFile(src, dst string) error {
	r := os.Open(src) ? {
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}
	defer r.Close()
	// ...
}

func Run() error {
	Start() ? // if the error returned by Start is not nil, return it
	Wait() ?  // if the error returned by Wait is not nil, return it
	return nil
}
```

Unlike `try`, the form with a block keeps the error-handling code explicitly visible. But this
proposal too was quickly buried under comments and suggestions for changes to its details. Taylor
closed the proposal and moved the discussion to GitHub Discussions (71460)
[[Taylor, 2025](#ref-taylor-2025)]. The revised version was received somewhat better but still did
not win broad support [[Griesemer, 2025](#ref-griesemer-2025)].

The three formal attempts are listed in the following table:

| Date | Proposal | Form | Outcome |
| :-- | :-- | :-- | :-- |
| August 2018 | `check` / `handle` | Keywords and a chain of handlers | Considered too complex; no formal proposal |
| June 2019 | `try(...)` | Built-in function, implicit return | Rejected in July 2019 |
| January 2025 | `expr ?` | Postfix operator, optionally with a block | Moved to a discussion; no broad support |
| June 2025 | (all) | Dedicated syntax for error handling | Decided to stop pursuing it |

## 7.5.4 The 2025 Decision

On June 3, 2025, Griesemer published *[ On | No ] syntactic support for error handling* on the Go
blog. The article announced that, for the foreseeable future, the Go team would stop pursuing
syntactic changes for error handling, and would close all existing and new proposals that primarily
concern error-handling syntax without examining them individually
[[Griesemer, 2025](#ref-griesemer-2025)].

The article does not hide the case for change: in Go user surveys, the lack of better error-handling
support has consistently been the top complaint. But the reasons the Go team lists against change
are more numerous:

- **The status quo works.** Go's way of handling errors can be verbose at times, but it is entirely
  workable. Even within the Go team there is no shared understanding of the problem itself, let
  alone agreement that the problem exists.
- **A language change affects everyone.** Once new syntax is introduced, nearly everyone has to
  start using it, or their code looks unidiomatic; this also contradicts the Go principle of not
  offering several ways to do the same thing.
- **When errors are actually handled, the verbosity recedes.** If an error really is handled, for
  example by adding context, the boilerplate makes up a much smaller share of the code.
- **Tools can ease the burden of writing.** Today's IDEs offer powerful code completion, even with
  the assistance of large language models, so writing the basic error check is not laborious; an IDE
  that supports Go could also provide a toggle that hides error-handling code on display.
- **Explicit checks help debugging.** If the error-handling logic is hidden behind `check`, `try` or
  `?`, one may first have to rewrite the code into the explicit form in order to insert a breakpoint
  or debug output.
- **Change is expensive.** Language changes are costly, and the Go team is small with many other
  priorities.
- **Every user asked was opposed.** The article mentions that every Go user the team asked, at the
  Google Cloud Next 2025 booth and at Go meetups, firmly held that the language should not change
  for the sake of error handling; many said the absence of dedicated error-handling syntax is felt
  most acutely right after switching from another language.

The alternatives the article offers are not syntax: helper functions that add context to errors, and
new standard library features that reduce boilerplate. This is the approach Rob Pike advocated in
*Errors are values* in 2015 [[Pike, 2015](#ref-pike-2015)]. For example, `cmp.Or`, added in Go 1.22,
returns the first of its arguments that is not equal to the zero value. `error` is a comparable
interface type, so it can be used to handle a group of errors at once:

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
	fmt.Println(printSum("y", "x")) // only the first non-nil error is returned
}
```

```
result: 3
<nil>
strconv.Atoi: parsing "x": invalid syntax
strconv.Atoi: parsing "y": invalid syntax
```

## 7.5.5 Libraries Landed, Not Syntax

In contrast to the repeated failures in syntax, the improvements to error handling that actually
landed over these years all happened in the standard library, without touching the language grammar:

- **Go 1.13 (2019): wrapping and inspection.** `%w`, `errors.Unwrap`, `errors.Is` and `errors.As`
  [[Neil and Amsterdam, 2019](#ref-neil-amsterdam-2019)] [[Amsterdam, 2019](#ref-amsterdam-2019)];
  see [7.2](./inspect.md).
- **Go 1.20 (2023): multiple wrapping.** `errors.Join` and multiple `%w` verbs in `fmt.Errorf`,
  which turned the error chain into an error tree [[Go Authors, 2023](#ref-go-authors-2023)].

  ```go
  err := errors.Join(errClose, errFlush) // merge two independent errors into one
  if errors.Is(err, errFlush) { /* each can still be checked separately */ }
  ```

- **Go 1.21 (2023): structured logging.** `log/slog` lets an error be recorded as a keyed field
  [[Amsterdam, 2023](#ref-amsterdam-2023)]; see [7.3](./context.md).
- **Go 1.26 (2026): generic `errors.AsType`.** Generics replace the interface of `As`, which
  requires passing a pointer [[Go Authors, 2026](#ref-go-authors-2026)]:

  ```go
  if pe, ok := errors.AsType[*fs.PathError](err); ok {
  	fmt.Println("failed path:", pe.Path)
  }
  ```

`AsType` illustrates the logic behind the 2025 decision: once a general language capability such as
generics is available, error handling can improve at the library level along with it, without any
syntax designed specifically for errors. Russ Cox summarized Go's way of evolving in 2019
as "experiment, simplify, ship", and `check` and `try` were abandoned precisely after
experimentation [[Cox, 2019b](#ref-cox-2019b)]. Library changes are incremental: old code keeps
working and new features are taken up as needed. Syntax changes affect every piece of code and every
reader. Go's actual strategy for error handling is to put every improvement that can live in a
library into the library, and to leave the grammar of the language unchanged.

## 7.5.6 Explicit over Concise

Looking back over these seven years, the Go team has not been standing still. Between explicitness
and conciseness it has chosen the former again and again, and each time it has explained its reasons
publicly. `check`/`handle` was abandoned because it traded complexity for brevity; `try` was
rejected because it hid a return inside what looks like an ordinary expression. The bottom line,
repeated throughout, is that when reading Go code, the control flow should be clear at a glance.

Compared with other languages, the choice is easier to interpret. Exceptions hand errors over to
implicit control transfer, which Go declined from the start (see [7.1.1](./value.md)). Rust's `?` is
a different approach: errors remain values, and a postfix operator merely saves the hand-written
branch. `?` is exactly what `try` set out to provide; Rust accepted it because Rust already lets
expressions alter control flow, whereas Go saw the same design and did not accept it. Two languages
made opposite choices on the same problem, reflecting different answers to the question of whether
control flow should always be explicitly visible. Treating errors as ordinary return values and
handling them with ordinary control flow has been Go's position since its birth, and the 2025
decision merely wrote that position down once more.

## Further Reading

- <a id="ref-griesemer-2025"></a>[Griesemer, 2025] Robert Griesemer. *[ On | No ] syntactic support
  for error handling.* The Go Blog, 2025-06-03. https://go.dev/blog/error-syntax (the Go team's
  formal announcement and reasoning for no longer pursuing error-handling syntax)
- <a id="ref-griesemer-2019"></a>[Griesemer, 2019] Robert Griesemer. *Proposal: A built-in Go error
  check function, "try".* 2019, issue 32437 (declined). https://github.com/golang/go/issues/32437 ;
  design document https://go.googlesource.com/proposal/+/master/design/32437-try-builtin.md ; the
  rejection notice https://github.com/golang/go/issues/32437#issuecomment-512035919
- <a id="ref-cox-2018b"></a>[Cox, 2018b] Russ Cox. *Error Handling, Problem Overview
  (check/handle).*
  2018. https://go.googlesource.com/proposal/+/master/design/go2draft-error-handling-overview.md
- <a id="ref-griesemer-2018"></a>[Griesemer, 2018] Robert Griesemer. *Go 2, here we come!* The Go
  Blog, 2018-11-29. https://go.dev/blog/go2-here-we-come (describes the Go 2 proposal process,
  through which every proposal discussed in this section passed)
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. *Go 1.20 Release Notes
  (errors.Join and multiple %w).* 2023. https://go.dev/doc/go1.20#errors
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Package errors (including the
  generic AsType introduced in 1.26).* https://pkg.go.dev/errors ; *Go 1.26 Release Notes.*
  https://go.dev/doc/go1.26
- <a id="ref-neil-amsterdam-2019"></a>[Neil and Amsterdam, 2019] Damien Neil, Jonathan Amsterdam.
  *Working with Errors in Go 1.13 (%w wrapping and error chains).* The Go Blog, 2019.
  https://go.dev/blog/go1.13-errors
- <a id="ref-cox-2019b"></a>[Cox, 2019b] Russ Cox. *Experiment, Simplify, Ship.* The Go Blog, 2019.
  https://go.dev/blog/experiment (the evolution philosophy of "libraries before language, experiment
  before commitment", which is the footnote to this section's main thread)
- <a id="ref-amsterdam-2019"></a>[Amsterdam, 2019] Jonathan Amsterdam. *proposal: Go 2 error values
  (#29934).* 2019. https://github.com/golang/go/issues/29934 (the umbrella proposal for the
  evolution of error values, linking the many rejected and adopted designs)
- <a id="ref-lohuizen-2018"></a>[Lohuizen, 2018] Marcel van Lohuizen. *Error Handling, Draft
  Design.*
  2018. https://go.googlesource.com/proposal/+/master/design/go2draft-error-handling.md
- <a id="ref-taylor-2025"></a>[Taylor, 2025] Ian Lance Taylor. *proposal: spec: reduce error
  handling boilerplate using ? (#71203).* 2025. https://go.dev/issue/71203 ; discussion
  https://github.com/golang/go/discussions/71460
- <a id="ref-rust-2016"></a>[Rust, 2016] The Rust Project. *Rust 1.13.0 Release Notes: Stabilize the
  `?` operator.* 2016.
  https://github.com/rust-lang/rust/blob/master/RELEASES.md#version-1130-2016-11-10
- <a id="ref-pike-2015"></a>[Pike, 2015] Rob Pike. *Errors are values.* The Go Blog, 2015.
  https://go.dev/blog/errors-are-values
- <a id="ref-amsterdam-2023"></a>[Amsterdam, 2023] Jonathan Amsterdam. *Structured Logging with
  slog.* The Go Blog, 2023. https://go.dev/blog/slog
