---
weight: 2000
title: "Part II Implementation of Language Features"
bookCollapseSection: true
---

# Part II Implementation of Language Features

- [Chapter 4 The Type System](./ch04type)
- [Chapter 5 Data Structures](./ch05data)
- [Chapter 6 Functions, Defer, and Panic](./ch06func)
- [Chapter 7 Error Handling](./ch07errors)
- [Chapter 8 Generics](./ch08generics)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Data dominates. If you've chosen the right data structures and organized things well, the algorithms will almost always be self-evident.</I></br>
<div class="quote-right">
-- Rob Pike, "Notes on Programming in C"
</div>
</div>

Language syntax faces the programmer; the data layout and execution machinery behind it face the
machine. This part examines the correspondence between the two: when a program contains an
interface, a slice, a `defer` statement or a type parameter, what memory representation and
execution mechanism the compiler and runtime prepare for it.

The discussion starts with the type system (Chapter 4), on which the other chapters rest. It
continues with the internal representation of data structures such as strings, slices and maps
(Chapter 5), the control flow of function calls, `defer` and `panic` (Chapter 6), the treatment of
errors as ordinary values (Chapter 7), and how generics balance compilation speed against runtime
performance (Chapter 8). With these implementations in view, the language features turn out not to
be isolated syntactic conveniences but a set of interrelated engineering decisions, each with its
own cost.
