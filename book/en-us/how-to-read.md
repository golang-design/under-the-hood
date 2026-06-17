---
weight: 200
title: "How to Read This Book"
---

# How to Read This Book

A reader once told the author that this book is hard going. They had studied Go and used it for a few years, yet when they hit the chapters on scheduling, stealing, and memory, they could still only talk in the abstract. That feedback is sincere, and the author accepts it. Part of the depth this book aims for comes from decades of accumulated work in systems, concurrency, and compilation, and the slope really is steep on first contact. But steep does not mean the only option is to grind through it. What a book can offer is a few paths that make the slope gentler. This page is about how to walk those paths.

The first thing to say: there is no need to read this book front to back. The five parts each stand on their own, [Overview and History](./part1overview), [Language Features](./part2lang), [Concurrency](./part3concurrency), [Memory](./part4memory), and [Compiler and Toolchain](./part5toolchain). They reference one another, but they are not levels you must clear in order. A reader is free to enter through whichever part they care about most, and to go back and fill in any prerequisite concept they do not yet understand.

## Choose a Starting Point by Background

Readers of different backgrounds will not find the same entry point suitable.

- You have experience using Go but no grounding in the lower levels of systems (operating systems, computer architecture, and compiler theory are things you have only heard of). This is the most common type of reader, and also the one most easily put off. The suggestion is to read [Part 1](./part1overview) through first. It goes from design philosophy to the life cycle of a program from launch to exit, laying a main thread for the details that follow. After that, pick the feature you use most and go deep, say slices, maps, or channels, using something familiar to feel your way into the unfamiliar mechanisms.
- You already have a foundation in operating systems or computer architecture. You can head straight for the part you most want to read. Chapters like scheduling ([Chapter 9](./part3concurrency/ch09sched)) and memory allocation and reclamation ([Chapter 12](./part4memory/ch12alloc) and [Chapter 13](./part4memory/ch13gc)) assume the reader can follow terms like threads, caches, and virtual memory, and they will not be an obstacle to you.
- You come with a specific problem to look up. Using the book as a manual is a legitimate way to read it too. Each section's title is meant to be as self-describing as possible, so go straight from the table of contents to the mechanism you want; there is no need to read a whole chapter for the sake of one section.

When a term first appears, the main text includes its original English form. If you run into an unfamiliar concept, the [glossary](./glossary) at the end of the book collects the core vocabulary that runs through the whole text, and you can look things up there at any time.

## A Two-Pass Reading for the Hard Chapters

Every section in this book unfolds along roughly the same thread: first it makes clear what problem is to be solved and what the core intuition is, then it gradually sinks into theory, proofs, and cross-system comparison, and finally lands on trimmed source code. The difficulty usually lies in the second half. For the chapters you find hard going, the author recommends reading in two passes.

On the first pass, read only the opening few paragraphs of each section, grasping "what problem does this component solve, and what is its basic idea." When you reach a formal proof (for example the randomized analysis of work stealing and its communication bound), a cross-system comparison (the incarnations in Cilk, Java, and Rust), or a long block of trimmed source code, skip past it for now. Read through a whole chapter this way and you will have a skeleton in mind first: which components there are, and how they cooperate.

On the second pass, return to the places you skipped and fill the proofs, comparisons, and implementation details back into the skeleton. By then they are no longer free-floating difficulties but footnotes hung on a structure you already understand, and they read much more smoothly. What lies between talking in the abstract and genuinely understanding is often exactly this second pass.

## Entry Points for a Few High-Threshold Topics

The three places named most often in reader feedback are GMP scheduling, work stealing, and memory allocation. Below is a suggested entry point for each, along with the parts you can set aside on the first pass.

**Goroutine scheduling (GMP).** Do not start reading from the scheduling loop directly. First read [9.1 The Scheduling Problem and the GMP Model](./part3concurrency/ch09sched/model.md) to get clear on "what is being scheduled, and where the difficulty lies." Then read [9.3 The MPG Model](./part3concurrency/ch09sched/mpg.md), which starts from "what exactly a goroutine is" and settles the three scheduling units M, P, and G into place. Read those two sections thoroughly and [9.4 The Scheduling Loop](./part3concurrency/ch09sched/schedule.md) becomes just "moving G between these units," no longer intimidating. If the boundaries between process and thread, or between user mode and kernel mode, are still unclear, filling in that point first will save a lot of effort.

**Work stealing.** [9.2 Work-Stealing Scheduling](./part3concurrency/ch09sched/steal.md) opens with a concrete problem: each P has its own local queue, work is unevenly distributed, and how do you spread the load out without introducing a central bottleneck. First read your way through this problem and the "share or steal" trade-off; as for that provable communication bound and the randomized analysis, leave them to the second pass. Understanding stealing requires only one prerequisite concept: the double-ended queue, where one end is pushed and popped for your own use and the other end is for others to steal from.

**Memory allocation.** Start from [12.1 Design Principles](./part4memory/ch12alloc/basic.md) and [12.2 Components](./part4memory/ch12alloc/component.md), first building the overall picture of the multi-level structure of mcache, mcentral, and mheap, then go look at how the three allocation paths for large, small, and tiny objects differ. This chapter draws on the concepts of the memory hierarchy and caches, and of virtual memory and pages, so it would not hurt to keep the relevant chapters of an operating systems textbook at hand.

## Stuck? You Are Welcome to Say So

When a section or a passage is hard going, it is often not the reader's problem but that the introduction there is not yet smooth enough. Grinding these rough entry points smooth, one by one, is the direction of this book's ongoing revision. If a reader gets stuck somewhere, you are welcome to point out the specific chapter and passage in the [GitHub repository](https://github.com/golang-design/under-the-hood/issues), and it will become the starting point for the next round of revision.
