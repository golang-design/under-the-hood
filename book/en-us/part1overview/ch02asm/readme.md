---
weight: 1200
title: "Chapter 2 Assembly and Calling Conventions"
bookCollapseSection: true
---

# Chapter 2 Assembly and Calling Conventions

- [2.1 The Plan 9 Assembly Language](./asm.md)
- [2.2 Stack Frames and Symbols in Assembly](./frame.md)
- [2.3 Calling Convention and the Register ABI](./callconv.md)
- [2.4 Argument Passing and Stack Frame Layout](./args.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Any problem in computer science can be solved with another level of indirection.</I></br>
<div class="quote-right">
-- David Wheeler
</div>
</div>

The CPU knows nothing about goroutines, interfaces or closures. It executes instructions one at a
time: moving data between registers and memory, computing, and jumping when necessary. Between
source code and machine, Go defines two conventions of its own: an assembly language written the
same way on every architecture, and a calling convention that fixes how Go functions pass arguments
and results to one another.

This chapter covers the two in turn. Sections 2.1 and 2.2 show how to read the assembly in the
runtime. Sections 2.3 and 2.4 cover where arguments and results live, how stack frames are laid out,
and the stack check at the start of almost every function. By the end, the reader should be able to
read `runtime/asm_amd64.s` and the assembly printed by `go build -gcflags=-S`.
