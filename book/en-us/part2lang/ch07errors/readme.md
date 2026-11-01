---
weight: 2400
title: "Chapter 7 Error Handling"
bookCollapseSection: true
---

# Chapter 7 Error Handling

- [7.1 The Evolution of the Problem](./value.md)
- [7.2 Inspecting Error Values](./inspect.md)
- [7.3 Error Formatting and Context](./context.md)
- [7.4 Error Semantics](./semantics.md)
- [7.5 The Future of Error Handling](./future.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Define errors out of existence.</I></br>
<div class="quote-right">
-- John Ousterhout, "A Philosophy of Software Design"
</div>
</div>

An error is a situation a program anticipates but cannot complete normally. Languages have long
followed one of two traditions for letting a routine report an error and the caller handle it:
report it through a return value, or propagate it as an exception. Go belongs to the first. It
defines an error as an interface with a single method, `error`, which a function returns as its last
result and the caller checks explicitly; truly exceptional situations are left to `panic` and
`recover` (see [6.3 The panic and recover Builtins](../ch06func/panic.md)).

This design gives programmers considerable freedom: an error can be a string, a sentinel value, a
structure with fields, or a tree that wraps other errors. The freedom also raises questions. In what
form should an error be defined? How can a caller identify it reliably? How is context attached? Can
the verbose `if err != nil` be simplified? This chapter takes these up in turn. Section 7.1 reviews
the two traditions of error handling and the evolution of the `error` type from 2008 to Go 1.
Section 7.2 covers wrapping, `errors.Is` and `errors.As` introduced in Go 1.13, and `errors.AsType`
in Go 1.26. Section 7.3 covers error messages, context, call stacks and structured logging. Section
7.4 discusses, from a library author's viewpoint, the form in which errors should be exposed.
Section 7.5 covers the attempts between 2018 and 2025 to simplify error handling syntax, and the Go
team's final decision to stop seeking a syntax change.
