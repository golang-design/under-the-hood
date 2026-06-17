---
weight: 3000
title: "Part III Concurrency"
bookCollapseSection: true
---

# Part III Concurrency

- [Chapter 9 The goroutine Scheduler](./ch09sched)
- [Chapter 10 Channels and select](./ch10chan)
- [Chapter 11 Synchronization Primitives and Patterns](./ch11sync)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Don't communicate by sharing memory, share memory by communicating.</I></br>
<div class="quote-right">
-- Rob Pike, "Go Proverbs"
</div>
</div>

Concurrency is Go's most distinctive hallmark, and also the part most easily misused.
This widely circulated proverb captures Go's orientation: shift the burden of synchronization off the programmer's shoulders and onto channels managed by the language runtime,
letting ownership of data flow along with messages rather than scattering it across shared state guarded by locks.
This part lays out that picture from the bottom up: first we dissect how the goroutine scheduler multiplexes a vast number of coroutines onto a small number of system threads,
then we go deep into the implementation of channels and select, seeing how the CSP model comes down to concrete sends, receives, and multi-way selection,
and finally we return to the traditional synchronization primitives and common concurrency patterns offered by the sync package.
Only by understanding both paths at once can we judge, in real engineering, when to use communication and when sharing is still called for.
