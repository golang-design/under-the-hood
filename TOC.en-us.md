## Table of Content

### [Preface](book/preface.md)

### Part 1: Basics

#### Chaper 01: Program Basics

#### Chaper 02: Parallel and Distributed Computing

#### Chaper 03: Queuing and Scheduling Theory

#### Chaper 04: Memory Management

#### [Chaper 05: Go Program Lifecycle](book/part1basic/ch05boot/readme.md)

- [5.1 Boot](book/part1basic/ch05boot/boot.md)
- [5.2 Initialization](book/part1basic/ch05boot/init.md)
- [5.3 Main Goroutine](book/part1basic/ch05boot/main.md)

### [Part 2：Runtime](book/part2runtime/readme.md)

#### [Chaper 06: Goroutine Scheduler](book/part2runtime/ch06sched/readme.md)

- [6.1 Basic Structure](book/part2runtime/ch06sched/basic.md)
- [6.2 Initialization](book/part2runtime/ch06sched/init.md)
- [6.3 Schedule Loop](book/part2runtime/ch06sched/exec.md)
- [6.4 System Monitor](book/part2runtime/ch06sched/sysmon.md)
- [6.5 Threads](book/part2runtime/ch06sched/thread.md)
- [6.6 Signal Handling](book/part2runtime/ch06sched/signal.md)
- [6.7 Execution Stacks](book/part2runtime/ch06sched/stack.md)
- [6.8 Corporative and Preemptive](book/part2runtime/ch06sched/preemptive.md)
- [6.9 Synchronization](book/part2runtime/ch06sched/sync.md)
- [6.10 Past, Present and Future](book/part2runtime/ch06sched/history.md)

#### [Chaper 07: Memory Allocator](book/part2runtime/ch07alloc/readme.md)

- [Basics](book/part2runtime/ch07alloc/basic.md)
- [Components](book/part2runtime/ch07alloc/component.md)
- [Initialization](book/part2runtime/ch07alloc/init.md)
- [Large Objects Allocation](book/part2runtime/ch07alloc/largealloc.md)
- [Small Objects Allocation](book/part2runtime/ch07alloc/smallalloc.md)
- [Tiny Objects Allocation](book/part2runtime/ch07alloc/tinyalloc.md)
- [Statistics of Memory Usage](book/part2runtime/ch07alloc/mstats.md)
- [Past, Present and Future](book/part2runtime/ch07alloc/history.md)

#### [Chaper 08: Garbage Collector](book/part2runtime/ch08GC/readme.md)

- [8.1 Basics](book/part2runtime/ch08GC/basic.md)
- [8.2 Initialization](book/part2runtime/ch08GC/init.md)
- [8.3 Mark-sweep and Tricolor Algorithm](book/part2runtime/ch08GC/tricolor.md)
- [8.4 Barriers](book/part2runtime/ch08GC/barrier.md)
- [8.5 Concurrent Reclaim](book/part2runtime/ch08GC/concurrent.md)
- [8.6 Mark Process](book/part2runtime/ch08GC/mark.md)
- [8.7 Sweep Process](book/part2runtime/ch08GC/sweep.md)
- [8.8 Finalizer](book/part2runtime/ch08GC/finalizer.md)
- [8.9 Past, Present and Future](book/part2runtime/ch08GC/history.md)

#### Chaper 09: Debugging

- [Race Detection](book/part2runtime/ch09debug/race.md)
- [Trace Debug](book/part2runtime/ch09debug/trace.md)

#### Chaper 10:  Compatabilities and Calling Convention

- [System Calls: Linux](book/part2runtime/ch10abi/syscall-linux.md)
- [System Calls: Darwin](book/part2runtime/ch10abi/syscall-darwin.md)
- [WebAssembly](book/part2runtime/ch10abi/syscall-wasm.md)
- [cgo](book/part2runtime/ch10abi/cgo.md)

### [Part ３: Compile System](book/part3compile/readme.md)

#### Chaper 11: Language Keywords

- [`go`](book/part3compile/ch11keyword/go.md)
- [`defer`](book/part3compile/ch11keyword/defer.md)
- [`panic` 与 `recover`](book/part3compile/ch11keyword/panic.md)
- [`map`](book/part3compile/ch11keyword/map.md)
- [`chan` and `select`](book/part3compile/ch11keyword/chan.md)
- [`interface`](book/part3compile/ch11keyword/interface.md)

#### Chaper 12: Module Linker

- [Initialization](book/part3compile/ch12link/init.md)
- [Module Link](book/part3compile/ch12link/link.md)

#### Chaper 13: Compiler

- [`unsafe`](book/part3compile/ch13gc/9-unsafe.md)
- [Lexical and Grammar](book/part3compile/ch13gc/parse.md)
- [Type System](book/part3compile/ch13gc/type.md)
- [Compiler Backend SSA](book/part3compile/ch13gc/ssa.md)
- [Past, Present and Future]

### [Part 4: Standard Library](book/part4lib/readme.md)

#### [Chaper 14: Package sync and atomic](book/part4lib/ch14sync/readme.md)

- [Semaphore](book/part4lib/ch14sync/sema.md)
- [`sync.Pool`](book/part4lib/ch14sync/pool.md)
- [`sync.Once`](book/part4lib/ch14sync/once.md)
- [`sync.Map`](book/part4lib/ch14sync/map.md)
- [`sync.WaitGroup`](book/part4lib/ch14sync/waitgroup.md)
- [`sync.Mutex`](book/part4lib/ch14sync/mutex.md)
- [`sync.Cond`](book/part4lib/ch14sync/cond.md)
- [`sync/atomic.*`](book/part4lib/ch14sync/atomic.md)

#### [Chaper 15: Miscellaneous](book/part4lib/ch15other/readme.md)

- [`syscall.*`](book/part4lib/ch15other/syscall.md)
- [`os/signal.*`](book/part4lib/ch15other/signal.md)
- [`reflect.*`](book/part4lib/ch15other/reflect.md)
- [`net.*`](book/part4lib/ch15other/net.md)
- [`time.*`](book/part4lib/ch15other/time.md)

### [Final Words](book/finalwords.md)

### [Bibliography](book/bibliography/list.md)

### Appendix

- [Appendix A: Source Index](book/appendix/index.md)
- [Appendix B: Glossary](book/appendix/glossary.md)