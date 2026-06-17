---
weight: 9001
title: "Appendix A: Glossary"
---

# Glossary

This appendix collects the main terms that appear in the book, grouped by topic and ordered alphabetically by their English names. For each term it gives the chapter where the term is mainly developed, so the reader can look it back up easily.

## Concurrency and Scheduling

| Term | Chapter | English | Abbreviation |
| --- | --- | --- | --- |
| Back Edge | [9.7](./part3concurrency/ch09sched/preemption.md) | Back Edge | |
| Cooperative Preemption | [9.7](./part3concurrency/ch09sched/preemption.md) | Cooperative Preemption | |
| Communicating Sequential Processes | [1.3](./part1overview/ch01intro/csp.md) | Communicating Sequential Processes | CSP |
| Goroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | Goroutine | G/g |
| Machine (Thread) | [9.3](./part3concurrency/ch09sched/mpg.md) | Machine | M/m |
| Network Poller | [9.9](./part3concurrency/ch09sched/poller.md) | Network Poller | netpoll |
| Non-spinning | [9.4](./part3concurrency/ch09sched/schedule.md) | Non-spinning | |
| Preemptive | [9.7](./part3concurrency/ch09sched/preemption.md) | Preemptive | |
| Processor | [9.3](./part3concurrency/ch09sched/mpg.md) | Processor | P/p |
| Safepoint | [9.7](./part3concurrency/ch09sched/preemption.md) | Safepoint | |
| Scheduler | [9](./part3concurrency/ch09sched/readme.md) | Scheduler | sched |
| Spinning | [9.4](./part3concurrency/ch09sched/schedule.md) | Spinning | |
| System Monitor | [9.8](./part3concurrency/ch09sched/sysmon.md) | System Monitor | sysmon |
| Work Stealing | [9.2](./part3concurrency/ch09sched/steal.md) | Work Stealing | |

## Synchronization and the Memory Model

| Term | Chapter | English | Abbreviation |
| --- | --- | --- | --- |
| Atomic Operation | [11.3](./part3concurrency/ch11sync/atomic.md) | Atomic Operation | |
| Compare-And-Swap | [11.3](./part3concurrency/ch11sync/atomic.md) | Compare-And-Swap | CAS |
| Condition Variable | [11.4](./part3concurrency/ch11sync/cond.md) | Condition Variable | |
| Data Race | [11.9](./part3concurrency/ch11sync/mem.md) | Data Race | |
| Happens-Before | [11.9](./part3concurrency/ch11sync/mem.md) | Happens-Before | |
| Lock-free | [11.3](./part3concurrency/ch11sync/atomic.md) | Lock-free | LF |
| Memory Barrier | [11.9](./part3concurrency/ch11sync/mem.md) | Memory Barrier | |
| Sequential Consistency | [11.9](./part3concurrency/ch11sync/mem.md) | Sequential Consistency | SC |
| False Sharing | [12.2](./part4memory/ch12alloc/component.md) | False Sharing | |
| True Sharing | [12.2](./part4memory/ch12alloc/component.md) | True Sharing | |
| Wait-free | [11.3](./part3concurrency/ch11sync/atomic.md) | Wait-free | |

## Memory Allocation

| Term | Chapter | English | Abbreviation |
| --- | --- | --- | --- |
| Arena | [12.3](./part4memory/ch12alloc/init.md) | Arena | heapArena |
| Arena Hint | [12.3](./part4memory/ch12alloc/init.md) | Arena Hint | arenaHint |
| Fast Path | [12.1](./part4memory/ch12alloc/basic.md) | Fast Path | |
| Free List | [12.2](./part4memory/ch12alloc/component.md) | Free List | |
| Heap | [12](./part4memory/ch12alloc/readme.md) | Heap | |
| Large Object | [12.4](./part4memory/ch12alloc/largealloc.md) | Large Object | |
| Page | [12.7](./part4memory/ch12alloc/pagealloc.md) | Page | |
| Page Allocator | [12.7](./part4memory/ch12alloc/pagealloc.md) | Page Allocator | |
| Size Class | [12.1](./part4memory/ch12alloc/basic.md) | Size Class | |
| Small Object | [12.5](./part4memory/ch12alloc/smallalloc.md) | Small Object | |
| Slow Path | [12.1](./part4memory/ch12alloc/basic.md) | Slow Path | |
| Tiny Allocator | [12.6](./part4memory/ch12alloc/tinyalloc.md) | Tiny Allocator | |
| Tiny Object | [12.6](./part4memory/ch12alloc/tinyalloc.md) | Tiny Object | |

## Garbage Collection

| Term | Chapter | English | Abbreviation |
| --- | --- | --- | --- |
| Bitmap | [13.5](./part4memory/ch13gc/sweep.md) | Bitmap | |
| Collector | [13.1](./part4memory/ch13gc/basic.md) | Collector | |
| Conservative | [13.7](./part4memory/ch13gc/safe.md) | Conservative | |
| Finalizer | [13.10](./part4memory/ch13gc/finalizer.md) | Finalizer | |
| Garbage Collection | [13](./part4memory/ch13gc/readme.md) | Garbage Collection | GC |
| Generational Hypothesis | [13.8](./part4memory/ch13gc/generational.md) | Generational Hypothesis | |
| Hybrid Write Barrier | [13.2](./part4memory/ch13gc/barrier.md) | Hybrid Write Barrier | |
| Liveness | [13.1](./part4memory/ch13gc/basic.md) | Liveness | |
| Mark Assist | [13.4](./part4memory/ch13gc/mark.md) | Mark Assist | |
| Mark-Sweep | [13.1](./part4memory/ch13gc/basic.md) | Mark-Sweep | |
| Mutator | [13.1](./part4memory/ch13gc/basic.md) | Mutator | |
| Pacer | [13.3](./part4memory/ch13gc/pacing.md) | Pacer | |
| Reachability | [13.1](./part4memory/ch13gc/basic.md) | Reachability | |
| Remembered Set | [13.8](./part4memory/ch13gc/generational.md) | Remembered Set | |
| Stop the World | [13.3](./part4memory/ch13gc/pacing.md) | Stop the World | STW |
| Tricolour Abstraction | [13.1](./part4memory/ch13gc/basic.md) | Tricolour Abstraction | |
| Write Barrier | [13.2](./part4memory/ch13gc/barrier.md) | Write Barrier | WB/wb |

## Execution Stack

| Term | Chapter | English | Abbreviation |
| --- | --- | --- | --- |
| Contiguous Stack | [14.1](./part4memory/ch14stack/design.md) | Contiguous Stack | |
| Prologue | [2.2](./part1overview/ch02asm/callconv.md) | Prologue | |
| Epilogue | [14.3](./part4memory/ch14stack/grow.md) | Epilogue | |
| Stack | [14](./part4memory/ch14stack/readme.md) | Stack | |
| Stack Copy | [14.4](./part4memory/ch14stack/copy.md) | Stack Copy | |
| Stack Growth | [14.3](./part4memory/ch14stack/grow.md) | Stack Growth | |

## Language Features and the Compiler

| Term | Chapter | English | Abbreviation |
| --- | --- | --- | --- |
| Calling Convention | [2.2](./part1overview/ch02asm/callconv.md) | Calling Convention / ABI | |
| Defer Bit | [6.2](./part2lang/ch06func/defer.md) | Defer Bit | |
| Devirtualization | [15.3](./part5toolchain/ch15compile/optimize.md) | Devirtualization | |
| Escape Analysis | [15.5](./part5toolchain/ch15compile/escape.md) | Escape Analysis | |
| GC Shape | [8.1](./part2lang/ch08generics/history.md) | GC Shape | |
| Inlining | [15.3](./part5toolchain/ch15compile/optimize.md) | Inlining | |
| Interface Table | [4.2](./part2lang/ch04type/interface.md) | Interface Table | itab |
| Open-coded Defer | [6.2](./part2lang/ch06func/defer.md) | Open-coded Defer | |
| Profile-Guided Optimization | [15.3](./part5toolchain/ch15compile/optimize.md) | Profile-Guided Optimization | PGO |
| Static Single Assignment | [15.2](./part5toolchain/ch15compile/ssa.md) | Static Single Assignment | SSA |
| Type Set | [8.3](./part2lang/ch08generics/checker.md) | Type Set | |
| Type Descriptor | [4.1](./part2lang/ch04type/type.md) | Type Descriptor | _type |

## Modules and the Toolchain

| Term | Chapter | English | Abbreviation |
| --- | --- | --- | --- |
| Language Server Protocol | [16.7](./part5toolchain/ch16tools/gopls.md) | Language Server Protocol | LSP |
| Minimal Version Selection | [17.3](./part5toolchain/ch17modules/minimum.md) | Minimal Version Selection | MVS |
| Race Detector | [16.2](./part5toolchain/ch16tools/race.md) | Race Detector | |
| Semantic Import Versioning | [17.2](./part5toolchain/ch17modules/semantics.md) | Semantic Import Versioning | |
| Semantic Versioning | [17.2](./part5toolchain/ch17modules/semantics.md) | Semantic Versioning | semver |
