---
weight: 1305
title: "3.5 Bootstrapping a Go Program"
---

# 3.5 Bootstrapping a Go Program

By the time execution reaches the first line of `main`, the runtime has already done a great deal of
work. The following program records the state of the runtime immediately after entering `main`:

```go {run=true}
package main

import (
	"fmt"
	"runtime"
	"runtime/metrics"
)

func main() {
	// Read the state before printing: printing allocates memory and changes it
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	s := []metrics.Sample{
		{Name: "/sched/goroutines:goroutines"},
		{Name: "/sched/threads/total:threads"},
	}
	metrics.Read(s)
	user := runtime.NumGoroutine()

	fmt.Printf("Version and platform: %s %s/%s\n", runtime.Version(), runtime.GOOS, runtime.GOARCH)
	fmt.Printf("CPUs: %d, GOMAXPROCS: %d\n", runtime.NumCPU(), runtime.GOMAXPROCS(0))
	fmt.Printf("Goroutines: %d in total, NumGoroutine reports only %d\n", s[0].Value.Uint64(), user)
	fmt.Printf("OS threads: %d\n", s[1].Value.Uint64())
	fmt.Printf("Heap: %d KiB, stack: %d KiB\n", ms.HeapSys>>10, ms.StackInuse>>10)
	fmt.Printf("Garbage collections: %d\n", ms.NumGC)
}
```

The output on a darwin/arm64 machine:

```
Version and platform: go1.26.10 darwin/arm64
CPUs: 18, GOMAXPROCS: 18
Goroutines: 6 in total, NumGoroutine reports only 1
OS threads: 5
Heap: 3840 KiB, stack: 256 KiB
Garbage collections: 0
```

The CPU count, thread count and memory usage vary from machine to machine, and even on the same
machine the thread count (we observed 4 to 6) and the heap size change from run to run. When run on
the website, the program executes in a js/wasm environment in the browser with a single thread: the
CPU count, GOMAXPROCS and thread count are all 1, the heap is 384 KiB and the stack is 128 KiB.

Of the 6 goroutines, only 1 is running the user's `main`; the other 5 are background goroutines of
the runtime, such as those for sweeping and for returning memory to the operating system, and
`NumGoroutine` does not count them. These goroutines and the extra threads were all created shortly
before `main.main` was called ([3.6](./main.md)). This section covers the earlier stage: from the
moment the operating system starts executing the program until the first goroutine begins to run. At
the start of this stage there is no goroutine and no way to allocate memory, only one thread and a
stretch of stack provided by the operating system, and the runtime must build itself up from there.
The discussion below uses Linux and x86-64 (amd64) as the example, with the program `hello` compiled
in [3.4](./link.md).

## 3.5.1 Program Entry and the Initial Stack

When `./hello` is executed, the Linux kernel does three things: it maps the code and data to the
addresses the linker specified, following the program headers of the executable; it builds an
initial stack for the program, containing the command-line arguments, environment variables and
other information; and it jumps to the entry address recorded in the file header. `hello` depends on
no shared library and needs no dynamic linker, so the kernel jumps straight into Go code. The entry
point is exactly the start of the reference chain in 3.4:

```
$ objdump -f hello | grep start
start address: 0x0000000000480580
$ go tool nm hello | grep ' _rt0_amd64_linux$'
  480580 T _rt0_amd64_linux
```

The contents of the initial stack are defined by the x86-64 System V ABI
[[Matz et al., 2014](#ref-matz-et-al-2014)]. From the top of the stack they are:

```
argc: number of arguments
argv: array of argument pointers, terminated by 0
envp: array of environment variable pointers, terminated by 0
auxv: auxiliary vector, made of (type, value) pairs, terminated by AT_NULL
... (the string contents of the arguments and environment variables)
```

The **auxiliary vector** (auxv) is a set of information the kernel passes to the program as (type,
value) pairs, for example the memory page size (`AT_PAGESZ`), a pointer to 16 bytes of random data
(`AT_RANDOM`), and the location of the vDSO that the kernel maps into the process. The Go runtime
uses this information shortly afterwards.

The entry code itself is only a few instructions. Each combination of operating system and
architecture has its own entry point, and they quickly converge on `rt0_go`, which is shared by an
architecture:

```asm
// runtime/rt0_linux_amd64.s and runtime/asm_amd64.s (Go 1.26)
TEXT _rt0_amd64_linux(SB),NOSPLIT,$-8
	JMP	_rt0_amd64(SB)

TEXT _rt0_amd64(SB),NOSPLIT,$-8
	MOVQ	0(SP), DI	// top of the stack: argc
	LEAQ	8(SP), SI	// next: argv
	JMP	runtime·rt0_go(SB)
```

macOS is different. A Go program on macOS always links `libSystem` dynamically (3.4), so the
system's dynamic linker, dyld, runs first and then passes the argument count and argument list in
registers, just as it would call the `main` of a C program. As a result, `_rt0_arm64_darwin`
consists of a single instruction that jumps to `rt0_go`.

## 3.5.2 g0, m0 and Thread-Local Storage

The first instruction of `main.main` in the `hello` of 3.4, once compiled, is:

```
CMPQ	SP, 16(R14)
```

The prologue of nearly every Go function contains such a comparison: it checks whether the stack
pointer has crossed the stack guard of the current goroutine's stack ([2.4](../ch02asm/args.md)),
and if so, grows the stack before continuing ([Chapter 14](../../part4memory/ch14stack/readme.md)).
`R14` holds a pointer to the current goroutine's descriptor, and `16(R14)` is its guard field
`stackguard0`. It follows that before the first Go function can run, a goroutine and its stack must
already exist, and the current thread must be able to find them.

The runtime describes a goroutine with the struct `g` and an operating system thread with the struct
`m`. Every `m` also owns a special goroutine, `g0`, which uses the thread's own stack and runs no
user code; it is used only for the runtime's internal work, such as choosing the next goroutine to
run or growing the stacks of other goroutines
([Chapter 9](../../part3concurrency/ch09sched/readme.md)).

Memory cannot yet be allocated, so the `m` and `g0` of the main thread cannot be created
dynamically. They are two global variables, `runtime.m0` and `runtime.g0`, whose space the linker
reserves in the data segment, so they exist as soon as the program is loaded. `rt0_go` first does
three things (abridged):

```asm
TEXT runtime·rt0_go(SB),NOSPLIT|NOFRAME|TOPFRAME,$0
	// 1. On the stack provided by the OS, carve out 64 KB below the current position as the stack of g0
	MOVQ	$runtime·g0(SB), DI
	LEAQ	(-64*1024)(SP), BX
	MOVQ	BX, g_stackguard0(DI)       // the guard compared against in function prologues
	MOVQ	BX, (g_stack+stack_lo)(DI)
	MOVQ	SP, (g_stack+stack_hi)(DI)

	// 2. Query the processor vendor and version through CPUID
	MOVL	$0, AX
	CPUID
	...

	// 3. Set up thread-local storage, then write a value and read it back to confirm it works
	LEAQ	runtime·m0+m_tls(SB), DI
	CALL	runtime·settls(SB)
	...
	get_tls(BX)
	LEAQ	runtime·g0(SB), CX
	MOVQ	CX, g(BX)       // the current goroutine is g0
	LEAQ	runtime·m0(SB), AX
	MOVQ	CX, m_g0(AX)    // m0.g0 = g0
	MOVQ	AX, g_m(CX)     // g0.m = m0
```

Step 3 solves the problem of how a thread finds its current goroutine. Threads of one process share
the whole address space, and giving each thread a private location requires support from the
operating system: **thread-local storage** (TLS) [[Drepper, 2013](#ref-drepper-2013)]. On Linux
x86-64, the base of the segment register FS points to the current thread's TLS area; the runtime
sets this base with the system call `arch_prctl` and stores a pointer to the current goroutine at a
fixed offset. The `R14` mentioned earlier is an optimization that came with the register-based
calling convention introduced in Go 1.17 ([2.3](../ch02asm/callconv.md)): while Go code runs, the
pointer to the current goroutine is also kept in `R14` [[Go Authors, 2026a](#ref-go-authors-2026a)],
which is faster than accessing TLS every time. When Go code is entered from outside, for example to
handle a signal from the operating system or when C code calls back into a Go function, the pointer
is reloaded from TLS.

Step 2 uses the `CPUID` instruction to record whether the processor vendor is Intel and the
processor's version information. The runtime currently uses the former to decide its memory-copy
strategy: on Intel processors that support the relevant feature, large copies of 2 KB or more use
the `REP MOVSB` instruction. In addition, a program compiled with `GOAMD64=v3` requires the
processor to support the corresponding instruction set extensions; `rt0_go` checks this after step 3
and, if the requirement is not met, prints
`This program can only be run on AMD64 processors with v3 microarchitecture support.` and exits. The
check is deliberately placed after TLS is set up, so that the message can be printed reliably.

## 3.5.3 The Order of Runtime Initialization

From here on, `rt0_go` can call Go functions. It calls the following four in turn:

```asm
	CALL	runtime·check(SB)       // verify the compiler's assumptions, e.g. that int8 is 1 byte
	...                             // pass argc and argv
	CALL	runtime·args(SB)        // save the arguments, read the auxiliary vector
	CALL	runtime·osinit(SB)      // count the CPUs available to this process
	CALL	runtime·schedinit(SB)   // initialize the rest of the runtime
```

If `check` finds that an assumption of the compiler does not hold, it terminates the program
immediately, to avoid hard-to-trace errors later. `args` extracts the page size and the address of
the 16 bytes of random data from the auxiliary vector. On Linux, `osinit` queries the set of CPUs
this process may use through the system call `sched_getaffinity` and counts them; since memory still
cannot be allocated, it reserves an 8 KB buffer on the stack of `g0` to receive the result, as a
source comment explicitly notes [[Go Authors, 2026b](#ref-go-authors-2026b)].

`schedinit` initializes the rest of the runtime. A condensed version of the code follows
(`runtime/proc.go`, Go 1.26 [[Go Authors, 2026b](#ref-go-authors-2026b)]):

```go
func schedinit() {
	gp := getg()            // the current goroutine, g0 at this point
	sched.maxmcount = 10000 // upper limit on the number of threads

	stackinit()      // initialize the pools that cache goroutine stacks
	randinit()       // random number generator, seeded from AT_RANDOM
	mallocinit()     // memory allocator: check the page size, randomize the heap base
	cpuinit(godebug) // query the instruction set extensions the processor supports
	alginit()        // choose the map hash function; maps may be used only after this
	...
	typelinksinit()  // organize the type information written by the linker; needs maps
	...
	goargs()         // convert the arguments and environment variables to Go strings
	goenvs()
	gcinit()         // garbage collector: only sets parameters here, enabled in 3.6

	// procs is the value of the environment variable GOMAXPROCS, or the default when unset (3.5.4)
	procresize(procs) // create procs Ps; the main thread holds the first
}
```

Strict ordering constraints apply between these calls, and the source records each with a comment of
the form "must run before ...". Two of them are analyzed below.

The first is the heap. On 64-bit platforms, Go 1.26 randomizes the heap base address by default,
which makes object addresses hard to predict [[Go Authors, 2026e](#ref-go-authors-2026e)]. Running
the same program three times on darwin/arm64, the address of the same heap object was
`0x5ed4deda6040`, `0x40a67d326040` and `0x7cb2110b0340`; with this feature turned off by
`GOEXPERIMENT=norandomizedheapbase64`, the address always begins with `0x140`. The random number
generator (`randinit`) must therefore be initialized before the heap (`mallocinit`), and its seed is
the 16 bytes of random data that the kernel provides through the auxiliary vector.

The second is maps. When the processor supports AES instructions, Go uses them to compute map
hashes, which is faster than a pure software implementation. Whether they are supported must first
be queried item by item by `cpuinit` through `CPUID`; and until `alginit` has chosen the hash
function, the runtime's own code cannot use maps either.

This is the same kind of problem as the package initialization discussed in [3.6](./main.md): a set
of operations has ordering constraints, and an execution order that satisfies all of them must be
found. The difference is that the order of package initialization is computed automatically by the
linker, whereas the order here is arranged by hand by the runtime authors, with the reasons recorded
in comments.

## 3.5.4 The Processor P and GOMAXPROCS

The last step of `schedinit` is to create the Ps. A **processor** (P) is the resource in the
scheduler that is needed to execute Go code: a thread must hold a P to run goroutines, so the number
of Ps determines how many goroutines can execute in parallel at the same time, and this number is
`GOMAXPROCS`. How threads, Ps and goroutines cooperate is covered in
[9.3](../../part3concurrency/ch09sched/mpg.md). The main thread obtains the first P, denoted P0.

If the environment variable `GOMAXPROCS` is set, its value is used
[[Go Authors, 2026d](#ref-go-authors-2026d)]. The default when it is unset has changed twice. Before
Go 1.5 the default was 1, so Go code used only one core even on a multi-core machine; since Go 1.5
it is the number of CPUs [[Cox, 2015](#ref-cox-2015)].

The second change concerns containers. Linux implements the CPU quota of a container through cgroup
bandwidth control (CFS bandwidth control), where the quota is expressed as the maximum CPU time
available in each period, and the period defaults to 100 milliseconds
[[Linux Kernel, n.d.](#ref-linux-kernel-nd)]. For example, a container with a quota of 2 CPUs on a
64-core machine may use at most 200 milliseconds of CPU time per 100 milliseconds. The program
inside the container still sees 64 CPUs, so Go 1.24 and earlier set `GOMAXPROCS` to 64. Under high
load, 64 threads run at the same time and exhaust the 200 millisecond quota of the current period in
about 3 milliseconds; for the rest of that period, the whole container is paused, and request
latency fluctuates noticeably. The community therefore developed libraries that read the quota at
startup, such as Uber's `automaxprocs` [[Uber, n.d.](#ref-uber-nd)].

Go 1.25 brought this capability into the runtime [[Pratt and Amedee, 2025](#ref-pratt-amedee-2025)].
On Linux, the default is the smaller of two values: the number of CPUs available to this process,
and the container's CPU quota rounded up and not less than 2. While the program runs, the system
monitoring thread sysmon ([3.6](./main.md)) checks once per second and adjusts the value when the
available CPUs or the quota change [[Go Authors, 2026c](#ref-go-authors-2026c)]. Once the value is
set explicitly, through the environment variable or `runtime.GOMAXPROCS`, it is no longer adjusted
automatically. The quota here corresponds to the "CPU limit" of container platforms such as
Kubernetes; the "CPU request" allocates CPU by weight and does not affect this default.

## 3.5.5 The First Goroutine

After `schedinit` returns, only two steps remain in `rt0_go`:

```asm
	MOVQ	$runtime·mainPC(SB), AX   // address of runtime.main
	PUSHQ	AX
	CALL	runtime·newproc(SB)       // create a goroutine for it and put it in a run queue
	POPQ	AX
	CALL	runtime·mstart(SB)        // the main thread enters the scheduling loop and never returns
	CALL	runtime·abort(SB)         // reaching here means something went wrong
```

`newproc` is the runtime implementation of the `go` statement; `go f()` compiles to a call to it. It
creates a goroutine for `runtime.main`, allocates an initial stack (2 KB on Linux; memory can be
allocated by now), arranges for the goroutine to start at the entry of `runtime.main`, and puts it
in the local run queue of P0. The first goroutine executes `runtime.main` rather than the user's
`main.main`: `runtime.main` first does the preparation described in 3.6.1 and then calls
`main.main`. The segment `runtime.mainPC -> runtime.main -> ... -> main.main` of the reference chain
in 3.4 corresponds to exactly this level of indirection.

`mstart` makes the main thread start scheduling. It first installs the signal handlers
([9.6](../../part3concurrency/ch09sched/signal.md)) and then enters the scheduling loop on the stack
of `g0`: pick a runnable goroutine and switch to its stack to run it; when that goroutine pauses,
return to `g0` and pick the next. At this point the run queue holds a single goroutine, so
`runtime.main` starts to run; the rest is covered in 3.6. `mstart` never returns, and from then on
the main thread alternates between executing goroutines and the scheduling loop.

The whole process can be summarized as follows:

1. The kernel loads the program, writes the arguments, environment variables and auxiliary vector
   onto the stack, and jumps to the entry point `_rt0_amd64_linux`;
2. The entry point extracts the argument count and list and moves on to `rt0_go`;
3. 64 KB of the stack provided by the operating system is carved out as the stack of `g0`;
4. `CPUID` is used to query the processor information;
5. Thread-local storage is set up, and `m0` and `g0` are linked to each other;
6. `check`, `args`, `osinit`: self-check, then read the page size, the random data and the number of
   available CPUs;
7. `schedinit`: initialize the stacks, the random numbers, the heap, the hash function and so on, in
   dependency order;
8. `GOMAXPROCS` Ps are created, and the main thread holds P0;
9. `newproc`: create the first goroutine for `runtime.main` and put it in the run queue of P0;
10. `mstart`: enter the scheduling loop and begin executing `runtime.main`.

The interactive figure below steps through this process; on the right it shows the structures that
exist in the process after each step. Changing the number of CPUs and the container quota shows how
many Ps step 8 creates.

<div class="viz" data-viz="boot-sequence"></div>

## 3.5.6 Why Implement Startup Itself

C programs also have a startup process, supplied by the C library: the startup code added
automatically at link time sets up the environment and then calls `main`. On Linux, Go does not
depend on the C library and makes system calls directly (Linux guarantees a stable system call
interface), so the program entry, thread-local storage and the creation of new threads all have to
be done by the runtime itself, and every combination of operating system and architecture needs a
small piece of assembly. In return there is the executable of 3.4 that depends on no shared library,
and the runtime has complete control over goroutine stacks, threads and signals.

A program that contains C code and is linked by the system's C linker takes another path: the C
library's startup code runs first, and the `main` it calls is a function of the same name that the
Go runtime implements in assembly and that jumps directly to `rt0_go`; thread-local storage has
already been set up by the C library's thread library, so `rt0_go` skips its own setup step.

## Further Reading

- <a id="ref-matz-et-al-2014"></a>[Matz et al., 2014] Michael Matz, Jan Hubička, Andreas Jaeger,
  Mark Mitchell (eds.). *System V Application Binary Interface, AMD64 Architecture Processor
  Supplement*. https://gitlab.com/x86-psABIs/x86-64-ABI (2014 PDF:
  https://www.uclibc.org/docs/psABI-x86_64.pdf, layout of the ELF process stack and the auxiliary
  vector auxv) Archived:
  https://web.archive.org/web/20260918150420/https://www.uclibc.org/docs/psABI-x86_64.pdf
  The "Process Initialization" section specifies the stack layout at program start and the type
  numbers of the auxiliary vector entries.
- <a id="ref-drepper-2013"></a>[Drepper, 2013] Ulrich Drepper. "ELF Handling For Thread-Local
  Storage."
  2013. https://akkadia.org/drepper/tls.pdf
  How thread-local storage is implemented jointly by the compiler, linker and operating system on
  Linux and similar systems.
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. "Go internal ABI
  specification." `src/cmd/compile/abi-internal.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/abi-internal.md Specifies
  that amd64 keeps the current goroutine in `R14`, and explains why.
- <a id="ref-cox-2015"></a>[Cox, 2015] Russ Cox. "Go 1.5 GOMAXPROCS Default." 2015.
  https://go.dev/s/go15gomaxprocs
  The proposal to change the default of `GOMAXPROCS` from 1 to the number of CPUs.
- <a id="ref-pratt-amedee-2025"></a>[Pratt and Amedee, 2025] Michael Pratt, Carlos Amedee.
  "Container-aware GOMAXPROCS." *The Go Blog*, 2025. https://go.dev/blog/container-aware-gomaxprocs
  The background and design of the default that Go 1.25 derives from the container quota.
- <a id="ref-linux-kernel-nd"></a>[Linux Kernel, n.d.] The Linux Kernel documentation. "CFS
  Bandwidth Control." https://docs.kernel.org/scheduler/sched-bwc.html How the container CPU quota
  (a quota per period) works.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `runtime/asm_amd64.s`
  (`rt0_go`) and `runtime/proc.go` (`schedinit`, `newproc`, `mstart`), Go 1.26.
  https://github.com/golang/go/tree/release-branch.go1.26/src/runtime
  https://github.com/golang/go/tree/master/src/runtime (`rt0_linux_amd64.s`, `rt0_darwin_amd64.s`)
  https://github.com/golang/go/blob/master/src/runtime/proc.go The source of the code in this
  section.
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *runtime/cgroup_linux.go (the
  cgroup-aware default of `GOMAXPROCS`, Go 1.25+).*
  https://github.com/golang/go/blob/master/src/runtime/cgroup_linux.go
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Package runtime
  documentation.* https://pkg.go.dev/runtime
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors. *Go 1.26 Release
  Notes*, "Heap base address randomization".
  https://go.dev/doc/go1.26#heap-base-address-randomization The heap base is randomized by default
  on 64-bit platforms, and the `GOEXPERIMENT` that turns this off.
- <a id="ref-uber-nd"></a>[Uber, n.d.] Uber. *automaxprocs.* https://github.com/uber-go/automaxprocs
  A library that sets `GOMAXPROCS` at startup from the container's CPU quota.
- This book: [1.2 An Overview of the Go Language](../ch01intro/go.md) (the view of a binary as
  containing a miniature operating system),
  [9.1 The Scheduling Problem and the GMP Model](../../part3concurrency/ch09sched/model.md) (the
  list of Ps and the scheduling loop),
  [9.6 Signal Handling](../../part3concurrency/ch09sched/signal.md).
- This book: [Chapter 12 Memory Allocator](../../part4memory/ch12alloc/),
  [Chapter 13 Garbage Collector](../../part4memory/ch13gc/) (the structures built by `mallocinit`
  and `gcinit`), [3.6 The Life and Death of the Main Goroutine](./main.md).
