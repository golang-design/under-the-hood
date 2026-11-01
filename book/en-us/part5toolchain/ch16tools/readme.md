---
weight: 5200
title: "Chapter 16 Tooling and Observability"
bookCollapseSection: true
---

# Chapter 16 Tooling and Observability

- [16.1 Runtime Deadlock Detection](./deadlock.md)
- [16.2 Race Detection](./race.md)
- [16.3 Execution Tracing](./trace.md)
- [16.4 Testing Code](./testing.md)
- [16.5 Benchmarking and Performance Profiling](./perf.md)
- [16.6 Runtime Metrics](./metric.md)
- [16.7 The Language Server Protocol](./gopls.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
Everyone knows that debugging is twice as hard as writing a program in the first place. So if you're as
clever as you can be when you write it, how will you ever debug it?
</I></br>
<div class="quote-right">
-- Brian W. Kernighan and P. J. Plauger, "The Elements of Programming Style", 2nd ed., 1978
</div>
</div>

The passage comes from Chapter 2, "Expression", of Kernighan and Plauger's *The Elements of
Programming Style*. The book first presents a PL/I program that counts the blanks in a string. It
uses the built-in functions `INDEX` and `SUBSTR` to cut off the first blank and everything before it
on each pass; the code is clever, but it takes some thought to see what it does. The authors then
give the plain version that examines one character at a time, and write the sentence above. The next
discussion concerns another kind of cleverness: programmers who, from their knowledge of a
particular compiler, use only the constructs "known" to be more efficient, a judgment the authors
show does not always hold. The first concerns understanding and debugging, the second intuition
about performance. The tools in this chapter answer exactly these two concerns: finding the cause
when a program is wrong, and measuring first when a program seems slow.

[16.1](./deadlock.md), [16.2](./race.md) and [16.4](./testing.md) concern correctness.
[16.1](./deadlock.md) shows how the runtime decides that the whole program is deadlocked, and how
`synctest` and the goroutine leak profile extend detection to partial deadlocks. [16.2](./race.md)
shows how the race detector uses vector clocks to find memory accesses that lack synchronization,
and how work is divided between the compiler and the ThreadSanitizer runtime. [16.4](./testing.md)
shows how `go test` turns test conventions into an executable program, and covers table-driven
tests, subtests and fuzzing. [16.3](./trace.md), [16.5](./perf.md) and [16.6](./metric.md) concern
observing a running program. The execution trace records scheduling, garbage collection and system
call events in time order. Benchmarks, `benchstat` and profiling answer "how fast", "did it really
change" and "where does the time go". Runtime metrics report the state of the heap, the collector
and the scheduler at very low cost, so that monitoring systems can store them over the long term and
alert on them. [16.7](./gopls.md) covers the language server protocol and gopls, that is, how the
semantic features of editors are built on `go/parser` and `go/types`. Most of these tools ship with
the toolchain. The mechanisms they rely on are described in the scheduler
([Chapter 9](../../part3concurrency/ch09sched)), memory statistics
([12.8](../../part4memory/ch12alloc/mstats.md)) and the compiler front end
([15.1](../ch15compile/parse.md)).
