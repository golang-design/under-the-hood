---
weight: 2100
title: "Chapter 4 The Type System"
bookCollapseSection: true
---

# Chapter 4 The Type System

- [4.1 The Runtime Type System](./type.md)
- [4.2 Interfaces](./interface.md)
- [4.3 Type Aliases](./alias.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
Simplicity is complicated.
</I></br>
<div class="quote-right">
-- Rob Pike
</div>
</div>

A type is a contract between the compiler and the runtime. At compile time, the type checker applies
the typing rules to decide whether a program is valid. At run time, interfaces, reflection, the
garbage collector and maps depend on the descriptions the compiler generates for every type. The
rules of Go's type system are fairly simple, but that simplicity rests on a carefully designed
representation.

This chapter covers how types behave in both phases. Section 4.1 introduces the runtime type
descriptor: which information about a compile-time type survives to run time, and how rules such as
type identity and comparability are implemented with it. Section 4.2 covers the two-word
representation of interfaces, dynamic dispatch through the interface table, and the implementation
of type assertions and type switches. Section 4.3 covers type aliases, which exist only at compile
time and were introduced to solve the problem of migrating types in large codebases.
