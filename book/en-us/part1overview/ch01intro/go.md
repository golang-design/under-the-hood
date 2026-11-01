---
weight: 1102
title: "1.2 An Overview of the Go Language"
---

# 1.2 An Overview of the Go Language

Start by compiling a program that prints a single line, and look at what the resulting executable
contains (Go 1.26.10, darwin/arm64):

```go
package main

import "fmt"

func main() { fmt.Println("hello") }
```

```
$ go build -o hello main.go
$ wc -c < hello
 2508994
$ go tool nm hello | grep -c ' T '
2024
$ go tool nm hello | grep -c ' T runtime\.'
1400
$ go tool nm hello | grep ' T main\.'
10009f630 T main.main
```

`go tool nm` lists the named functions and variables in the file, and the `T` column marks
functions. The source defines one function, `main.main`, yet the executable contains 2024 functions,
1400 of them in the `runtime` package. They make up the bulk of the Go **runtime**, which every Go
program includes. How the linker decides which functions to keep is covered in
[3.4](../ch03life/link.md).

This section gives the book an overall framework: the parts that make up Go, the design decisions
that set it apart from mainstream languages, and where in the book each decision is examined.

## 1.2.1 Three Components

The **language** is the part programmers write directly: syntax, types, concurrency and error
handling. It is deliberately small, with only 25 keywords
[[Go Authors, 2026a](#ref-go-authors-2026a)]. For a systematic introduction to the language itself,
see the textbook by Donovan and Kernighan
[[Donovan and Kernighan, 2015](#ref-donovan-kernighan-2015)]; this book is concerned with its
implementation.

The **runtime** is the code linked into every program. It multiplexes many goroutines onto a few
operating system threads, allocates memory for objects, reclaims memory that is no longer in use,
and gives each goroutine a stack that grows on demand. Most of this work was traditionally done by
the operating system; Go reimplements it inside the process, which is why the runtime is often
compared to a small operating system.

The **toolchain** turns source code into programs that can be run, diagnosed and maintained: the
`go` command, the compiler, the linker, the module system, and the testing and profiling tools. In
their 2022 retrospective, Go's designers observe that the language is only a small part of why Go
succeeded; libraries, tools, conventions and the overall approach to software engineering matter as
much [[Cox et al., 2022](#ref-cox-et-al-2022)].

A comparison with C and Java is instructive. C programs also have a runtime, but a minimal one:
startup code and the C standard library, with threads and memory left almost entirely to the
operating system. Java's runtime is a virtual machine, usually installed separately, on which the
program runs. Go links the runtime directly into the executable: copy one file to the target machine
and it runs, and goroutine scheduling and garbage collection are nearly invisible to the programmer.
The price is a larger executable and a runtime that is itself quite complex, which is what most of
this book discusses.

## 1.2.2 Some Unusual Design Decisions

**Concurrency is part of the language.** A single `go` keyword starts a function running
concurrently, and goroutines pass data to each other through channels:

```go
ch := make(chan int)
go func() { ch <- compute() }() // compute in a new goroutine and send the result
result := <-ch                  // wait for the result here
```

This style is practical because goroutines are cheap. The following program starts ten thousand
goroutines, blocks all of them on one channel, and measures the growth in memory:

```go {run=true}
package main

import (
	"fmt"
	"runtime"
)

func main() {
	const n = 10000
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)

	block := make(chan struct{})
	for range n {
		go func() { <-block }() // block right after starting, so it stays alive
	}
	runtime.ReadMemStats(&after)

	stack := after.StackInuse - before.StackInuse
	heap := after.HeapInuse - before.HeapInuse
	fmt.Println("goroutines:", runtime.NumGoroutine())
	fmt.Println("per goroutine: stack", stack/n, "bytes, heap record", heap/n, "bytes")
	close(block)
}
```

One run on darwin/arm64 produced the following (results differ by a few bytes from run to run):

```
goroutines: 10001
per goroutine: stack 2097 bytes, heap record 678 bytes
```

Run in a browser (js/wasm), the result is a stack of 2048 bytes and 516 bytes on the heap; the exact
numbers vary slightly by platform. Each goroutine's stack is at least 2 KB (`stackMin` in
`runtime/stack.go`) and grows when it runs short
([Chapter 14](../../part4memory/ch14stack/readme.md)); the runtime also adjusts the initial stack
size of new goroutines according to the average stack size measured during garbage collection. The
heap part is the state the runtime keeps for each goroutine, plus the record left when it waits on a
channel. By comparison, an operating system thread's stack is usually measured in megabytes. The
cost is that the runtime must implement a sophisticated scheduler
([Chapter 9](../../part3concurrency/ch09sched/readme.md)). The origin of this concurrency model is
in [1.3](./csp.md).

**Interfaces need no explicit declaration.** A type satisfies an interface automatically if it has
the methods the interface requires; no `implements` clause is written
[[Pike, 2012](#ref-pike-2012)]:

```go {run=true}
package main

import (
	"fmt"
	"os"
	"strings"
)

// upper never declares that it implements io.Writer,
// but it has a Write method with the matching signature, so it satisfies the interface.
type upper struct{ n int }

func (u *upper) Write(p []byte) (int, error) {
	u.n += len(p)
	return os.Stdout.Write([]byte(strings.ToUpper(string(p))))
}

func main() {
	u := &upper{}
	fmt.Fprintf(u, "hello, %s\n", "gopher") // Fprintf only requires an io.Writer
	fmt.Println("bytes written:", u.n)
}
```

```
HELLO, GOPHER
bytes written: 14
```

The benefit is that an interface can be designed after the fact for types that others defined, which
is why small single-method interfaces such as `io.Reader` and `io.Writer` are so widely used
[[Go Authors, 2026b](#ref-go-authors-2026b)]. The cost is that a call through an interface must
first look up the actual method in a table, and the compiler usually cannot inline it
([4.2](../../part2lang/ch04type/interface.md)).

**Errors are ordinary values.** A function returns an error as a value, and the caller checks it on
the spot; there is no `try`/`catch` style transfer of control:

```go
f, err := os.Open(name)
if err != nil {
	return fmt.Errorf("open %s: %w", name, err) // add context and return to the caller above
}
defer f.Close() // cleanup sits next to the open and runs when the function returns
```

The benefit is that the error path is plainly visible; the cost is a great deal of repeated
`if err != nil` ([Chapter 7](../../part2lang/ch07errors/readme.md); for `defer` see
[6.2](../../part2lang/ch06func/defer.md)).

**A slice is a view of an underlying array.** Go has three built-in containers, slices, maps and
channels, of which slices are the most common. A slice records an underlying array, a starting
position, the number of accessible elements (the length) and the number of elements it can be
extended to (the capacity). Assignment and argument passing copy only the slice itself, not the
underlying array:

```go {run=true}
package main

import "fmt"

func main() {
	s := make([]int, 3, 4) // length 3, underlying array capacity 4
	t := append(s, 4)      // enough capacity: t and s share the same underlying array
	t[0] = 99
	fmt.Println(s, t) // s sees the 99 as well

	u := append(t, 5) // not enough capacity: a new array is allocated, u and t are independent from now on
	u[1] = 77
	fmt.Println(t, u)
}
```

```
[99 0 0] [99 0 0 4]
[99 0 0 4] [99 77 0 4 5]
```

Passing a slice is cheap; the cost is that two slices may share one array without anyone noticing.
Whether they still share it after an `append` depends on whether the capacity suffices
([5.1](../../part2lang/ch05data/slice.md)).

**Nothing happens implicitly.** Go has no operator overloading and no automatic conversion between
numeric types, and an unused import or an unused declared variable is a compile error
[[Pike, 2012](#ref-pike-2012)]:

```go
package main

import "os"

func main() {
	var a int32 = 1
	var b int64 = a
	_ = b
}
```

```
./main.go:3:8: "os" imported and not used
./main.go:7:16: cannot use a (variable of type int32) as int64 value in variable declaration
```

A few more characters at the keyboard buy the ability to tell what a line does from that line alone.

## 1.2.3 The Structure of This Book

- **Part 1, Overview and History**: why Go is designed as it is (Chapter 1), Go's assembly language
  and calling convention ([Chapter 2](../ch02asm/readme.md)), and a program's whole path from build
  to exit ([Chapter 3](../ch03life/readme.md)).
- **Part 2, Implementing Language Features**: types and interfaces
  ([Chapter 4](../../part2lang/ch04type/readme.md)); slices, strings and maps
  ([Chapter 5](../../part2lang/ch05data/readme.md)); functions, defer and panic
  ([Chapter 6](../../part2lang/ch06func/readme.md)); error handling
  ([Chapter 7](../../part2lang/ch07errors/readme.md)); generics
  ([Chapter 8](../../part2lang/ch08generics/readme.md)).
- **Part 3, Concurrency**: the goroutine scheduler
  ([Chapter 9](../../part3concurrency/ch09sched/readme.md)); channels and select
  ([Chapter 10](../../part3concurrency/ch10chan/readme.md)); locks, atomic operations and the memory
  model ([Chapter 11](../../part3concurrency/ch11sync/readme.md)).
- **Part 4, Memory**: the memory allocator ([Chapter 12](../../part4memory/ch12alloc/readme.md));
  the garbage collector ([Chapter 13](../../part4memory/ch13gc/readme.md)); goroutine stacks
  ([Chapter 14](../../part4memory/ch14stack/readme.md)).
- **Part 5, Compiler and Toolchain**: the compiler
  ([Chapter 15](../../part5toolchain/ch15compile/readme.md)); debugging and profiling tools
  ([Chapter 16](../../part5toolchain/ch16tools/readme.md)); modules and dependencies
  ([Chapter 17](../../part5toolchain/ch17modules/readme.md)).
- **Part 6, Heterogeneous Computing and Go in the Age of AI**: GPUs, graphics, AI inference and
  agent runtimes ([Chapter 18](../../part6hetero/ch18gpu/readme.md) through
  [Chapter 21](../../part6hetero/ch21agent/readme.md)).

## 1.2.4 Threads Running Through the Book

In 2015 Rob Pike distilled a number of Go community beliefs into 19 "Go
Proverbs" [[Pike, 2015](#ref-pike-2015)]. Several capture the design decisions above: "Clear is
better than clever", "A little copying is better than a little dependency", and "Don't communicate
by sharing memory, share memory by communicating".

When later chapters discuss an implementation, two questions are always worth asking: what does this
approach buy, and what does it cost? The answer can often be traced back to the problems discussed
in [1.1](./history.md).

## Further Reading

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *The Go Programming Language
  Specification*. https://go.dev/ref/spec
  The language specification, the authority for every statement about language rules in this book.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Effective Go*.
  https://go.dev/doc/effective_go
  The official style guide, which explains the reasoning behind many idioms.
- <a id="ref-pike-2012"></a>[Pike, 2012] Rob Pike. "Go at Google: Language Design in the Service of
  Software Engineering." 2012. https://go.dev/talks/2012/splash.article
  The motivation for the design decisions described in this section.
- <a id="ref-cox-et-al-2022"></a>[Cox et al., 2022] Russ Cox, Robert Griesemer, Rob Pike, Ian Lance
  Taylor, Ken Thompson. "The Go Programming Language and Environment." *Communications of the ACM*,
  65(5): 70–78, 2022. https://doi.org/10.1145/3488716 The designers' retrospective: the language is
  only a small part of why Go succeeded; libraries, tools, conventions and software engineering
  practice matter as much.
- <a id="ref-donovan-kernighan-2015"></a>[Donovan and Kernighan, 2015] Alan A. A. Donovan, Brian W.
  Kernighan. *The Go Programming Language*. Addison-Wesley, 2015. A systematic textbook on the Go
  language.
- <a id="ref-pike-2015"></a>[Pike, 2015] Rob Pike. "Go Proverbs." Gopherfest, 2015.
  https://go-proverbs.github.io/
  The full text of the Go Proverbs.
