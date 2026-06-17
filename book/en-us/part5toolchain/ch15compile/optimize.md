---
weight: 5103
title: "15.3 The Optimizer"
---

# 15.3 The Optimizer

[15.2](./ssa.md) lowered the front end's syntax tree down to the SSA intermediate
representation and explained why SSA's "each variable is assigned exactly once"
makes the optimization passes both accurate and fast to write. This section
continues from there: on top of this representation, what optimizations does the
compiler actually run, and why precisely these few.

To read the Go optimizer well, we first have to read its disposition. Faced with
the same task of turning a high-level language into machine code, GCC and LLVM
are willing to spend seconds or even tens of seconds kneading a function over and
over to win the last few percent of run-time performance. Go takes a different
road: it does only the batch of optimizations with the best cost-to-benefit
ratio, and hands the time it saves back to compilation speed
([1.1](../../part1overview/ch01intro/history.md)). This is not a shortfall in
ability but a clear-eyed ordering of values, and this section will return to that
red line at the end. We first look at the optimizations Go is willing to do, then
at Profile-Guided Optimization (PGO), introduced in Go 1.21, which pushes
optimization from "static guessing" toward "data-driven."

## 15.3.1 Inlining: the gateway to all optimization

Among the many optimizations done on SSA, **inlining** holds a special place. By
itself it does one plain thing: it expands the body of a small function directly
into the place that calls it, sparing one function-call's overhead (building the
stack frame, passing arguments, jumping, returning). But its real value is not in
saving that bit of overhead; it is that it **creates conditions for other
optimizations**. A cross-function call is a wall to the optimizer: what the code
on the far side of the wall looks like, whether the arguments are constants,
whether the return value gets used, of all this it knows nothing. Inlining tears
the wall down, merges the code on both sides of the call site, and now constants
can propagate across, branches can be decided, and dead code can be eliminated.

Take one of the most common examples. The fast path of `sync.Once.Do` is just a
single atomic read, and the standard library writes it as a separate small
method:

```go
func (o *Once) Do(f func()) {
    if atomic.LoadUint32(&o.done) == 0 {
        o.doSlow(f)
    }
}
```

Without inlining, every `once.Do(f)` would pay a call's worth of overhead just to
read one field. After inlining, the `atomic.LoadUint32` wrapper layer also gets
expanded along with it, and the whole fast path collapses into a few
instructions, no different from a hand-written inline atomic read. The many
"one thin wrapper layer" designs in the Go standard library are built precisely on
the assumption that "the compiler will inline it away." To find out whether a
given call was actually inlined, and why not if it wasn't, use
`go build -gcflags=-m`, and the compiler prints its inlining decisions one by one
(`can inline`, `inlining call to`, or refusal reasons such as
`function too complex`).

Inlining cannot run unchecked. Expanding every call makes the code size explode
(the same callee gets copied once at each of thousands of call sites), drags out
compile time along with it, and instead lowers the hit rate of the instruction
cache. Go draws the line with an **inline budget**: the compiler estimates a
"cost" for each candidate function, roughly proportional to its number of AST
nodes, and a function whose cost exceeds the budget is not inlined. In go1.26 this
budget is a hard-coded constant:

```go
// cmd/compile/internal/inline/inl.go (trimmed)
const (
    inlineMaxBudget = 80 // the inline budget ceiling for ordinary functions
    // ...
)
```

The number 80 itself does not matter; what matters is the trade-off behind it:
**the larger the budget, the more aggressive the inlining, the more the code
bloats and the slower the compile; the smaller the budget, the more conservative,
but the more optimization opportunities are passed up**. Go sets it at a fairly
conservative spot, consistent with the overall goal of "compile fast." A function
that contains structures such as `defer`, closures, or `recover` carries extra
cost or is outright forbidden from inlining, because expanding them is either not
worth it or semantically impossible.

This budget line is so important because of one expansion in inlining's reach.
Early Go compilers inlined only **leaf functions**, that is, functions that
themselves call no one else. This restriction sharply blunted inlining's power: a
small function with even one call inside it broke the whole chain. Later the
compiler gained support for **mid-stack inlining**, allowing functions that
"still contain calls themselves" to be expanded too, and only then could inlining
truly burrow layer by layer along the call chain. But opening this gate also
magnified the risk of code bloat and slower compiles, and the fine tuning of the
budget and the cost model became the core of the inlining implementation from
that point on. Inlining goes in the first section because the effectiveness of
the optimizations that follow depends in large part on whether inlining has first
torn down the cross-function wall.

## 15.3.2 Bounds-check elimination, constant folding, and common subexpressions

After inlining, a batch of classic scalar optimizations on SSA can come into full
play. Each is plain on its own, but together they form the backbone of the quality
of Go's generated code.

**Bounds-Check Elimination (BCE)** is the one among them most deeply tied to Go's
safety model. Go guarantees that every slice or array index access stays in
bounds, at the cost of the compiler inserting a check before each `a[i]`: if `i`
is out of bounds, panic. This check is the bedrock of safety, but in many cases it
can be proven never to fire, and so can be safely deleted. The most typical case
is a loop like this:

```go
func sum(a []int) int {
    s := 0
    for i := 0; i < len(a); i++ {
        s += a[i] // the optimizer can prove 0 <= i < len(a), removing the bounds check here
    }
    return s
}
```

The loop condition `i < len(a)` already implies that `a[i]` is legal, and the
compiler removes the bounds check on this access entirely on that basis. Behind
this is an optimization pass in the SSA pipeline called `prove`: it walks the
control flow gathering each value's range and inequality constraints (such as "on
entering the loop body, `i < len(a)` holds"), then uses these constraints to
decide whether a given access is necessarily legal. The strength of BCE directly
affects the performance of numerically intensive code, so the community has
accumulated a fair amount of experience on "how to write loops to make BCE easier
for the compiler," for example writing a line `_ = a[len(a)-1]` first to tell the
compiler the upper bound in advance. You can use
`go build -gcflags=-d=ssa/check_bce/debug=1` to print which bounds checks were not
eliminated, as a guide when optimizing hot code.

Two more are textbook-level standard optimizations, and especially direct to do on
SSA:

- **Constant folding**: an expression whose result can be computed at compile time
  is replaced directly with the result. `1<<20` does not survive to run time.
  Inlining often turns more things into constants, which then triggers a fresh
  round of folding, exactly the "inlining creates conditions for later
  optimizations" that 15.3.1 stressed.
- **Common Subexpression Elimination (CSE)**: the same value computed twice, the
  second time reuses the first's result. SSA's "each value is defined exactly once"
  turns "are these two expressions equivalent" into a simple value-number
  comparison, so CSE comes almost for free.
- **Dead-code elimination**: branches judged unreachable after constant folding,
  and computed results that no one uses, are all removed.

These few optimizations mesh with one another: inlining feeds constant folding,
folding feeds dead-code elimination, and deleting dead code lets CSE see more
clearly. The SSA pipeline arranges them in multiple passes and iterates
repeatedly, until there are no new simplifications left, and this is the concrete
meaning of what [15.2](./ssa.md) called "doing optimization on SSA."

## 15.3.3 Devirtualization: turning interface calls back into direct calls

A call through an interface ([4.2](../../part2lang/ch04type/interface.md)) is an
**indirect call**: at run time the method address has to be fetched from the type
information in the interface value, then jumped to. This layer of indirection has
run-time overhead, and worse, it is equally a wall to the optimizer: the target of
the indirect call is unknown at compile time, cannot be inlined, and constants
cannot propagate through it.

**Devirtualization** is about tearing this wall down where it can be torn down. If
the compiler can determine at compile time the concrete type behind some interface
variable, it rewrites the indirect call into a **direct call** of that concrete
method, and after devirtualization the call becomes a candidate for inlining once
more, so "devirtualization + inlining" often happens in a chain, collapsing one
interface dispatch into a few inlined instructions:

```go
func write(b []byte) {
    var w io.Writer = &bytes.Buffer{}
    // w is an interface, but flow analysis proves its dynamic type must be *bytes.Buffer
    w.Write(b) // the interface call is rewritten into a direct call to (*bytes.Buffer).Write, and can be inlined further
}
```

Here the static type of `w` is `io.Writer`, and `w.Write` is originally one
interface dispatch; but within the function it is only ever assigned the single
concrete type `*bytes.Buffer`, the compiler recognizes its true identity through
flow analysis, rewrites the indirect call into a direct call, and then inlines it.
This is a direction the Go compiler has kept investing in over recent years,
because interfaces are everywhere in Go code, and every interface wall torn down
lets inlining and constant propagation take one more step. But what static
analysis can see through is ultimately limited, and the concrete type of many
interfaces is stable only at run time, only under one particular workload. To break
through this ceiling, we have to call on the PGO of the next section.

## 15.3.4 PGO: guiding optimization with a run-time portrait

By this point the optimizations above share one common weak spot: they all rely on
**guessing statically**. Who should get budget, which call is worth aggressive
inlining, which interface's concrete type is stable, the compiler can only infer
from source structure, and source structure does not tell it "how this program
actually runs, where the hot spots are." **Profile-Guided Optimization (PGO)**,
formally introduced in Go 1.21, is here to fill in this piece of information.

The idea is plain and powerful: first, under a real workload, use `pprof`
([16.5](../ch16tools/perf.md)) to collect a CPU **profile**, which records how
much CPU each function and each call site consumed while the program ran; feed
this profile to the compiler at compile time, and the compiler now holds a map of
"where the hot spots are," and can make more aggressive decisions on the hot paths
than static guessing would. In concrete actions, this comes down to two places:

- **More aggressive inlining of hot calls**. The inline budget for an ordinary
  function is 80 (15.3.1), but for a call site marked hot by the profile, the
  budget is raised to `inlineHotMaxBudget = 2000`, a full twenty-fold-plus
  enlargement. In other words, a function normally turned away at the door for
  being too large is worth expanding, as long as it sits on the hot path.
  "Hot" is judged with a cumulative distribution: sort all call sites by weight,
  take those whose cumulative weight falls within the top 99% of the total weight
  (`inlineCDFHotCallSiteThresholdPercent = 99`) as hot, and ignore the remaining
  long tail.

  ```go
  // cmd/compile/internal/inline/inl.go (trimmed)
  var (
      inlineHotMaxBudget                   int32   = 2000 // the inline budget for hot call sites
      inlineCDFHotCallSiteThresholdPercent         = float64(99)
  )
  ```

- **Devirtualizing hot interface calls**. For an indirect call, if the profile
  shows that at run time it lands on the same concrete type the vast majority of
  the time, the compiler does **conditional devirtualization**: it inserts a type
  test, taking the devirtualized direct call (and possibly inlining it) when the
  common type is hit, and falling back to the original interface dispatch
  otherwise. This is a confident bet: lose it and you only fall back to the old
  road, win it and the hot path is straightened out.

PGO's gain is usually a single-digit percentage, which does not sound like much,
but it is nearly zero-cost: name the collected profile `default.pgo` and place it
in the main package directory, and `go build` enables it automatically, with no
extra flags. For a long-running service under a stable load, a few percent means
machines genuinely saved.

Placing Go's PGO in the wider industry's coordinate system, there is one choice on
its implementation route worth explaining. There are two roads to profile-guided
optimization. One is **instrumentation**: first compile a special binary with
counters inserted and run it, in exchange for exact execution counts, at the cost
of maintaining two builds, and the instrumentation itself slows the run; LLVM's
traditional PGO takes this road. The other is **sampling**: sample the CPU profile
directly off the binary running normally in production, with no extra instrumented
build. Go chose the latter, and the official documentation says plainly that it is
aimed at an "AutoFDO" style workflow, which is exactly the approach Google uses
internally to optimize vast numbers of services with sampled profiles. A sampled
profile is less precise than instrumentation, but it can be taken from a real
production load, and the collection barely disturbs the live service, so for the
server-side scenarios Go targets, this trade-off pays off.

What is worth pausing to take in is the shift behind PGO: **guessing statically at
"what matters" has a ceiling, and using real run-time data to guide optimization
can break through that ceiling**. The compiler no longer stares only at source
structure but allocates its limited optimization budget with evidence of "how this
program actually runs" in hand. This comes from the same line of thinking that
recurs in [9 The Scheduler](../../part3concurrency/ch09sched/readme.md) and
[13 Garbage Collection](../../part4memory/ch13gc/readme.md): let the system adapt
on run-time feedback rather than nailing everything down at compile time. The only
difference is when the feedback takes effect: the scheduler and the GC adjust in
real time during the run, while PGO feeds the previous run's feedback back into the
next compile.

PGO currently acts mainly on inlining and devirtualization, but the official
documentation puts it plainly: it is a foundation just laid, and later versions
will see more optimizations learn to use this profile. Basic-block layout, register
allocation, stack-frame layout, and the like can all in principle benefit from
information on "which path is hotter." Put another way, PGO's single-digit gain
today is the floor of what it can give, not the ceiling, and as more optimization
passes plug into the profile, there is no small amount of room behind this door.

## 15.3.5 The red line of compilation speed

Escape analysis ([15.5](./escape.md)) decides whether a variable is allocated on
the stack or the heap, and is another key optimization unique to Go and tightly
tied to the GC; it stands as its own section and is not expanded here. Looking at
it together with the few above, the outline of the Go optimizer is already clear:
inlining, BCE, constant folding, CSE, dead code, devirtualization, escape
analysis, plus PGO as a data-driven amplifier. This list covers the optimizations
with the best cost-to-benefit ratio, and stops there.

What is most worth remembering about the Go optimizer is, in fact, what it
**does not** do. Some aggressive optimizations GCC and LLVM can do, such as
large-scale loop transformations, time-consuming interprocedural analysis, and
elaborate vectorization, Go deliberately declines to chase. The reason is again
that red line running through the whole book: **compilation speed**
([1.1](../../part1overview/ch01intro/history.md)). Go was born in the kind of
Google code base that runs to hundreds of millions of lines and takes hours to
compile, and "compile fast, iterate fast" was a goal it placed up front from day
one, ranking higher than "wringing out the last few percent of run-time
performance."

This is a trade-off to be understood, not forgiven. For the vast majority of
server-side programs, the development efficiency that fast compilation brings is
worth more than those few percent; and for the hot spots that genuinely need
ultimate performance, Go offers two precise ways out: use PGO to let the compiler
concentrate its firepower on the hot paths the data points to, or have the
programmer hand-optimize that small stretch of critical code. A gain in
performance never comes for free; it always carries a cost somewhere else. Go's
choice is to put the cost on "not chasing ultimate optimization," and to leave the
dividend for "extremely fast compilation." Understand this red line, and you
understand why the Go compiler optimizes with such restraint.

## Further reading

1. The Go Authors. *Profile-Guided Optimization.* https://go.dev/doc/pgo
2. Michael Pratt. *Profile-guided optimization in Go 1.21.* The Go Blog, 2023.
   https://go.dev/blog/pgo
3. The Go Authors. *cmd/compile/internal/inline (inline budget and PGO hot-spot inlining).*
   https://github.com/golang/go/tree/master/src/cmd/compile/internal/inline
4. David Chase. *Mid-stack inlining in the Go compiler.* Design document, 2017.
   https://golang.org/s/go19inliningtext
5. The Go Authors. *cmd/compile/internal/devirtualize (static and PGO devirtualization).*
   https://github.com/golang/go/tree/master/src/cmd/compile/internal/devirtualize
6. The Go Authors. *Go 1.21 Release Notes (PGO promoted to stable, `default.pgo` auto-enabled).*
   https://go.dev/doc/go1.21
7. This book, [15.2 Intermediate Representation](./ssa.md), [15.5 Escape Analysis](./escape.md),
   [16.5 Benchmarking and Performance Profiling](../ch16tools/perf.md),
   [4.2 Interfaces](../../part2lang/ch04type/interface.md).
