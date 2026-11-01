---
weight: 3300
title: "Chapter 11 Synchronization Primitives and Patterns"
bookCollapseSection: true
---

# Chapter 11 Synchronization Primitives and Patterns

- [11.1 Shared-Memory Synchronization Patterns](./basic.md)
- [11.2 Mutex](./mutex.md)
- [11.3 Atomic Operations](./atomic.md)
- [11.4 Condition Variables](./cond.md)
- [11.5 Wait Groups](./waitgroup.md)
- [11.6 Object Pool](./pool.md)
- [11.7 Concurrency-Safe Hash Table](./map.md)
- [11.8 Context](./context.md)
- [11.9 Memory Consistency Models](./mem.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>The fact that the construction can be defined in terms of simpler underlying primitives is a useful guarantee that its inclusion is logically consistent with the remainder of the language.</I></br>
<div class="quote-right">
-- C. A. R. Hoare, "Communicating Sequential Processes", 1978
</div>
</div>

In the conclusion of his CSP paper, Hoare writes that input, output and concurrency should be
regarded as primitives of programming, but that this does not make them a replacement for every
other concept in a language. A more elaborate construction, such as a procedure or a monitor,
deserves dedicated notation if it is frequently useful, has properties that are easier to prove, and
can be implemented more efficiently than the general case. Go's choices agree with this. Channels
and `select` are part of the language ([Chapter 10](../ch10chan/readme.md)); mutexes, atomic
operations, condition variables and the like are provided by the standard library packages `sync`
and `sync/atomic`; and what the runtime itself uses to implement a channel is a lock
([10.6.5](../ch10chan/lockfree.md)).

This chapter covers these library-level synchronization primitives. Section 11.1 revisits the two
traditions of shared memory and message passing and the duality between them. Sections 11.2 through
11.8 discuss the implementation and design trade-offs of the mutex, atomic operations, the condition
variable, the wait group, the object pool, the concurrency-safe hash table and the context. Section
11.9 starts from hardware and programming-language memory models and arrives at the Go memory model,
which defines the visibility guarantees that these primitives and channels provide together. For
when to use a channel and when to use a lock, see [10.7](../ch10chan/pattern.md).
