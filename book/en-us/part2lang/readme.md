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

The syntax of a language is written for humans to read, but the data layout behind that syntax is what the machine actually executes.
This part presses on exactly that gap: when we write down an interface, a slice, a defer, or a type parameter, what memory representation and execution mechanism do the compiler and runtime really prepare for us.
We begin with the type system as the overall skeleton, then descend layer by layer into the internal representation of data structures such as strings, slices, and maps,
and on to the control flow of function calls, deferred execution, and panic recovery, the paradigm of treating errors as ordinary values, and how generics are implemented without sacrificing performance.
Once we understand these implementations, language features cease to be isolated syntactic sugar and become a set of engineering decisions that interlock with one another, each carrying its own cost.
