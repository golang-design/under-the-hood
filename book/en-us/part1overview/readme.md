---
weight: 1000
title: "Part I Overview and History"
bookCollapseSection: true
---

# Part I Overview and History

- [Chapter 1 Design Philosophy and History](./ch01intro)
- [Chapter 2 Assembly and Calling Conventions](./ch02asm)
- [Chapter 3 The Lifecycle of a Program](./ch03life)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Simplicity is prerequisite for reliability.</I></br>
<div class="quote-right">
-- Edsger W. Dijkstra, "How do we tell truths that might hurt?" (EWD498)
</div>
</div>

The rest of the book goes deep into the scheduler, the memory allocator, the garbage collector and
the compiler. Before that, this part answers three more basic questions.

First, why Go looks the way it does today. Chapter 1 covers the engineering problems Go was created
to solve, which ideas it inherited from Unix, C and CSP, and which it deliberately left behind.
Almost every later implementation trade-off finds its motivation here.

Second, what Go code looks like at the machine level. The lowest layers of the runtime (switching
goroutines, growing stacks, atomic operations) are written in assembly. Chapter 2 introduces what is
needed to read that assembly: Go's own assembly language, and where arguments and results live
during a function call.

Third, which stages a program goes through from source to exit. Chapter 3 follows one program end to
end: the `go` command orchestrates the build, the compiler and linker produce an executable, the
runtime initializes before `main`, and finally `main` returns and the process ends. This thread ties
together the subsystems discussed in the later parts.

After this part, the reader should be able to follow every step in the output of `go build -x`, read
a short assembly routine in the runtime using Go assembly, and explain what happens before and after
`main` in a Go program.
