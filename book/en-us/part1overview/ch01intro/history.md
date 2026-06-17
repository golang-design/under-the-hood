---
weight: 1101
title: "1.1 The Evolution of Programming Languages"
---

# 1.1 The Evolution of Programming Languages

To understand why Go turned out the way it did, why it is so restrained, so obsessed with compilation speed, so concerned with concurrency, we first have to look at the language landscape it was born into, and at whose pain it set out to solve. Go was not designed in a vacuum. It is the response of a group of people who spent their careers writing systems software, a response to their long-standing dissatisfaction with the mainstream languages of the time. Understanding this background gives a unified starting point for all the trade-offs the rest of this book examines, in the scheduler, the memory model, and generics.

## 1.1.1 A Few Main Threads in the Evolution of Languages

Half a century of programming-language evolution is not a straight line but a repeated tug-of-war among several forces. Compressed into a single timeline: in the late 1950s, Fortran freed scientific computing from assembly and Lisp brought higher-order functions and automatic memory management; in the 1960s Algol established structured blocks and syntax; in the 1970s C was born alongside Unix and gave systems programmers a language that "hugs the machine without making you write assembly"; in the 1980s and 90s C++ and Java pushed object orientation into the mainstream, the former chasing zero cost, the latter chasing portability and management; in the same period scripting languages such as Python and Perl won on development efficiency; after the 2000s, Go and Rust represented two answers to "rethinking systems programming", one betting on simplicity and concurrency, the other on compile-time memory safety.

Behind every step lies a set of **specific trade-offs** along several dimensions. No language can be optimal on every dimension at once, and seeing these dimensions clearly is what makes it possible to understand why each one turned out the way it did:

- **Level of abstraction**: from assembly's "directly manipulate the machine", to C's procedural abstraction, to the object abstraction of C++/Java, to the higher-order abstraction of functional languages. The higher the level, the more concise the expression and the further from the machine, and the weaker the grip on performance and predictability.
- **Memory safety**: from C's manual `malloc`/`free` (powerful but extremely error-prone, with dangling pointers, out-of-bounds access, leaks), to managed languages with garbage collection (which eliminate a large class of memory errors at the cost of runtime overhead and pauses), to Rust's ownership (compile-time safety guarantees at the cost of a steeper learning curve).
- **Concurrency model**: from manual threads with locks (dangerous and hard to reason about), to higher-level message passing such as CSP / Actor ([1.3](./csp.md)), to the stackless coroutines of `async`/`await`.
- **Type system**: swinging back and forth between "the safety of static strong typing" and "the flexibility of dynamic typing", and again choosing differently between "nominal typing" and "structural typing" ([4.2](../../part2lang/ch04type/interface.md)).
- **Engineering qualities**: compilation speed, build model, toolchain, dependency management. This dimension has long been undervalued by language designers, yet it is the lifeline of large-scale software collaboration, and it is exactly where Go pushed hardest.

Placing a few representative languages on these axes makes the differences plain:

| Language | Memory management | Concurrency | Types | Compilation/execution | Design orientation |
| --- | --- | --- | --- | --- | --- |
| C | Manual | Threads + locks | Static, weak | Compiled to native code | Close to the machine, zero-cost abstraction |
| C++ | Manual / RAII | Threads + locks | Static, strong, complex | Slow to compile, fast to run | Maximizing expressiveness |
| Java | GC | Threads + locks / virtual threads | Static, nominal, rich reflection | JIT, heavy runtime | "Write once, run anywhere" |
| Python | GC (reference counting) | GIL + threads / async | Dynamic | Interpreted | Development efficiency first |
| Rust | Ownership | Threads + async | Static, strong, ownership | Slow to compile, fast to run | Safe and zero-cost |
| Go | GC | goroutine (CSP) | Static, structural interfaces | Extremely fast to compile, fast to run | Simple, engineering-friendly |

This table is not meant to rank the languages; there is no "best" row, only several rows that "made different trade-offs for different goals". Go's place in the table, with GC, CSP concurrency, structural interfaces, extremely fast compilation, and a design orientation toward "simplicity", was forced out by exactly the pains it set out to solve.

## 1.1.2 The Designers' Lineage

A language's character is often written in the resumes of its designers. Go began inside Google in 2007, started by Robert Griesemer, Rob Pike, and Ken Thompson, and the backgrounds of these three almost guaranteed that Go would look the way it does today.

**Ken Thompson** is a co-creator of Unix, the author of the B language (C's predecessor), and one of the sources of the Unix philosophy that "each program should do one thing well, and compose them through simple interfaces". **Rob Pike** came from Bell Labs and was a principal designer of Plan 9, the research operating system that followed Unix, and together with Thompson he invented UTF-8; more important, over twenty years at Bell Labs he ran a continuous line of concurrent-language experiments, **Newsqueak, Alef, and Limbo**, gradually turning Hoare's CSP ([1.3](./csp.md)) ideas into a language. Go's `go` keyword, channels, and `select` are the continuation of this line. **Robert Griesemer** brought a deep compiler background, having worked on Google's V8 JavaScript engine, Java's HotSpot virtual machine, and Strongtalk.

Layer these three lineages together and Go's genes become clear: **Unix minimalism** (small, orthogonal, composable), **a twenty-year genealogy of concurrent languages** (CSP and channels), and **front-line compiler and runtime engineering experience** (extremely fast compilation, a substantial runtime). A language designed by "Unix systems programmers plus concurrent-language researchers plus compiler experts" naturally leans toward simplicity, stays close to the system, and treats the toolchain as paramount. Go is not the product of some new fashion in linguistics, but a set of trade-offs distilled from these people's lifetime of experience.

## 1.1.3 The Dissatisfaction at Go's Birth

What prompted them to act were several concrete, everyday pains in large-scale C++ / Java server-side development. In *Go at Google*, Rob Pike put it bluntly: Go was born "to solve Google's software engineering problems", not to pursue linguistic novelty. These pains included:

- **Compilation slow enough to wreck the rhythm.** Google's enormous C++ codebase, because of the **transitive dependencies** of header files, where one `.cc` file `#include`s a header, that header includes others, and so on, layer upon layer, could end up parsing the same batch of headers thousands of times in a single compile. Pike has cited an often-quoted example: in one large build, the amount of header expansion the compiler actually processed was thousands of times the size of the source itself, and builds routinely took tens of minutes. The "change one line, compile, see the result" development loop was badly slowed. Go's later, near-obsessive emphasis on compilation speed ([3.2](../ch03life/compile.md), [15](../../part5toolchain/ch15compile)) has its roots right here.
- **Chaotic dependency management.** The textual-inclusion model of `#include` left dependency relationships murky and led to repeated compilation. Go's package model (the package as the smallest unit, no circular dependencies, depending on a read-only exported summary rather than all the source) and its "an unused import is a compile error" rule are aimed squarely at this pain.
- **Concurrency hard to write and dangerous.** Concurrency in C++ relied on thread libraries plus manual locks, which is both verbose and extremely error-prone (races, deadlocks), while Google's server programs are inherently highly concurrent. Go made concurrency a first-class citizen of the language, with a single `go` keyword, channels, and `select` ([1.3](./csp.md), [9](../../part3concurrency/ch09sched)), turning concurrency from "only experts dare touch it" into "anyone can write it".
- **The language too sprawling.** C++ has so many features, so intertwined, that within a single team it was hard to reach consensus on "which subset of the language to use", and newcomers needed a long time before they dared touch certain corners. Pike has mentioned several times that it was precisely an experience of waiting for a large C++ program to compile, while idly flipping through the C++0x draft standard, that made him resolve to build a "small" language.

## 1.1.4 A "Less Is More" Response

Go's response is a deliberate **restraint**. It chose: compilation to native machine code, garbage collection, static typing; a minimal syntax (just 25 keywords, few enough to recite in one breath); concurrency modeled on CSP ([1.3](./csp.md)); a type system whose skeleton is **composition** rather than inheritance ([4.2](../../part2lang/ch04type/interface.md)); and an extreme emphasis on the toolchain and build speed.

What it **deliberately left out** is as striking as what it kept, and every "leave out" corresponds to one of the pains or values above:

- For a long time it had **no generics** (until Go 1.18 in 2022, [8](../../part2lang/ch08generics)), because no scheme had been found that did not sacrifice compilation speed and simplicity, and it preferred to do without rather than rush.
- **No exceptions** ([7](../../part2lang/ch07errors)): errors are ordinary values, returned explicitly and handled explicitly, refusing "implicit control-flow jumps".
- **No inheritance**, replaced by interfaces and composition, avoiding the fragility and entanglement of class hierarchies.
- **No operator overloading and no implicit type conversion**, refusing the magic of "you can't tell what a line of code does just by looking at it".

Pike condensed this orientation into a single line, "**Less is exponentially more**": removing a feature saves not only that feature itself but also the complexity born of its pairwise interactions with every other feature, and that complexity grows combinatorially with the number of features. What makes a small language valuable is precisely that its features have so few hidden entanglements among them.

## 1.1.5 Complexity Must Earn Its Place

The orientation of "designing by subtraction" is a thread running through the whole book. A distilled example is the **"generic dilemma"** that Russ Cox posed in 2009: among "slow programmers, slow compilers, slow runtimes", any generics scheme seems able to pick only two of the three. C++ templates chose a fast runtime (sacrificing compilation speed and code size), Java chose fast compilation (sacrificing runtime boxing overhead). Precisely because Go valued the latter two so highly (fast compilation, a lean runtime), it preferred to let programmers write a bit of repetitive code for a while rather than introduce generics that would sacrifice them, and it held off until 2022, when it found an implementation that balanced the three reasonably well (GC-shape stenciling plus dictionaries, [8.1](../../part2lang/ch08generics/history.md)). This thirteen-year wait is the most vivid footnote to Go's design philosophy: **complexity must earn its place, and a new feature must first prove it is worth it.**

Once we understand these dissatisfactions and responses present at Go's birth, the analysis of each piece of the implementation in the rest of this book, why the scheduler is cooperative plus signal-based preemption ([9.7](../../part3concurrency/ch09sched/preemption.md)), why the memory model offers only sequentially consistent atomics ([11.9](../../part3concurrency/ch11sync/mem.md)), why the GC fights so hard for low latency ([13](../../part4memory/ch13gc)), all share a common origin in coordinates: they are concrete unfoldings, in every corner, of one set of values, "simple, engineering-friendly, in the service of real large-scale software collaboration". The next section ([1.2](./go.md)) first sketches a bird's-eye view for the whole book, making clear how this set of values is distributed across the three layers of language, runtime, and toolchain.

## Further Reading

1. Rob Pike. *Go at Google: Language Design in the Service of Software Engineering.* 2012.
   https://go.dev/talks/2012/splash.article (Go's engineering motivation, the most authoritative first-hand account)
2. Russ Cox. *The Generic Dilemma.* 2009. https://research.swtch.com/generic
3. Rob Pike. *Less is exponentially more.* 2012.
   https://commandcenter.blogspot.com/2012/06/less-is-exponentially-more.html
4. The Go Authors. *Frequently Asked Questions (FAQ): Origins / Design.* https://go.dev/doc/faq
5. Rob Pike. *The Implementation of Newsqueak / Concurrency, and Go's language genealogy.*
   (The CSP line from Newsqueak/Alef/Limbo to Go)
6. Brian W. Kernighan. *Unix: A History and a Memoir.* 2019 (the Go designers' Unix / Plan 9 origins).
7. Alan A. A. Donovan, Brian W. Kernighan. *The Go Programming Language.* 2015.
