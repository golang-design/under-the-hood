---
weight: 3100
title: "Chapter 9 The goroutine Scheduler"
bookCollapseSection: true
---

# Chapter 9 The goroutine Scheduler

- [9.1 The Scheduling Problem and the GMP Model](./model.md)
- [9.2 Work-Stealing Scheduling](./steal.md)
- [9.3 The MPG Model and Concurrent Scheduling Units](./mpg.md)
- [9.4 The Scheduling Loop](./schedule.md)
- [9.5 Thread Management](./thread.md)
- [9.6 Signal Handling](./signal.md)
- [9.7 Cooperation and Preemption](./preemption.md)
- [9.8 System Monitoring](./sysmon.md)
- [9.9 The Network Poller](./poller.md)
- [9.10 Timers](./timer.md)
- [9.11 NUMA Awareness and the Future of the Scheduler](./numa.md)

(Execution stack management originally belonged to this chapter; it has now been moved to [Chapter 14 Execution Stack Management](../../part4memory/ch14stack).)


<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
The performance improvement does not materialize from the air, it 
comes with code complexity increase.
</I></br>
<div class="quote-right">
-- Dmitry Vyukov
</div>
</div>

In the author's eyes, the Go scheduler is the most fascinating component in the entire runtime.
For Go itself, its design and implementation directly affect every other component of the Go runtime, and it is the part that deals directly with user-space code.
For Go users, the scheduler hides an extremely complex runtime machinery behind a single simple keyword, `go`.
To guarantee high performance, the scheduler must make effective use of the parallelism and locality of computation; to keep user space simple,
the scheduler must efficiently schedule the network poller and the garbage collector, which are invisible to user-space code; to guarantee the correctness of code
execution, it must also strictly implement the memory ordering of user-space code, and so on.
In short, the design of the scheduler directly determines the form that the Go runtime source code takes.
