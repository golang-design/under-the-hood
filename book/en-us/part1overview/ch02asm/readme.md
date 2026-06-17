---
weight: 1200
title: "Chapter 2 Assembly and Calling Conventions"
bookCollapseSection: true
---

# Chapter 2 Assembly and Calling Conventions

- [2.1 The Plan 9 Assembly Language](./asm.md)
- [2.2 Stack Frames and Symbols in Assembly](./frame.md)
- [2.3 Calling Conventions and the Register ABI](./callconv.md)
- [2.4 Argument Passing and Stack Frame Layout](./args.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Any problem in computer science can be solved with another level of indirection.</I></br>
<div class="quote-right">
-- David Wheeler
</div>
</div>

Sooner or later source code has to land on a machine, and the machine understands neither goroutines, interfaces, nor closures: it recognizes only registers, the stack, and a string of addresses. This chapter faces exactly that seam. Go does not borrow some CPU's native assembly directly. Instead it maintains a Plan 9 style assembly language unified across architectures, and on top of that defines a calling convention that is compatible with no platform's ABI. These two layers of indirection look like taking the long way around, yet they buy two kinds of sovereignty: "one toolchain cross-compiles to every architecture" and "the lowest layers can be optimized without disturbing user code." Once we can read them, those few pages of the runtime at the very bottom turn from gibberish into a readable live operation.
