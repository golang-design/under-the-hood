---
weight: 2300
title: "Chapter 6 Functions, Defer, and Panic"
bookCollapseSection: true
---

# Chapter 6 Functions, Defer, and Panic

- [6.1 Function Calls](./func.md)
- [6.2 The Defer Statement](./defer.md)
- [6.3 The panic and recover Builtins](./panic.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Thus in a sense procedures in ALGOL are second class citizens, they always have to appear in person and can never be represented by a variable or expression.</I></br>
<div class="quote-right">
-- Christopher Strachey, "Fundamental Concepts in Programming Languages"
</div>
</div>

A function is a **first-class citizen** when it can be assigned like any other value, passed as an
argument, returned as a result, and can capture variables from the environment in which it is
defined, thereby becoming a closure. Strachey drew the distinction between first-class and
second-class objects in his lecture notes for the International Summer School in Computer
Programming, held in Copenhagen in August 1967, and used ALGOL procedures as his example of a
second-class citizen; the notes were not formally published until 2000.

This chapter examines the implementation of three function-related mechanisms in Go: how function
values and closures are represented in memory and how they are called (6.1), how `defer` guarantees
that cleanup runs no matter which path leaves a function (6.2), and how `panic` and `recover`
propagate along the call stack and are intercepted (6.3). The three share one runtime mechanism.
Deferred calls rely on closures, panic handling relies on deferred calls, and the same code runs
deferred calls on a normal return and during a panic. Understanding this mechanism makes clear the
trade-offs Go makes among convenience, run-time performance, and explicit control flow.
