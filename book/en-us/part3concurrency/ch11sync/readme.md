---
weight: 3300
title: "Chapter 11 Synchronization Primitives and Patterns"
bookCollapseSection: true
---

# Chapter 11 Synchronization Primitives and Patterns

- [11.1 Shared-Memory Synchronization Patterns](./basic.md)
- [11.2 Mutex](./mutex.md)
- [11.3 Atomic Operations](./atomic.md)
- [11.4 Condition Variable](./cond.md)
- [11.5 Wait Group](./waitgroup.md)
- [11.6 Cache Pool](./pool.md)
- [11.7 Concurrent-Safe Hash Map](./map.md)
- [11.8 Context](./context.md)
- [11.9 Memory Consistency Model](./mem.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>The fact that the construction can be defined in terms of simpler underlying primitives is a useful guarantee that its inclusion is logically consistent with the remainder of the language.</I></br>
<div class="quote-right">
-- C.A.R. Hoare
</div>
</div>

In modern programming languages, synchronization between multiple threads is usually achieved through traditional shared-memory mechanisms such as mutexes and semaphores. Go takes a different path from most languages in its choice of synchronization primitives: message-passing synchronization based on channels and select is the language's true synchronization primitive in the proper sense. The concepts that are "traditionally" treated as primitives, such as atomics, mutexes, condition variables, and thread-local resources, are recast in Go as user-space synchronization patterns, giving the language its own distinctive character.
