---
weight: 2405
title: "7.5 The Future of Error Handling"
---

# 7.5 The Future of Error Handling

In the preceding sections we saw the plainness of the `error` interface, `%w` wrapping, and the inspection of error chains. By this point the reader probably carries an unspoken question: those three lines of `if err != nil` boilerplate, spread year after year across every Go program, is there really no way to get rid of them? The question is not a lonely one. From the go2 draft of 2018 to a single conclusion in 2025, the Go team weighed it back and forth for seven years, proposing several syntaxes such as `check`/`handle`, `try`, and `?`, and then withdrawing them one by one. This section places that path of failed syntax side by side with another, quietly successful path of library evolution, and lays out the judgment the Go team finally arrived at: for the foreseeable future, error handling will not receive any dedicated syntax.

Understanding this outcome matters more than memorizing any of the rejected syntaxes. It is not a deferral but a well-grounded decision to "not do" it, and behind it lies Go's solemn reaffirmation of "explicit over concise".

## 7.5.1 The Rejected Syntax Attempts

### check / handle: the 2018 go2 draft

The first formal attempt to turn error handling into syntax was the `check`/`handle` draft, published in 2018 along with the "Go 2" blueprint. It introduced two keywords: `check` is an expression that evaluates a call returning `(T, error)`, extracting `T` when the error is `nil` and otherwise handing control to the nearest `handle` block; `handle` is a statement that declares the cleanup logic for a failed check in the current function. A typical file copy was written like this under the draft:

```go
func CopyFile(src, dst string) error {
	handle err {
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}

	r := check os.Open(src)     // on failure, jump to the handle above
	defer r.Close()

	w := check os.Create(dst)
	handle err {                 // handles stack; the later-declared one takes effect first
		w.Close()
		os.Remove(dst)
	}

	check io.Copy(w, r)
	check w.Close()
	return nil
}
```

Its ambition lay in the `handle` chain: multiple `handle` blocks take effect in reverse declaration order, reminiscent of the stack semantics of `defer`, allowing "roll back on error" cleanup logic to be laid out layer by layer along the call order. The cost lay there too. To understand what happens after a given `check` line fails, the reader has to maintain a `handle` stack in their head, one that is both independent of and intertwined with the `defer` stack. The community broadly reported that it "introduced a new control flow that has to be learned separately, just to save an `if`", and its complexity was not necessarily lower than what it eliminated. The draft was ultimately judged too complex and never advanced to the proposal stage.

### try(): the built-in function withdrawn in 2019

Learning from how heavy `check`/`handle` was, Robert Griesemer proposed a scheme that went to the opposite extreme in June 2019, [proposal 32437](https://github.com/golang/go/issues/32437): a built-in function named `try`. Its signature can be understood this way: it takes an expression returning `(T1, ..., Tn, error)`, returns the first $n$ values when the error is `nil`, and otherwise uses that error to **return early from the enclosing function**. So the opening of `CopyFile` shrank to:

```go
// before try: four lines of boilerplate, re-dressing the error and throwing it upward
r, err := os.Open(src)
if err != nil {
	return fmt.Errorf("copy %s %s: %v", src, dst, err)
}

// after try: one line, take the value when the error is nil, otherwise return
func CopyFile(src, dst string) error {
	r := try(os.Open(src))     // when err != nil, CopyFile returns err immediately
	defer r.Close()

	w := try(os.Create(dst))
	defer w.Close()
	try(io.Copy(w, r))
	return nil
}
```

`try` introduced no new keyword and no new control structure, just a built-in function, so on the syntactic surface it looked extremely restrained. Decorating the error was left to `defer` together with named return values. As soon as the proposal appeared, community discussion quickly heated up to a scale rarely seen in Go's history, and the core objection came down to a single sentence: `try` hid a `return` inside an expression that looks like an ordinary function call.

This is precisely what Go has always shied away from, **hidden control flow**. The line `x := try(f())` might cause the function to return then and there, yet it reads no differently from `x := len(f())`. In a language that holds "you can see the direction of control flow just by reading the code" as an article of faith, this is a concession hard to accept. The proposal also brought a string of secondary problems: `try` was hard to use in tests (which expect `t.Fatal` rather than `return`), decorating the error was forced to detour through `defer`, and during debugging a breakpoint was hard to place on that implicit return. The same year, the author withdrew the proposal, citing exactly the community's strong disagreement over control-flow readability.

### Lighter if-err and the ? proposal

After `try` was withdrawn, the community did not give up, turning instead to lighter forms. The most representative was the `?` operator proposal of 2024, which copied Rust's `?` almost verbatim:

```go
r := os.Open(src)?     // equivalent to if err != nil { return ..., err }
```

A trailing `?`, and a non-nil error returns carrying the error. It was lighter than `try`, dispensing even with the shell of a function call, but it also pushed the "hidden control flow" problem to its extreme: a single punctuation mark could make the function return. There were also variants such as falling back with `||` (`f() || return err`), all alike in spirit, all tugging back and forth between "writing a few fewer characters" and "making the return visible". None of them gathered enough support.

The schemes taken seriously and then set aside over seven years can be laid out as a clear timeline:

| Year | Scheme | Form | Outcome |
| --- | --- | --- | --- |
| 2018 | `check` / `handle` | keywords + handle stack | too complex, never filed |
| 2019 | `try(...)` | built-in function, implicit return | hidden control flow, withdrawn by the author |
| 2024 | `expr?` | postfix operator | insufficient support |
| 2025 | (all) | error-handling syntax | decided to stop pursuing |

## 7.5.2 2025: Deciding to Stop Pursuing Dedicated Syntax

On June 3, 2025, Griesemer published an article on behalf of the Go team, putting a period at the end of this path: for the foreseeable future, Go will no longer pursue syntactic changes to error handling, and will close existing as well as newly arriving proposals whose main subject is error-handling syntax, without examining each one in depth. This was not a stalling tactic but a reasoned conclusion. The reasons given in the article are worth taking in one by one:

- **Fifteen years, hundreds of proposals, and still no consensus.** Even within the Go team there was no agreement on which path to take. A language-level change, if even its designers cannot persuade one another, has no right to land.
- **A language change is mandatory, a library change is optional.** This point is the most crucial. After generics ([8](../ch08generics)) landed, those who did not want to use them could go on without them; but once new syntax is added for error handling, nearly everyone is forced to read it, learn it, and choose between the two ways of writing. One of Go's design principles is "do not provide multiple ways to do the same thing", and new syntax would break exactly that.
- **Better error handling comes from context, not from shorter syntax.** The team stressed repeatedly that the truly valuable improvement is to supplement errors with context information (what went wrong, why), not to compress `if err != nil` into one line. The latter saves typing; the former saves troubleshooting time.
- **Implementation and maintenance are costly.** New syntax has to run through the entire toolchain: the compiler, documentation, `gofmt`, `go vet`, IDEs, and more, while the Go team is not large and its priorities are limited.
- **An explicit `if err != nil` is better for debugging.** A standalone statement can carry a breakpoint, a log line, a single step, none of which an implicit return offers.

The alternative directions the article gives are, none of them, syntax: use helper functions to supplement error context, add small tools like `cmp.Or` to the standard library, and lean on the IDE's code completion and "fold boilerplate" features to ease the visual noise at the display layer rather than the language layer.

## 7.5.3 What Actually Landed Was the Library, Not the Language

Turning the lens from "the syntax that did not work out" to "the evolution that did", we see a markedly different but consistently lively main thread. Every improvement to error handling that actually landed over these years, without exception, happened at the **library level**, leaving the language grammar untouched:

- **Go 1.13 (2019): `%w` wrapping and error chains.** The `%w` verb of `fmt.Errorf` lets one error "wrap" another, and together with `errors.Is`, `errors.As`, and `errors.Unwrap` forms an inspectable error chain. This was the fruit of years of practice with `pkg/errors` ([7.2](./inspect.md)) being absorbed into the standard library, all a matter of the two packages `errors` and `fmt`, with not a single line of the compiler touched.
- **Go 1.20 (2023): `errors.Join` and multiple `%w`.** `Join` merges several parallel errors into one, exposing them to `Is`/`As` inspection through `Unwrap() []error`; in the same version `fmt.Errorf` also allows multiple `%w` in a single call. The error chain thus expanded from a line into a tree.

  ```go
  err := errors.Join(errClose, errFlush) // merge two independent errors into one
  if errors.Is(err, errFlush) { /* each can still be inspected */ }
  ```

- **Go 1.21 (2023): `log/slog`.** Structured logging entered the standard library, and an error can now be recorded as a keyed structured field (`slog.Any("err", err)`), emitted together with its context, echoing the team's judgment that "error handling is about context". It too is a new package, not new syntax.
- **Go 1.26 (2025): the generic `errors.AsType`.** With the signature `func AsType[E error](err error) (E, bool)`, it borrows generics ([8](../ch08generics)) to replace the awkward interface of `As` that required passing a pointer:

  ```go
  if pe, ok := errors.AsType[*fs.PathError](err); ok {
      fmt.Println("failed path:", pe.Path)
  }
  ```

  What makes it worth chewing over is that it neatly confirms one piece of logic in the 2025 decision: once an **optional** language capability like generics is in hand, error handling can improve at the library level along with it, without any syntax **dedicated** to error handling.

The conclusion this contrast yields is plain: the language layer was attacked again and again without success, while the library layer advanced step by step. The reason is not hard to grasp. A library change is addition: old code stays usable as is, new tools are taken up on demand. A syntax change is multiplication: once introduced it multiplies onto every source file and every reader. Go's real strategy for error handling is to put into the library every improvement that can go into the library, and to guard the language grammar without the slightest movement.

The path of syntax may have ended, but room remains open, only all of it lies outside the language. A few directions named in the 2025 decision are worth watching: one is "boilerplate folding" at the toolchain layer, letting the IDE fold or fade stretches of `if err != nil` when displaying, the source unchanged while the appearance changes; the other is the standardization of error context, where the community is still discussing more structured diagnostic information above `errors.Join` (such as the fields an error carries, call stacks, machine-readable classifications), which is the extension of `pkg/errors` ([7.2](./inspect.md))'s stack approach further into the library. None of these touch the grammar, yet they may keep improving the practical experience of error handling over the next few years. In other words, the story has not ended; it is only certain not to be continued in the chapter on syntax.

## 7.5.4 A Stable Philosophy: Explicit over Concise

Stepping back over these seven years, we find that the Go team was not being old-fashioned but, time and again, placed "explicit" before "concise", and each time explained why. `check`/`handle` failed because it traded complexity for concision; `try` and `?` failed because they traded implicit control flow for concision. The bottom line argued for repeatedly was always this: reading a piece of Go code, the control flow should be plain at a glance, and an error should not quietly change the direction of a function inside some inconspicuous expression.

Putting Go back into the lineage of languages makes the contrast especially clear. Handing error handling to syntax takes roughly two paths. One is exceptions, the path C++, Java, and Python took: errors are thrown implicitly up the call stack, the normal path is written cleanly, at the cost of control flow jumping between `throw` and `catch`, hard to see from local code. Go refused exceptions from the very beginning. The other is "syntactic sugar over values", with Rust's `?` as its representative, where errors remain values (`Result`) and a trailing punctuation merely spares the hand-written dispatch. `?` is exactly what `try` wanted, and Rust chose it because Rust already accepts that "an expression may implicitly change control flow" (`?` and `match` are both expressions). Looking at the same design, Go chose not to, and this was not failing to see it but seeing it and still declining. The two languages turned in opposite directions at the same crossroads, and behind it lies a different faith about whether "control flow should always be visible". Treating errors as ordinary return values and handling them with ordinary control flow is the "errors are values" stance Go set down from its birth, and the 2025 decision merely wrote that stance down once more, clearly and plainly.

Performance and concision never come for free. What Go buys with a screenful of `if err != nil` is that anyone, opening any piece of Go code, can see where errors flow without relying on language magic. Not everyone is happy with this trade, but it is a clear-eyed choice that has been weighed again and again and publicly defended, not an oversight. The future of error handling will most likely be just what it is now: the syntax unchanged, the library going on growing.

## Further Reading

1. Robert Griesemer. *Error Syntax: A Retrospective and Decision.* The Go Blog, 2025-06-03.
   https://go.dev/blog/error-syntax (the Go team's formal statement and reasoning for no longer pursuing error-handling syntax)
2. Robert Griesemer, et al. *Proposal: A built-in Go error check function, "try".* 2019,
   issue 32437 (withdrawn). https://github.com/golang/go/issues/32437
3. The Go Authors. *Go 2 Draft: Error Handling Overview (check/handle).* 2018.
   https://go.googlesource.com/proposal/+/master/design/go2draft-error-handling-overview.md
4. Russ Cox. *Go 2, Here We Come! (Toward Go 2 series).* The Go Blog, 2018-11-29.
   https://go.dev/blog/go2-here-we-come
5. The Go Authors. *Go 1.20 Release Notes (errors.Join and multiple %w).* 2023.
   https://go.dev/doc/go1.20#errors
6. The Go Authors. *Package errors (including the generic AsType introduced in 1.26).*
   https://pkg.go.dev/errors
7. The Go Authors. *Working with Errors in Go 1.13 (%w wrapping and error chains).* The Go Blog, 2019.
   https://go.dev/blog/go1.13-errors
8. Russ Cox. *Experiment, Simplify, Ship.* The Go Blog, 2019.
   https://go.dev/blog/experiment (the "library before language, experiment before fixing" philosophy of evolution, exactly the footnote to this section's main thread)
9. Jonathan Amsterdam. *proposal: Go 2 error values (#29934).* 2019.
   https://github.com/golang/go/issues/29934 (the master proposal for error-value evolution, threading together the many rejected and adopted schemes)
