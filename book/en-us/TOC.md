## Table of Content

### [Preface](preface.md)

### Part 1: Basics

#### Chaper 01: Program Basics

#### Chaper 02: Parallel and Distributed Computing

#### Chaper 03: Queuing and Scheduling Theory

#### Chaper 04: Memory Management

#### [Chaper 05: Go Program Lifecycle](part1basic/ch05boot/readme.md)

- [5.1 Boot](part1basic/ch05boot/boot.md)
- [5.2 Initialization](part1basic/ch05boot/init.md)
- [5.3 Main Goroutine](part1basic/ch05boot/main.md)

### [Part 2：Runtime](part2runtime/readme.md)

#### [Chaper 06: Goroutine Scheduler](part2runtime/ch06sched/readme.md)

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

#### [Chaper 07: Memory Allocator](part2runtime/ch07alloc/readme.md)

- [Basics](part2runtime/ch07alloc/basic.md)
- [Components](part2runtime/ch07alloc/component.md)
- [Initialization](part2runtime/ch07alloc/init.md)
- [Large Objects Allocation](part2runtime/ch07alloc/largealloc.md)
- [Small Objects Allocation](part2runtime/ch07alloc/smallalloc.md)
- [Tiny Objects Allocation](part2runtime/ch07alloc/tinyalloc.md)
- [Statistics of Memory Usage](part2runtime/ch07alloc/mstats.md)
- [Past, Present and Future](part2runtime/ch07alloc/history.md)

#### [Chaper 08: Garbage Collector](part2runtime/ch08GC/readme.md)

- [8.1 Basics](part2runtime/ch08GC/basic.md)
- [8.2 Initialization](part2runtime/ch08GC/init.md)
- [8.3 Mark-sweep Algorithm](part2runtime/ch08GC/vanilla.md)
- [8.4 Barrier Technique](part2runtime/ch08GC/barrier.md)
- [8.5 Concurrent Reclaim](part2runtime/ch08GC/concurrent.md)
- [8.6 Mark Process](part2runtime/ch08GC/mark.md)
- [8.7 Sweep Process](part2runtime/ch08GC/sweep.md)
- [8.8 Finalizer](part2runtime/ch08GC/finalizer.md)
- [8.9 Past, Present and Future](part2runtime/ch08GC/history.md)

#### Chaper 09: Debugging

- [Race Detection](part2runtime/ch09debug/race.md)
- [Trace Debug](part2runtime/ch09debug/trace.md)

#### Chaper 10:  Compatabilities and Calling Convention

- [System Calls: Linux](part2runtime/ch10abi/syscall-linux.md)
- [System Calls: Darwin](part2runtime/ch10abi/syscall-darwin.md)
- [WebAssembly](part2runtime/ch10abi/syscall-wasm.md)
- [cgo](part2runtime/ch10abi/cgo.md)

### [Part ３: Compile System](part3compile/readme.md)

#### Chaper 11: Language Keywords

- [`go`](part3compile/ch11keyword/go.md)
- [`defer`](part3compile/ch11keyword/defer.md)
- [`panic` 与 `recover`](part3compile/ch11keyword/panic.md)
- [`map`](part3compile/ch11keyword/map.md)
- [`chan` and `select`](part3compile/ch11keyword/chan.md)
- [`interface`](part3compile/ch11keyword/interface.md)

#### Chaper 12: Module Linker

- [Initialization](part3compile/ch12link/init.md)
- [Module Link](part3compile/ch12link/link.md)

#### Chaper 13: Compiler

- [`unsafe`](part3compile/ch13gc/9-unsafe.md)
- [Lexical and Grammar](part3compile/ch13gc/parse.md)
- [Type System](part3compile/ch13gc/type.md)
- [Compiler Backend SSA](part3compile/ch13gc/ssa.md)
- [Past, Present and Future]

### [Part 4: Standard Library](part4lib/readme.md)

#### [Chaper 14: Package sync and atomic](part4lib/ch14sync/readme.md)

- [Semaphore](part4lib/ch14sync/sema.md)
- [`sync.Pool`](part4lib/ch14sync/pool.md)
- [`sync.Once`](part4lib/ch14sync/once.md)
- [`sync.Map`](part4lib/ch14sync/map.md)
- [`sync.WaitGroup`](part4lib/ch14sync/waitgroup.md)
- [`sync.Mutex`](part4lib/ch14sync/mutex.md)
- [`sync.Cond`](part4lib/ch14sync/cond.md)
- [`sync/atomic.*`](part4lib/ch14sync/atomic.md)

#### [Chaper 15: Miscellaneous](part4lib/ch15other/readme.md)

- [`syscall.*`](part4lib/ch15other/syscall.md)
- [`os/signal.*`](part4lib/ch15other/signal.md)
- [`reflect.*`](part4lib/ch15other/reflect.md)
- [`net.*`](part4lib/ch15other/net.md)
- [`time.*`](part4lib/ch15other/time.md)

### [Final Words](finalwords.md)

### [Bibliography](bibliography/list.md)

### Appendix

- [Appendix A: Source Index](appendix/index.md)
- [Appendix B: Glossary](appendix/glossary.md)