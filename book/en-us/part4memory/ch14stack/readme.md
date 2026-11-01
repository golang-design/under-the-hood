---
weight: 4300
title: "Chapter 14 Execution Stack Management"
bookCollapseSection: true
---

# Chapter 14 Execution Stack Management

- [14.1 Design of Contiguous Stacks](./design.md)
- [14.2 Stack Allocation and Caching](./alloc.md)
- [14.3 Stack Growth](./grow.md)
- [14.4 Stack Copying and Pointer Adjustment](./copy.md)
- [14.5 Stack Shrinking and Evolution](./shrink.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
To make the stacks small, Go's run-time uses resizable, bounded stacks. A newly minted
goroutine is given a few kilobytes, which is almost always enough. When it isn't, the
run-time grows (and shrinks) the memory for storing the stack automatically, allowing
many goroutines to live in a modest amount of memory.
</I></br>
<div class="quote-right">
-- The Go Authors, "Go FAQ: Why goroutines instead of threads?"
</div>
</div>

The Go FAQ gives this explanation for choosing goroutines over threads, then adds two points: the
CPU overhead averages about three cheap instructions per function call, and it is practical to
create hundreds of thousands of goroutines in the same address space, whereas if goroutines were
only threads, system resources would run out at a much smaller number. These few sentences cover the
main content of this chapter. A stack starts small and grows or shrinks on demand. The adjustment is
triggered by one check at the start of every function, whose cost is those few instructions. The
stack size is bounded above by a limit. Unlike a thread stack, a goroutine **stack** is not provided
by the operating system. It is a contiguous region of memory that the runtime allocates from the
page heap and can move wholesale to another location when necessary
([9.3](../../part3concurrency/ch09sched/mpg.md)).

[14.1](./design.md) describes how a stack is represented in the runtime, and how and why Go moved
from segmented stacks to contiguous stacks. [14.2](./alloc.md) covers stack allocation: the per-P
local caches, the global stack pool, the handling of large stacks, and the initial size derived from
average stack usage since Go 1.19. [14.3](./grow.md) covers stack growth: how the check in the
function prologue (for the instruction-level details see [2.4](../../part1overview/ch02asm/args.md))
leads through `morestack` into `newstack`, how the size of the new stack is chosen, and the stack
limit. [14.4](./copy.md) covers stack copying: how the runtime uses the compiler-generated stack
maps to find and adjust every pointer into the old stack, how it synchronizes with concurrent
channel operations, and how these requirements in turn constrain escape analysis and the rules for
using `unsafe`. [14.5](./shrink.md) covers stack shrinking: why it happens while the garbage
collector scans stacks, when it must be deferred, what space guarantee the halving and quarter
criteria provide, and finally a comparison with operating system threads, Rust, and Java virtual
threads. Cooperative preemption, which borrows the stack check, is covered in
[9.7](../../part3concurrency/ch09sched/preemption.md).
