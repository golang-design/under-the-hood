---
weight: 3100
title: "Chapter 9 The goroutine Scheduler"
bookCollapseSection: true
---

# Chapter 9 The goroutine Scheduler

- [9.1 The Scheduling Problem and the GMP Model](./model.md)
- [9.2 Work-Stealing Scheduling](./steal.md)
- [9.3 The MPG Model and the Units of Concurrent Scheduling](./mpg.md)
- [9.4 The Scheduling Loop](./schedule.md)
- [9.5 Thread Management](./thread.md)
- [9.6 Signal Handling](./signal.md)
- [9.7 Cooperation and Preemption](./preemption.md)
- [9.8 System Monitoring](./sysmon.md)
- [9.9 The Network Poller](./poller.md)
- [9.10 Timers](./timer.md)
- [9.11 NUMA Awareness and the Future of the Scheduler](./numa.md)

(Execution stack management originally belonged to this chapter and has moved to
[Chapter 14 Execution Stack Management](../../part4memory/ch14stack).)


<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
The performance improvement does not materialize from the air, it comes with code complexity increase.
</I></br>
<div class="quote-right">
-- Dmitry Vyukov
</div>
</div>

The scheduler is the component of the Go runtime closest to user code. A programmer writes a single
`go` keyword, and the scheduler decides on which operating system thread and when the goroutine
runs, when it yields the processor, how it is suspended when it blocks on a system call, network I/O
or a timer, and how it is resumed once its condition holds. To perform well, the scheduler must
exploit both the parallelism of multiple cores and the locality of caches. It must also cooperate
with runtime components invisible to users, such as the garbage collector and the network poller,
and preserve the memory ordering that user code relies on. The author considers the scheduler the
part of the runtime most worth reading closely: many design decisions in other runtime components
can only be understood from the scheduler's point of view.

This chapter has three layers. Sections 9.1 to 9.4 cover the basic model of scheduling: the origin
of the scheduling problem and the GMP model, the work-stealing algorithm and its theoretical
guarantees, the structure of the three scheduling units G, M and P, and the execution of the
scheduling loop. Sections 9.5 to 9.8 cover the interaction between the scheduler and the operating
system: creating and reusing threads, signal handling, cooperative and asynchronous preemption, and
the system monitor that patrols the whole runtime in the background. Sections 9.9 to 9.11 cover how
the external events a goroutine waits for are managed, namely the network poller and timers, and
finally NUMA-aware scheduling, a complete design that was never landed, along with the problems the
scheduler has yet to solve.
