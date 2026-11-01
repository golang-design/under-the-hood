---
weight: 5000
title: "Part V Compiler and Toolchain"
bookCollapseSection: true
---

# Part V Compiler and Toolchain

- [Chapter 15 The Compiler Pipeline](./ch15compile)
- [Chapter 16 Tooling and Observability](./ch16tools)
- [Chapter 17 Modules and Dependencies](./ch17modules)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>You can't trust code that you did not totally create yourself.</I></br>
<div class="quote-right">
-- Ken Thompson, "Reflections on Trusting Trust", 1984
</div>
</div>

This sentence comes from Thompson's Turing Award lecture. He went on to point out that no amount of
source-level verification or scrutiny protects against using untrusted code, because programmers
inspect the source but run the compiler's output. Source code becomes a runnable program only after
passing through an entire toolchain; the compiler, the linker, the build system and the transitive
closure of dependencies each influence the program's behavior, and whether it can be trusted. One of
Go's responses to this problem is that, since Go 1.21, the toolchain is fully reproducible, so an
officially released toolchain can be rebuilt from source and compared
([3.3](../part1overview/ch03life/bootstrap.md)).

This part discusses Go's toolchain in three chapters. [Chapter 15](./ch15compile/readme.md) follows
the compiler pipeline and examines how source code becomes machine code through lexical and
syntactic analysis, intermediate representations and optimization, along with mechanisms at the
boundary between compiler and runtime such as escape analysis and cgo.
[Chapter 16](./ch16tools/readme.md) covers tools for correctness and performance: deadlock
detection, race detection, execution tracing, testing, benchmarking and profiling, runtime
statistics, and gopls, which provides language services to editors.
[Chapter 17](./ch17modules/readme.md) covers modules and dependency management: how Go uses minimal
version selection to obtain reproducible builds, and how `go.sum` and the checksum database ensure
that everyone downloads the same code.
