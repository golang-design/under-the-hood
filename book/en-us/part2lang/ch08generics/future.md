---
weight: 2504
title: "8.4 The Future of Generics"
---

# 8.4 The Future of Generics

> Generics landed in 1.18 and more than four years have passed. This section no longer dwells on
> speculation about "what might be." Instead it looks back and takes inventory: which expectations
> were met, which were deliberately shelved, and where the tension that runs through it all (the
> cost of abstraction) stands today. The author once gave a public talk on Go 2 generics in earlier
> years ([YouTube](https://www.youtube.com/watch?v=E16Y6bI2S08),
> [slides](https://changkun.de/s/go2generics/)). Most of those predictions can now be checked against
> reality, and this section accounts for them along the way.

[8.1](./history.md) traced the thirteen-year evolution of generics from contracts to "interfaces as
constraints," and [8.3](./checker.md) covered how the type checker digests type parameters and
constraints. The story after landing is another thread: shipping a language feature is only the
starting point. What idioms it grows in the standard library, what boundaries the community runs into
in use, what the team then adds and what it holds back, these are what decide its final shape. The Go
team has always described its own approach to generics as cautious: ship the smallest usable version
first, watch real needs surface, then add in small steps. This section takes inventory of what that
caution bought, along four lines: what landed, what is still absent, the core tension, and the
philosophy of evolution.

## 8.4.1 What Has Landed Since 1.18

In 1.18 generics delivered only the language-level type parameters and constraints. What actually
brought them into everyday code was the standard library and idioms that grew around them over the
next several releases.

**`slices`, `maps`, `cmp`: a generic standard library (1.21).** Before generics, "sort, search, or
deduplicate an arbitrary slice" relied either on `sort.Slice` plus a closure, or on `interface{}`
plus reflection. Neither path was safe or fast. In 1.21 these operations were collected into three
generic packages. `cmp` provides the constraint and comparison primitives for ordered types:

```go
// cmp package: abstracting "can be ordered" into a constraint (sketched from src/cmp)
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
        ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
        ~float32 | ~float64 | ~string
}

func Less[T Ordered](x, y T) bool { return (isNaN(x) && !isNaN(y)) || x < y }
```

Note that every item in the constraint carries a tilde `~`, meaning "the underlying type is this"
rather than "is exactly this," so a user-defined `type Celsius float64` also falls within `Ordered`.
`slices` and `maps` are then built on top of these constraints, giving type-safe, reflection-free
versions of common operations:

```go
import ("slices"; "cmp")

s := []int{3, 1, 2}
slices.Sort(s)                       // [1 2 3], no sort.Slice closure needed
i, ok := slices.BinarySearch(s, 2)   // i=1, ok=true
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age) // cmp.Compare returns -1/0/+1
})
```

This is the first and most direct promise generics fulfilled: code that previously had to sacrifice
either type safety (reflection) or reuse (copying it out by hand) is gathered into a single general
implementation that is both safe and efficient.

**`iter.Seq` and range-over-func iterators (1.23).** What truly turned generics from "something only
library authors touch" into "something everyone benefits from" was the iterator protocol introduced in
1.23. First, in the `iter` package, an "iterator" is defined as an ordinary generic function type:

```go
// src/iter: an iterator is just a function that hands elements to yield one by one
type Seq[V any]     func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

`yield` returning `false` means the caller wants to stop early, and the iterator breaks accordingly.
The accompanying language change is that `for range` can now range directly over such a function, with
the compiler rewriting the loop body into the `yield` closure passed to the iterator. So functions like
`maps.Keys` that return an `iter.Seq` can be ranged over just like built-in containers:

```go
func Keys[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[K] {
    return func(yield func(K) bool) {
        for k := range m {
            if !yield(k) { // caller breaks, yield returns false, stop early
                return
            }
        }
    }
}

for name := range maps.Keys(m) { // caller side: no different from ranging a built-in container
    fmt.Println(name)
}
```

The design of this step is telling: it invented no new syntax for "custom iterators." Instead it used
a generic function type plus a single `range` extension to let any data structure offer a uniform
traversal interface. Generics are not the protagonist here, but they are the foundation. Without the
parameterizable function type `iter.Seq[V]`, there would be no "uniform iteration over an arbitrary
element type" to speak of.

**Generic type aliases (1.24).** [4.3](../ch04type/alias.md) introduced the type alias `type A = B`.
Aliases in 1.18 could not carry type parameters, so there was no way to give a short name to a generic
type. 1.24 filled in this gap:

```go
type Set[T comparable] = map[T]struct{} // from 1.24: aliases can be parameterized too
```

This looks small, yet it is a necessary stitch for weaving generics into the existing type system: an
alias must be able to forward type parameters, otherwise a generification refactor (putting type
parameters on an old type while keeping the old name through an alias) would stall halfway.

**Performance polishing of dictionary indirection (ongoing).** [8.1](./history.md) detailed the
implementation strategy: GC-shape stenciling plus runtime dictionaries. In the releases since landing,
the compiler and runtime have steadily been trimming the overhead of this indirection (more aggressive
devirtualization, dictionary inlining for some calls). This line has no day of being "done." It is
precisely the engineering battlefield of the core tension in the next section.

## 8.4.2 What Is Still Absent, and Why

Beyond taking inventory of what landed, we should equally take inventory of the deliberate blanks. The
following are capabilities common in generic programming that Go still does not provide. Their absence
is mostly not an oversight but a decision made after weighing the trade-offs.

**Parameterized methods (methods cannot have their own type parameters).** You can write a generic
function `func Map[T, U any](...)`, but you cannot write a method with its own independent type
parameters, such as `func (s Set[T]) Map[U any](...) Set[U]`. This is the limitation people trip over
most often, and the reason lies in the interplay between methods and interfaces. Interface satisfaction
in Go is structural: a type satisfies an interface as long as it has the required method set. If
methods were allowed to carry their own type parameters, interfaces would have to be able to describe
"a method that holds for any `U`." That is equivalent to introducing universal quantification over
types at the level of the method set, which would complicate both type checking and the runtime method
table (itab), and would no longer be self-consistent with the existing interface model. The Go team's
choice was: better to have users write such operations as top-level generic functions than to open this
door for methods (see issue [#49085](https://github.com/golang/go/issues/49085) for years of
discussion).

**Higher-kinded types.** Go's type parameters can only be instantiated with concrete types, not with
"type constructors." You cannot write a `Functor` abstraction that holds for "any container `F[_]`."
Haskell's `Functor`/`Monad` machinery has no way to be expressed in Go. This is a deliberate
simplification: higher-kinded types would raise the type system's complexity by an order of magnitude,
counter to Go's leaning that "being able to read it matters more than writing it cleverly."

**Generic specialization.** C++ allows providing a dedicated implementation for a specific type
parameter (template specialization). Go does not: a generic function has a single definition for all
types that satisfy the constraint. This avoids the cognitive burden of "the same call jumping to a
completely different implementation depending on the type," at the cost of being unable to hand-write
an optimized version for a hot type.

**True sum types / enums.** The `A | B` in a constraint looks like a sum type, but it is really a
**type set**: it constrains "which types the type parameter may be," a compile-time, type-level
concept, not a value-level tagged union of "this value is either an A or a B," and it has no
compiler-enforced exhaustiveness check. If you want to express "a result is either a success or an
error, and a `switch` must cover all branches," you cannot. Sum types remain an actively discussed
topic in the community, with several proposals under discussion but no conclusion. The distinction to
keep clear here: `A | B` is a reuse of the constraint syntax, not a value-level sum type.

Put together, what is absent is not trivia but rather quite core capabilities in generic programming.
Go's choice has been consistent throughout: every omission buys a smaller language model and a type
system that is easier to reason about. Whether it is worth it depends on whether the reader values
expressiveness or simplicity more, and that itself is an account with no standard answer.

## 8.4.3 The Core Tension: Performance Versus Abstraction

The deepest tension in generics is not in syntax but in implementation: **unified abstraction and
zero runtime overhead are hard to have at once.** This question has three classic answers, already
laid out in [8.1](./history.md). Here we only fix the coordinates so the lessons from after landing
can be placed against them:

| Strategy | Representative | Code size | Runtime overhead |
|------|------|--------|-----------|
| Full monomorphization | C++ templates, Rust | One copy per concrete type, bloated, slow to compile | Zero (can inline, can devirtualize) |
| Full boxing / type erasure | Java | One copy | Uniform indirection and boxing overhead |
| GC-shape stenciling + dictionaries | Go | One copy per **pointer shape** | Indirect access through a dictionary |

Go takes the third, compromise path: it generates code grouped by memory layout (GC shape), a group
of types with the same layout shares one copy of machine code, while type-dependent information
(descriptors, methods, other generic instances it uses) is passed in at call time through a **runtime
dictionary**. It is of a piece with the Haskell type-class "dictionary passing" mentioned in
[4.2](../ch04type/interface.md): one layer of indirection in exchange for a balance between code size
and performance.

The cost hides in exactly that layer of indirection. In the widely circulated 2022 piece "Generics can
make your Go code slower," PlanetScale's Vicent Marti laid out the mechanism concretely: when generic
code calls a method on a type parameter, the call first goes through the dictionary to find the
concrete type's method table (itab), then jumps indirectly through the itab. This layer of indirection
**defeats inlining and devirtualization**. The compiler can neither see through the call target nor
inline it. The result is counterintuitive: in some scenarios the generic version is not only no faster
than a hand-written concrete version, it is even slower than an honest `interface`-based version,
because it carries the dictionary's indirection while gaining none of the inlining benefit that
monomorphization was supposed to bring. For the mechanism's details, see the design document "Generics
implementation: GC Shape Stenciling" in the Go proposal repository.

This is not generics "failing" but rather its engineering nature:

- Generics' steadiest payoff scenario is generifying **data structures** (containers, algorithms).
  Such code rarely has performance-sensitive small method calls to begin with, the dictionary
  indirection is amortized away, and `slices`/`maps` are exactly this case.
- On performance-sensitive hot paths, when small methods are called frequently on a type parameter,
  measure: a hand-written monomorphized version may still be faster.
- The compiler's optimization of this indirect path (devirtualization, dictionary inlining) is work
  still being advanced along the evolution line in [8.1](./history.md). Today's conclusion is not
  necessarily tomorrow's.

Performance gains never come for free. Go uses one layer of dictionary indirection to buy "one body of
code serving many types," with controlled code bloat. Anyone wanting more extreme speed must fall back
to monomorphization and shoulder the code size and compile time themselves. In the end, what generics
give is not "free abstraction" but **a new option that has to be weighed per scenario.**

## 8.4.4 Small-Step, Practice-Driven Evolution

Looking back over the trajectory from 1.18 to today, we find it confirms the approach the Go team has
repeatedly stated: ship the smallest usable version first, observe needs in real use, then add
carefully. 1.18 gave only type parameters and constraints; `slices`/`maps`/`cmp` did not come until
1.21; iterators not until 1.23; generic aliases not until 1.24. Each step was not a one-time pouring
of the blueprint into a finished form, but a single move placed only after idioms had settled in the
community and the need had been confirmed again and again.

This caution is not unique to Go. Reflecting on C++ templates in earlier years, Bjarne Stroustrup
admitted ([Stroustrup 1994], Chapter 15):

> "I do think I was overly cautious and conservative in starting to describe the template mechanism.
> We should have put many features in from the start... These features added little burden on the
> implementer, yet were especially helpful to the user."

> "Up to templates, I had always polished a language feature through 'implement, use, discuss,
> reimplement.' After templates, implementation often ran in parallel with discussion, the discussion
> was not broad enough, and I lacked critical implementation experience, so I later revised templates
> in many ways based on usage experience."

Both passages point to the same lesson: a feature as deeply embedded in the type system as generics
cannot be pushed all the way through by paper discussion alone. It needs a great deal of real
implementation and use to calibrate. By the time C++ templates were finalized, large generic libraries
like the STL were in fact already in use. Go absorbed this lesson into an explicit rhythm: ship first,
observe next, extend later. Its cost is "the capability you want has to wait" (parameterized methods,
sum types still have not arrived). What it buys is that every extension stands on a need already
validated, rather than betting on speculation.

It is for this reason that the absence list in 8.4.2 should not be read as "a to-do list not yet
finished." Some of those items may never be added. Go's restraint toward language complexity is itself
part of the design. The future of generics is most likely not some version with an explosion of
features, but a continuation of this slow, small-step walk: between abstraction and simplicity,
expressiveness and readability, performance and generality, settling the point anew, again and again,
with care.

## Further Reading

- [slices] The Go Authors. _Package slices_. https://pkg.go.dev/slices
- [maps] The Go Authors. _Package maps_. https://pkg.go.dev/maps
- [cmp] The Go Authors. _Package cmp_. https://pkg.go.dev/cmp
- [iter] The Go Authors. _Package iter_. https://pkg.go.dev/iter
- [Go1.21] The Go Authors. _Go 1.21 Release Notes_ (adds `slices`/`maps`/`cmp`). https://go.dev/doc/go1.21
- [Go1.23] The Go Authors. _Go 1.23 Release Notes_ (range-over-func and `iter`). https://go.dev/doc/go1.23
- [Go1.24] The Go Authors. _Go 1.24 Release Notes_ (generic type aliases). https://go.dev/doc/go1.24
- [RangeFunc] The Go Blog. _Range Over Function Types_. https://go.dev/blog/range-functions ; proposal [#61405](https://github.com/golang/go/issues/61405)
- [GCShape] Keith Randall. _Generics implementation: GC Shape Stenciling_ (Go design document). https://github.com/golang/proposal/blob/master/design/generics-implementation-gcshape.md
- [Marti2022] Vicent Marti. _Generics can make your Go code slower_. PlanetScale, 2022. https://planetscale.com/blog/generics-can-make-your-go-code-slower
- [Issue49085] The Go Authors. _proposal: spec: allow type parameters in methods (parameterized methods)_. https://github.com/golang/go/issues/49085
- [Stroustrup 1994] Bjarne Stroustrup. _The Design and Evolution of C++_. Addison-Wesley, 1994. Chapter 15: Templates.
