---
weight: 1101
title: "1.1 The Evolution of Programming Languages"
---

# 1.1 The Evolution of Programming Languages

In 2007, Google's build engineers measured the compilation of a large C++ program. It consisted of
about 2000 source files totalling 4.2 MB when simply concatenated, yet after all `#include`
directives were expanded, more than 8 GB of text reached the compiler, an average blow-up of about
2000 bytes for every source byte. Building it took 45 minutes on the distributed build system of the
day. Rob Pike cited these figures in his 2012 article "Go at
Google" [[Pike, 2012a](#ref-pike-2012a)].

The blow-up comes from the way `#include` works. The preprocessor inserts the full text of a header
file verbatim, and that header includes other headers in turn. Every `.cc` file reads and parses all
of this again, so a commonly used header is processed thousands of times in a single build.

Go began while its designers waited for builds like this one. In September 2007, Robert Griesemer,
Rob Pike and Ken Thompson wrote the goals of a new language on a whiteboard; Go was open-sourced in
November 2009 [[Cox et al., 2022](#ref-cox-et-al-2022)], and Go 1 was released in March 2012. This
section covers three topics: the problems they set out to solve, what each of the three designers
brought, and a principle that runs through Go's design: a language should have as few features as
possible, and each addition must prove its worth.

## 1.1.1 The Problems Go Set Out to Solve

Pike states plainly in "Go at Google" that Go was designed to solve the problems Google met in
software development. Its purpose was not programming language research but to improve the working
environment of its designers and their colleagues; in Pike's words, it is a language design "in the
service of software engineering" [[Pike, 2012a](#ref-pike-2012a)]. There were three main problems.

**Slow builds.** The cause is described above. When Go compiles a package, the compiler distills the
package's exported content (types, function signatures, constants and so on) into a summary and
writes it into the compiled output. Packages that import it read only this summary and never parse
its source again ([3.2](../ch03life/compile.md)). In addition, importing a package without using it
is a compile error, and packages may not import each other cyclically, so the dependency graph stays
clear and does not grow without bound.

**Difficult concurrent programming.** Google's servers run on multicore machines and must handle
many requests at once. In C++ such programs have to rely on threads and locks, which makes the code
verbose and error-prone. Go builds concurrency into the language: the `go` statement starts a
goroutine, and channels pass data between goroutines ([1.3](./csp.md)).

**An overly complex language.** C++ has many features that interact with one another; each team
typically uses a subset, and different teams choose different subsets. By Pike's recollection,
around September 2007 he was waiting on a build of a large C++ program that took about 45 minutes,
and in the meantime attended a talk by several Google employees on the C++ standards committee. The
talk introduced the new standard then known as C++0x (later C++11) and covered about 35 new features
in an hour. What troubled Pike (and, in his view, Thompson and Griesemer) most was the new memory
model with its atomic types: it specified such fine details in an already heavily burdened type
system and tied the language too closely to the hardware of the time (Go's own memory model is in
[11.9](../../part3concurrency/ch11sync/mem.md)). Back in his office, Pike started another build,
turned to Griesemer and asked a string of questions; before the build finished they had pulled in
Thompson and decided to design a new language [[Pike, 2012b](#ref-pike-2012b)]. Thompson also said
that reading the C++0x draft standard firmed up his resolve (see the epigraph on the chapter's first
page).

## 1.1.2 The Three Designers

Ken Thompson and Dennis Ritchie created Unix together [[Kernighan, 2019](#ref-kernighan-2019)], and
Thompson also designed B, the predecessor of C. Rob Pike worked at Bell Labs on Plan 9, the research
successor to Unix. In 1992 Thompson and Pike designed UTF-8, now the most widely used character
encoding on the web. Pike also took part in designing several languages built around channels
[[Pike, 1990](#ref-pike-1990)] ([1.3](./csp.md)). Robert Griesemer earned his doctorate at ETH
Zürich, where Niklaus Wirth designed Pascal, Modula-2 and Oberon; Griesemer later worked on Java's
HotSpot virtual machine and on Chrome's V8 JavaScript engine.

The official Go FAQ summarizes Go's lineage this way: the basic syntax belongs to the C family; the
design of declarations and packages borrows heavily from the Pascal, Modula and Oberon family; and
the concurrency ideas come from languages inspired by Hoare's CSP, such as Newsqueak and Limbo
[[Go Authors, 2026](#ref-go-authors-2026)]. These three sources correspond roughly to the experience
of the three designers [[Donovan and Kernighan, 2015](#ref-donovan-kernighan-2015)]:

| Source | What it contributed to Go |
| --- | --- |
| C | Braces, expressions and operators, pointers (but no pointer arithmetic) |
| Pascal, Modula-2, Oberon | Declarations with the name first and the type after; compilation by package; export status marked at the declaration |
| Newsqueak, Limbo and others | The `go` statement, channels, `select` |

The influence of the Oberon family shows most clearly in declaration syntax. A C declaration has to
be read starting from the name and alternating to the right and left. Take a function pointer whose
target function takes another function pointer as its first parameter; in C it is written:

```c
int (*fp)(int (*)(int, int), int);
```

In Go the same declaration reads from left to right:

```go
var fp func(func(int, int) int, int) int
```

Pike's 2010 article "Go's Declaration Syntax" is devoted to this choice
[[Pike, 2010](#ref-pike-2010)]. The export rule follows the same thinking: Oberon marks an exported
name with a trailing `*`, while Go distinguishes by whether the first letter of the name is upper
case. Either way the status is visible at the declaration, and no separate export list needs to be
maintained.

## 1.1.3 Less Is More

Pike set out Go's design approach in his 2012 talk "Less is exponentially
more" [[Pike, 2012b](#ref-pike-2012b)]. The "exponentially" in the title can be understood through
the interaction of features. Language features are not independent: whenever two meet, a dedicated
rule may be needed to specify how they behave together. Most Go programmers have met the following
three examples:

- **For loops and closures.** Before Go 1.22 a loop had a single loop variable. Closures and
  goroutines in the loop body captured that same variable and usually saw only its last value. Go
  1.22 creates a new variable for each iteration.
- **Interfaces and nil.** When an interface variable holds a nil pointer, the interface variable
  itself is not equal to nil.
- **Defer and panic.** After a panic, deferred functions that were already registered still run;
  `recover` works only when called directly from a deferred function.

Simple counting shows why features should be few. Twelve features give 66 pairs; adding one more
creates 12 new pairs. If interactions among three and four features at once are counted as well, the
number of combinations doubles with every added feature. The specification must describe each
combination, the compiler must implement each one, and everyone reading code must remember each one.
Removing a feature therefore saves far more than the feature itself.

The figure below draws 12 common Go features as points on a circle, with a line between every two
points. You can add and remove features to watch the number of lines change, and inspect several
pairs of features that do have dedicated rules.

<div class="viz" data-viz="lang-interactions"></div>

The idea was articulated before Go. In "No Silver Bullet", proposed in 1986 and published in 1987,
Fred Brooks divided the difficulties of software development into essence and accident: the former
comes from the problem itself, the latter from tools and means of expression, and earlier advances
such as high-level languages removed only the latter [[Brooks, 1987](#ref-brooks-1987)]. The rules
between features are exactly such accidental difficulties, and every user of the language must bear
them. In his 1980 Turing Award lecture Tony Hoare said [[Hoare, 1981](#ref-hoare-1981)]: "There are
two ways of constructing a software design: One way is to make it so simple that there are obviously
no deficiencies, and the other way is to make it so complicated that there are no obvious
deficiencies. The first method is far more difficult."

In his 1995 "A Plea for Lean Software", Wirth cites Martin Reiser's observation that software is
getting slower more rapidly than hardware is getting faster. As a counterexample he offers the
Oberon system that he and Jürg Gutknecht developed: a complete operating system together with its
compiler, small enough to be explained from start to finish in a single book (*Project Oberon*)
[[Wirth, 1995](#ref-wirth-1995)].

## 1.1.4 New Features Must Prove Their Worth

Generics are the classic example. In his 2009 post "The Generic Dilemma", Russ Cox sorted the
approaches of the time into three routes. Provide no generics and make programmers write repetitive
code, as C does. Generate a separate copy of the code for each type, at the cost of slower
compilation and larger programs, as C++ does. Or box every value implicitly, at the cost of slower
execution, as Java does. In short, one must choose among slow programmers, slow compilers and
bloated programs, and slow execution [[Cox, 2009](#ref-cox-2009)].

Go 1 had no generics. They entered the language only with Go 1.18, released in March 2022, and the
implementation took a compromise: types with the same underlying representation (for example, all
pointer types) share one copy of the code, and the remaining differences are supplied by a
dictionary passed in at the call ([8.1](../../part2lang/ch08generics/history.md)). Counting from the
open-sourcing in 2009, this decision waited thirteen years.

Other features Go deliberately omits are exceptions (errors are ordinary return values,
[Chapter 7](../../part2lang/ch07errors/readme.md)), class inheritance (replaced by interfaces and
struct embedding), operator overloading, and implicit conversions between numeric types. Each has
its uses, and each becomes entangled with other features.

The principle recurs in later chapters. Goroutines cannot be given priorities
([Chapter 9](../../part3concurrency/ch09sched/readme.md)). Atomic operations offer only one
semantics, and the one easiest to reason about ([11.9](../../part3concurrency/ch11sync/mem.md)). The
garbage collector has only two tunable parameters, `GOGC` and `GOMEMLIMIT`
([Chapter 13](../../part4memory/ch13gc/readme.md)). The next section describes the parts that make
up Go.

## Further Reading

- <a id="ref-pike-2012a"></a>[Pike, 2012a] Rob Pike. "Go at Google: Language Design in the Service
  of Software Engineering." 2012. https://go.dev/talks/2012/splash.article The engineering
  motivation for Go; the header-bloat figures come from here.
- <a id="ref-pike-2012b"></a>[Pike, 2012b] Rob Pike. "Less is exponentially more." 2012.
  https://commandcenter.blogspot.com/2012/06/less-is-exponentially-more.html The source of the "less
  is more" slogan in the Go community; it also records the C++0x talk at Go's beginning.
- <a id="ref-cox-et-al-2022"></a>[Cox et al., 2022] Russ Cox, Robert Griesemer, Rob Pike, Ian Lance
  Taylor, Ken Thompson. "The Go Programming Language and Environment." *Communications of the ACM*,
  65(5): 70–78, 2022. https://doi.org/10.1145/3488716 Go's designers look back on which decisions
  proved right.
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Frequently Asked Questions
  (FAQ)*, sections "Origins" and "Design". https://go.dev/doc/faq Go's lineage, and the reasons for
  several things Go does not do.
- <a id="ref-pike-2010"></a>[Pike, 2010] Rob Pike. "Go's Declaration Syntax." The Go Blog, 2010.
  https://go.dev/blog/declaration-syntax
  Why types are written after names.
- <a id="ref-cox-2009"></a>[Cox, 2009] Russ Cox. "The Generic Dilemma." 2009.
  https://research.swtch.com/generic
  The three routes to generics, and the cost of each.
- <a id="ref-brooks-1987"></a>[Brooks, 1987] Frederick P. Brooks, Jr. "No Silver Bullet: Essence and
  Accidents of Software Engineering." *IEEE Computer*, 20(4): 10–19, 1987. Divides the difficulties
  of software development into essential and accidental ones.
- <a id="ref-hoare-1981"></a>[Hoare, 1981] C. A. R. Hoare. "The Emperor's Old
  Clothes." *Communications of the ACM*, 24(2): 75–83, 1981. Hoare's Turing Award lecture, on the
  lessons of excessive complexity in language design.
- <a id="ref-wirth-1995"></a>[Wirth, 1995] Niklaus Wirth. "A Plea for Lean Software." *IEEE
  Computer*, 28(2): 64–68, 1995. Argues for lean software, using the Oberon system as the example.
- <a id="ref-pike-1990"></a>[Pike, 1990] Rob Pike. "The Implementation of Newsqueak." *Software:
  Practice and Experience*, 20(7): 649–659, 1990. Pike's early channel-based language, the origin of
  Go's concurrency design.
- <a id="ref-kernighan-2019"></a>[Kernighan, 2019] Brian W. Kernighan. *UNIX: A History and a
  Memoir*. Kindle Direct Publishing, 2019. The history of Bell Labs and Unix, in which both Thompson
  and Pike appear.
- <a id="ref-donovan-kernighan-2015"></a>[Donovan and Kernighan, 2015] Alan A. A. Donovan, Brian W.
  Kernighan. *The Go Programming Language*. Addison-Wesley, 2015. Its preface has a diagram of Go's
  ancestry that corresponds to the table in this section.
