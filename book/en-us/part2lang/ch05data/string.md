---
weight: 2202
title: "5.2 Strings and Zero-Copy Conversion"
---

# 5.2 Strings and Zero-Copy Conversion

Strings share their origin with slices: in the runtime both are "a header plus memory living elsewhere" (for the layout, see [5.1.1](./slice.md#511-三种内存布局)). But a string is **read-only and immutable**, which makes it its own category. Immutability buys us sharing and copy-free use, and it brings one direct cost: converting between `string` and `[]byte` copies the bytes by default. This section opens up that copy, looks at the cases where the compiler can elide it, then turns to the manual zero-copy tools Go 1.20 provides and the safety contract that comes with them.

## 5.2.1 Converting Between Strings and []byte

String immutability brings one direct cost: converting between `string` and `[]byte` **copies the bytes** by default. The reason is immutability itself. A `[]byte` is writable, so if we let it point straight at the underlying bytes of some string, modifying the `[]byte` would mean modifying that "immutable" string, breaking every sharing assumption. So the runtime dutifully `memmove`s a fresh copy:

```go
// runtime: []byte → string (string.go, excerpt)
func slicebytetostring(buf *tmpBuf, ptr *byte, n int) string {
    // ...
    p := mallocgc(uintptr(n), nil, false) // allocate new memory
    memmove(p, unsafe.Pointer(ptr), uintptr(n)) // copy the bytes
    return unsafe.String((*byte)(p), n)
}
```

This copy can be noticeable on a hot path. Fortunately the compiler recognizes a few patterns where "the bytes are read immediately after conversion and cannot be modified" and elides the copy. The two most common are using a `[]byte` as a temporary map key for a lookup, and ranging directly over `[]byte(s)`:

```go
var m map[string]int
_ = m[string(b)]      // compiler: the temporary string is only used to look up the map, no copy needed (uses slicebytetostringtmp)
for i, c := range []byte(s) { // compiler: only iterated, not retained, no need to actually build a slice
    _, _ = i, c
}
```

To do a manual zero-copy conversion in your own code, Go 1.20 gives the official tools: `unsafe.String(*byte, len)` views a span of bytes as a string, `unsafe.StringData(string) *byte` takes a string's underlying pointer, and `unsafe.Slice` / `unsafe.SliceData` are the slice-side counterparts. They replace the older, fragile practice of hand-assembling a header through `reflect.StringHeader` / `reflect.SliceHeader` (that practice is not reliable in the presence of GC movement or changes in field alignment). The price is that you must guarantee yourself that **the bytes are no longer modified after the conversion**, otherwise you have punctured the immutability contract:

```go
// zero-copy, and only valid when you can guarantee b is read-only from here on
s := unsafe.String(unsafe.SliceData(b), len(b))
```

## Further Reading

1. The Go Authors. *runtime/string.go: `slicebytetostring` / `stringStruct`* (string layout and conversion).
   https://github.com/golang/go/blob/master/src/runtime/string.go
2. The Go Authors. *Go 1.20 Release Notes* (`unsafe.String` / `unsafe.StringData` /
   `unsafe.SliceData`). https://go.dev/doc/go1.20
3. Rob Pike. *Strings, bytes, runes and characters in Go.* The Go Blog, 2013.
   https://go.dev/blog/strings
