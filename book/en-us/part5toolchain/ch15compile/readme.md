---
weight: 5100
title: "Chapter 15 The Compiler Pipeline"
bookCollapseSection: true
---

# Chapter 15 The Compiler Pipeline

- [15.1 Lexing and Grammar](./parse.md)
- [15.2 Intermediate Representation](./ssa.md)
- [15.3 The Optimizer](./optimize.md)
- [15.4 The Pointer Checker](./unsafe.md)
- [15.5 Escape Analysis](./escape.md)
- [15.6 cgo](./cgo.md)
- [15.7 Past, Present, and Future](./future.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
To what extent should one trust a statement that a program is free of Trojan
horses? Perhaps it is more important to trust the people who wrote the
software.
</I></br>
<div class="quote-right">
-- Ken Thompson, "Reflections on Trusting Trust", 1984
</div>
</div>

These two sentences open Ken Thompson's Turing Award lecture, "Reflections on Trusting Trust". The
lecture describes a compiler backdoor that propagates from one compiler generation to the next: it
exists only in the compiler's binary, and the source shows no trace of it
([3.3.4](../../part1overview/ch03life/bootstrap.md)). Programmers review source code but run the
compiler's output, and the compiler sits between the two. This chapter opens up that link and
examines how the Go 1.26 compiler turns source code into machine code.

The chapter follows the compilation pipeline; [3.2](../../part1overview/ch03life/compile.md) gives
an overview of it. [15.1](./parse.md) covers lexing and parsing: automatic semicolon insertion, how
a recursive-descent parser handles ambiguity in the grammar and recovers from errors, and the front
end's evolution from yacc to the `syntax` package. [15.2](./ssa.md) covers intermediate
representations: the unified IR, the `ir` package and walk, and SSA construction, optimization
passes and rewrite rules. [15.3](./optimize.md) covers the optimizer's inlining, devirtualization,
profile-guided optimization and bounds-check elimination. [15.4](./unsafe.md) covers the legal
patterns of `unsafe.Pointer` and checkptr, which verifies those patterns at run time.
[15.5](./escape.md) covers how escape analysis abstracts a program into a weighted directed graph
and solves it there, along with the evolution and limits of the implementation. [15.6](./cgo.md)
covers how cgo converts between the two runtime conventions of Go and C, where the pointer-passing
rules come from, and what crossing the boundary costs. [15.7](./future.md) reviews the compiler's
evolution in chronological order. Assembly and the calling convention are in
[Chapter 2](../../part1overview/ch02asm/readme.md); bootstrapping and linking are in
[Chapter 3](../../part1overview/ch03life/readme.md).
