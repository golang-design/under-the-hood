---
weight: 2504
title: "8.4 The Future of Generics"
---

# 8.4 The Future of Generics

Generics shipped with Go 1.18 in March 2022, and by Go 1.27 in August 2026 they have been through
ten releases. The release of a language feature is only a beginning. The idioms it forms in the
standard library, the boundaries users meet in practice, and what the team adds or sets aside in
response together determine its final shape. This section reviews how generics have evolved since
landing: which capabilities have been filled in, how generic methods in Go 1.27 changed a position
the team held for years, which capabilities remain deliberately omitted, how far the performance
tension at the implementation level has been resolved, and what the process says about how Go
evolves. The author presented the generics design of the time at Go Night Reading episode 80 in
March 2020 [[Ou, 2020](#ref-ou-2020)], when constraints were still expressed as contracts
([8.2 Contract-Based Generics](./contracts.md)); comparing it with today's design shows how much has
changed.

## 8.4.1 Capabilities Already Filled In

Go 1.18 delivered only type parameters and constraints at the language level. Its release notes
admit that these features rely on a large amount of new code that has not been tested in production;
the team believed in the quality of the implementation but "cannot back that belief with real-world
experience", and recommended appropriate caution when deploying generic code in production
[[Go Authors, 2022](#ref-go-authors-2022)]. Later releases added to it along two lines: relaxations
in the language and type checking, and a standard library built around generics.

| Version | Language and type checking | Standard library |
|---------|----------------------------|------------------|
| Go 1.18 (2022) | Type parameters, constraints, type inference | |
| Go 1.20 (2023) | Types may be declared inside generic functions and methods; ordinary interface types may satisfy `comparable` | |
| Go 1.21 (2023) | Several improvements to type inference ([8.3.3](./checker.md)) | `slices`, `maps`, `cmp`; `sync.OnceValue` |
| Go 1.23 (2024) | `range` over function types | `iter`; iterators such as `maps.Keys` and `slices.All`; `unique` |
| Go 1.24 (2025) | Generic type aliases | `weak` |
| Go 1.25 (2025) | The specification drops the concept of core types ([8.3.2](./checker.md)) | |
| Go 1.26 (2026) | Constraints may refer to the generic type being declared | `errors.AsType` ([7.2 Inspecting Error Values](../ch07errors/inspect.md)) |
| Go 1.27 (2026) | Generic methods; function type inference in all assignment contexts | `(*rand.Rand).N` |

**`slices`, `maps` and `cmp` (Go 1.21).** Before generics, sorting, searching or deduplicating an
arbitrary slice required either `sort.Slice` with a closure, or `interface{}` and reflection. The
former needs comparison logic written for every call; the latter loses compile-time type checking
and pays a run-time cost. Go 1.21 gathered these operations into three generic packages
[[Go Authors, 2023b](#ref-go-authors-2023b)]. `cmp` defines the constraint for ordered types and the
comparison primitives [[Go Authors, 2026c](#ref-go-authors-2026c)]:

```go
// Go 1.26 src/cmp/cmp.go (abridged, comments translated)
type Ordered interface {
	~int | ~int8 | ~int16 | ~int32 | ~int64 |
		~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
		~float32 | ~float64 |
		~string
}

// Less reports whether x is less than y. NaN is considered less than any non-NaN value.
func Less[T Ordered](x, y T) bool {
	return (isNaN(x) && !isNaN(y)) || x < y
}

// isNaN holds for any Ordered type: only NaN is not equal to itself.
func isNaN[T Ordered](x T) bool {
	return x != x
}
```

Every term in the constraint carries a `~`, so a custom type such as `type Celsius float64` also
satisfies `Ordered`. `isNaN` is written the way it is because a generic function cannot call
`math.IsNaN` for the floating-point types alone: it relies on the fact that only NaN is unequal to
itself, which gives a test that is also valid (always false) for integers and strings. `slices`
[[Go Authors, 2026a](#ref-go-authors-2026a)] and `maps` [[Go Authors, 2026b](#ref-go-authors-2026b)]
are built on these constraints:

```go {run=true}
package main

import (
	"cmp"
	"fmt"
	"maps"
	"slices"
)

type Person struct {
	Name string
	Age  int
}

func main() {
	s := []int{3, 1, 2}
	slices.Sort(s) // no comparison closure as with sort.Slice
	i, ok := slices.BinarySearch(s, 2)
	fmt.Println(s, i, ok)

	people := []Person{{"Alice", 30}, {"Bob", 25}}
	slices.SortFunc(people, func(a, b Person) int {
		return cmp.Compare(a.Age, b.Age) // returns -1, 0 or +1
	})
	fmt.Println(people)

	ages := map[string]int{"Carol": 35, "Alice": 30, "Bob": 25}
	for _, name := range slices.Sorted(maps.Keys(ages)) { // since Go 1.23
		fmt.Println(name, ages[name])
	}
}
```

```
[1 2 3] 1 true
[{Bob 25} {Alice 30}]
Alice 30
Bob 25
Carol 35
```

**Iterators and `range` over function types (Go 1.23).** The `maps.Keys` used in the last part of
the example is itself a small picture of how generics evolved. Shortly before the Go 1.21 release,
`maps.Keys` and `maps.Values` had already been implemented, but they were removed on the release
branch, and the commit message reads: "keep the two names so that they can later return
iterators" [[Taylor, 2023c](#ref-taylor-2023c)]. Two years later, Go 1.23 introduced the iterator
protocol [[Go Authors, 2024](#ref-go-authors-2024)]. The `iter` package defines an iterator as an
ordinary generic function type [[Go Authors, 2026d](#ref-go-authors-2026d)]:

```go
// Go 1.26 src/iter/iter.go
type Seq[V any] func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

An iterator hands elements to `yield` one by one; when `yield` returns `false`, the caller wants no
more values and the iterator should stop. The accompanying language change is that `for range` can
act directly on such a function: the compiler rewrites the loop body into a function passed to the
iterator as `yield`, and an early exit such as `break` makes `yield` return `false`
[[Taylor, 2024](#ref-taylor-2024)]. `maps.Keys` then rejoined the standard library returning an
`iter.Seq`:

```go
// Go 1.26 src/maps/iter.go (comments added by the author)
func Keys[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[K] {
	return func(yield func(K) bool) {
		for k := range m {
			if !yield(k) { // the caller left the loop early
				return
			}
		}
	}
}
```

This design introduces no new syntax for custom iterators. A generic function type plus one
extension of `range` lets any data structure offer a uniform traversal interface. Generics are
inconspicuous here but foundational: without the parameterizable function type `iter.Seq[V]`, there
would be no uniform iterator type for arbitrary element types.

**Generic type aliases (Go 1.24).** The type aliases introduced in
[4.3 Type Aliases](../ch04type/alias.md) could not carry type parameters in Go 1.18, so there was no
way to give a generic type an alias that is still generic. Go 1.24 fully supports generic type
aliases [[Go Authors, 2025](#ref-go-authors-2025)]:

```go
type Set[T comparable] = map[T]struct{} // since Go 1.24, an alias may have type parameters
```

Aliases were designed to support migrating types during large-scale refactoring; with generic
aliases, the old name can likewise be kept when a generic type moves between packages.

**Constraints that refer to themselves (Go 1.26).** Go 1.26 lifted the restriction that a generic
type cannot refer to itself in its own type parameter list
[[Go Authors, 2026e](#ref-go-authors-2026e)]:

```go
type Adder[A Adder[A]] interface { // valid since Go 1.26
	Add(A) A
}

func algo[A Adder[A]](x, y A) A {
	return x.Add(y)
}
```

A type parameter bounded by a constraint that takes that same parameter as its argument is called
**F-bounded polymorphism** in type theory. It was proposed for object-oriented languages by Canning
et al. in 1989 [[Canning et al., 1989](#ref-canning-et-al-1989)], and Java's
`<T extends Comparable<T>>` is one instance. Since Go 1.18, Go has allowed such constraints in the
type parameter list of a function, for example `func Max[T Lesser[T]](a, b T) T` with
`type Lesser[T any] interface{ Less(T) bool }`. What was forbidden was only a generic type referring
to itself in its own type parameter list; Go 1.20 reports
`invalid recursive type: Adder refers to itself` when compiling the `Adder` above. The restriction
originated in a deadlock of type inference in the recursive constraint's type parameter list during
development (#49439); inference of type arguments for generic types was later removed and was not
shipped in the final Go 1.18 either, so the restriction lost its reason to exist
[[Griesemer, 2025](#ref-griesemer-2025)].

## 8.4.2 Generic Methods: A Change of Position

Of all the missing capabilities, the one users asked for most is the **generic method**: a method
that declares its own type parameters. The 2021 type parameters proposal discussed its difficulties
specifically [[Taylor and Griesemer, 2021](#ref-taylor-griesemer-2021)]. Suppose type `S` has a
generic method `Identity[T any](v T) T`, an interface `HasIdentity` in another package requires such
a method, and a third package calls `Identity[int]` on any value implementing `HasIdentity`. Since
interface satisfaction in Go is structural, when the package containing `S` is compiled there is no
way to know which type arguments `Identity` will be called with. The proposal lists three ways out:
analyze the whole program's call graph at link time, but reflection makes such an analysis
impossible to complete; instantiate at run time, which needs just-in-time compilation or a
reflection-based implementation, complex and surprisingly slow; or declare that generic methods do
not take part in interface satisfaction, but the proposal argued that it would then be unclear why
methods are needed at all, since any generic method can be written as a generic function. The Go FAQ
goes on to list four choices, holds that forbidding generic methods from satisfying interfaces
is "unacceptable from a design standpoint", and once wrote "we do not anticipate that Go will ever
add generic methods" [[Go Authors, 2026g](#ref-go-authors-2026g)]. A proposal to allow methods to
have type parameters (#49085) was filed in 2021 and gathered more than nine hundred upvotes, yet
made no progress for a long time [[Macias, 2021](#ref-macias-2021)].

In January 2026, Griesemer filed a new proposal titled "Generic Methods for Go", whose background
section is headed "A change of view" [[Griesemer, 2026a](#ref-griesemer-2026a)]. The proposal
observes that generic methods had been rejected because the primary role of a method was seen as
implementing interfaces. But a method is not only a means of implementing interfaces: it is a
function associated with a type and accessed through that type's namespace, and it has value for
organizing code even if it is never used to implement an interface; `x.a().b().c()` reads from left
to right, whereas `c(b(a(x)))` evaluates from the inside out. Since a concrete method is a function
with a receiver, a generic concrete method can be a generic function with a receiver; interface
methods cannot syntactically have type parameters, so a generic method naturally matches no
interface method, which is an orthogonal matter. The third way out, which the 2021 proposal found
unclear, was thereby re-evaluated as the right choice. The proposal was accepted on 25 February 2026
and ships with Go 1.27 [[Go Authors, 2026f](#ref-go-authors-2026f)]:

```go
package main

import (
	"fmt"
	"strconv"
)

type List[E any] []E

// Apply applies f to each element of l and returns a new list of the results
func (l List[E]) Apply[F any](f func(E) F) List[F] {
	r := make(List[F], len(l))
	for i, x := range l {
		r[i] = f(x)
	}
	return r
}

func main() {
	l := List[int]{1, 2, 3}
	s := l.Apply(strconv.Itoa)                         // F is inferred as string from the argument
	n := s.Apply(func(x string) int { return len(x) }) // method calls can be chained left to right
	fmt.Println(s, n)
	fmt.Println(l.Apply[float64](func(x int) float64 { return float64(x) / 2 })) // type argument given explicitly
}
```

```
[1 2 3] [1 1 1]
[0.5 1 1.5]
```

This code needs Go 1.27; with `go 1.26` declared in `go.mod`, the compiler reports
`generic method requires go1.27 or later`. Generic methods do not take part in interface
satisfaction:

```go
type Stringer interface{ String() string }

type H struct{}

func (H) String[P any]() string { return "" }

var _ Stringer = H{} // error
```

```
cannot use H{} (value of struct type H) as Stringer value in variable declaration: H does not implement Stringer (wrong type for method String)
		have String[P any]() string
		want String() string
```

The proposal also specifies that generic methods cannot be accessed through reflection by name or by
index, for the same reason as uninstantiated generic functions: the `reflect` package has no
mechanism for instantiating generics. In the Go 1.27 standard library, the only generic method is
`(*Rand).N` in `math/rand/v2`, which behaves like the long-existing top-level generic function
`rand.N`.

The implementation of generic methods remains bound by shape stenciling ([8.1.3](./history.md)). The
following method produces the type `T[T[X]]` on every instantiation of `T[X]`. When a generic type
is instantiated, all of its methods must be generated, because the type may be used in another
package to satisfy an interface. The instantiation would recurse forever and never terminate, so the
compiler's monomorphization check rejects the code:

```go
type T[P any] struct{}

func (T[P]) m() T[T[P]] { panic("unimplemented") } // instantiation cycle: P instantiated as T[P]
```

Written as a top-level generic function, `func m[P any](T[P]) T[T[P]]`, it compiles, because a
function is instantiated only when called. Griesemer points out that since generic methods cannot be
used to satisfy interfaces, the compiler could treat them like generic functions, which would lift
this restriction; at the time of writing, this work is still under investigation
[[Griesemer, 2026b](#ref-griesemer-2026b)].

## 8.4.3 Capabilities Still Absent

The Go 1.18 release notes list six known limitations of the generics implementation
[[Go Authors, 2022](#ref-go-authors-2022)]. Checked against Go 1.27, only one has been removed:

| Limitation listed in Go 1.18 | Status in Go 1.27 |
|------------------------------|-------------------|
| Types cannot be declared inside generic functions and methods | Lifted in Go 1.20 [[Go Authors, 2023a](#ref-go-authors-2023a)] |
| `real`, `imag` and `complex` do not accept arguments of type parameter type | Still present |
| Only methods explicitly declared in the constraint can be called, even if every type in the type set has the method | Still present |
| Fields shared by all structs in a type set cannot be accessed | Still present ([8.3.5](./checker.md)) |
| Type parameters cannot be embedded in structs or interfaces | Still present |
| A union with more than one term cannot contain an interface with methods | Still present |

The last five still produce compile errors in Go 1.27, for example
`embedded field type cannot be a (pointer to a) type parameter` and
`cannot use fmt.Stringer in union (fmt.Stringer contains methods)`. Besides these implementation
limits, the "Omissions" section of the type parameters proposal explicitly lists capabilities that
were not meant to be provided [[Taylor and Griesemer, 2021](#ref-taylor-griesemer-2021)], several of
which are central tools of generic programming in other languages.

**Specialization.** C++ allows a specialized implementation for particular template arguments; Go
does not. A generic function has one definition for all types that satisfy the constraint. The same
call does not branch to a completely different implementation depending on the type argument, at the
price that an optimized version cannot be hand-written for a hot type.

**Metaprogramming.** Go has no mechanism for executing code at compile time to generate run-time
code. C++ templates are Turing complete, and template metaprogramming became a programming paradigm
of its own; Go generics only substitute types.

**Higher-order abstraction.** A generic function can be used only by calling or instantiating it,
and a generic type can be used only by instantiating it. An uninstantiated `List` therefore cannot
be passed as a type argument, and abstraction over **type constructors**, such as `Functor` and
`Monad` in Haskell, so-called higher-kinded types, cannot be expressed in Go.

The proposal also omits covariance and contravariance, operator methods (a generic container cannot
be accessed with the syntax `c[k]`), a variable number of type parameters, defining adapters in
constraints, and constants as parameters (such as `Matrix[n int] [n][n]float64`).

**Sum types.** The `A | B` in a constraint looks like a sum type but is really a type set
([8.3.1](./checker.md)): it limits which types a type parameter may be, a compile-time concept at
the level of types, and not a tagged union at the level of values saying "this value is either an
`A` or a `B`", and there is no compiler-enforced exhaustiveness check. A proposal for sum types was
filed as early as 2017 [[Obenour, 2017](#ref-obenour-2017)]; in 2023, Taylor proposed defining sum
types on the basis of union constraints, that is, allowing interfaces containing unions to be used
as ordinary types [[Taylor, 2023a](#ref-taylor-2023a)]. Neither proposal has been decided to this
day.

These omissions are not marginal; they are fairly central capabilities in generic programming. Go's
choice has been consistent: every omission makes the language model smaller and the type system
easier to reason about. The history of generic methods also shows that these choices are not fixed:
when the understanding of a problem changes, a feature once declared as one that would "never be
added" can arrive in a restricted form.

## 8.4.4 Performance and Abstraction: The Cost of Indirect Calls

The deepest tension in generics lies not in syntax but in implementation: unified abstraction and
zero run-time overhead are hard to have together. The code size and run-time cost of the three
strategies, full monomorphization, type erasure, and Go's GC shape stenciling with dictionaries, are
discussed in detail in [8.1.3](./history.md) and [8.1.4](./history.md), and Randall's design
document already foresaw the cost that method calls on type parameters cannot be resolved at compile
time [[Randall, 2020](#ref-randall-2020)]. The concern here is the experience since landing: where
the cost of shape stenciling actually falls, and what the compiler has improved.

Two weeks after Go 1.18 was released, Vicent Marti of PlanetScale published a widely circulated
analysis [[Marti, 2022](#ref-marti-2022)]. Marti found that all pointer types share one shape, so
when a method is called on a type parameter in generic code, the method's information can be
obtained from the dictionary only at run time, and a pointer method call that could otherwise be
inlined degrades to "an interface call with two indirections", which the compiler can neither
devirtualize nor inline; passing an interface value as a type argument to a generic function costs
even more. The article's advice can be summarized as follows: generics suit data structures and
functional helpers that take callback types as parameters; do not expect generics to achieve
devirtualization or inlining; do not pass interfaces to generic functions; and there is no need to
rewrite existing APIs that take interfaces as generic.

Later releases made several improvements to indirect access through the dictionary. In the following
example, `TotalArea` calls the `Area` method on a type parameter and is inlined into `run`:

```go
type Shape interface{ Area() float64 }

type Square struct{ side float64 }

func (q *Square) Area() float64 { return q.side * q.side }

func TotalArea[T Shape](xs []T) (t float64) {
	for _, x := range xs {
		t += x.Area()
	}
	return
}

//go:noinline
func run(xs []*Square) float64 { return TotalArea(xs) } // TotalArea is inlined here
```

After inlining, the dictionary used in `run` is a definite read-only symbol,
`main..dict.TotalArea[*main.Square]`. Go 1.20 still reads the method's entry address out of it at
run time:

```asm
// Go 1.20, GOARCH=amd64
MOVQ  main..dict.TotalArea[*main.Square](SB), SI  // read Area's entry address from the dictionary at run time
LEAQ  main..dict.TotalArea[*main.Square](SB), DX
MOVQ  BX, AX                                      // receiver
CALL  SI
```

Go 1.21 added a set of SSA rewrite rules: values loaded from a constant dictionary or from a type
descriptor are folded into constants at compile time [[Randall, 2023](#ref-randall-2023)]. The same
code compiles in Go 1.26 to:

```asm
// Go 1.26, GOARCH=amd64
LEAQ  main..dict.TotalArea[*main.Square](SB), DX
LEAQ  main.(*Square).Area(SB), CX                 // entry address folded into a constant at compile time
CALL  CX
```

The memory load is gone and the call target is known at compile time, but the call remains: inlining
is done on the intermediate representation before SSA, and by the time the SSA phase determines the
call target, the opportunity for inlining has passed. By comparison, in the hand-written concrete
version `for _, x := range xs { t += x.Area() }`, `(*Square).Area` is inlined into a single
multiplication. Other improvements are mostly of the same kind: Go 1.26 eliminated the nil check on
the dictionary argument, and Go 1.27 removes impossible type assertion branches in shape instances,
for example when the shape of `S` is `string`, the `case []byte` of `switch any(x).(type)` can never
match [[Bailey, 2025](#ref-bailey-2025)]. The issue Taylor filed in 2023 on "better optimization of
type switches in instantiated generic functions" remains open [[Taylor, 2023b](#ref-taylor-2023b)].

Several engineering conclusions follow:

- The most dependable gain from generics is making **data structures and algorithms** general. Such
  code seldom calls small methods on type parameters frequently on hot paths, so the dictionary
  indirection is amortized; `slices` and `maps` are of this kind.
- On performance-sensitive hot paths that frequently call small methods on type parameters, measure;
  a hand-written monomorphized version may still be faster.
- The compiler's optimization of this indirect path is still in progress, and today's measurements
  may not hold for future releases.

Go pays one layer of dictionary indirection in exchange for one body of code serving many types and
bounded code growth; where extreme performance is needed, one must still return to monomorphization
and bear the cost in code size and compile time. What generics provide is not a "zero-overhead
abstraction" but a new option to be weighed case by case.

## 8.4.5 Small Steps, Driven by Practice

Looking back at the course from Go 1.18 to now, one sees a consistent rhythm: ship the smallest
usable version first, observe needs in real use, then add carefully. Go 1.18 offered only type
parameters and constraints; `slices`, `maps` and `cmp` arrived only in Go 1.21; `maps.Keys` was
deferred to Go 1.23 to wait for the iterator protocol; generic aliases came in Go 1.24; generic
methods in Go 1.27. Each step was settled only after idioms had accumulated and needs had been
confirmed repeatedly, rather than casting the whole blueprint in one go.

This caution is not unique to Go. Reflecting on the design of C++ templates, Stroustrup wrote
[[Stroustrup, 1994](#ref-stroustrup-1994)]:

> I do think I was overly cautious and conservative in starting to describe the template mechanism.
> We should have put many features in from the start... These features added little burden on the
> implementer, yet were especially helpful to the user.

Stroustrup also said that before templates he had always polished language features through a cycle
of "implement, use, discuss, reimplement", whereas the implementation of templates often ran in
parallel with the discussion, without sufficient implementation experience, and he could only revise
templates in many ways afterwards on the basis of usage experience. The history of C++
standardization bears this out: templates were accepted by the ANSI committee in 1990, when there
were no large generic libraries yet; the STL entered the draft standard only in October 1994, and
extensions such as member templates (1994) and partial specialization (1996) were added only later.
Stroustrup holds that C++98 was far more flexible than the C++ of the ARM era, mainly because of the
cumulative effect of improvements such as member templates
[[Stroustrup, 2007](#ref-stroustrup-2007)].

The two histories point to the same lesson: a feature as deeply embedded in the type system as
generics cannot be fully designed by discussion on paper; it needs a great deal of real
implementation and use for calibration. Go has turned the lesson into an explicit rhythm: ship
first, observe next, extend later. The cost is that capabilities users want have to wait: sum types
have not arrived to this day, and generic methods waited four years. What it buys is that each
extension rests on needs that have already been validated, instead of betting on conjecture.

The list of absences in 8.4.3 should therefore not be read as an unfinished to-do list. Some of
those items may never be added, since Go's restraint toward language complexity is itself part of
the design; others may arrive, like generic methods, in a restricted and clear form once the
understanding of the problem changes. The future of generics is probably not a single release in
which many features burst out, but a continuation of this small-step evolution: weighing again and
again, with care, abstraction against simplicity, expressiveness against readability, and
performance against generality.

## Further Reading

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Package slices*.
  https://pkg.go.dev/slices
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Package maps*.
  https://pkg.go.dev/maps
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Package cmp*.
  https://pkg.go.dev/cmp
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Package iter*.
  https://pkg.go.dev/iter
- <a id="ref-go-authors-2023b"></a>[Go Authors, 2023b] The Go Authors. Go 1.21 Release Notes (new
  `slices`, `maps`, `cmp`). https://go.dev/doc/go1.21
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. Go 1.23 Release Notes (`range`
  over function types and `iter`). https://go.dev/doc/go1.23
- <a id="ref-go-authors-2025"></a>[Go Authors, 2025] The Go Authors. Go 1.24 Release
  Notes (generic type aliases). https://go.dev/doc/go1.24
- <a id="ref-taylor-2024"></a>[Taylor, 2024] Ian Lance Taylor. "Range Over Function Types." The Go
  Blog, 2024-08-20. https://go.dev/blog/range-functions ; proposal
  [#61405](https://github.com/golang/go/issues/61405)
- <a id="ref-randall-2020"></a>[Randall, 2020] Keith Randall. "Generics implementation - GC Shape
  Stenciling." Go design document, 2020.
  https://github.com/golang/proposal/blob/master/design/generics-implementation-gcshape.md
- <a id="ref-marti-2022"></a>[Marti, 2022] Vicent Marti. "Generics can make your Go code slower."
  PlanetScale, 2022-03-30. https://planetscale.com/blog/generics-can-make-your-go-code-slower
- <a id="ref-macias-2021"></a>[Macias, 2021] Mario Macias. "proposal: spec: allow type parameters in
  methods." golang/go#49085, 2021-10-20. https://github.com/golang/go/issues/49085
  Closed in April 2026 as a duplicate of #77273.
- <a id="ref-stroustrup-1994"></a>[Stroustrup, 1994] Bjarne Stroustrup. *The Design and Evolution of
  C++*. Addison-Wesley, 1994. Chapter 15: Templates.
- <a id="ref-ou-2020"></a>[Ou, 2020] 欧长坤 (Changkun Ou). "带你提前玩 Go 2 新特性：泛型" ["Playing with Go 2
  features early: generics"]. Go 夜读 (Go Night Reading) episode 80, 2020-03-18. Video:
  https://www.youtube.com/watch?v=E16Y6bI2S08 ; slides: https://changkun.de/s/go2generics/
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. Go 1.18 Release Notes.
  https://go.dev/doc/go1.18
  The announcement of generics, the note of caution on their use, and the six known limitations.
- <a id="ref-go-authors-2023a"></a>[Go Authors, 2023a] The Go Authors. Go 1.20 Release Notes.
  https://go.dev/doc/go1.20
  The new compiler front end allows types to be declared inside generic functions and methods.
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors. Go 1.26 Release Notes.
  https://go.dev/doc/go1.26
  A generic type may refer to itself in its own type parameter list.
- <a id="ref-go-authors-2026f"></a>[Go Authors, 2026f] The Go Authors. Go 1.27 Release Notes.
  https://go.dev/doc/go1.27 Generic methods, promoted field keys in struct literals, and function
  type inference extended to all assignment contexts.
- <a id="ref-go-authors-2026g"></a>[Go Authors, 2026g] The Go Authors. Frequently Asked Questions
  (FAQ), "Why does Go not support methods with type
  parameters?" https://go.dev/doc/faq#generic_methods
- <a id="ref-taylor-griesemer-2021"></a>[Taylor and Griesemer, 2021] Ian Lance Taylor, Robert
  Griesemer. "Type Parameters Proposal." Go design document, 2021.
  https://go.googlesource.com/proposal/+/refs/heads/master/design/43651-type-parameters.md The
  sections "No parameterized methods" and "Omissions".
- <a id="ref-griesemer-2026a"></a>[Griesemer, 2026a] Robert Griesemer. "spec: generic methods for
  Go." golang/go#77273, 2026-01-22 (accepted 2026-02-25). https://github.com/golang/go/issues/77273
- <a id="ref-griesemer-2026b"></a>[Griesemer, 2026b] Robert Griesemer. "cmd/compile: investigate
  relaxation of mono-checker restrictions for generic methods." golang/go#81699, 2026-09-23.
  https://github.com/golang/go/issues/81699
- <a id="ref-griesemer-2025"></a>[Griesemer, 2025] Robert Griesemer. "go/types, types2: permit type
  cycles through type parameter lists." Go commit 1abc6b0204, 2025-10-13 (Go 1.26).
  https://github.com/golang/go/commit/1abc6b0204
- <a id="ref-canning-et-al-1989"></a>[Canning et al., 1989] Peter Canning, William Cook, Walter
  Hill, Walter Olthoff, John C. Mitchell. "F-bounded polymorphism for object-oriented
  programming." *Proceedings of the Fourth International Conference on Functional Programming
  Languages and Computer Architecture (FPCA '89)*, 273–280, 1989.
  https://doi.org/10.1145/99370.99392
- <a id="ref-taylor-2023a"></a>[Taylor, 2023a] Ian Lance Taylor. "proposal: spec: sum types based on
  general interfaces." golang/go#57644, 2023-01-05. https://github.com/golang/go/issues/57644
- <a id="ref-obenour-2017"></a>[Obenour, 2017] Demi Marie Obenour. "proposal: spec: add sum types /
  discriminated unions." golang/go#19412, 2017-03-05. https://github.com/golang/go/issues/19412
- <a id="ref-taylor-2023b"></a>[Taylor, 2023b] Ian Lance Taylor. "cmd/compile: better optimization
  of type switches in instantiated generic functions." golang/go#59591, 2023-04-13.
  https://github.com/golang/go/issues/59591
- <a id="ref-taylor-2023c"></a>[Taylor, 2023c] Ian Lance Taylor. "[release-branch.go1.21] maps:
  remove Keys and Values." Go commit b25266c58d, 2023-07-26.
  https://github.com/golang/go/commit/b25266c58d
- <a id="ref-randall-2023"></a>[Randall, 2023] Keith Randall. "cmd/compile: constant-fold loads from
  constant dictionaries and types." Go commit bd3f44e4ff, 2023-05-02 (Go 1.21).
  https://github.com/golang/go/commit/bd3f44e4ff
- <a id="ref-bailey-2025"></a>[Bailey, 2025] Jake Bailey. "cmd/compile: eliminate nil checks on
  .dict arg" (Go 1.26) and "cmd/compile: eliminate impossible type assertions in generic
  functions" (Go 1.27). Go commits 97da068774 and 343fbe2971, 2025-09.
  https://github.com/golang/go/commit/97da068774 ; https://github.com/golang/go/commit/343fbe2971
- <a id="ref-stroustrup-2007"></a>[Stroustrup, 2007] Bjarne Stroustrup. "Evolving a language in and
  for the real world: C++ 1991–2006." *Proceedings of the Third ACM SIGPLAN Conference on History of
  Programming Languages (HOPL III)*, 2007. https://doi.org/10.1145/1238844.1238848 The dates at
  which templates (1990) and the STL (1994) were accepted, and the gradual extension of templates in
  C++98.
