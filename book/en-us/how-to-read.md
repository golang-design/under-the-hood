---
weight: 200
title: "How to Read This Book"
---

# How to Read This Book

Many readers report that the book is hard going: even after several years of using Go, they struggle
to follow chapters on scheduling, work stealing and memory management. Part of the depth the book
aims for comes from decades of accumulated work in systems, concurrency and compilers, so the entry
barrier is real. That does not mean it must be read word by word from cover to cover. This page
describes several ways to make it easier.

First, the book need not be read from beginning to end. Its six parts are fairly independent:
[Overview and History](./part1overview/readme.md),
[Implementation of Language Features](./part2lang/readme.md),
[Concurrency](./part3concurrency/readme.md), [Memory](./part4memory/readme.md),
[Compiler and Toolchain](./part5toolchain/readme.md), and
[Heterogeneous Compute and Go in the AI Era](./part6hetero/readme.md). The parts cross-reference one
another but do not have to be read in order. Start with the part that interests you most, and go
back to unfamiliar prerequisites as they come up.

## Choosing a Starting Point by Background

Different readers suit different entry points.

- **Readers who use Go but lack a systems foundation**, and know operating systems, computer
  architecture and compilers only by name. This is the most common kind of reader and the one most
  likely to give up halfway. Start by finishing [Part I](./part1overview/readme.md): it runs from
  design philosophy through assembly and calling conventions to the whole life of a program from
  compilation through startup to exit, and gives the later details a main thread. Then pick one
  familiar feature to study in depth, such as slices, maps or channels, and use what you already
  know to approach the unfamiliar mechanism.
- **Readers with a background in operating systems or architecture** can go straight to the parts
  they care about. Scheduling ([Chapter 9](./part3concurrency/ch09sched/readme.md)) and memory
  allocation and garbage collection ([Chapter 12](./part4memory/ch12alloc/readme.md),
  [Chapter 13](./part4memory/ch13gc/readme.md)) assume familiarity with threads, caches and virtual
  memory, so these chapters pose no obstacle for such readers.
- **Readers with a specific question** can use the book as a reference. Section titles are meant to
  be self-explanatory, so you can jump from the table of contents to the mechanism you need without
  reading a whole chapter for one section.

For unfamiliar terms and concepts, consult the [Glossary](./glossary.md) at the end of the book at
any time.

## Reading Hard Chapters in Two Passes

Most sections follow the same line: first the problem to be solved and the core intuition, then a
descent into theory, proofs and comparisons with other systems, and finally trimmed source code. The
difficulty tends to sit in the second half. For a chapter that gives you trouble, read it in two
passes.

On the first pass, read only the opening paragraphs of each section, to grasp what problem the
component solves and what the basic idea is. Skip formal proofs (such as the randomized analysis and
communication bounds of work stealing), comparisons with other systems (such as work stealing in
Cilk, Java and Tokio), and long stretches of source code. By the end of the chapter you have a
skeleton: which components exist and how they cooperate.

On the second pass, return to what you skipped and fill the proofs, comparisons and implementation
details back into the skeleton. They are no longer isolated difficulties but details attached to a
structure you already understand, and they read far more smoothly. The difference between a rough
idea and real understanding is often just this second pass.

## Entry Points for Three Hard Topics

Readers most often name three difficulties: goroutine scheduling, work stealing and memory
allocation. Below is a suggested entry point for each, along with what can be skipped on a first
pass.

**Goroutine scheduling.** Do not start from the scheduling loop. First read
[9.1 The Scheduling Problem and the GMP Model](./part3concurrency/ch09sched/model.md) to see what is
being scheduled and where the difficulty lies. Then read
[9.3 The MPG Model and the Units of Concurrent Scheduling](./part3concurrency/ch09sched/mpg.md),
which begins with the goroutine's place in the family of coroutines and explains how the three
scheduling units G, M and P are represented in the runtime. Once you understand these two sections,
[9.4 The Scheduling Loop](./part3concurrency/ch09sched/schedule.md) is only about how to arrange the
execution of Gs among those units. If the differences between processes and threads, or between user
mode and kernel mode, are unclear, filling in those concepts first will save a lot of effort.

**Work stealing.** [9.2 Work-Stealing Scheduling](./part3concurrency/ch09sched/steal.md) starts from
a concrete problem: each P has its own local queue, so load is bound to be uneven, and the question
is how to balance it without introducing a central bottleneck. On a first pass, understanding this
problem, the trade-off between work sharing and work stealing, and the order in which Go looks for a
runnable G is enough; leave the theoretical guarantees in 9.2.4 for the second pass. Classical work
stealing is built on one double-ended queue per processor: the owner pushes and pops tasks at one
end, and thieves take tasks from the other. Go's local queue differs from this, and 9.2.4 explains
how.

**Memory allocation.** Start with [12.1 Design Principles](./part4memory/ch12alloc/basic.md) and
[12.2 Components](./part4memory/ch12alloc/component.md): first build an overall picture of the
multi-level structure of mcache, mcentral and mheap, and then see how `mallocgc` routes a request to
different allocation paths by object size and by whether the object contains pointers (12.1.4). This
chapter uses ideas such as the memory hierarchy and caches, virtual memory and pages, so keep an
operating systems textbook at hand.

## Tell Us Where You Got Stuck

When a section or paragraph is hard to read, the fault is often not the reader's but a lead-in that
is not gentle enough. Improving these entry points one by one is the direction of the book's
continuing revision. If you cannot get through some passage, please point out the specific chapter
and paragraph in the [GitHub repository](https://github.com/golang-design/under-the-hood/issues); it
will become the starting point of the next round of revision.
