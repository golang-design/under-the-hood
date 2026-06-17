---
weight: 4300
title: "Chapter 14 Execution Stack Management"
bookCollapseSection: true
---

# Chapter 14 Execution Stack Management

Goroutines are cheap enough that millions can coexist at once ([9.3](../../part3concurrency/ch09sched/mpg.md)), and one key reason hides in their **stack**. An operating system thread's stack usually reserves a fixed block of megabytes right from the start; a million of them would reach the terabyte range, which is simply infeasible. A Go goroutine's stack starts at only **2KB** and **grows on demand**. This "small but growable" stack is the physical foundation of goroutine cheapness. This chapter explains how it is designed, how it is allocated, how it grows and shrinks, and the design evolution behind it from segmented stacks to contiguous stacks.

- [14.1 The Design of Contiguous Stacks](./design.md)
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

Make the stack small, then let it resize on demand: behind that single sentence lies a whole set of design choices. The stack is managed by the runtime on the heap rather than tied to a thread; the checks and preemption are compressed into a single comparison in the function prologue; growth relies on copying an entire segment, and shrinking is handled along the way by the garbage collector. This chapter follows that thread to take apart execution stack management, from the design trade-offs of contiguous stacks, through allocation, growth, copying and pointer adjustment, to shrinking and the cross-system coordinates of its evolution.
