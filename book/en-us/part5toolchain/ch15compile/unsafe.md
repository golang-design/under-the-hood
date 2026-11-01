---
weight: 5104
title: "15.4 The Pointer Checker"
---

# 15.4 The Pointer Checker

Go's memory safety rests on one premise: the compiler knows the type of every value. The type system
guarantees that a pointer refers only to objects of its declared type, and on that basis the
compiler generates a pointer bitmap for every stack frame; both the garbage collector
([Chapter 13](../../part4memory/ch13gc/readme.md)) and stack copying
([14.4](../../part4memory/ch14stack/copy.md)) rely on these bitmaps to find every pointer. A few
situations call for stepping outside the type system: exchanging data with C code
([15.6](./cgo.md)), filling in system call arguments in the layout the operating system prescribes,
and converting between `[]byte` and `string` without copying
([5.2](../../part2lang/ch05data/string.md)). The `unsafe` package provides the way out for these
cases.

Once the type system has been bypassed, the properties the compiler used to guarantee must be
maintained by the programmer. This section first explains the legitimate uses of `unsafe.Pointer`
and where its rules come from, then how the compiler and runtime cooperate with those rules, and
finally the **pointer checker** (checkptr), which checks `unsafe.Pointer` conversions at run time
and turns misuse that normally stays dormant into an immediate error.

## 15.4.1 Valid Patterns of unsafe.Pointer

The documentation of `unsafe.Pointer` opens by listing its four special operations
[[Go Authors, n.d.a](#ref-go-authors-nda)]:

```go
// Pointer represents a pointer to an arbitrary type. There are four special operations
// available for type Pointer that are not available for other types:
//   - A pointer value of any type can be converted to a Pointer.
//   - A Pointer can be converted to a pointer value of any type.
//   - A uintptr can be converted to a Pointer.
//   - A Pointer can be converted to a uintptr.
//
// Pointer therefore allows a program to defeat the type system and read and write
// arbitrary memory. It should be used with extreme care.
```

The first two operations together allow any `*T1` to be converted to any `*T2`, interpreting the
same memory as another type; the last two allow pointers and integers to be converted into each
other, and so allow arithmetic on addresses. The documentation then lists six valid patterns and
declares that code not matching them may be invalid now or in the future. `go vet` can find some
uses that do not match the patterns, but the documentation points out specifically that `go vet`
reporting nothing does not guarantee the code is valid.

| Pattern | Conversion | Key points |
|:---|:---|:---|
| (1) | `*T1` → `Pointer` → `*T2` | `T2` is no larger than `T1`, and the two have compatible memory layouts |
| (2) | `Pointer` → `uintptr` | Only to obtain the numeric value of the address, for example to print it; must not be converted back |
| (3) | `Pointer` → `uintptr` → `Pointer`, with arithmetic in between | Both conversions must be in the same expression; the result must still point into the original allocation |
| (4) | `Pointer` → `uintptr` when calling functions such as `syscall.Syscall` | The conversion must appear directly in the argument list of the call |
| (5) | Result of `reflect.Value.Pointer` or `UnsafeAddr` → `Pointer` | Must be converted immediately after the call, in the same expression |
| (6) | `Data` field of `reflect.SliceHeader` or `StringHeader` converted to and from `Pointer` | The header may only be a pointer to a real slice or string, never declared on its own |

A typical example of pattern (1) is `math.Float64bits`, which performs no floating-point operation
and merely reads the 8 bytes of a `float64` as a `uint64`
[[Go Authors, 2026c](#ref-go-authors-2026c)]:

```go
func Float64bits(f float64) uint64 { return *(*uint64)(unsafe.Pointer(&f)) }
```

Pattern (3) is used to access struct fields or array elements, with offsets given by
`unsafe.Offsetof` and `unsafe.Sizeof`, both of which, like `unsafe.Alignof`, are evaluated at
compile time. An offset can be added or subtracted, and `&^` can round an address down to an
alignment, but the result must still fall within the original allocation. Unlike C, Go does not
allow moving a pointer even one byte past the end of the allocation:

```go
// invalid: end points outside the allocation
var s thing
end = unsafe.Pointer(uintptr(unsafe.Pointer(&s)) + unsafe.Sizeof(s))
```

This restriction comes from the garbage collector: an address that points exactly to the end of an
allocation may be the start of the next object, which would make the next object appear to be still
referenced while the original object loses its reference. According to the documentation, (3)
through (6) enumerate all the valid ways to convert a `uintptr` back to a `Pointer`, and all of them
require the conversion to follow immediately after the operation that produced the address. The next
subsection explains why.

## 15.4.2 uintptr Is Just an Integer

The `unsafe` documentation is explicit about the nature of `uintptr`
[[Go Authors, n.d.a](#ref-go-authors-nda)]:

```go
// A uintptr is an integer, not a reference.
// Converting a Pointer to a uintptr creates an integer value
// with no pointer semantics.
// Even if a uintptr holds the address of some object,
// the garbage collector will not update that uintptr's value
// if the object moves, nor will that uintptr keep the object
// from being reclaimed.
```

The pointer bitmaps generated by the compiler mark only slots of pointer type, and variables of type
`uintptr` are not among them. This has two consequences. First, if only a `uintptr` remembers the
address of an object, the garbage collector treats the object as unreachable and reclaims it.
Second, objects may move. Go heap objects do not move at present, but goroutine stacks do: when a
stack grows or shrinks, the runtime copies the whole stack to a new location and adjusts every
pointer into the stack according to the bitmap ([14.4](../../part4memory/ch14stack/copy.md)), while
a stack address kept in a `uintptr` retains its old value and thereafter points into the abandoned
old stack.

Both consequences appear only if a garbage collection or stack copy happens to occur while the
`uintptr` is alive. Pattern (3) requires both conversions to be in the same expression, which
shrinks that interval to a single address computation:

```go
// valid
p = unsafe.Pointer(uintptr(p) + offset)

// invalid: the uintptr is stored in a variable before being converted back to a Pointer
u := uintptr(p)
p = unsafe.Pointer(u + offset)
```

The compiler and the runtime each provide a guarantee for this. First, when generating SSA, a
conversion between pointer and integer is not simply a value copy but generates a dedicated
`Convert` operation [[Go Authors, 2026c](#ref-go-authors-2026c)]:

```go
	// Convert converts between pointers and integers.
	// We have a special op for this so as to not confuse GC
	// (particularly stack maps).  It takes a memory arg so it
	// gets correctly ordered with respect to GC safepoints.
	// It gets compiled to nothing, so its result must in the same
	// register as its argument. regalloc knows it can use any
	// allocatable integer register for OpConvert.
	// arg0=ptr/int arg1=mem, output=int/ptr
	{name: "Convert", argLength: 2, zeroWidth: true, resultInArg0: true},
```

`Convert` takes a memory state as an argument, so it cannot be scheduled across the function calls
before or after it. Between two conversions in the same expression there is only arithmetic and no
function call, hence no synchronous safepoint: the stack does not grow here, and garbage collection
does not scan this frame precisely here. Second, there is asynchronous preemption
([9.7](../../part3concurrency/ch09sched/preemption.md)): a goroutine may be interrupted at any
instruction, but the runtime scans the innermost interrupted frame conservatively, so any integer in
a register that looks like a pointer keeps its object alive, and the stack of a goroutine at an
asynchronous safepoint is not shrunk either [[Go Authors, 2026c](#ref-go-authors-2026c)]. Once a
`uintptr` is stored in a variable and spans statements, neither guarantee holds.

Pattern (4) is different. The parameters of `syscall.Syscall` have type `uintptr`, so a pointer must
be converted to an integer before it can be passed, and the kernel treats some of these arguments as
pointers for the duration of the call. The standard library handles this with two compiler
directives [[Go Authors, 2026c](#ref-go-authors-2026c)]:

```go
// N.B. For the Syscall functions below:
//
// //go:uintptrkeepalive because the uintptr argument may be converted pointers
// that need to be kept alive in the caller.
//
// //go:nosplit because stack copying does not account for uintptrkeepalive, so
// the stack must not grow. Stack copying cannot blindly assume that all
// uintptr arguments are pointers, because some values may look like pointers,
// but not really be pointers, and adjusting their value would break the call.
```

For a function marked `//go:uintptrkeepalive`, escape analysis rewrites `uintptr(unsafe.Pointer(p))`
in the argument list so that `p` is first stored in a temporary variable, which is kept alive until
the call returns. `//go:nosplit` guarantees that the stack does not grow during the call, and the
compiler checks that a function marked with the former is also marked with the latter.
`//go:uintptrkeepalive` may only be used in the standard library; the other directive,
`//go:uintptrescapes`, makes the objects that such arguments point to escape to the heap, so stack
growth is no longer a problem. This is exactly why pattern (4) requires the conversion to
appear "directly in the argument list": that is the only place where the compiler recognizes this
form.

## 15.4.3 checkptr

The rules above are not complicated, yet code that violates them often passes all tests: the program
reads wrong data or crashes only when a garbage collection or stack copy happens to fall in the
dangerous window. Proposal #22218 of 2017 suggested inserting run-time checks at conversions,
motivated by a different problem: when stack copying encounters a pointer value between 0 and
`minLegalPointer`, the runtime terminates the program with invalid pointer found on stack, and the
proposal wanted the error reported at the conversion that produced such a value
[[amscanne, 2017](#ref-amscanne-2017)]. Matthew Dempsky implemented the compiler option
`-d=checkptr` in 2019, shipped in Go 1.14 [[Dempsky, 2019a](#ref-dempsky-2019a);
[Go Authors, 2020](#ref-go-authors-2020)]. It inserts calls to runtime functions at two kinds of
conversion:

- When an `unsafe.Pointer` is converted to `*T`, it calls `checkptrAlignment`, which checks that the
  address satisfies the alignment requirement of `T` and that the memory covered by `T` does not
  straddle multiple allocations. Alignment is enforced only for types that themselves contain
  pointers.
- When a `uintptr` is converted to `unsafe.Pointer`, it calls `checkptrArithmetic`. In the walk
  phase the compiler analyzes the operands of the conversion, collects all the "original
  pointers" in the arithmetic expression that were converted from `unsafe.Pointer` (both sides of an
  addition, the left side of a subtraction or `&^`), and passes them to the runtime together with
  the computed result [[Go Authors, 2026b](#ref-go-authors-2026b)].

The implementation of `checkptrArithmetic` is short [[Go Authors, 2026a](#ref-go-authors-2026a)]:

```go
func checkptrArithmetic(p unsafe.Pointer, originals []unsafe.Pointer) {
	if 0 < uintptr(p) && uintptr(p) < minLegalPointer {
		throw("checkptr: pointer arithmetic computed bad pointer value")
	}

	// Check that if the computed pointer p points into a heap
	// object, then one of the original pointers must have pointed
	// into the same object.
	base := checkptrBase(p)
	if base == 0 {
		return
	}

	for _, original := range originals {
		if base == checkptrBase(original) {
			return
		}
	}

	throw("checkptr: pointer arithmetic result points to invalid allocation")
}
```

The first check corresponds to the motivation of proposal #22218. The second check is the run-time
version of "the result must still point into the original allocation" in pattern (3): `checkptrBase`
determines in turn whether the address lies in the current goroutine's stack, in some heap object
(using the garbage collector's `findObject`, [12.2](../../part4memory/ch12alloc/component.md)), or
in the data or bss segment of some module, and returns the base address of the enclosing allocation.
The result is valid only if its base equals that of one of the original pointers. If the operands of
the arithmetic contain no `unsafe.Pointer` at all, for example because the address was first stored
in a `uintptr` variable, `originals` is empty, and the check necessarily fails whenever the result
points to a heap object. Code that keeps a `uintptr` across statements is therefore caught on the
spot, without waiting for a garbage collection to happen at the wrong moment.

The function `second` below violates pattern (3) (output from Go 1.26.10):

```go
package main

import (
	"fmt"
	"unsafe"
)

type pair struct{ a, b int }

var sink *pair

func second(p *pair) int {
	u := uintptr(unsafe.Pointer(p))
	q := unsafe.Pointer(u + unsafe.Offsetof(p.b)) // u spans a statement, invalid
	return *(*int)(q)
}

func main() {
	sink = &pair{1, 2}
	fmt.Println(second(sink))
}
```

```shell
$ go run .
2
$ go vet .
main.go:14:7: possible misuse of unsafe.Pointer
$ go run -race . 2>&1 | head -1
fatal error: checkptr: pointer arithmetic result points to invalid allocation
```

Without checking, the program prints the correct result and the error is hidden. `go vet` recognizes
this form from its syntax; `-race` implies `-d=checkptr`, and the run-time check terminates the
program at line 14. Each tool has blind spots: if the conversion in the same program is rewritten in
the form of pattern (3) but the result goes past the end of the allocation, `go vet` no longer
complains, while checkptr still reports the same error whenever the result lands in an adjacent heap
object.

In Go 1.14, checkptr was tied to `-race` and `-msan`, except on Windows, where parts of the standard
library had many conversions that needed to be fixed [[Dempsky, 2019b](#ref-dempsky-2019b)]. In Go
1.26, `-race`, `-msan` and `-asan` all imply `-d=checkptr` unless another value is given explicitly,
and `-gcflags=all=-d=checkptr=0` turns it off. `-d=checkptr=2` goes further and forces every value
converted to `unsafe.Pointer` to be allocated on the heap, so that the heap-object-based checks
cover more cases. The runtime itself does not use checkptr
[[Go Authors, 2026b](#ref-go-authors-2026b)].

The check has known limitations. `checkptrBase` returns the same pseudo base address 1 for every
address on a stack, so out-of-range arithmetic between different variables in the same stack frame
goes undetected; `checkptrStraddles` compares only the bases of the first and last ends of a region
of memory, so a region that fully contains another allocation in the middle is not detected either.
The source marks both points with a TODO [[Go Authors, 2026a](#ref-go-authors-2026a)]. Like the race
detector ([16.2](../ch16tools/race.md)), checkptr can find only errors that tests actually execute.

A function that really must break the rules can be annotated with `//go:nocheckptr`, and the
compiler inserts no checks into it. `internal/abi.NoEscape` in the standard library is an example;
it deliberately goes through an integer conversion so that escape analysis cannot see where the
pointer flows [[Go Authors, 2026c](#ref-go-authors-2026c)]:

```go
//go:nosplit
//go:nocheckptr
func NoEscape(p unsafe.Pointer) unsafe.Pointer {
	x := uintptr(p)
	return unsafe.Pointer(x ^ 0)
}
```

`//go:nosplit` and `//go:cgo_unsafe_args` both imply `//go:nocheckptr`. When checkptr is enabled,
the inliner also does not inline functions marked `//go:nocheckptr` ([15.3](./optimize.md));
otherwise, once the body was expanded into the caller, checks would be inserted into it again.

## 15.4.4 Safer Primitives

Pattern (6) is the most fragile of the six. The `Data` fields of `reflect.SliceHeader` and
`reflect.StringHeader` are `uintptr`, and the field is also a pointer only if the header is itself
an alias of a real slice or string; in a separately declared header variable, `Data` is just an
integer and cannot keep the underlying data alive. Go 1.17 added `unsafe.Add` and `unsafe.Slice`
[[Dempsky, 2021](#ref-dempsky-2021)], and Go 1.20 added `unsafe.SliceData`, `unsafe.String` and
`unsafe.StringData`, so that slices and strings can be constructed and taken apart without depending
on the memory representation of the headers [[Go Authors, 2021](#ref-go-authors-2021);
[Go Authors, 2023](#ref-go-authors-2023)]. Their signatures are as follows (excerpt)
[[Go Authors, n.d.a](#ref-go-authors-nda)]:

```go
func Add(ptr Pointer, len IntegerType) Pointer
// ...
func Slice(ptr *ArbitraryType, len IntegerType) []ArbitraryType
// ...
func SliceData(slice []ArbitraryType) *ArbitraryType
// ...
func String(ptr *byte, len IntegerType) string
// ...
func StringData(str string) *byte
```

The Go 1.17 release notes stress that these functions exist to make code that follows the rules
easier to write, and that the rules themselves have not changed
[[Go Authors, 2021](#ref-go-authors-2021)]. Their advantage is that checks can be attached to the
function: `unsafe.Slice` always checks whether the length is negative, whether `ptr` times the
length overflows, and whether the length is zero when `ptr` is nil; with checkptr enabled, the
compiler calls `unsafeslicecheckptr` instead, which also checks whether the result straddles
multiple allocations, and `unsafe.String` works the same way
[[Go Authors, 2026b](#ref-go-authors-2026b); [Go Authors, 2026c](#ref-go-authors-2026c)]. The two
header types have been marked deprecated since Go 1.20, and the documentation recommends these
functions instead [[hopehook, 2022](#ref-hopehook-2022); [Go Authors, n.d.b](#ref-go-authors-ndb)].
For how these functions are used in zero-copy conversion and under what preconditions, see
[5.2.4](../../part2lang/ch05data/string.md).

## 15.4.5 How Other Languages Do It

Garbage-collected languages that offer raw addresses all face the same contradiction: the collector
wants to reclaim and move objects freely, while a raw address requires the object to stay put. The
C# `fixed` statement pins a movable variable for the duration of a block, and pointers declared in
the block can be used only inside it [[Microsoft, n.d.](#ref-microsoft-nd)]. Go has no such syntax
for pure Go code. Instead it limits the time of "pinning" to a single address computation,
guaranteed implicitly by the compiler and runtime; when C code needs to hold a Go pointer for a long
time, Go 1.21 provides `runtime.Pinner` to pin objects explicitly ([15.6](./cgo.md)).

Java is evolving in a direction similar to the introduction of `unsafe.Slice`. For a long time,
Java's low-level libraries relied on the non-public `sun.misc.Unsafe` to read and write memory on
and off the heap, with allocation and deallocation entirely under programmer control. JEP 454 argues
that this model gives developers too much control: several memory regions can refer to one another,
and once the order of deallocation goes wrong, a dangling pointer causes use after free. The Foreign
Function & Memory API, finalized in Java 22, represents a region of memory as a `MemorySegment`, and
every segment has both spatial and temporal bounds, guaranteeing that unallocated memory is not
accessed and that memory is not accessed after it is freed [[OpenJDK, 2024](#ref-openjdk-2024)].

Rust has no garbage collection, so the problem of objects being moved or reclaimed during address
arithmetic does not arise, but it too confines code that bypasses checking to explicit `unsafe`
blocks, and its language reference lists item by item the operations that can be performed only
inside them, such as dereferencing a raw pointer [[Rust Project, n.d.](#ref-rust-project-nd)]. Go's
`unsafe` is a package rather than a piece of syntax: code that bypasses the type system must import
it, so the import list becomes the entry point for review. That `reflect.Value.Pointer` returns a
`uintptr` rather than an `unsafe.Pointer` serves the same purpose: code that does not import
`unsafe` cannot convert the result to an arbitrary type.

## 15.4.6 Summary

The rules of `unsafe.Pointer` look fussy, but they all revolve around one fact: the pointer bitmaps
generated by the compiler do not know about `uintptr`. The six valid patterns either never convert
an integer back to a pointer, or compress the time the integer stays alive into a range the compiler
can look after. The compiler maintains these ranges with the `Convert` operation,
`//go:uintptrkeepalive` and `//go:nosplit`, and the runtime covers asynchronous preemption with
conservative scanning. checkptr turns the rules into executable checks, so that code that violates
them fails immediately in testing instead of crashing by chance in production.

## Further Reading

- <a id="ref-amscanne-2017"></a>[amscanne, 2017] amscanne. golang/go#22218. *proposal: add
  GOEXPERIMENT=checkptr.* 2017. https://go.dev/issue/22218 Proposed inserting run-time checks at
  `unsafe.Pointer` conversions; implemented and closed by [Dempsky, 2019a].
- <a id="ref-dempsky-2019a"></a>[Dempsky, 2019a] Matthew Dempsky. cmd/compile: add -d=checkptr to
  validate unsafe.Pointer rules. Go commit 80a6fedea0, 2019. https://go.dev/cl/162237 Shipped in Go
  1.14.
- <a id="ref-dempsky-2019b"></a>[Dempsky, 2019b] Matthew Dempsky. cmd/compile: enable -d=checkptr
  when -race or -msan is specified. Go commit dded58760d, 2019. https://go.dev/cl/201783 Shipped in
  Go 1.14.
- <a id="ref-dempsky-2021"></a>[Dempsky, 2021] Matthew Dempsky. spec: add unsafe.Add and
  unsafe.Slice. Go commit 1da05eb0ce, 2021. https://go.dev/cl/312212 Shipped in Go 1.17.
- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *Package unsafe* (valid
  conversion patterns of `Pointer`, `Add`/`Slice`/`String`/`SliceData`/`StringData`).
  https://pkg.go.dev/unsafe
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *reflect.SliceHeader /
  StringHeader* deprecation notes. https://pkg.go.dev/reflect#SliceHeader
- <a id="ref-go-authors-2020"></a>[Go Authors, 2020] The Go Authors. *Go 1.14 Release Notes*:
  Compiler.
  2020. https://go.dev/doc/go1.14
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.17 Release Notes*:
  Changes to the language (`unsafe.Add`, `unsafe.Slice`). 2021. https://go.dev/doc/go1.17
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. *Go 1.20 Release Notes*:
  Changes to the language (`unsafe.String`, `unsafe.SliceData`, `unsafe.StringData`). 2023.
  https://go.dev/doc/go1.20
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. runtime/checkptr.go
  (`checkptrAlignment`, `checkptrStraddles`, `checkptrArithmetic`, `checkptrBase`). Go 1.26 source.
  https://github.com/golang/go/blob/master/src/runtime/checkptr.go
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. cmd/compile/internal/walk:
  convert.go and builtin.go (checkptr instrumentation at conversions,
  `unsafeslicecheckptr`/`unsafestringcheckptr`); see also cmd/compile/internal/base/flag.go. Go 1.26
  source. https://github.com/golang/go/tree/master/src/cmd/compile/internal/walk
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. src/math/unsafe.go,
  src/cmd/compile/internal/ssa/_gen/genericOps.go, src/runtime/mgcmark.go, src/runtime/stack.go,
  src/syscall/syscall_linux.go, src/internal/abi/escape.go, src/runtime/unsafe.go,
  src/runtime/pinner.go. Go 1.26 source. https://github.com/golang/go/tree/release-branch.go1.26/src
- <a id="ref-hopehook-2022"></a>[hopehook, 2022] hopehook. reflect: deprecate SliceHeader and
  StringHeader. Go commit d734203e39, 2022. https://go.dev/cl/428757
  Shipped in Go 1.20.
- <a id="ref-microsoft-nd"></a>[Microsoft, n.d.] Microsoft. *fixed statement - pin a variable for
  pointer operations.* C# language reference.
  https://learn.microsoft.com/dotnet/csharp/language-reference/statements/fixed
- <a id="ref-openjdk-2024"></a>[OpenJDK, 2024] OpenJDK. *JEP 454: Foreign Function & Memory API*
  (finalized in Java 22; `MemorySegment` as a controlled replacement for `sun.misc.Unsafe`). 2024.
  https://openjdk.org/jeps/454
- <a id="ref-rust-project-nd"></a>[Rust Project, n.d.] The Rust Project. *The Rust Reference*:
  Unsafety. https://doc.rust-lang.org/reference/unsafety.html
- This book: [5.1 Arrays and Slices](../../part2lang/ch05data/slice.md),
  [5.2 Strings and Zero-Copy Conversion](../../part2lang/ch05data/string.md),
  [9.7 Cooperation and Preemption](../../part3concurrency/ch09sched/preemption.md),
  [12.2 Components](../../part4memory/ch12alloc/component.md),
  [14.4 Stack Copying and Pointer Adjustment](../../part4memory/ch14stack/copy.md),
  [15.3 The Optimizer](./optimize.md), [15.6 cgo](./cgo.md),
  [16.2 Race Detection](../ch16tools/race.md).
