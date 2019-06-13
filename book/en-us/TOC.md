## Table of Content

### [Preface](preface.md)

### Part 1: Basics

#### Chapter 01: Program Basics

#### Chapter 02: Parallel and Distributed Computing

#### Chapter 03: Queuing and Scheduling Theory

#### Chapter 04: Memory Management

#### [Chapter 05: Go Program Lifecycle](part1basic/ch05boot/readme.md)

- [5.1 Boot](part1basic/ch05boot/boot.md)
- [5.2 Initialization](part1basic/ch05boot/init.md)
- [5.3 Main Goroutine](part1basic/ch05boot/main.md)

### [Part 2：Runtime](part2runtime/readme.md)

#### [Chapter 06: Goroutine Scheduler](part2runtime/ch06sched/readme.md)

- [6.1 Basic Structure](part2runtime/ch06sched/basic.md)
- [6.2 Initialization](part2runtime/ch06sched/init.md)
- [6.3 Schedule Loop](part2runtime/ch06sched/exec.md)
- [6.4 System Monitor](part2runtime/ch06sched/sysmon.md)
- [6.5 Threads](part2runtime/ch06sched/thread.md)
- [6.6 Signal Handling](part2runtime/ch06sched/signal.md)
- [6.7 Execution Stacks](part2runtime/ch06sched/stack.md)
- [6.8 Corporative and Preemptive](part2runtime/ch06sched/preemptive.md)
- [6.9 Synchronization](part2runtime/ch06sched/sync.md)
- [6.10 Past, Present and Future](part2runtime/ch06sched/history.md)

#### [Chapter 07: Memory Allocator](part2runtime/ch07alloc/readme.md)

- [Basics](part2runtime/ch07alloc/basic.md)
- [Components](part2runtime/ch07alloc/component.md)
- [Initialization](part2runtime/ch07alloc/init.md)
- [Large Objects Allocation](part2runtime/ch07alloc/largealloc.md)
- [Small Objects Allocation](part2runtime/ch07alloc/smallalloc.md)
- [Tiny Objects Allocation](part2runtime/ch07alloc/tinyalloc.md)
- [Statistics of Memory Usage](part2runtime/ch07alloc/mstats.md)
- [Past, Present and Future](part2runtime/ch07alloc/history.md)

#### [Chapter 08: Garbage Collector](part2runtime/ch08GC/readme.md)

- [8.1 Basics](part2runtime/ch08GC/basic.md)
- [8.2 Initialization](part2runtime/ch08GC/init.md)
- [8.3 Mark-sweep Algorithm](part2runtime/ch08GC/vanilla.md)
- [8.4 Barrier Technique](part2runtime/ch08GC/barrier.md)
- [8.5 Concurrent Reclaim](part2runtime/ch08GC/concurrent.md)
- [8.6 Mark Process](part2runtime/ch08GC/mark.md)
- [8.7 Sweep Process](part2runtime/ch08GC/sweep.md)
- [8.8 Finalizer](part2runtime/ch08GC/finalizer.md)
- [8.9 Past, Present and Future](part2runtime/ch08GC/history.md)

#### Chapter 09: Debugging

- [Race Detection](part2runtime/ch09debug/race.md)
- [Trace Debug](part2runtime/ch09debug/trace.md)

#### Chapter 10:  Compatabilities and Calling Convention

- [System Calls: Linux](part2runtime/ch10abi/syscall-linux.md)
- [System Calls: Darwin](part2runtime/ch10abi/syscall-darwin.md)
- [WebAssembly](part2runtime/ch10abi/syscall-wasm.md)
- [cgo](part2runtime/ch10abi/cgo.md)

### [Part ３: Compile System](part3compile/readme.md)

#### Chapter 11: Language Keywords

- [`go`](part3compile/ch11keyword/go.md)
- [`defer`](part3compile/ch11keyword/defer.md)
- [`panic` 与 `recover`](part3compile/ch11keyword/panic.md)
- [`map`](part3compile/ch11keyword/map.md)
- [`chan` and `select`](part3compile/ch11keyword/chan.md)
- [`interface`](part3compile/ch11keyword/interface.md)

#### Chapter 12: Module Linker

- [Initialization](part3compile/ch12link/init.md)
- [Module Link](part3compile/ch12link/link.md)

#### Chapter 13: Compiler

- [`unsafe`](part3compile/ch13gc/9-unsafe.md)
- [Lexical and Grammar](part3compile/ch13gc/parse.md)
- [Type System](part3compile/ch13gc/type.md)
- [Compiler Backend SSA](part3compile/ch13gc/ssa.md)
- [Past, Present and Future]

### [Part 4: Standard Library](part4lib/readme.md)

#### [Chapter 14: Error handling](part4lib/ch14errors/readme.md)

#### [Chapter 15: Package sync and atomic](part4lib/ch15sync/readme.md)

- [Semaphore](part4lib/ch15sync/sema.md)
- [`sync.Pool`](part4lib/ch15sync/pool.md)
- [`sync.Once`](part4lib/ch15sync/once.md)
- [`sync.Map`](part4lib/ch15sync/map.md)
- [`sync.WaitGroup`](part4lib/ch15sync/waitgroup.md)
- [`sync.Mutex`](part4lib/ch15sync/mutex.md)
- [`sync.Cond`](part4lib/ch15sync/cond.md)
- [`sync/atomic.*`](part4lib/ch15sync/atomic.md)

#### [Chapter 16: Miscellaneous](part4lib/ch16other/readme.md)

- [`syscall.*`](part4lib/ch16other/syscall.md)
- [`os/signal.*`](part4lib/ch16other/signal.md)
- [`reflect.*`](part4lib/ch16other/reflect.md)
- [`net.*`](part4lib/ch16other/net.md)
- [`time.*`](part4lib/ch16other/time.md)

### [Final Words](finalwords.md)

### [Bibliography](../bibliography/list.md)

### Appendix

- [Appendix A: Source Index](appendix/index.md)
- [Appendix B: Glossary](appendix/glossary.md)