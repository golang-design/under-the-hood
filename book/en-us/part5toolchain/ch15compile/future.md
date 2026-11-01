---
weight: 5107
title: "15.7 Past, Present, and Future"
---

# 15.7 Past, Present, and Future

The previous six sections followed the compilation pipeline through the Go 1.26 compiler: lexing and
grammar ([15.1 Lexing and Grammar](./parse.md)), the intermediate representation
([15.2 Intermediate Representation](./ssa.md)), the optimizer ([15.3 The Optimizer](./optimize.md)),
the pointer checker ([15.4 The Pointer Checker](./unsafe.md)), escape analysis
([15.5 Escape Analysis](./escape.md)) and cgo ([15.6 cgo](./cgo.md)). This section puts them back on
a timeline. The compiler's evolution falls into three stages. Through Go 1.4 it was a C compiler
inherited from Plan 9. From Go 1.5 to Go 1.8 it was translated into Go and given an SSA-based back
end. Since then, improvements have concentrated on the calling convention, generics and optimization
guided by profile data. A note on naming: the compiler is called gc, short for "Go compiler", and
the `cmd/compile` documentation takes care to point out that it has almost nothing to do with the
capitalized GC, garbage collection [[Go Authors, 2026a](#ref-go-authors-2026a)].

## 15.7.1 Inherited from Plan 9: Go 1.4 and Earlier

Ken Thompson committed the first compiler in March 2008 [[Thompson, 2008](#ref-thompson-2008)]. It
was written in C, its grammar was described by the yacc file `go.y`, and its structure and naming
followed the Plan 9 C compilers: each target architecture had its own program, `6g` for amd64 and
`8g` for 386, and so did the accompanying assemblers and linkers
([2.1 The Plan 9 Assembly Language](../../part1overview/ch02asm/asm.md)). The compiler used the
syntax tree as its intermediate representation.

Before Go 1 (March 2012), the compiler had already gained escape analysis
([15.5 Escape Analysis](./escape.md)) and inlining; inlining was implemented in December 2011 and
enabled by default in January 2012 [[van Dijk, 2011](#ref-van-dijk-2011)]
[[Cox, 2012](#ref-cox-2012)]. A syntax tree, however, is ill suited to data-flow analysis, and many
optimizations were hard to implement. In his 2015 proposal for an SSA back end, Keith Randall noted
that an SSA-based intermediate representation would make possible many optimizations that were
difficult in the compiler of the time [[Randall, 2015](#ref-randall-2015)].

## 15.7.2 From C to Go: Go 1.5

In Go 1.5 (August 2015) the compiler and linker were automatically translated from their C source
into Go, and programs such as `6g` and `8g` were merged into a single `go tool compile` whose target
is selected by `GOOS` and `GOARCH` [[Go Authors, 2015](#ref-go-authors-2015)]. The translator was
written specifically for this code base and is not a general-purpose C-to-Go tool
[[Pike, 2015](#ref-pike-2015)]. The release notes stress that this was a true translation and not a
rewrite: the new program was essentially the old one, so the translation introduced almost no new
bugs and in fact found and fixed some previously unknown ones. The motivation for the conversion and
the consequences of bootstrapping are covered in
[3.3 Bootstrapping the Language](../../part1overview/ch03life/bootstrap.md).

The price of the translation was speed. The automatically translated code kept C idioms and
performed worse than hand-written Go, so Go 1.5 builds were about twice as slow
[[Go Authors, 2015](#ref-go-authors-2015)]. For several releases afterward, a continuing effort was
to rewrite this code gradually into idiomatic Go. The front end was rewritten as well: Go 1.6
replaced the yacc-generated parser with a hand-written recursive-descent parser
([15.1 Lexing and Grammar](./parse.md)), and Go 1.8 switched to a new front end
[[Go Authors, 2017](#ref-go-authors-2017)].

## 15.7.3 The SSA Back End: Go 1.7 and 1.8

Even before the translation was complete, Randall had proposed the next step: to "convert from the
current syntax-tree-based IR to a more modern SSA-based IR", converting in stages and replacing the
back end first [[Randall, 2015](#ref-randall-2015)]. The new back end takes over from the
intermediate representation after walk, which by then is quite low-level but largely
machine-independent; everything after that, namely lowering to machine-specific operations,
instruction scheduling, register allocation and code generation, operates on SSA form. The proposal
originally targeted Go 1.6.

The new back end was first used for 64-bit x86 in Go 1.7 (August 2016), reducing the CPU time of
benchmark programs by 5% to 35%, and the release notes specifically mention that it provides a
better platform for optimizations such as bounds-check elimination
[[Go Authors, 2016](#ref-go-authors-2016)]. Go 1.8 (February 2017) extended it to all architectures:
benchmark programs sped up by 20% to 30% on 32-bit ARM and by 0 to 10% on 64-bit x86, which already
used the new back end; the temporary `-ssa=0` option from Go 1.7 for turning the new back end off
was removed [[Go Authors, 2017](#ref-go-authors-2017)]. The structure of the SSA back end, its
rewrite rules and its passes are covered in [15.2 Intermediate Representation](./ssa.md).

## 15.7.4 Calling Convention and Generics: Go 1.17 to 1.20

Go 1.17 (August 2021) switched to passing function arguments and results in registers on 64-bit x86
for Linux, macOS and Windows, improving the performance of representative programs and packages by
about 5% and typically shrinking binaries by about 2% [[Go Authors, 2021](#ref-go-authors-2021)]. Go
1.18 extended this to 64-bit ARM, 64-bit PowerPC and 64-bit x86 on all operating systems, with
typical gains of more than 10% on 64-bit ARM and PowerPC [[Go Authors, 2022](#ref-go-authors-2022)].
The difficulty of the change lay in compatibility: it could not alter the behavior of any safe Go
code, and it had to disturb existing assembly code as little as possible. The design is in
[[Clements, 2020](#ref-clements-2020)], and the two conventions and the conversion between them are
covered in [2.3 Calling Convention and the Register ABI](../../part1overview/ch02asm/callconv.md).

The same release added generics. Type checking in the front end moved to `types2`
([8.3 Type-Checking Techniques](../../part2lang/ch08generics/checker.md)), and generic code is
implemented by shape-based stenciling with dictionaries
([8.1 The Evolution of Generics Design](../../part2lang/ch08generics/history.md)). The release notes
admit that the changes supporting generics made Go 1.18 compile about 15% slower than Go 1.17, with
no effect on the execution time of the generated code [[Go Authors, 2022](#ref-go-authors-2022)]. Go
1.20 enabled the unified IR by default, which had by then reached feature parity with the old front
end [[Dempsky, 2022](#ref-dempsky-2022)]; the release notes describe it as the front end using a new
way of handling the compiler's internal data, which fixed several generics issues and allowed type
declarations inside generic functions and methods [[Go Authors, 2023a](#ref-go-authors-2023a)].
Today the unified IR handles construction of the intermediate representation, package import and
export, and inlining [[Go Authors, 2026a](#ref-go-authors-2026a)].

## 15.7.5 Profile-Guided Optimization: Go 1.20 Onward

Until then, the compiler's inlining and devirtualization relied only on static heuristics.
Profile-guided optimization (PGO) feeds the compiler CPU profile data collected from the running
program so that it can make different decisions at hot spots
[[Go Authors, n.d.a](#ref-go-authors-nda)]. Go 1.20 added PGO as a preview, using profiles to inline
more aggressively at hot call sites, which sped up representative programs by about 3% to 4%
[[Go Authors, 2023a](#ref-go-authors-2023a)]. Go 1.21 declared PGO ready for general use: a
`default.pgo` in the main package directory is enabled by default, and most programs speed up by 2%
to 7%; PGO also began to devirtualize some interface method calls, adding a direct call for the most
common callee. The compiler itself was built with PGO in the same release, which cut build times by
up to 6% [[Go Authors, 2023b](#ref-go-authors-2023b)]. Go 1.22 let devirtualization cover more calls
and interleaved devirtualization with inlining, raising the gains for most programs to 2% to 14%
[[Go Authors, 2024](#ref-go-authors-2024)]. The implementation in the compiler is covered in
[15.3 The Optimizer](./optimize.md).

Optimizations that do not depend on profile data have advanced too. After escape analysis was
rewritten in Go 1.13, Go 1.25 and 1.26 successively moved the backing storage of variable-size
`make` and `append` onto the stack ([15.5 Escape Analysis](./escape.md)). Go 1.22 also added new
inlining heuristics as a preview: inline more aggressively at "important" call sites such as those
in loops, and suppress inlining at "unimportant" ones such as those on panic paths; they are enabled
with `GOEXPERIMENT=newinliner` [[Go Authors, 2024](#ref-go-authors-2024)]. As of Go 1.26 it remains
an experiment that is off by default.

## 15.7.6 Outlook

This book follows Go 1.26. At the time of writing, Go 1.27 had been released in August 2026
[[Go Authors, 2026c](#ref-go-authors-2026c)]. Its compiler-related changes include: the language
allows methods to declare their own type parameters, that is, generic methods
([8.4 The Future of Generics](../../part2lang/ch08generics/future.md)); for some allocations smaller
than 80 bytes, the compiler now emits calls to size-specialized allocation functions, which lowers
the cost of such allocations by up to 30% at the price of about 60 KB of extra binary size; and the
new experimental `simd` package provides portable, vector-width-independent SIMD support, while the
`simd/archsimd` package introduced in Go 1.26 gains 128-bit SIMD for arm64 and WebAssembly in
addition to amd64. The Go 1.26 release notes had already announced this portable high-level SIMD
package [[Go Authors, 2026b](#ref-go-authors-2026b)].

The next release on the main branch, Go 1.28, is expected in February 2027. As of November 2026, the
compiler section of its release-notes draft is still empty; for bootstrapping, Go 1.28 requires Go
1.26.0 or later to build [[Go Authors, 2026d](#ref-go-authors-2026d)]. Compiler-related experiments
on the main branch include `NewInliner`, `SIMD`, `RuntimeFreegc`, which needs cooperation from the
compiler, and `CgoBindings`, added in October 2026, which describes cgo bindings in terms of Go
types [[Go Authors, 2026e](#ref-go-authors-2026e)]. Whether an experiment becomes the default
behavior is a question for later releases to answer.

## 15.7.7 Summary

The compiler's two major refactorings went in different directions: Go 1.5 changed the
implementation language, and Go 1.7 and 1.8 changed the back end's intermediate representation. The
former relied on mechanical translation to guarantee that the old and new programs were equivalent,
at the price of slower builds for a while; the latter proceeded in stages, first enabled on one
architecture and then extended to all of them. The register calling convention, the unified IR and
PGO that followed all build on these two refactorings. Every change was required to leave program
behavior unchanged, and its costs and benefits are recorded in the release notes of each version
[[Go Authors, n.d.b](#ref-go-authors-ndb)]: Go 1.5 builds were about twice as slow, Go 1.18 compiled
about 15% slower, and PGO brings most programs that supply profile data a gain of 2% to 14% (Go
1.22).

## Further Reading

- <a id="ref-clements-2020"></a>[Clements, 2020] Austin Clements. "Proposal: Register-based Go
  calling convention." Go proposal 40724, 2020.
  https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md The compatibility
  constraints and design for moving from the stack ABI to a register ABI.
- <a id="ref-cox-2012"></a>[Cox, 2012] Russ Cox. gc: enable inlining by default. Go commit
  4a6b07f235,
  2012. https://golang.org/cl/5531058
  Shipped in Go 1.
- <a id="ref-dempsky-2022"></a>[Dempsky, 2022] Matthew Dempsky. internal/buildcfg: enable unified IR
  by default. Go commit 833367e98a, 2022. https://go.dev/cl/422235 Shipped in Go 1.20.
- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *Profile-guided optimization.*
  https://go.dev/doc/pgo The PGO user documentation: collecting profiles, the `default.pgo`
  convention and the optimizations that can currently use profile data.
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *Release History.*
  https://go.dev/doc/devel/release An index of the release notes of every version, recording version
  by version how bootstrapping, the SSA back end, the register ABI and PGO landed.
- <a id="ref-go-authors-2015"></a>[Go Authors, 2015] The Go Authors. *Go 1.5 Release Notes.* 2015.
  https://go.dev/doc/go1.5
- <a id="ref-go-authors-2016"></a>[Go Authors, 2016] The Go Authors. *Go 1.7 Release Notes: Compiler
  Toolchain.* 2016. https://go.dev/doc/go1.7
- <a id="ref-go-authors-2017"></a>[Go Authors, 2017] The Go Authors. *Go 1.8 Release Notes: Compiler
  Toolchain.* 2017. https://go.dev/doc/go1.8
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.17 Release Notes:
  Compiler.*
  2021. https://go.dev/doc/go1.17
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *Go 1.18 Release Notes.* 2022.
  https://go.dev/doc/go1.18
- <a id="ref-go-authors-2023a"></a>[Go Authors, 2023a] The Go Authors. *Go 1.20 Release Notes:
  Compiler.*
  2023. https://go.dev/doc/go1.20
- <a id="ref-go-authors-2023b"></a>[Go Authors, 2023b] The Go Authors. *Go 1.21 Release Notes:
  Compiler.*
  2023. https://go.dev/doc/go1.21
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. *Go 1.22 Release Notes:
  Compiler.*
  2024. https://go.dev/doc/go1.22
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. cmd/compile/README.md:
  Introduction to the Go compiler. Go 1.26 source.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/README.md The division of
  the compiler into phases, the meaning of the name `gc`, and the unified IR.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Go 1.26 Release
  Notes.* 2026. https://go.dev/doc/go1.26 See the section on the experimental `simd/archsimd`
  package.
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Go 1.27 Release
  Notes.* 2026. https://go.dev/doc/go1.27
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. doc/next. Go main-branch
  source. https://github.com/golang/go/tree/master/doc/next The Go 1.28 release-notes draft, as of
  the main branch on 1 November 2026.
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors.
  internal/goexperiment/flags.go. Go main-branch source.
  https://github.com/golang/go/blob/master/src/internal/goexperiment/flags.go The list and
  descriptions of `GOEXPERIMENT` experiments, as of the main branch on 1 November 2026.
- <a id="ref-pike-2015"></a>[Pike, 2015] Rob Pike. "Go in Go." Gopherfest, 2015.
  https://go.dev/talks/2015/gogo.slide
  The motivation for and process of translating the compiler automatically from C to Go.
- <a id="ref-randall-2015"></a>[Randall, 2015] Keith Randall. "New SSA Backend for the Go
  Compiler." 2015. https://go.dev/s/go17ssa The SSA back-end proposal: convert in stages, replacing
  the back end first.
- <a id="ref-thompson-2008"></a>[Thompson, 2008] Ken Thompson. SVN=114202. Go commit
  cb87526ce3, 2008. https://github.com/golang/go/commit/cb87526ce3 The source of the original gc
  compiler, under `src/c`.
- <a id="ref-van-dijk-2011"></a>[van Dijk, 2011] Luuk van Dijk. gc: inlining (disabled without -l).
  Go commit a62722bba4, 2011. https://golang.org/cl/5400043 Shipped in Go 1.
- This book: [2.3 Calling Convention and the Register ABI](../../part1overview/ch02asm/callconv.md),
  [3.3 Bootstrapping the Language](../../part1overview/ch03life/bootstrap.md),
  [Chapter 8 Generics](../../part2lang/ch08generics/readme.md)
  ([8.1 The Evolution of Generics Design](../../part2lang/ch08generics/history.md),
  [8.3 Type-Checking Techniques](../../part2lang/ch08generics/checker.md),
  [8.4 The Future of Generics](../../part2lang/ch08generics/future.md)),
  [15.2 Intermediate Representation](./ssa.md), [15.3 The Optimizer](./optimize.md).
