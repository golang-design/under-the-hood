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

Slices, strings and `map`s are the three data structures most used in Go programs. Their syntax is
simple, but each rests on its own runtime layout and growth strategy. When `append` copies, when
slices share memory, when a string conversion allocates, why a `map` iterates in random order and
cannot be written concurrently: the answers to all of these follow from layout and implementation,
and need not be memorized as isolated rules.

The chapter has four sections. 5.1 covers the memory layout of arrays and slices, their growth
strategy, and what the compiler does to reduce allocations. 5.2 covers string immutability, UTF-8
and zero-copy conversion. 5.3 covers the general principles of hash tables and hash-flooding
attacks. 5.4 covers the `map` implementation of Go 1.24, which is based on the Swiss Table.
