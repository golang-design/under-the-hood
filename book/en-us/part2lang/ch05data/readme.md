---
weight: 2200
title: "Chapter 5 Data Structures"
bookCollapseSection: true
---

# Chapter 5 Data Structures

- [5.1 Arrays and Slices](./slice.md)
- [5.2 Strings and Zero-Copy Conversion](./string.md)
- [5.3 Hash Tables: Principles and Security](./map.md)
- [5.4 Swiss Table and the Go 1.24 Implementation](./swisstable.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Data dominates. If you've chosen the right data structures and organized things well, the algorithms will almost always be self-evident.</I></br>
<div class="quote-right">
-- Rob Pike, "Notes on Programming in C"
</div>
</div>

Slices and hash tables are the only two generic containers Go provides, and they are also the two data structures that appear most often in everyday code. They take a seemingly plain set of questions, how a contiguous region of memory is described, shared, and grown, and turn them into a concrete runtime layout and growth strategy. As a result, the various "surprises" of `append`, the pitfalls of slice aliasing, and the random iteration and crash-on-concurrency of `map` are no longer rules to be memorized by rote, but inevitable consequences of layout and trade-offs. This chapter unfolds along four themes: we first lay out the memory model and growth strategy of arrays and slices, then look separately at the zero-copy conversion and safety contract that string immutability brings; next we work through the general principles of hash tables and the attack and defense of hash flooding, and finally arrive at Go 1.24's thorough rewrite based on the Swiss Table, seeing how it balances cache behavior, security, and incremental growth. Along the way we watch how Go hides all this complexity in places the user never sees, leaving only the plain `s[i]` and `m[k]` at the surface.
