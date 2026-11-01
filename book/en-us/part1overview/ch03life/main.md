---
weight: 1306
title: "3.6 The Life and Death of the Main Goroutine"
---

# 3.6 The Life and Death of the Main Goroutine

Consider two examples. What does the first program print?

```go {run=true}
package main

import "fmt"

var (
	a = c + b // depends on b and c
	b = f("b")
	c = f("c")
	d = 3
)

func f(name string) int {
	d++
	fmt.Printf("initializing %s, d = %d\n", name, d)
	return d
}

func init() { fmt.Println("init: a, b, c, d =", a, b, c, d) }

func main() { fmt.Println("main") }
```

Although `a` is declared first, it is initialized last:

```
initializing b, d = 4
initializing c, d = 5
init: a, b, c, d = 9 4 5 5
main
```

The second example: what happens to the other goroutines still running when `main` returns?

```go {run=true}
package main

import (
	"fmt"
	"time"
)

func main() {
	go func() {
		time.Sleep(10 * time.Millisecond)
		fmt.Println("background goroutine done")
	}()
	fmt.Println("main returns")
}
```

The program prints only "main returns". The background goroutine has no chance to print before the
process ends.

The answers to both questions have to do with the first goroutine of the program. As
[3.5](./boot.md) described, once the runtime has finished starting up, it creates a goroutine to
execute `runtime.main`. That function does some preparation, then runs the initialization code of
all packages in a deterministic order, then calls the user's `main.main`, and ends the whole process
when `main.main` returns. This goroutine is the **main goroutine**.

## 3.6.1 Preparation Before `main.main`

Before calling user code, `runtime.main` does three main things:

1. It starts the system monitoring thread sysmon
   ([9.8](../../part3concurrency/ch09sched/sysmon.md)). In the background, sysmon performs periodic
   checks, for example preempting goroutines that have run too long and triggering garbage
   collection when necessary. sysmon occupies a thread of its own and runs no goroutines; on
   WebAssembly (`GOARCH=wasm`) it is not started.
2. It initializes the `runtime` package and then enables garbage collection; until then the
   collector is off. Since Go 1.25, this step also starts the automatic update of GOMAXPROCS: when
   the user has not set GOMAXPROCS explicitly and the number of available CPUs or the container's
   CPU quota changes, the runtime adjusts GOMAXPROCS accordingly.
3. It initializes all the remaining packages the program depends on, in order.

The 5 runtime goroutines observed in `main` by the program at the beginning of [3.5](./boot.md) were
all created by the main goroutine during these steps: the `init` of the `runtime` package starts a
goroutine that forces garbage collection when necessary; enabling garbage collection starts two
background goroutines, one for sweeping and one for returning memory to the operating system; the
automatic update of GOMAXPROCS is performed by a goroutine; and the last one runs finalizers, which
is created on the first call to `runtime.SetFinalizer`, a function that the `os` package calls when
initializing variables such as `os.Stdin`.

A condensed version of the code (`runtime/proc.go`, Go 1.26
[[Go Authors, 2026b](#ref-go-authors-2026b)]):

```go
func main() { // runtime.main, running on the main goroutine
	mainStarted = true
	if haveSysmon {
		systemstack(func() { newm(sysmon, nil, -1) }) // 1. start sysmon
	}

	lockOSThread()                  // lock the main thread during initialization (see below)
	doInit(runtime_inittasks)       // 2. initialize the runtime package
	gcenable()                      //    enable garbage collection
	defaultGOMAXPROCSUpdateEnable() //    start the automatic GOMAXPROCS update
	for m := &firstmoduledata; m != nil; m = m.next {
		doInit(m.inittasks)   // 3. initialize the other packages in the order the linker determined
	}
	unlockOSThread()

	fn := main_main // the user's main.main
	fn()
	runExitHooks(0) // run the exit hooks
	exit(0)         // end the process
}
```

In `proc.go`, `main_main` is only declared, with `//go:linkname main_main main.main` telling the
linker to resolve it to the user's `main.main` [[Go Authors, 2026d](#ref-go-authors-2026d)]. A
source comment explains that when the linker lays out the runtime's code, the address of the `main`
package is not yet known, so the call goes indirectly through a function value.

`lockOSThread` is meant for a few platforms: some system libraries may be called only on the main
thread of the process, for example the graphical interface libraries of macOS. During initialization
the main goroutine stays locked to the main thread; if `runtime.LockOSThread` is called in an
`init`, `main.main` runs on the main thread too.

The code yields a fact that is easy to overlook: **the initialization code of all packages and
`main.main` run one after another on the same goroutine.** An `init` may start new goroutines, but
there is no concurrency between two `init` functions, nor between the last `init` and `main.main`.
The exception is a library built with `-buildmode=c-archive` or `c-shared`: a C thread may call back
into Go before Go's initialization has finished, and the runtime makes it wait for initialization to
end with a channel named `main_init_done` [[Taylor, 2016](#ref-taylor-2016)].

The remaining question is how, when a program often depends on dozens or even hundreds of packages,
the order in which they are initialized is determined.

## 3.6.2 The Order of Package Initialization

### The Dependency Graph and Topological Order

When package P imports package Q, the initialization code of P may use variables in Q, so Q must be
initialized before P. Treat each package as a vertex, and for every import of Q by P draw a directed
edge from Q to P, meaning that Q must finish first. Go forbids import cycles, so this graph has no
cycles: it is a **directed acyclic graph** (DAG). A valid initialization order is a **topological
order** of this graph: a sequence containing all vertices in which the source of every edge comes
before its target. The process of finding a topological order is **topological sorting**.

### Kahn's Algorithm

The algorithm used in this section comes from A. B. Kahn's 1962 paper "Topological sorting of large
networks" [[Kahn, 1962](#ref-kahn-1962)]. The paper addressed the scheduling of large engineering
projects: thousands of tasks, each of which must wait for its predecessors, for which a computer had
to produce a feasible execution order.

Kahn's algorithm maintains a count for every vertex: the number of predecessors not yet completed
(the in-degree). The vertices whose count is zero form the ready set. At each step, a vertex is
taken from the ready set and output, and the count of each of its successors is decremented by one;
a successor whose count drops to zero joins the ready set. Every vertex and every edge is processed
exactly once, so the running time is proportional to the number of vertices plus the number of
edges.

The algorithm also gives a way to detect cycles. If some vertices have not been output and the ready
set is empty, then each remaining vertex has at least one uncompleted predecessor. Starting from any
remaining vertex and tracing back along uncompleted predecessors, since the number of vertices is
finite, one must return to a vertex already visited, so the graph contains a cycle. Conversely, the
vertices on a cycle wait for one another and never enter the ready set. "The algorithm cannot
continue" is therefore equivalent to "a circular dependency
exists" [[Knuth, 1997](#ref-knuth-1997)].

### Go's Rule

At each step of Kahn's algorithm several vertices may be ready at once, and choosing any of them
yields a valid topological order. Go, however, requires the order to be unique: the same program
should be initialized in the same order wherever and however many times it is built. The Go language
specification states [[Go Authors, 2026a](#ref-go-authors-2026a)]:

> Given the list of all packages, sorted by import path, in each step the first uninitialized
> package in the list for which all imported packages (if any) are already initialized is
> initialized. This step is repeated until all packages are initialized.

That is, when several packages are in the ready set, the one whose import path comes first in
lexicographic order is always chosen.

The interactive figure below demonstrates this rule on the (simplified) initialization of a real
program. You can step through it, or add an import to create a cycle and watch how the algorithm
stops.

<div class="viz" data-viz="init-order"></div>

In lexicographic order `internal/godebug` comes before `sync`, but it imports `sync`, so it must
wait until `sync` has been initialized. The resulting order is:

```
errors → sync → internal/godebug → syscall → time → io/fs → os → main
```

In a real program the order can be verified with the environment variable `GODEBUG=inittrace=1`
(available since Go 1.16). Each time the runtime finishes initializing a package it prints a line
giving, in order, the time since program start, the initialization time, the number of bytes
allocated and the number of allocations:

```go {run=true env="GODEBUG=inittrace=1"}
package main

import "fmt"

func main() { fmt.Println("hello") }
```

The output on a macOS (Apple silicon) machine follows; the time values differ from run to run:

```
init internal/bytealg @0 ms, 0 ms clock, 0 bytes, 0 allocs
init internal/runtime/sys @0.13 ms, 0 ms clock, 0 bytes, 0 allocs
init runtime @0.14 ms, 0.024 ms clock, 0 bytes, 0 allocs
init errors @0.24 ms, 0 ms clock, 0 bytes, 0 allocs
init iter @0.28 ms, 0 ms clock, 16 bytes, 1 allocs
init sync @0.30 ms, 0.008 ms clock, 0 bytes, 0 allocs
init internal/godebug @0.33 ms, 0.13 ms clock, 312 bytes, 7 allocs
init syscall @0.49 ms, 0.009 ms clock, 1368 bytes, 7 allocs
init time @0.51 ms, 0.008 ms clock, 0 bytes, 0 allocs
init io/fs @0.54 ms, 0 ms clock, 0 bytes, 0 allocs
init os @0.55 ms, 0.046 ms clock, 7840 bytes, 22 allocs
init unicode @0.62 ms, 0 ms clock, 512 bytes, 4 allocs
init reflect @0.64 ms, 0 ms clock, 0 bytes, 0 allocs
hello
```

The order of `sync` and `internal/godebug` agrees with the figure. `fmt` is not in the list: a
package with no initialization code does not appear. By a comment in the linker source, about half
of the packages in the standard library are in this situation.

### Variables and `init` Functions Within a Package

Initializing a single package takes two steps: first the package-level variables are initialized,
and then the `init` functions are called in turn.

The initialization order of package-level variables uses the same algorithm, with declaration order
replacing import path as the sorting key: at each step, initialize the variable that is earliest in
declaration order and whose dependencies are all initialized. In the example at the beginning, `a`
depends on `b` and `c`; `b` and `c` call `f`, and `f` reads and writes `d`, so both `b` and `c`
depend on `d`. When the compiler analyzes dependencies it follows references into function bodies,
so although `d` does not appear directly in `b = f("b")`, `b` still depends on `d`. Hence:

1. `a`, `b` and `c` all have uninitialized dependencies, and only `d = 3` can be initialized first;
2. now `b` is the earliest declared variable that can be initialized; after calling `f`, `d` becomes
   4 and `b` equals 4;
3. next `c` is initialized, `d` becomes 5 and `c` equals 5;
4. finally `a = c + b` is initialized, giving 9.

Switching the interactive figure to the "variables within a package" scenario lets you watch this
step by step. Dependencies are determined statically by the compiler from the references in the
source, independent of run-time values, so changing `a = c + b` to `a = b + c` leaves the order
unchanged. If the variables depend on one another in a cycle, compilation fails. For example:

```go
package main

var (
	a = d
	d = f()
)

func f() int { return a }

func main() {}
```

`a` depends on `d`, `d` depends on `f`, and `f` reads `a`, which forms a cycle. The compiler
reports:

```
./main.go:4:2: initialization cycle for a
	./main.go:4:2: a refers to d
	./main.go:5:2: d refers to f
	./main.go:8:6: f refers to a
```

Import cycles between packages likewise fail to compile (the error message is
`import cycle not allowed`). Because import cycles are not allowed, an initialization order for
packages always exists.

After all package-level variables are initialized, the `init` functions are called in the order they
appear in the source. A package may have several `init` functions
[[Go Authors, 2026c](#ref-go-authors-2026c)]; when they are spread over different files, the order
depends on the order in which the files are given to the compiler. The language specification
recommends that build systems present files sorted by file name
[[Go Authors, 2026a](#ref-go-authors-2026a)], which is what the `go` command does, so the order of
`init` is determined as well. No place in a program can refer to an `init` function, so it cannot be
called explicitly either.

## 3.6.3 Computing the Initialization Order

The sorting is done at link time, and the runtime only executes in order. For each package the
compiler generates an initialization task record (symbol `p..inittask`) that lists the functions to
be called in turn: the initialization function the compiler generates for package-level variables,
and each `init` the user wrote. Which packages the package imports is attached to the record as a
dedicated kind of relocation entry (`R_INITORDER`) pointing to the records of the imported packages.
The record structure the runtime sees is:

```go
// runtime/proc.go
type initTask struct {
	state uint32 // 0 = uninitialized, 1 = initializing, 2 = done
	nfns  uint32 // followed immediately by nfns function pointers: the variable initializer and each init
}
```

The linker (`cmd/link/internal/ld/inittask.go` [[Go Authors, 2026b](#ref-go-authors-2026b)]) starts
from the record of the `main` package, collects all records and their dependencies along
`R_INITORDER`, and then runs Kahn's algorithm, using a heap sorted by name as the ready set and
taking the lexicographically smallest record each time. A record with no functions to call takes
part in the sorting but is not written to the final list. The resulting order is written into the
executable. After the program starts, `runtime.main` calls `doInit1` on each record in turn:

```go
// runtime/proc.go (the timing code for inittrace is omitted)
func doInit1(t *initTask) {
	switch t.state {
	case 2: // done
		return
	case 1: // re-entered while initializing: the order given by the linker is wrong
		throw("recursive call during initialization - linker skew")
	default:
		t.state = 1
		// take the nfns function pointers that follow the record and call them
		firstFunc := add(unsafe.Pointer(t), 8)
		for i := uint32(0); i < t.nfns; i++ {
			p := add(firstFunc, uintptr(i)*goarch.PtrSize)
			f := *(*func())(unsafe.Pointer(&p))
			f()
		}
		t.state = 2
	}
}
```

Each of the three values of `state` has a purpose: "done" guarantees that each package is
initialized only once; "initializing" detects ordering errors, and a correct program never reaches
`case 1`.

This division of labor, with the linker sorting and the runtime executing, was introduced in Go 1.21
[[Go Authors, 2023](#ref-go-authors-2023)]. Before that, before initializing a package the runtime
first initialized the packages it imports, recursively (the `initTask` of Go 1.20 carried a
dependency list that `doInit` processed recursively). The language specification only required that
imported packages be initialized before the importer, and did not say which of two packages with no
dependency between them comes first. The order of the dependency list was determined by the order in
which the compiler processed the `import` declarations, so the actual order depended on details such
as how the `import` statements were written. Go 1.21 wrote "sort by import path and pick the first
package that can be initialized" into the specification, and the initialization order has been
uniquely determined since. A few old programs relied on some unspecified order, for example two
packages that do not import each other registering entries in the same global table, and their
behavior may change after an upgrade. The correct fix is to express the dependency explicitly with
`import`.

## 3.6.4 Return of the Main Goroutine and Process Exit

After `main.main` returns, `runtime.main` does not wait for other goroutines, which the language
specification states explicitly [[Go Authors, 2026a](#ref-go-authors-2026a)]. It does very little
cleanup. If another goroutine is at that moment running a `defer` triggered by a panic, it yields
the processor and waits briefly, because that panic may be recovered by `recover`; if the panic has
already reached the stage of printing the error message, it does not return, and that goroutine
prints the full message and ends the process with exit code 2. Beyond that, the runtime runs the
registered exit hooks (at present the only user in the standard library is coverage, which uses it
to write out counter data) and then calls `exit(0)`. The operating system then reclaims the whole
process, the remaining goroutines terminate at once, and their `defer` calls do not run.

This is just what happened in the second example at the beginning. For the background work to
finish, `main` must wait explicitly. Go 1.25 added the `Go` method to `sync.WaitGroup`
[[Go Authors, 2025](#ref-go-authors-2025)], which combines "increment the counter, start the
goroutine, decrement the counter when it ends" into one step:

```go {run=true}
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	var wg sync.WaitGroup
	for i := range 3 {
		wg.Go(func() {
			time.Sleep(time.Duration(i) * time.Millisecond)
			fmt.Println("task", i, "done")
		})
	}
	wg.Wait() // wait for all three tasks to finish
	fmt.Println("all done, main returns")
}
```

The return of `main.main` is only one of the ways a program ends. The common ones compare as
follows:

| How it ends | Exit code | `defer` in `main` | Other goroutines |
| --- | --- | --- | --- |
| `main.main` returns | 0 | run before returning | terminate at once |
| `os.Exit(n)` is called | n | not run | terminate at once |
| An unrecovered panic in another goroutine | 2 | not run | terminate at once |
| All goroutines are blocked (deadlock) | 2 | not run | all blocked |
| The main goroutine calls `runtime.Goexit` | 2 | run | keep running; the program exits with an error after all end |

Two rows deserve separate explanation. The third row means that goroutines have no fault isolation:
an unrecovered panic in any goroutine ends the whole process, even if the main goroutine is
perfectly fine:

```go {run=true}
package main

import (
	"fmt"
	"time"
)

func main() {
	defer fmt.Println("main's defer does not run")
	go func() { panic("background goroutine failed") }()
	time.Sleep(time.Second)
	fmt.Println("never reached")
}
```

The output is `panic: background goroutine failed` followed by the call stack of that goroutine, and
the exit code is 2. If the panic occurs in the main goroutine itself, the case is slightly
different: as the panic unwinds the call stack, the `defer` calls in `main` run, and the process
still ends with exit code 2.

The last row is rarer. `runtime.Goexit` terminates the current goroutine after it has run its own
`defer` calls. When the main goroutine calls it, `main.main` has not returned, so the process does
not exit and the other goroutines run as usual; after they have all finished, the runtime finds that
no goroutine exists at all and can only exit with an error:

```go {run=true}
package main

import (
	"fmt"
	"runtime"
	"time"
)

func main() {
	go func() {
		time.Sleep(10 * time.Millisecond)
		fmt.Println("another goroutine is still running")
	}()
	defer fmt.Println("main's defer runs as usual")
	runtime.Goexit()
}
```

```
main's defer runs as usual
another goroutine is still running
fatal error: no goroutines (main called runtime.Goexit) - deadlock!
```

## 3.6.5 Why Not Wait for Other Goroutines

"The process ends when the main thread ends" is not the only possible design.

C specifies that returning from `main` is equivalent to calling `exit`, and on systems such as Linux
and macOS `exit` terminates all threads of the process. Go follows this rule. Java's rule is
different: as long as non-daemon threads are still running, the program does not exit after `main`
returns; only background threads marked as **daemon threads** are terminated along with everything
else once all other threads have finished [[Gosling et al., 2023](#ref-gosling-et-al-2023)].

Go did not take Java's approach because of how goroutines are designed. `go f()` returns no handle,
so a program can neither query whether a goroutine is still running nor terminate it from outside.
If the runtime waited for all goroutines before exiting, a single background goroutine that failed
to exit would keep the program from ever ending, with no means to stop it. Go's choice is to hand
the decision to `main`: `main` decides when the program ends, and the programmer waits explicitly
for the work that needs waiting for. The cost is that forgetting to wait has become a common error
in Go concurrent programs.

The problem has a more general treatment. In 2018, Nathaniel J. Smith, in the article "Notes on
structured concurrency, or: Go statement considered harmful" [[Smith, 2018](#ref-smith-2018)],
compared the `go` statement to the `goto` of earlier days: `goto` lets control flow jump to any
place in a program, and `go` lets a piece of concurrently executing code outlive the function that
started it. Both break a basic premise of reasoning, namely that when a function returns, all the
work it started has finished. Smith advocates that every concurrent task belong to some block of
code, and that the block wait for all the tasks it started before it ends; this style of programming
is called **structured concurrency**. Go has not changed the semantics of the `go` statement, but it
provides tools that move in this direction: `golang.org/x/sync/errgroup` combines waiting for a
group of goroutines with collecting their errors, `context` carries cancellation signals, and
`WaitGroup.Go` in Go 1.25 makes "register at the time of starting" the most natural way to write it.

This completes the whole life of a Go program, from startup through initialization to exit. The
specific duties of sysmon and the way garbage collection works are covered in
[Chapter 9](../../part3concurrency/ch09sched) and [Chapter 13](../../part4memory/ch13gc)
respectively.

## Further Reading

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *The Go Programming Language
  Specification*, the sections "Package initialization" and "Program initialization and execution".
  https://go.dev/ref/spec#Package_initialization
  The source of the two initialization rules in this section.
- <a id="ref-kahn-1962"></a>[Kahn, 1962] A. B. Kahn. "Topological sorting of large
  networks." *Communications of the ACM*, 5(11): 558–562, 1962.
  https://doi.org/10.1145/368996.369025 The source of the sorting algorithm described in this
  section. Go's linker uses this algorithm and picks lexicographically from the ready set.
- <a id="ref-knuth-1997"></a>[Knuth, 1997] Donald E. Knuth. *The Art of Computer Programming, Volume
  1: Fundamental Algorithms*, 3rd ed., §2.2.3 (Algorithm T). Addison-Wesley, 1997. The classic
  treatment of topological sorting with counts and a queue, including the detection of cycles.
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. *Go 1.21 Release
  Notes*, "Changes to the language". https://go.dev/doc/go1.21 The change that turned initialization
  order from an implementation detail into part of the language specification.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `runtime/proc.go` (`main`,
  `doInit1`) and `cmd/link/internal/ld/inittask.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/link/internal/ld/inittask.go
  https://github.com/golang/go/blob/master/src/runtime/proc.go (`func main`, `doInit`, `doInit1`,
  `initTask`) The source of the linker sorting and the runtime execution.
- <a id="ref-smith-2018"></a>[Smith, 2018] Nathaniel J. Smith. "Notes on structured concurrency, or:
  Go statement considered harmful." 2018.
  https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/ The
  starting point of structured concurrency, useful for understanding Go's exit rule and the place of
  `errgroup`.
- <a id="ref-gosling-et-al-2023"></a>[Gosling et al., 2023] James Gosling et al. *The Java Language
  Specification, Java SE 21 Edition*, §12.8 "Program Exit".
  https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html#jls-12.8
  Java's program exit rule, for comparison with Go's design.
- <a id="ref-go-authors-2025"></a>[Go Authors, 2025] The Go Authors. *Go 1.25 Release
  Notes* (`sync.WaitGroup.Go`). https://go.dev/doc/go1.25
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Effective Go: The init
  function.* https://go.dev/doc/effective_go#init
- <a id="ref-taylor-2016"></a>[Taylor, 2016] Ian Lance Taylor. "runtime: main_init_done can be
  implemented more efficiently." Go issue #15943, 2016. https://github.com/golang/go/issues/15943
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Command compile.*
  https://go.dev/cmd/compile/
- This book: [3.5 Bootstrapping a Go Program](./boot.md),
  [9.8 System Monitoring](../../part3concurrency/ch09sched/sysmon.md),
  [11 Synchronization Primitives and Patterns](../../part3concurrency/ch11sync).
