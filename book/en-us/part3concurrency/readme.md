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

Go supports concurrency directly in the language: the `go` statement starts a goroutine, channels
pass values between goroutines, and `select` picks one of several communication operations to
proceed. These constructs descend from Hoare's Communicating Sequential Processes
([1.3](../part1overview/ch01intro/csp.md)). The proverb above comes from Pike's talk at Gopherfest
SV in 2015 and summarizes the matching programming style: let ownership of data move between
goroutines along with messages, rather than having several goroutines access the same state under a
lock.

This part discusses the implementation of these constructs from the bottom up. Chapter 9 covers how
the scheduler multiplexes a large number of goroutines onto a small number of operating system
threads, together with the supporting mechanisms of preemption, system monitoring, network polling
and timers. Chapter 10 covers the data structures behind channels and `select`, and the
implementation of send, receive, close and multiway selection. Chapter 11 covers the synchronization
primitives of the `sync` package (mutexes, condition variables, wait groups), as well as atomic
operations, contexts and the Go memory model. Communication and shared memory are not mutually
exclusive: a channel is itself protected by a lock, and in many situations a mutex remains the more
direct choice. Only by understanding the implementation and cost of both can one choose well for a
concrete problem.
