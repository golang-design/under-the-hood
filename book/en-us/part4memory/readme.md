---
weight: 4000
title: "Part IV Memory"
bookCollapseSection: true
---

# Part IV Memory

- [Chapter 12 Memory Allocator](./ch12alloc)
- [Chapter 13 Garbage Collector](./ch13gc)
- [Chapter 14 Execution Stack Management](./ch14stack)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>On-the-fly garbage collection: an exercise in cooperation.</I></br>
<div class="quote-right">
-- Edsger W. Dijkstra, Leslie Lamport, et al., Communications of the ACM (1978)
</div>
</div>

Memory management is the most hidden part of the runtime, and also the part that most shapes how the system feels: out of sight of the programmer, it decides latency, throughput, and scalability. This foundational paper captures the essence of modern concurrent garbage collection in a single word, cooperation. The collector no longer seizes the whole world and bluntly stops the program; instead it moves forward together with the user code that keeps producing garbage, each yielding to and coordinating with the other. This part unfolds along that same thread: first we look at how the memory allocator carves up and reuses memory on top of many cores with a lock-free fast path, then we go deep into the garbage collector's tricolor marking, write barriers, and concurrent collection, to understand how Go pushes pauses down to the sub-millisecond level, and finally we return to each goroutine's execution stack, to see how the stack's on-demand growth and shrinkage support millions of coroutines. Allocation, collection, and the stack together form the memory foundation that supports the running of Go programs.
