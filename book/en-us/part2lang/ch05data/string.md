---
weight: 2202
title: "5.2 Strings and Zero-Copy Conversion"
---

# 5.2 Strings and Zero-Copy Conversion

At run time a string is represented much like a slice: a header plus a run of bytes elsewhere
([5.1.1](./slice.md)). The difference is that a string is **immutable**. Immutability lets strings
be shared freely without copying, and it has one direct cost: converting between `string` and
`[]byte` must, in principle, copy the bytes. This section first describes the representation of a
string, how immutability is guaranteed, and the relation between Go strings and UTF-8. It then
examines the cost of that copy and the cases in which the compiler can omit it. Finally it presents
the manual zero-copy tools of the `unsafe` package and the conventions for using them, and discusses
memory retention through substrings and string interning.

## 5.2.1 Representation and Immutability

A string header has only two words: a pointer to the bytes and the byte count (`stringStruct` in
`runtime/string.go`) [[Go Authors, 2026a](#ref-go-authors-2026a)]. Unlike a slice it has no capacity
field, because the content and length of a string never change once fixed.

Immutability is guaranteed at two levels. In the language, strings do not support element
assignment: `s[0] = 'x'` does not compile, and every operation that appears to modify a string
(concatenation, replacement and so on) produces a new one. In the implementation, the compiler
places string literals in the read-only data segment of the executable, and that memory is mapped
read-only while the program runs. If `unsafe` is used to get around the language and modify a
literal:

```go
package main

import "unsafe"

func main() {
	s := "hello"
	b := unsafe.Slice(unsafe.StringData(s), len(s))
	b[0] = 'j' // the literal lives in read-only memory
}
```

the program crashes with a write to read-only memory:

```
unexpected fault address 0x100f78fd3
fatal error: fault
```

The signal name that follows depends on the operating system; on the author's macOS/arm64 machine it
is SIGBUS. This behavior shows that immutability is more than a language rule: for literals it is
also protected by hardware. For strings built at run time, immutability can only be maintained by
the program honoring a convention, a point 5.2.4 returns to.

## 5.2.2 Bytes, Characters and UTF-8

A Go string is a sequence of bytes and is not required to hold valid UTF-8. Go source files,
however, are specified to be UTF-8, and `for range` over a string decodes it as UTF-8. This choice
is closely tied to the experience of Go's designers. By Rob Pike's recollection in 2003
[[Pike, 2003](#ref-pike-2003)], UTF-8 was designed on a placemat in a New Jersey diner one night in
September 1992: Ken Thompson devised the bit layout of the encoding, with Pike helping alongside.
Within a few days they had converted the Plan 9 operating system to the new encoding throughout, and
on September 8 they sent the design to X/Open. The following year the two presented a paper at the
USENIX Winter conference describing Plan 9's adoption of UTF-8
[[Pike and Thompson, 1993](#ref-pike-thompson-1993)].

UTF-8 encodes a Unicode code point in 1 to 4 bytes. An ASCII character takes one byte, and no byte
of a multi-byte sequence can be confused with an ASCII character. In Go, `len(s)` returns the number
of bytes, the index `s[i]` yields the `i`-th byte, and `for range` decodes one code point per
iteration (of type `rune`, that is `int32`), producing the replacement character U+FFFD on an
invalid byte sequence [[Pike, 2013](#ref-pike-2013)]:

```go {run=true}
package main

import (
	"fmt"
	"unicode/utf8"
)

func main() {
	s := "Goλ€"
	fmt.Println(len(s), utf8.RuneCountInString(s)) // number of bytes and number of characters
	for i, r := range s {
		fmt.Printf("%d:%c ", i, r) // i is the byte offset
	}
	fmt.Println()
	fmt.Println(s[2], s[2:4]) // index and slice by byte

	for _, r := range "a\xffb" { // \xff is not valid UTF-8
		fmt.Printf("%U ", r)
	}
	fmt.Println()
}
```

```
7 4
0:G 1:o 2:λ 4:€ 
206 λ
U+0061 U+FFFD U+0062
```

The characters "λ" and "€" take 2 and 3 bytes respectively, so the string has 7 bytes and 4
characters, and the offsets that `range` reports are 0, 1, 2 and 4. `s[2]` is the first byte of "λ",
206 (0xCE), while `s[2:4]` cuts out exactly the whole "λ". If a slice boundary falls in the middle
of a character, the result is no longer valid UTF-8, but it is still a valid Go string.

## 5.2.3 The Cost of Conversion and Compiler Optimizations

A `[]byte` is writable. If `[]byte(s)` pointed directly at the bytes of the string `s`, a write
through it would change a string that is supposed to be immutable; conversely, if `string(b)`
referred directly to the bytes of the slice `b`, later modifications of `b` would show up in the
string. Conversion between the two must therefore copy, semantically. The conversion from `[]byte`
to `string` is done by the runtime function `slicebytetostring` (Go 1.26, with race detector and
similar code omitted):

```go
func slicebytetostring(buf *tmpBuf, ptr *byte, n int) string {
	if n == 0 {
		return ""
	}
	if n == 1 { // a single byte: point into a static array, no allocation
		p := unsafe.Pointer(&staticuint64s[*ptr])
		if goarch.BigEndian {
			p = add(p, 7)
		}
		return unsafe.String((*byte)(p), 1)
	}

	var p unsafe.Pointer
	if buf != nil && n <= len(buf) { // result does not escape and is at most 32 bytes: use the stack buffer
		p = unsafe.Pointer(buf)
	} else {
		p = mallocgc(uintptr(n), nil, false)
	}
	memmove(p, unsafe.Pointer(ptr), uintptr(n))
	return unsafe.String((*byte)(p), n)
}
```

The parameter `buf` is a 32-byte buffer (`tmpBuf`) that the compiler reserves in the caller's stack
frame; it is passed only when the result of the conversion does not escape. The opposite direction,
`stringtoslicebyte`, makes the same arrangement.

Beyond that, the compiler recognizes several situations in which the result of a conversion is only
read temporarily and can be neither retained nor modified, and in those it omits the copy entirely.
For `string(b)`, comments in the runtime source list the following: using `string(b)` as a key to
look up a map (`m[string(b)]`), using it in a concatenation (such as `"<" + string(b) + ">"`), and
comparing it with another string (`string(b) == "foo"`). At these places the compiler uses
`slicebytetostringtmp`, which returns a string pointing directly at the bytes in `b` without
copying.

For the opposite direction, `[]byte(s)`, Go 1.22 added an optimization based on escape analysis: if
it can be proved that the resulting slice is never modified, it can share the bytes of the string
directly. The following program measures the number of allocations in each case:

```go {run=true}
package main

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

var (
	sinkS string
	m     = map[string]int{}
)

//go:noinline
func countA(s string) int {
	n := 0
	for _, c := range []byte(s) { // read only, never modified
		if c == 'a' {
			n++
		}
	}
	return n
}

//go:noinline
func upper(s string) int {
	b := []byte(s) // b is modified below
	b[0] = 'A'
	return len(b)
}

func main() {
	s := strings.Repeat("a", 40+len(os.Args)) // 41 bytes, built at run time
	b := []byte(s)

	fmt.Println(testing.AllocsPerRun(100, func() { sinkS = string(b) }))  // result escapes
	fmt.Println(testing.AllocsPerRun(100, func() { _ = m[string(b)] }))   // map lookup
	fmt.Println(testing.AllocsPerRun(100, func() { _ = string(b) == s })) // comparison
	fmt.Println(testing.AllocsPerRun(100, func() { countA(s) }))          // read-only []byte(s)
	fmt.Println(testing.AllocsPerRun(100, func() { upper(s) }))           // modified []byte(s)
	fmt.Println(testing.AllocsPerRun(100, func() { upper(s[:8]) }))       // at most 32 bytes
}
```

```
1
0
0
0
1
0
```

Only two cases need an allocation: `string(b)` whose result escapes, and `[]byte(s)` that is
modified after conversion and exceeds 32 bytes. Compiling with `-gcflags=-m` shows what the compiler
reports for the two conversions:

```
./main.go:18:27: zero-copy string->[]byte conversion
./main.go:35:14: zero-copy string->[]byte conversion
```

The first is the `[]byte(s)` in `countA`; the second is `b := []byte(s)` in `main`, where `b` is
likewise never modified afterwards.

The optimization is implemented by recording a "may be mutated" property for each location during
escape analysis. It was committed in August 2023 and reverted the next day when a case that went
wrong was found; the same day it was committed again behind the debug flag `-d=zerocopy`, enabled by
default, and shipped with Go 1.22.

## 5.2.4 Manual Zero-Copy: `unsafe.String` and Related Functions

The compiler's optimizations cover only the cases it can prove safe. When the programmer knows that
a run of bytes will never be modified again, four functions in the `unsafe` package perform the
zero-copy conversion by hand: `unsafe.String(ptr, len)` builds a string from a byte pointer and a
length, `unsafe.StringData(s)` obtains a pointer to the underlying bytes of a string, and
`unsafe.Slice` and `unsafe.SliceData` are the counterparts on the slice side. `unsafe.Slice` was
added in Go 1.17 [[Dempsky, 2021](#ref-dempsky-2021)], and the other three in Go 1.20
[[Go Authors, 2023](#ref-go-authors-2023)].

Before that, the usual approach was to construct the headers by hand with `reflect.StringHeader` and
`reflect.SliceHeader`. The problem is that the `Data` field of these structs is a `uintptr`, which
the garbage collector does not treat as a pointer, so the field alone cannot keep the referenced
memory alive, and the program must hold a separate, correctly typed pointer. Both types were
deprecated in Go 1.20, and the documentation recommends the functions above instead
[[hopehook, 2022](#ref-hopehook-2022)].

`strings.Builder` in the standard library uses exactly this technique: it accumulates content in an
internal `[]byte`, and its `String` method returns the result as
`unsafe.String(unsafe.SliceData(b.buf), len(b.buf))` without copying. This is safe because `Builder`
only appends after the content already written and never modifies bytes that have been written.

The precondition for using these functions is that the programmer guarantees the bytes are not
modified after the conversion. Once that is violated, immutability is broken:

```go {run=true}
package main

import (
	"fmt"
	"unsafe"
)

func main() {
	b := []byte("hello")
	s := unsafe.String(unsafe.SliceData(b), len(b)) // zero-copy: s and b share the bytes
	fmt.Println(s)
	b[0] = 'j' // violates the convention: the bytes are modified after conversion
	fmt.Println(s)
}
```

```
hello
jello
```

The content of the string `s` changed without any assignment to it. If `s` had already been used as
a map key, or were being read by another goroutine, the consequences would be hard to predict.

## 5.2.5 Substrings, Memory Retention and Interning

A substring shares the bytes of the original string, just as a subslice does ([5.1.5](./slice.md)).
Cutting a small piece out of a large string and keeping it for a long time keeps the entire large
string from being reclaimed. `strings.Clone`, introduced in Go 1.18, solves this: it guarantees that
the content is copied into new memory. The documentation also warns that the copy itself consumes
memory, so `Clone` should be used only when profiling shows it is needed.

The opposite need is **interning**: keeping a single copy of strings that appear many times in a
program (for example host names in logs, or field names produced by parsing). The `unique` package,
introduced in Go 1.23, provides this [[Go Authors, 2026b](#ref-go-authors-2026b)]. `unique.Make`
returns a handle, equal values yield equal handles, and comparing two handles requires comparing
only one pointer:

```go {run=true}
package main

import (
	"fmt"
	"unique"
)

func main() {
	a := unique.Make("golang")
	b := unique.Make(string([]byte{'g', 'o', 'l', 'a', 'n', 'g'}))
	fmt.Println(a == b, a.Value()) // equal handles; comparing them compares one pointer
}
```

```
true golang
```

Internally `unique` maintains a global table that refers to its values through weak pointers, so
values that are no longer referenced can still be reclaimed. Since Go 1.25 the compiler also omits
the copy in `unique.Make(string(b))`.

## 5.2.6 Comparison with Other Languages

Languages differ in how they design strings along two axes: whether strings are mutable, and which
encoding they use internally.

- **Java**'s `String` is immutable and was originally stored internally as UTF-16; Java 9 introduced
  compact strings (JEP 254), under which a string containing only Latin-1 characters uses one byte
  per character.
- **Python 3**'s `str` is immutable and works in units of code points. Since Python 3.3 (PEP 393),
  the internal representation is chosen among 1, 2 and 4 bytes per character according to the
  largest code point in the string, so indexing by code point takes constant time.
- **Rust** distinguishes the owning `String` from the borrowed `&str`. Both guarantee valid UTF-8,
  and building a string from bytes requires validation.
- **C++**'s `std::string` is a mutable sequence of bytes with no prescribed encoding.

Go's choice lies in between: strings are immutable, are sequences of bytes internally, and use UTF-8
by convention rather than by enforcement. Not enforcing validation means that conversions such as
`string(b)` need not scan the content, and that a string can carry arbitrary binary data. The cost
is that a program needing valid UTF-8 must check for itself with `utf8.ValidString`.

## Further Reading

- <a id="ref-pike-2013"></a>[Pike, 2013] Rob Pike. "Strings, bytes, runes and characters in Go." The
  Go Blog, 2013. https://go.dev/blog/strings The relation among strings, bytes and runes, and the
  decoding rules of `for range`.
- <a id="ref-pike-2003"></a>[Pike, 2003] Rob Pike. "UTF-8 history." 2003.
  https://www.cl.cam.ac.uk/~mgk25/ucs/utf-8-history.txt
  A first-hand account of how UTF-8 was designed, with the original 1992 emails.
- <a id="ref-pike-thompson-1993"></a>[Pike and Thompson, 1993] Rob Pike, Ken Thompson. "Hello World
  or Καλημέρα κόσμε or こんにちは 世界." *Proceedings of the Winter 1993 USENIX Conference*, 43–50, 1993.
  How Plan 9 came to adopt UTF-8, and the design considerations.
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. `runtime/string.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/string.go
  https://github.com/golang/go/blob/master/src/runtime/string.go
  The implementations of `slicebytetostring`, `slicebytetostringtmp` and `stringtoslicebyte`.
- <a id="ref-dempsky-2021"></a>[Dempsky, 2021] Matthew Dempsky. spec: add unsafe.Add and
  unsafe.Slice. Go commit 1da05eb0ce, 2021. https://go.dev/cl/312212 Shipped with Go 1.17.
- <a id="ref-hopehook-2022"></a>[hopehook, 2022] hopehook. reflect: deprecate SliceHeader and
  StringHeader. Go commit d734203e39, 2022. https://go.dev/cl/428757
  Shipped with Go 1.20.
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. Go 1.20 Release Notes.
  https://go.dev/doc/go1.20
  The introduction of `unsafe.String`, `unsafe.StringData` and `unsafe.SliceData`.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. Documentation of the `unique`
  package. https://pkg.go.dev/unique
  The value interning mechanism introduced in Go 1.23.
