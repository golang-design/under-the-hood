---
weight: 5107
title: "15.7 Past, Present, and Future"
---

# 15.7 Past, Present, and Future

The compiler is the part of the Go toolchain that changes most often, yet remains the most transparent to users. Take the same source code, change nothing, recompile it with a new version, and it often comes out faster, smaller, and better, without you ever knowing what happened in between. This section pulls the camera back to look at the road the compiler itself has traveled, then at what it is doing now and where it is heading next. Running through all of it is one unchanging order of priorities: **compilation speed comes first, quality of generated code second, and both are traded off under the constraint of being engineerable** ([1.1](../../part1overview/ch01intro/history.md)).

Let us be clear up front that the "change" this section talks about all happens under the hood. Go's compatibility promise for the language and its tools means that these refactorings should not disturb a single line of user code. The two major rewrites we are about to discuss were carried out under exactly this constraint.

## 15.7.1 Past: From C to Go, From Plan 9 to SSA

The compiler itself has gone through two bone-deep changes, in two very different directions: one swapped out the implementation language, the other swapped out the backend architecture.

**First, the implementation language: C to Go.** The earliest `gc` compiler (up through Go 1.4) was written in C, inheriting the code style and build conventions of the Plan 9 toolchain. Go 1.5 completed **bootstrapping**: the compiler was machine-translated into Go, and from then on it was "a Go compiler written in Go." The details of this are in [3.3](../../part1overview/ch03life/bootstrap.md); here we only stress its significance. Changing languages was not for the sake of fashion: the C version could not take advantage of Go's own concurrency, memory safety, and rich standard library, nor could it let the Go community read and modify the compiler in a familiar language. Only after bootstrapping did the compiler truly become "a Go program the community can maintain," which paved the way for everything that followed. The price was the introduction of a **bootstrap chain**: to compile the current version of Go you first need a working older version of Go, so the toolchain has to carefully maintain this backward dependency.

In passing, let us clear up a frequently confused name: the compiler is called `gc`, short for "Go compiler," and has nothing to do with garbage collection (the capitalized GC). The opening of `cmd/compile/README` makes a point of this.

**Second, the backend architecture: Plan 9 style to SSA.** Bootstrapping only swapped the pen, not the skeleton. The backend of Go 1.5/1.6 still largely followed the traditional design of the Plan 9 compiler: based on a lower-level instruction representation, it did limited optimization and assignment directly. This backend worked, but it was hard for it to carry modern optimizations; its intermediate representation was inconvenient for dataflow analysis, and adding a new optimization often meant special-casing in several places, with poor extensibility.

Go 1.7 introduced the **SSA backend** ([15.2](./ssa.md)), the most pivotal architectural upgrade in the compiler's history. SSA (Static Single Assignment) requires that each variable be assigned exactly once, so "where this value comes from and where it goes" becomes an explicit graph structure, and optimizations such as dead code elimination, constant propagation, redundancy elimination, and bounds-check elimination can all be written as **rewrite rules** over the graph, independent of one another, composable, and customizable per architecture. An intuitive example is bounds-check elimination:

```go
// On each access to the slice in the loop, the compiler would insert an i < len(s) check
for i := 0; i < len(s); i++ {
    s[i] = 0      // SSA can prove 0 <= i < len(s) always holds, so this check is removed
}
```

Such "rules" take a very concrete form in the SSA backend. Go's machine-independent and machine-dependent optimizations are written in large numbers as rewrite entries of the form `(source pattern) -> (replacement)`, for example rewriting a multiplication whose right operand is known to be a power of two into a shift:

```text
// Pseudo-rule sketch: multiplying by a constant 2^k, replaced by a left shift of k bits (a shift is usually faster)
(Mul64 x (Const64 [c])) && isPowerOfTwo(c) => (Lsh64x64 x (Const64 [log2(c)]))
```

At build time the compiler compiles hundreds or thousands of such rules into the optimizer, sweeping over the SSA graph pass after pass and applying them repeatedly until no rule can fire anymore. Adding an optimization, most of the time, just means adding a few rules, without having to touch the framework itself; this is exactly what "extensible" means for the SSA backend.

In a Plan 9 style backend, reliably carrying out proofs like bounds-check elimination is not easy; under the SSA framework, it is just "running a few rules over the value-relation graph." This refactoring was equally transparent to users: nobody changed a line of code, they just found that programs compiled by the new version ran faster and the binaries were smaller. The SSA backend was at first only enabled on amd64, then rolled out architecture by architecture, and to this day it remains the trunk of Go code generation, the stage on which later work such as PGO and the register ABI could land.

Placing these two rewrites in the coordinate system of Go's peers makes its trade-offs clearer. The industrial-grade compilers of most mainstream languages (such as LLVM and GCC, written in C++) have, from the very beginning, put an SSA or SSA-like intermediate representation at their core, placing code-generation quality very high, at the cost of compilation speed and implementation complexity. Go went the other way: first stand up the language and ecosystem with a simple, blazing-fast Plan 9 style backend, then, once the community and the demand had matured, fill in the "code quality" gap with SSA. In other words, others go "good first, then tune for speed," while Go goes "fast first, then fill in good"; this is precisely the historical projection of its "compilation speed first" order of priorities.

Looking at the two big changes together, they convey the same engineering posture: **when the old foundation cannot hold up the future, be willing to tear it down and rewrite, but keep every rewrite faithful to the promise of transparency to users.** A rough-grained timeline:

```text
Go 1.4   gc compiler written in C (traditional Plan 9 backend)
Go 1.5   bootstrap: compiler translated to Go; first form of concurrent GC
Go 1.7   SSA backend lands (amd64 first), then rolled out architecture by architecture
Go 1.17  stack-based ABI to register calling convention, about +5% overall
Go 1.18  generics: types2 frontend + GC-shape stenciling backend
Go 1.21  PGO official release: compiler optimization shifts from static guessing to data-driven
```

## 15.7.2 Present: The Register ABI and PGO

If the past was "swapping the foundation," then the two current advances are two buildings raised on the new foundation. Their common theme is pushing the compiler from "guessing statically" toward "deciding based on real information."

**The register calling convention (Go 1.17).** For a long time, Go's function calls passed arguments and return values via the **stack**: the caller wrote the actual arguments into agreed-upon positions on the stack, and the callee read them back off the stack. This convention was simple, consistent across architectures, and friendly to stack scanning, but every call required a string of memory reads and writes, with non-trivial overhead. Go 1.17 changed it to passing arguments via **registers** ([2.2](../../part1overview/ch02asm/callconv.md), [6.1](../../part2lang/ch06func/func.md)): the first several arguments and return values go directly through registers, and the fast path that hits them never touches memory at all.

```text
// Stack-based ABI (old)         // Register ABI (new, on amd64 the first several integers go through AX, BX, CX, ...)
caller:  MOV arg, 0(SP)          caller:  MOV arg, AX
         CALL f                           CALL f
f:       MOV 0(SP), reg          f:       (arg is already in AX, use it directly)
```

The overall speedup is about 5%, and it is **transparent to users and to all code outside of assembly**; the design deliberately keeps backup slots on the stack, so mechanisms like stack scanning, `recover`, and `go:nosplit` need no rewriting. The engineering difficulty of this change is not in "thinking of using registers" (that is common sense), but in "making register argument passing work without breaking any existing invariant in a runtime that has GC, preemption, and cross-architecture assembly." Its design document (proposal 40724) is worth reading, a model of "doing a low-level optimization under compatibility constraints."

**Profile-guided optimization, PGO (Go 1.21).** When the compiler makes decisions such as inlining and devirtualization, it traditionally can only **guess statically**: inline if the function is small, devirtualize if the type can be pinned down at compile time. But information like "which path is hot" is simply unobtainable by static analysis. The idea of PGO (Profile-Guided Optimization) is to feed a **profile** of the actual run back into the compiler ([15.3](./optimize.md)):

```bash
# 1) collect a CPU profile in production or under load testing
go test -cpuprofile cpu.prof -bench .
# 2) name it default.pgo and place it in the main package directory; go build enables it automatically
cp cpu.prof ./cmd/myapp/default.pgo
go build ./cmd/myapp
```

Mechanically, the compiler reads a weighted call graph out of the profile: each call edge has a sampled hotness. The inliner uses this to relax the budget for hot edges; normally, once a function body exceeds the budget it is not inlined, but if it sits on a hot path that is frequently traversed, it is worth making an exception and expanding it. Devirtualization is similar: at a hot spot, if the profile shows that an interface call goes overwhelmingly to the same concrete type, the compiler can generate a fast path straight to that type, falling back only when the type does not match. In other words, PGO does not invent new optimizations; it merely **gives existing optimizations a more accurate ruler**, so that the limited "code-bloat budget" is spent where it is truly worth it. In practice it often brings a single-digit-percentage improvement. The key significance of PGO is not those few percentage points, but that it establishes a new paradigm: **from now on the compiler's optimization decisions can be driven by data, rather than only by static heuristic guessing.**

**The ongoing polishing of generics support.** In parallel there is generics. The frontend switched to the `types2` type checker in Go 1.18 ([8.3](../../part2lang/ch08generics/checker.md)), and the backend adopts **GC-shape stenciling**: it generates code grouped by memory layout, so a group of types with the same layout shares one copy of machine code, and type-specific information is passed in at call time through a **runtime dictionary**. This route avoids the code explosion of monomorphizing every type, at the cost of introducing a layer of dictionary indirection ([8.4](../../part2lang/ch08generics/future.md)). Cutting down the overhead of this indirection is homework the compiler is still doing to this day, which leads right into the future we discuss next.

## 15.7.3 Future: Continuing to Walk the Tightrope Between Speed and Optimization

The compiler's future is still that tension running through the whole book: the balance between **compilation speed** and **quality of generated code** ([1.1](../../part1overview/ch01intro/history.md)). Go's answer to this question has always been clear-cut, and several foreseeable directions all unfold under the constraint of that answer.

**Pushing PGO further.** Inlining and devirtualization are only the first batch of scenarios where PGO can use a profile. Profile-guided stack allocation and escape analysis, basic-block layout (placing hot paths together to improve instruction fetch and branch prediction), and profile-based specialization are all natural extensions. The difficulty is preserving the optionality of "compile very fast even with no profile, trade for better code only when a profile is present"; PGO should never become a precondition for compilation.

**The performance of generic code.** That layer of GC-shape dictionary indirection is currently the main performance tax on generics. Inlining dictionary access at hot spots, and doing more thorough devirtualization and specialization for a single instantiation, so that generic code gradually approaches the speed of a hand-written monomorphic version, is a front that has no "done" date but will keep being advanced ([8.4](../../part2lang/ch08generics/future.md)).

**Code generation in concert with the new GC.** Code generation is never isolated. The next-generation GC (Green Tea, [13.11](../../part4memory/ch13gc/greentea.md)) changes the form of scanning and write barriers, and the way the compiler inserts barriers and arranges pointer liveness information also has to evolve along with it; only by co-evolving can the GC's throughput improvements be made to actually land in the generated code.

**Exploiting new hardware.** Vector instructions (SIMD), wider registers, and new atomic and memory-ordering primitives: how these hardware capabilities can be put to use automatically by the compiler without breaking Go's simple mental model is a long-standing open question. Go tends to introduce them in a controlled way inside the standard library and runtime, rather than throwing the complexity onto users.

But there is one thing that almost certainly will not change: **Go will not sacrifice the compilation speed it takes pride in just to squeeze out a few more percent of runtime performance.** Fast compilation is the cornerstone of Go's productivity narrative, and any optimization that significantly slows compilation will most likely be kept out the door, or degraded into an option (as PGO is). This invariant is itself the most important design parameter of this machine.

Looking back at the line of the compiler, it perfectly illustrates how the Go toolchain works: **getting better continuously and transparently to users; making trade-offs at every step under the established order of priorities (fast, simple, engineerable); daring to tear down and rewrite (C to Go, Plan 9 to SSA), and daring to introduce a new paradigm (PGO's data-driven approach).** This machine that turns source code into blazing-fast binaries is itself the most precise embodiment of Go's engineering philosophy.

## Further Reading

1. The Go Authors. *cmd/compile/README: Introduction to the Go compiler.* The compiler's four-stage architecture, the `gc` name, and the evolution of types2 and the Unified IR.
   https://github.com/golang/go/blob/master/src/cmd/compile/README.md
2. Keith Randall. *Generating Better Machine Code with SSA.* GopherCon / the design motivation of the Go 1.7 SSA backend and its rewrite-rule framework. https://go.dev/talks/2015/gogo.slide
3. The Go Authors. *Profile-guided optimization (PGO user documentation).* Collecting a profile, the `default.pgo` convention, and the optimizations that can currently use a profile. https://go.dev/doc/pgo
4. Austin Clements, Cherry Mui, et al. *Proposal 40724: Register-based Go calling convention.* The compatibility constraints and design of the stack ABI to register ABI change.
   https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md
5. The Go Authors. *Go 1.5 / 1.7 / 1.17 / 1.21 Release Notes.* The per-version landing record of bootstrapping, the SSA backend, the register ABI, and PGO. https://go.dev/doc/devel/release
6. This book, [15.2 Intermediate Representation and SSA](./ssa.md), [15.3 The Optimizer and PGO](./optimize.md).
7. This book, [8 Generics](../../part2lang/ch08generics) ([8.3](../../part2lang/ch08generics/checker.md) types2, [8.4](../../part2lang/ch08generics/future.md) dictionary indirection), [3.3 Bootstrapping](../../part1overview/ch03life/bootstrap.md).
