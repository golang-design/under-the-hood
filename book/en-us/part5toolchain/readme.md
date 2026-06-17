---
weight: 5000
title: "Part Five: Compiler and Toolchain"
bookCollapseSection: true
---

# Part Five: Compiler and Toolchain

- [Chapter 15 The Compiler Pipeline](./ch15compile)
- [Chapter 16 Tooling and Observability](./ch16tools)
- [Chapter 17 Modules and Dependencies](./ch17modules)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>You can't trust code that you did not totally create yourself.</I></br>
<div class="quote-right">
-- Ken Thompson, "Reflections on Trusting Trust"
</div>
</div>

The source we write must pass through an entire toolchain before it becomes a runnable program,
and every link in that chain, the compiler, the linker, the build system, and even the transitive closure of dependencies, quietly shapes the behavior and trustworthiness of the program.
The question Thompson posed in his Turing Award lecture remains thought-provoking to this day: when trust is passed along the toolchain layer by layer, what exactly are we trusting.
This part takes that as its entry point into the full picture of Go's toolchain: we first walk through the compiler's multi-pass pipeline from source to machine code,
then survey the tooling ecosystem built around building, testing, profiling, and observability,
and finally arrive at module and dependency management, to see how Go uses minimal version selection and verifiable checksums to make "trust" something that can be reasoned about and reproduced.
