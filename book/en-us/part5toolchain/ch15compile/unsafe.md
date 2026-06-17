---
weight: 5104
title: "15.4 The Pointer Checker"
---

# 15.4 The Pointer Checker

Go is a memory-safe language. In ordinary code, the type system guarantees that every pointer refers to a legal object of its declared type, garbage collection ([13](../../part4memory/ch13gc)) guarantees that an object is not reclaimed while it is still referenced, and the runtime keeps out-of-bounds accesses behind bounds checks. These guarantees are not free. They rest on the premise that the compiler always knows the type and layout of every value. Yet there is always a small set of scenarios that need to step outside this system: interoperating with C ([15.6](./cgo.md)) means interpreting a span of bytes according to C's memory layout, laying out a system structure for the operating system means placing bytes one by one, and reinterpreting a `[]byte` as a `string` with zero copies ([5.1](../../part2lang/ch05data/slice.md)) means letting two types share the same underlying memory. Go leaves an escape hatch for these scenarios: the `unsafe` package.

The price of the escape hatch is that once you use it to bypass the type system, the guarantees the compiler and runtime originally provided partially lapse. Misuse is no longer caught by the language, and you must instead obey, on your own, a set of rules that are far from intuitive. This section first clarifies the limits of `unsafe.Pointer`'s power and the legal patterns the specification lists, then explains the most insidious class of traps among them (the relationship between `uintptr` and garbage collection), and finally explains how the compiler and runtime use a pointer checker (checkptr) to turn this kind of latent misuse into an error reported on the spot.

## 15.4.1 unsafe.Pointer: four privileges for bypassing the type system

Ordinary pointers `*T` cannot be freely converted between one another; the type system does not allow reading and writing an `*int` as if it were a `*float64`. `unsafe.Pointer` is a special pointer that opens a gap in the type system, and the specification grants it four privileges that ordinary types do not have:

- A pointer `*T` of any type can be converted to `unsafe.Pointer`.
- `unsafe.Pointer` can be converted back to a pointer `*T` of any type.
- `uintptr` can be converted to `unsafe.Pointer`.
- `unsafe.Pointer` can be converted to `uintptr`.

Taken together, the first two mean that by routing through `unsafe.Pointer` you can turn any `*T1` into any `*T2`, and thereby interpret the same span of memory as a different type, which is precisely what the type system was meant to forbid. The latter two allow pointers and integers to convert into each other, which makes arithmetic on addresses possible. The specification therefore states explicitly that `Pointer` allows a program to defeat the type system and read and write arbitrary memory, and that it should be used with extreme care.

```go
// The unsafe package's definition of Pointer (ArbitraryType is for documentation only; it denotes any type)
type ArbitraryType int
type Pointer *ArbitraryType
```

The gap is opened this wide, but the specification does not say anything goes. It lists several "legal conversion patterns" and promises that only usages falling within these patterns are defined; deviating from them is undefined behavior. `go vet` checks whether code falls within these patterns, and `unsafe` code that does not pass `go vet` enjoys no guarantee. Below we walk through these patterns one by one; they cover almost all legitimate uses of `unsafe`.

**Pattern one: converting `*T1` to `*T2`, requiring that `T2` be no larger than `T1` and that the two have compatible memory layouts.** This is the most common and also the safest class, used to reinterpret a span of memory as another type. The standard library's `math.Float64bits` is the canonical example: it does no floating-point arithmetic at all, only reads the 8 bytes of a `float64` as a `uint64` unchanged:

```go
func Float64bits(f float64) uint64 {
	return *(*uint64)(unsafe.Pointer(&f))
}
```

**Pattern two: computing the address of a struct field or array element by adding a `uintptr` offset through `Pointer`.** If `p` points to an allocated object, you can first convert it to `uintptr`, add an offset, and then convert it back to `Pointer`:

```go
// Take the address of struct field s.f, equivalent to &s.f
f := unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Offsetof(s.f))
// Take the address of array element x[i], equivalent to &x[i]
e := unsafe.Pointer(uintptr(unsafe.Pointer(&x[0])) + i*unsafe.Sizeof(x[0]))
```

The offset can be added or subtracted, and using `&^` to round an address down for alignment is also legal. But there is one iron rule: the computed pointer must still point into the original allocated object. Unlike C, moving the pointer outside the object's bounds (even just one byte past the end) is invalid, because once out of bounds the address no longer corresponds to any live object, and garbage collection has no way to judge whether it should be retained:

```go
// Invalid: end lands outside the allocated memory region
var s thing
end := unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Sizeof(s))
```

Here we should call out the three compile-time constant functions the `unsafe` package provides, which are the basis for doing offsets legally. `Sizeof(x)` gives the number of bytes the type occupies (for a slice it returns the size of the slice header, not the underlying array), `Offsetof(s.f)` gives the offset of a field within a struct, and `Alignof(x)` gives the alignment the type requires. When the type's size is determined, all three are Go constants computed by the compiler, with no runtime cost.

**Pattern three: converting `Pointer` to `uintptr` as an argument when calling `syscall.Syscall`.** System calls pass arguments as `uintptr`, but some arguments are reinterpreted by the kernel as pointers. Here the compiler has a special convention: as long as the `uintptr(unsafe.Pointer(p))` conversion appears directly in the call's argument list, the compiler guarantees that the object `p` points to is not moved or reclaimed before the call returns:

```go
syscall.Syscall(SYS_READ, uintptr(fd), uintptr(unsafe.Pointer(p)), uintptr(n))
```

**Pattern four: converting to and from the `Data` field of reflection headers.** `reflect.SliceHeader` and `reflect.StringHeader` declare `Data` as `uintptr` rather than `unsafe.Pointer`, so that code which does not import `unsafe` cannot use it to rewrite arbitrary memory. The price is that these two structures are meaningful only when they overlay a real slice or string; you must never declare a standalone `SliceHeader` variable and then fill in its `Data`, because then `Data` is just an ordinary integer and will not make garbage collection believe the underlying data is still referenced. This pattern is fragile enough that Go has officially marked these two types `Deprecated`; section 15.4.4 below gives the safe replacements for them.

## 15.4.2 The most perilous trap: a uintptr is just an integer

Stringing the four patterns above together, the danger is almost entirely concentrated in the conversions between `unsafe.Pointer` and `uintptr`. To understand this, you first have to recognize a fact that is easily overlooked: **in the eyes of the Go runtime, a `uintptr` is just an integer, and garbage collection does not treat it as a pointer at all.**

This means two things. First, if an object is "pointed to" only by an address held in some `uintptr`, garbage collection will not on that basis consider it live, and the object may be reclaimed at any moment. Second, if garbage collection moves an object (stack copying is the typical case: when a goroutine's stack grows, the whole stack together with the objects on it is relocated, and their addresses change accordingly, see [14.4](../../part4memory/ch14stack)), it will update all the real pointers but will not update any `uintptr`, because it simply does not know which integers are actually addresses. So a `uintptr` that was once correct will, after some garbage collection, quietly point to invalid memory or a different object.

Substituting this fact into pattern two, the specification's rule that "the two conversions must be completed within a single expression" acquires its rationale. Two seemingly equivalent ways of writing it have utterly different fates:

```go
// Legal: Pointer→uintptr→Pointer done in one breath, with no moment that GC can interrupt in between
p = unsafe.Pointer(uintptr(p) + offset)

// Invalid: the uintptr is stored into the variable u, crossing a statement boundary
u := uintptr(p)
// If a GC happens here, the object p points to may be reclaimed or moved, and u becomes invalid at once
p = unsafe.Pointer(u + offset)
```

The difference is not in the syntax but in whether the `uintptr` crosses a statement boundary. In the first form, going from `unsafe.Pointer` to `uintptr` and back to `unsafe.Pointer` happens within the evaluation of a single expression, and the compiler guarantees that no garbage collection safe point is inserted in between, so the object is referenced by the original `Pointer` throughout the arithmetic and cannot move. The second form stores the intermediate `uintptr` into the variable `u`, and the two conversions are separated by a statement boundary; any garbage collection that happens while `u` is alive may invalidate it. By the same reasoning, in pattern two arithmetic on a `uintptr` pointing to `nil` or to an out-of-bounds address is also invalid, because they correspond to no live object at all.

The reason this class of bug is so perilous is that it does not manifest most of the time. Only when garbage collection happens to trigger within that dangerous window and happens to reclaim or move that very object will the program read a garbage value or crash. It depends on timing, is hard to reproduce, and may lie dormant for a long time before surfacing under some high load in production. The rule itself ("a `Pointer` to `uintptr` must be used for arithmetic within a single expression, and never saved across statements") is not complex; what is hard is that while writing code you may not realize you are violating it. This is exactly the problem the tool in the next section is meant to solve.

## 15.4.3 checkptr: turning latent misuse into an error on the spot

Relying on people to strictly observe the rules above is not dependable, so Go adds a pointer checker (checkptr) to the compiler and runtime. Its idea is to insert runtime checks at `unsafe` conversion sites, turning a latent bug that "is usually fine but occasionally crashes mysteriously" into a clear error that occurs at the scene of the crime.

checkptr is off by default and is controlled by the compiler's debug flag `-d=checkptr`. More commonly it is enabled indirectly: there is a convention in compiling `cmd/compile` that enabling any of `-race`, `-msan`, or `-asan` also sets `-d=checkptr` to 1 ([16.2](../ch16tools/race.md)). So when you routinely run `go test -race`, the pointer checker is already at work. Mechanically, during the walk phase (before [15.3](./ssa.md), where the syntax tree is lowered into a form closer to runtime calls) the compiler scans those conversions that break type safety and inserts calls to runtime check functions after them. The runtime `runtime/checkptr.go` provides these checks, and there are three core kinds:

- **Alignment check** (`checkptrAlignment`): when converting an `unsafe.Pointer` to a `*T`, it verifies that the address satisfies `T`'s alignment requirement. On most hardware, reading a pointer-containing type from an unaligned address fails, so the runtime enforces alignment only when "the pointed-to type itself contains pointers" and relaxes it for pure scalar types (see issue 37298). Failure raises `checkptr: misaligned pointer conversion`.
- **Cross-allocation check** (`checkptrStraddles`, triggered as a side effect of the alignment check): it verifies that the span of memory covered by `(*[n]T)(p)` does not straddle multiple independent allocations. Two adjacent objects being next to each other in address does not mean they can be accessed together as one array. Failure raises `checkptr: converted pointer straddles multiple allocations`.
- **Arithmetic check** (`checkptrArithmetic`): for pointer arithmetic like that in pattern two, it verifies that if the computed pointer lands in some heap object, then it must land in the same object as one of the "original pointers" that took part in the computation. This is the runtime enforcement of the rule that "you must not go out of bounds beyond the original allocation." Failure raises `checkptr: pointer arithmetic result points to invalid allocation`, or, when the result is an illegal low address, `checkptr: pointer arithmetic computed bad pointer value`.

Determining which allocation an address belongs to relies on the runtime's `checkptrBase`, which in turn locates the base of the address in the current goroutine's stack, the heap (`findObject`, reusing the GC's object lookup, see [12.2](../../part4memory/ch12alloc/component.md)), and the global data/bss segments. Only when two addresses have the same base do they count as belonging to the same allocation.

`unsafe.Slice` and `unsafe.String`, the two helper functions that assemble a pointer and a length into a slice or a string, also each have a dedicated check entry (the runtime's `unsafeslicecheckptr` and `unsafestringcheckptr`), which checks the pointer and length before constructing the new slice or string view, ensuring that the resulting view does not cross the boundary of the original allocation.

checkptr also leaves an exit for exemption. The very few functions that genuinely need to bypass the check can be annotated with the compiler directive `//go:nocheckptr`, telling the compiler not to insert checks for that function. The runtime and certain low-level libraries rely on it precisely to handle those conversions that are "known to be safe but would trigger a false positive in form." This tool embodies Go's consistent attitude: even when it gives you a hatch to bypass safety, it tries its best to keep you from shooting yourself in the foot.

## 15.4.4 The place of unsafe and safer helper functions

The name `unsafe` is itself a warning. Go's design stance is safe by default: memory safety and type safety are the norm, and `unsafe` is an exception channel reserved for the few scenarios that genuinely need it, not an everyday tool. Its legitimate uses cluster in a few places: interpreting memory according to C's layout when interoperating with C ([15.6](./cgo.md)), interfacing with system calls and system structures, and converting between `[]byte` and `string` with zero copies ([5.1](../../part2lang/ch05data/slice.md)) to avoid one memory copy. What these scenarios have in common is that either they cross a boundary the Go type system cannot reach (C, the kernel), or they control memory layout precisely on a performance hot path to save one copy.

Even in these scenarios, the use of `unsafe` should be narrowed as much as possible: used sparingly, kept strictly within the specification's legal patterns, and tested with race and checkptr enabled. Go also keeps making this escape hatch itself less prone to going wrong. In the early days, to construct a slice over a given underlying array, the common approach was to borrow `reflect.SliceHeader` and manually fill in its `Data`, `Len`, and `Cap` fields, which is exactly the fragile form in pattern four of 15.4.1: `Data` is a `uintptr`, and one slip lets the underlying data lose its credential of being referenced and get reclaimed. Go 1.17 introduced `unsafe.Add` and `unsafe.Slice`, and Go 1.20 added `unsafe.String`, `unsafe.SliceData`, and `unsafe.StringData`, gathering these operations into built-in functions that are type-safe and covered by checkptr:

```go
// Go 1.17+: typed offset on a Pointer, replacing hand-written uintptr arithmetic
func Add(ptr Pointer, len IntegerType) Pointer

// Go 1.17+: construct a slice from a pointer and a length, replacing filling in reflect.SliceHeader
func Slice(ptr *ArbitraryType, len IntegerType) []ArbitraryType
// Go 1.20+: take the address of the first element of a slice's underlying array, in reverse
func SliceData(slice []ArbitraryType) *ArbitraryType

// Go 1.20+: construct a string from a *byte and a length, and take a string's underlying bytes in reverse
func String(ptr *byte, len IntegerType) string
func StringData(str string) *byte
```

This set of functions converges the dangerous operations that used to be scattered through user code, done by hand-written `uintptr` arithmetic and reflection headers, into a few primitives with clear semantics. `unsafe.Slice(ptr, n)` is equivalent to `(*[n]T)(unsafe.Pointer(ptr))[:]`, but checks at runtime that `n` is non-negative and that `ptr` and `n` do not go out of bounds; `unsafe.String(b, n)` and `unsafe.StringData(s)` give the zero-copy conversion between `[]byte` and `string` a canonical form, without having to touch `StringHeader` anymore. Correspondingly, `reflect.SliceHeader` and `reflect.StringHeader` have been officially marked `Deprecated`, and their documentation points directly to these new functions.

This is Go's complete attitude toward "unsafe." It admits that `unsafe` is sometimes necessary and does not pretend it can do away with it; but it uses the type system to confine the danger to the single gap of `unsafe.Pointer`, pins down the legal patterns with the specification, uses checkptr to turn misuse into an on-the-spot error in tests, and then uses the new primitives of 1.17/1.20 to replace the most common dangerous forms with safe ones. Safety is never a yes-or-no question; the escape hatch must exist, and what can be done is to defend it layer by layer, driving down both the probability of it being misused and the cost when it is.

## 15.4.5 Escape hatches elsewhere

Placing Go's design within a lineage makes clearer where its trade-off falls. Garbage-collected languages almost all have to face the same tension: they want the GC to move objects freely to compact memory, and they also want to occasionally let the program get a bare address to do low-level operations, yet moving and bare addresses are inherently in conflict. The different solutions each language adopts happen to throw into relief the position of Go's "a `uintptr` must not cross a statement" rule.

C# offers explicit pinning. Its `fixed` statement pins a managed object for the duration of a code block, telling the GC not to move it during that time, so that doing pointer arithmetic on that object within the block is safe. Go has no construct like `fixed`; it achieves the same guarantee that "the object will not be moved away during the arithmetic" in another way: by forbidding the `uintptr` carrying the address from outliving that expression. In other words, C# relies on the programmer explicitly declaring a pinning window, while Go relies on compressing the window down to a single expression and having the compiler implicitly guarantee that the object stays referenced by the original pointer throughout. The two have the same goal; one hands the responsibility to syntax, the other to a rule.

Java's evolution, on the other hand, is highly isomorphic to the evolution of Go's helper functions. In the early days, Java's low-level code depended on the undocumented `sun.misc.Unsafe`, whose field offsets are likewise just a `long` integer, carrying exactly the same "the offset becomes invalid after the GC moves things" hazard as `uintptr`. In recent years Java replaced it with the Foreign Function & Memory API (Project Panama, finalized in Java 22), which, with an abstraction like `MemorySegment` that has bounds checking and a lifetime scope, gathers bare memory access into a controlled interface. This is the very same idea behind Go replacing the hand-filled `reflect.SliceHeader` with `unsafe.Slice`/`unsafe.String`: upgrading fragile bare operations into checked, bounded primitives.

Rust's `unsafe` block offers a reference point on another dimension. It shares with Go the stance that "the escape hatch must be a small, named, demarcated, auditable block," and the `unsafe` keyword fences off the code that bypasses checks within a conspicuous boundary, making it easy to review. But to be clear, Rust has no garbage collection, and therefore none of the "the object is moved during arithmetic" class of danger; its `unsafe` guards against other things (dereferencing raw pointers, data races, and so on). What can be borrowed is the posture of "explicitly fencing off the unsafe," not the specific danger model.

Taken together, Go's choice is a restrained compromise: not introducing an explicit pinning construct like `fixed`, confining the ability to bypass safety to the single gap of `unsafe.Pointer`, replacing the explicit window with a single rule that "a `uintptr` must not be saved across statements," and then filling in the tooling and ergonomics with checkptr and the new primitives. What it buys is surface-level simplicity in the language; what it pays is that this rule is not intuitive enough and needs tooling as a backstop.

## Further reading

1. The Go Authors. *Package unsafe (the legal conversion patterns for `Pointer`, and `Add`/`Slice`/`String`/`SliceData`/`StringData`).*
   https://pkg.go.dev/unsafe
2. The Go Authors. *runtime/checkptr.go (`checkptrAlignment`, `checkptrStraddles`, `checkptrArithmetic`, `checkptrBase`).*
   https://github.com/golang/go/blob/master/src/runtime/checkptr.go
3. The Go Authors. *cmd/compile/internal/walk: convert.go and builtin.go (instrumentation at checkptr conversion sites, `unsafeslicecheckptr`/`unsafestringcheckptr`).*
   https://github.com/golang/go/tree/master/src/cmd/compile/internal/walk
4. The Go Authors. *Go 1.17 Release Notes (`unsafe.Add`, `unsafe.Slice`).* https://go.dev/doc/go1.17
5. The Go Authors. *Go 1.20 Release Notes (`unsafe.String`, `unsafe.SliceData`, `unsafe.StringData`).* https://go.dev/doc/go1.20
6. The Go Authors. *The Deprecated notice for reflect.SliceHeader / StringHeader.* https://pkg.go.dev/reflect#SliceHeader
7. JEP 454: *Foreign Function & Memory API (finalized in Java 22, `MemorySegment` as a controlled replacement for `sun.misc.Unsafe`).*
   https://openjdk.org/jeps/454 ; the C# `fixed` statement and object pinning, https://learn.microsoft.com/dotnet/csharp/language-reference/statements/fixed
8. This book: [5.1 Arrays, Slices, and Strings](../../part2lang/ch05data/slice.md), [12.2 Components](../../part4memory/ch12alloc/component.md), [14.4 Stack Management](../../part4memory/ch14stack), [15.6 cgo](./cgo.md), [16.2 Race Detection](../ch16tools/race.md).
