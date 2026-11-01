---
weight: 1302
title: "3.2 The Go Compilation Pipeline"
---

# 3.2 The Go Compilation Pipeline

The two functions below are almost identical. Each creates a `point` inside the function and takes
its address:

```go {run=true}
package main

import (
	"fmt"
	"testing"
)

type point struct{ x, y int }

func sum(p *point) int { return p.x + p.y }

// The address of p is passed only to sum and is not referenced after sum returns
func local() int {
	p := point{1, 2}
	return sum(&p)
}

// The address of p is returned to the caller, so it outlives escape itself
func escape() *point {
	p := point{3, 4}
	return &p
}

var sink *point // keeps the compiler from optimizing the result away

func main() {
	a := testing.AllocsPerRun(100, func() { _ = local() })
	b := testing.AllocsPerRun(100, func() { sink = escape() })
	fmt.Println("heap allocations per call of local: ", a)
	fmt.Println("heap allocations per call of escape:", b)
}
```

`testing.AllocsPerRun` runs a function 100 times and reports the average number of heap allocations
per call:

```
heap allocations per call of local:  0
heap allocations per call of escape: 1
```

The `p` in `local` lives on the stack and is released automatically when the function returns. The
`p` in `escape` lives on the heap and must be reclaimed by the garbage collector. The compiler makes
this decision before the program runs. With `-gcflags=-m`, the compiler reports its judgments (the
lines about `p` are excerpted):

```
$ go build -gcflags=-m -o /dev/null .
./main.go:10:6: can inline sum
./main.go:13:6: can inline local
./main.go:19:6: can inline escape
./main.go:10:10: p does not escape
./main.go:20:2: moved to heap: p
```

How does the compiler decide whether the lifetime of `p` extends beyond the function, and what
does "can inline" mean? This section follows the order in which the compiler works: which
representation it converts the source into, which analyses and transformations it applies to that
representation, and how it finally produces machine instructions.

## 3.2.1 The Compiler Phases

[3.1](./cmd.md) noted that `go build` invokes the compiler `compile` once per package, producing one
object file. Inside, the compiler is a pipeline: each phase converts the program into another
representation and passes it on [[Go Authors, 2026a](#ref-go-authors-2026a)]:

1. **Lexing and parsing**: split the source text into tokens (keywords, identifiers, literals,
   operators), then organize them by the grammar into a **syntax tree**.
2. **Type checking**: determine which declaration each identifier refers to and the type of each
   expression. Type errors are reported in this phase.
3. **Inlining and escape analysis**: expand the bodies of small functions at their call sites, and
   decide whether each variable is allocated on the stack or on the heap.
4. **Lowering** (walk): rewrite language features such as `go` statements, channel operations and
   map operations into calls to runtime functions.
5. **Optimization**: convert the program into an intermediate representation that is closer to the
   machine and easier to analyze, and run dozens of optimization passes.
6. **Code generation**: select instructions for the target architecture, allocate registers, and
   write the object file.

The first two phases are concerned with whether the program is correct; the later ones with how to
execute it efficiently. The interactive figure below uses the function `larger` from 3.2.6 as an
example and shows how its representation changes phase by phase.

<div class="viz" data-viz="build-pipeline"></div>

## 3.2.2 Parsing and Type Checking

The first phase is implemented in `cmd/compile/internal/syntax`. The Go grammar is deliberately
designed to be easy to parse: on reading a token, the parser can determine the structure of a
statement without knowing whether the preceding identifier is a type name or a variable name. In C,
whether `T * x;` declares a pointer or computes a product depends on whether `T` is a type name. Go
declarations always begin with a keyword such as `var`, `func` or `type`, so this ambiguity does not
exist. In his 2012 article "Go at Google", Rob Pike observed that parsing Go requires neither type
information nor a symbol table, which lets the compiler and a variety of tools be small and fast
[[Pike, 2012](#ref-pike-2012)].

Type checking is implemented in `cmd/compile/internal/types2`, and type inference for generics also
happens in this phase ([8.3](../../part2lang/ch08generics/checker.md)). The standard library also
has `go/parser` and `go/types`, used by tools such as `gofmt`, `go vet` and gopls; the compiler
itself does not use them. `types2` is a port of `go/types` into the compiler, and the two share one
test suite.

## 3.2.3 Inlining

A function call has a fixed cost: preparing arguments, jumping, setting up a stack frame, and
jumping back on return. A bigger loss is that the caller cannot see what happens inside the callee,
which rules out many optimizations. Expanding the body of the callee directly at the call site
removes both problems. This transformation is called **inlining**.

Inlining increases code size and lengthens compile time, so it is applied only to small functions.
The compiler uses the number of nodes in the syntax tree of the function body as its **inline
cost**, and inlines only when the cost is at most 80; each call in the body to a function that
cannot be inlined adds another 57 (`cmd/compile/internal/inline/inl.go`). `-gcflags=-m=2` prints the
cost, for example for the function `larger` discussed in 3.2.6:

```
./main.go:3:6: can inline larger with cost 14 as: func(int, int) int { m := a; if b > a { m = b }; return m }
```

In the opening example, `sum`, `local` and `escape` are all inlined. This is why, in the experiment
of [3.1](./cmd.md), changing the body of `greet.Hello` also forces `main` to be recompiled: the body
of `Hello` has been inlined into `main`.

The budget of 80 treats all functions alike, yet the running time of a program is often concentrated
in a few functions. Since Go 1.21, a CPU profile collected in production can be placed in the main
package directory (as the file `default.pgo`); the compiler uses it to find the most frequently
executed call sites and raises the budget at those sites to 2000. This technique is called
**profile-guided optimization** (PGO) [[Go Authors, 2026d](#ref-go-authors-2026d)].

## 3.2.4 Escape Analysis

A local variable is allocated in the function's stack frame and released together with the frame
when the function returns, at no extra cost. But if a pointer to a local variable still exists after
the function returns, the variable cannot disappear with the frame; it must be allocated on the heap
and reclaimed by the garbage collector once it is no longer referenced.

C leaves this problem to the programmer: returning the address of a local variable is an error, and
the program then reads memory that has been overwritten. Go allows `return &p` and guarantees that
it is safe, by having the compiler decide whether each variable escapes the function that contains
it. This is called **escape analysis**. The comment at the top of `escape.go` reduces the properties
to be guaranteed to two invariants:

1. A pointer to a stack object cannot be stored in the heap.
2. A pointer to a stack object cannot outlive the object.

The compiler builds a weighted directed graph: vertices represent storage locations such as
variables, edges represent assignments, and the weight of an edge records the number of address-of
and dereference operations along the way. It then checks whether there is a path that carries the
address of a variable into the heap or out of the function; if there is, the variable is allocated
on the heap. The `p` in `escape` is carried out of the function by `return &p`, so the compiler
reports "moved to heap". The parameter `p` of `sum` only has two of its fields read, so the report
is "does not escape". This conclusion is saved with the package's export data, so when other
packages call `sum`, they also know that passing it the address of a stack variable is safe.

Escape analysis is conservative: a variable that cannot be proved not to escape is treated as
escaping. Storing an address in a global variable, sending it on a channel, passing it as an
argument to a new goroutine, or passing it to a function the compiler cannot analyze (for example, a
method called through an interface) usually causes the variable to be allocated on the heap.

The idea did not originate with Go. In the 1990s, researchers in functional languages and in Java
were exploring how a compiler could discover that an object does not escape the function that
creates it, so that it can be allocated on the stack. At OOPSLA 1999, Choi et al. at IBM and
Blanchet each presented an escape analysis for Java [[Choi et al., 1999](#ref-choi-et-al-1999)]
[[Blanchet, 1999](#ref-blanchet-1999)]. The Java virtual machine performs this analysis during
just-in-time compilation; Go performs it at compile time, on every build, and the results can be
inspected directly with `-gcflags=-m`. Fewer heap allocations also reduce the burden on the garbage
collector ([Chapter 13](../../part4memory/ch13gc/readme.md)).

## 3.2.5 Lowering Language Features

The next phase is called walk. It decomposes complex statements into simple steps, fixes the order
of evaluation, and rewrites high-level language features into lower-level forms: `switch` becomes
binary search or a jump table, and `go` statements and channel and map operations become calls to
runtime functions. Take the following function as an example:

```go
func work() {}

func send(ch chan int, m map[string]int) {
	go work()
	ch <- 1
	m["k"]++
}
```

`go build -trimpath -gcflags=-S` prints the assembly of `send` (darwin/arm64; the instruction
address column and some auxiliary instructions are omitted):

```
TEXT  main.send(SB), ABIInternal, $48-16
MOVD  16(g), R16                       // load the stack guard of the current goroutine
CMP   R16, RSP                         // compare the stack pointer with the guard
BLS   112                              // not enough stack: jump to the end to grow it
...
MOVD  $main.work·f(SB), R0
CALL  runtime.newproc(SB)              // go work()
MOVD  main.ch(FP), R0
MOVD  $main..stmp_0(SB), R1
CALL  runtime.chansend1(SB)            // ch <- 1
MOVD  $type:map[string]int(SB), R0
MOVD  main.m+8(FP), R1
MOVD  $go:string."k"(SB), R2
CALL  runtime.mapassign_faststr(SB)    // locate the storage of m["k"]
MOVD  (R0), R1
ADD   $1, R1, R1                       // ++
MOVD  R1, (R0)
...
RET   (R30)
...
CALL  runtime.morestack_noctxt(SB)     // grow the stack, then restart from the function entry
JMP   0
```

Three lines of Go become three runtime calls. The runtime implements most of the semantics of
goroutines, channels and maps, and the compiler is responsible for calling it at the right places
with the required information prepared. The first three instructions and the `morestack` call at the
end are also inserted by the compiler: a function that needs stack space checks at entry whether
enough remains, and grows the stack first if not (a small function that uses no stack, like `larger`
in 3.2.6, omits the check). A goroutine stack can therefore start very small and grow on demand
([Chapter 14](../../part4memory/ch14stack/readme.md)).

The compiler and the runtime divide labor in many similar ways. The common ones are:

| Go code | Code generated by the compiler | Responsibility of the runtime |
| --- | --- | --- |
| `go f()` | call `runtime.newproc` | create a goroutine and hand it to the scheduler ([9.4](../../part3concurrency/ch09sched/schedule.md)) |
| `ch <- v`, `<-ch` | call `runtime.chansend1`, `runtime.chanrecv1` | send, receive and blocking ([Chapter 10](../../part3concurrency/ch10chan/readme.md)) |
| entry of a function that needs stack space | check the stack bound and call `morestack` if it is exceeded | allocate a larger stack and migrate to it ([Chapter 14](../../part4memory/ch14stack/readme.md)) |
| writing a pointer into the heap, `*p = q` | insert a write barrier that records extra information during garbage collection | the collector uses it to avoid missing objects ([13.2](../../part4memory/ch13gc/barrier.md)) |
| types that contain pointers | generate a bitmap marking where the pointer fields are | the collector uses it to scan objects ([4.1](../../part2lang/ch04type/type.md)) |

## 3.2.6 Static Single Assignment Form

Up to this point the program still has the shape of the source: a variable can be assigned many
times, which makes optimization hard. Consider this function:

```go
func larger(a, b int) int {
	m := a
	if b > a {
		m = b
	}
	return m
}
```

To answer "what is the value of `m` when `return m` executes", one must find all assignments to `m`
and decide which of them can reach this point. Changing the representation simplifies the question:
every assignment introduces a new name. Write `m := a` as `m1` and `m = b` as `m2`. The two
control-flow paths merge before `return`, and at the merge point a special selection operation is
placed: "take `m2` if coming from the `if` branch, otherwise `m1`". Its result is written `m3`.
After this rewrite, each name is defined in exactly one place, and to learn about a value one only
has to look at its definition.

This representation is called **static single assignment form** (SSA), and the selection operation
at the merge point is called a φ function. It was proposed in the late 1980s by Barry Rosen, Mark
Wegman, Kenneth Zadeck and others while studying how to decide whether two expressions in a program
are always equal [[Rosen et al., 1988](#ref-rosen-et-al-1988)]. In 1991 Ron Cytron et al. gave an
efficient algorithm for converting an arbitrary program to SSA form
[[Cytron et al., 1991](#ref-cytron-et-al-1991)], and it has since become the standard intermediate
representation of compilers; both GCC and LLVM are built around it. The reason is that many
optimizations become direct on SSA form: if a value is a constant, all its uses can be replaced by
that constant; if two values are computed identically, the computation need be done only once; if a
value is never used, it can be deleted.

The original Go back end was inherited from the Plan 9 C compiler and did not use SSA. Go 1.7 (2016)
enabled a new SSA-based back end on amd64 [[Go Authors, 2016](#ref-go-authors-2016)], and Go 1.8
extended it to all architectures [[Go Authors, 2017](#ref-go-authors-2017)]. Setting `GOSSAFUNC`
shows the form of a function after each optimization pass; adding `+` after the function name also
prints it to the terminal, otherwise only the web page `ssa.html` is generated
[[Go Authors, 2026b](#ref-go-authors-2026b)]:

```
$ GOSSAFUNC=larger+ go build -o /dev/null .
```

Right after conversion to SSA form, `larger` looks as follows (a few irrelevant values removed):

```
b1:
    v7 = Arg <int> {a}
    v8 = Arg <int> {b}
    v10 = Less64 <bool> v7 v8          // a < b
    If v10 -> b3 b2
b2: <- b1 b3
    v12 = Phi <int> v7 v11 (m[int])    // φ function: take v7 (m1) or v11 (m2)
    Ret ...
b3: <- b1
    v11 = Copy <int> v8 (b[int], m[int])
    Plain -> b2
```

`b1`, `b2` and `b3` are three **basic blocks**: sequences of instructions that execute in order,
with the end of the block deciding where control goes next. The `m` in the source has become three
values: `v7`, `v11`, and `v12` at the merge point, where `v12` is the φ function. `larger` goes
through 54 passes in all, and a few of them have the most visible effect:

- `branchelim` finds that the two paths exist only to select one value, so it rewrites the branch
  into a conditional select and merges the three basic blocks into one:
  `v12 = CondSelect <int> v8 v7 v10`.
- `lower` replaces architecture-independent operations with arm64 instructions: the comparison
  becomes `CMP` and the conditional select becomes `CSEL`.
- `regalloc` assigns a register to each value: `a` in `R0`, `b` in `R1`, and the result is written
  back to `R0`.

The final machine code is only three instructions:

```
CMP   R0, R1            // compare b with a
CSEL  GT, R1, R0, R0    // take b if b is greater than a, otherwise a; the result goes to R0
RET
```

There is no branch instruction in it. A processor predicts the direction of branches and must
discard speculatively executed work when the prediction fails; `CSEL` involves no branch, so there
is no misprediction cost.

## 3.2.7 Object Files and Export Data

Besides machine code and information for the linker ([3.4](./link.md)), the object file written by
the compiler contains **export data**, which holds everything other packages need when they import
this package: the exported types and function signatures, the bodies of inlinable functions, the
bodies of generic functions, and the conclusions of escape analysis for each parameter
[[Go Authors, 2026c](#ref-go-authors-2026c)].

When package Q imports package P, the compiler reads only the export data of P, not the source of P.
The export data also includes the information from lower-level packages that is involved in the
public interface of P, so Q needs to read just one file for each directly imported package. C and
C++ do the opposite: `#include` inserts the text of a header file verbatim, the same header is
parsed again in every source file that includes it, and headers include other headers in turn. Pike
gives an example from inside Google in "Go at Google": after header expansion, the input handed to
the compiler for a large C++ program was about two thousand times the size of the source itself
[[Pike, 2012](#ref-pike-2012)].

This approach has a cost too: the higher a package sits, the more lower-level information its export
data carries, and a widely used set of large types appears in the export data of almost every
package. The compiler's remedy is to build an index over the export data and decode only the parts
that are actually used [[Go Authors, 2026a](#ref-go-authors-2026a)].

This shows the orientation of the Go compiler: it compiles one package at a time, packages are
connected only through export data, and packages can be compiled in parallel; optimization is mostly
within a package, and the inline budget is set small. The result is very fast compilation, which
makes the incremental builds described in [3.1](./cmd.md), where only modified packages are
recompiled, truly save time. The price is some run-time performance, and profile-guided optimization
exists to recover that loss where it matters.

## Further Reading

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. "Introduction to the Go
  compiler." `cmd/compile/README.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/README.md
  https://github.com/golang/go/blob/master/src/cmd/compile/README.md The official description of the
  compiler phases and export data; the division into phases in this section comes from it.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. "Introduction to the Go
  compiler's SSA backend." `cmd/compile/internal/ssa/README.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/internal/ssa/README.md
  https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssa/README.md Values, basic
  blocks and rewrite rules in the SSA back end, and the use of `GOSSAFUNC`.
- <a id="ref-rosen-et-al-1988"></a>[Rosen et al., 1988] Barry K. Rosen, Mark N. Wegman, F. Kenneth
  Zadeck. "Global Value Numbers and Redundant Computations." *Proceedings of the 15th ACM Symposium
  on Principles of Programming Languages (POPL)*, 1988. One of the earliest papers in which SSA
  appears, used to find equal values in a program.
- <a id="ref-cytron-et-al-1991"></a>[Cytron et al., 1991] Ron Cytron, Jeanne Ferrante, Barry K.
  Rosen, Mark N. Wegman, F. Kenneth Zadeck. "Efficiently Computing Static Single Assignment Form and
  the Control Dependence Graph." *ACM Transactions on Programming Languages and Systems*, 13(4):
  451–490, 1991. https://doi.org/10.1145/115372.115320 Gives an efficient algorithm for constructing
  SSA form, since adopted by compilers generally.
- <a id="ref-choi-et-al-1999"></a>[Choi et al., 1999] Jong-Deok Choi, Manish Gupta, Mauricio
  Serrano, Vugranam C. Sreedhar, Sam Midkiff. "Escape Analysis for Java." *Proceedings of
  OOPSLA '99*, 1999. https://doi.org/10.1145/320384.320386 Escape analysis for Java, likewise aimed
  at allocating objects on the stack.
- <a id="ref-pike-2012"></a>[Pike, 2012] Rob Pike. "Go at Google: Language Design in the Service of
  Software Engineering." 2012. https://go.dev/talks/2012/splash.article
  Why Go treats compilation speed as a design goal, and the C++ header expansion example.
- <a id="ref-go-authors-2016"></a>[Go Authors, 2016] The Go Authors. *Go 1.7 Release
  Notes*, "Compiler Toolchain". https://go.dev/doc/go1.7 The first official release shipped with the
  new SSA-based back end.
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Making Unified Intermediate
  Representation (UIR) Changes* (`cmd/compile/internal/noder/README.md`).
  https://github.com/golang/go/blob/master/src/cmd/compile/internal/noder/README.md
  (IR construction and the export data format.)
- <a id="ref-blanchet-1999"></a>[Blanchet, 1999] Bruno Blanchet. "Escape Analysis for
  Object-Oriented Languages: Application to Java." *Proceedings of OOPSLA '99*, 1999: 20–34.
  https://doi.org/10.1145/320384.320387 Another escape analysis for Java, published at the same time
  as Choi et al.
- <a id="ref-go-authors-2017"></a>[Go Authors, 2017] The Go Authors. *Go 1.8 Release
  Notes*, "Compiler Toolchain". https://go.dev/doc/go1.8#compiler The SSA back end extended to all
  architectures.
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Profile-guided
  optimization.* https://go.dev/doc/pgo The use of `default.pgo` and the optimizations PGO performs.
- This book: [15.1 Lexing and Grammar](../../part5toolchain/ch15compile/parse.md),
  [15.2 Intermediate Representation](../../part5toolchain/ch15compile/ssa.md),
  [8.3 Type-Checking Techniques](../../part2lang/ch08generics/checker.md).
- This book: [1.1 The Evolution of Programming Languages](../ch01intro/history.md),
  [13.2 Write Barrier Techniques](../../part4memory/ch13gc/barrier.md),
  [Chapter 14 Execution Stack Management](../../part4memory/ch14stack/readme.md).
