---
weight: 100
title: "Preface"
---

# Preface

Go was released publicly in 2009 and is now more than a decade old. Compared with most programming
languages, it has changed with considerable restraint over those years. When Go 1 shipped in 2012,
the Go team promised that programs written to the Go 1 specification would keep compiling and
running correctly, unmodified, for the lifetime of that specification
[[Go Authors, 2012](#ref-go-authors-2012)]. Major features added since, generics among them, have
not broken that promise. Go was designed from the start for simplicity, efficient concurrency and
low development cost, and it is natural to ask what machinery lies beneath that simple surface and
how it works. This book is about exactly that: the technical principles in Go's source code and how
they evolved.

## To the Reader

Designs evolve and source code keeps changing, so why spend effort studying source code you may
never touch in daily work? Russ Cox once defined software engineering this way
[[Cox, 2018](#ref-cox-2018)]:

```text
Software engineering is what happens to programming
when you add time and other programmers.
```

Go's runtime and compiler are exactly such a body of code: many people have maintained them for more
than ten years. Reading them deepens your understanding of the language itself, and it also shows
the basic principle behind a design, along with the engineering decisions, practices and techniques
its implementers used to realize it. Code can always be rewritten; principles last.

The book aims to cover every aspect of Go: the runtime components that user code deals with
directly, the toolchain behind key language features, and several important standard libraries. Some
chapters discuss differences between platforms, but Linux/amd64 is the default.

## Prerequisites

Readers should have basic computer science training: at least courses in **programming** and **data
structures**, enough to discuss hash tables and red-black trees with ease. Some chapters use
elementary **discrete mathematics** and **probability**, such as predicates and random variables.

The book does not assume fluency in Go.
[1.2 An Overview of the Go Language](./part1overview/ch01intro/go.md) outlines Go's components and
its main design decisions; for a systematic introduction to the language itself, see Donovan and
Kernighan's *The Go Programming Language*. Programming experience in Go will, of course, make
reading smoother.

Citations in the text take the form [[Cox, 2018](#ref-cox-2018)]; clicking one jumps to the matching
entry under "Further Reading" at the end of the section. Some of these works are sources for the
discussion, including design documents, proposals, papers and specific commits in the Go repository;
others point to topics the book does not cover in depth, for readers who want to go further. The
terms used in the book are collected in the [Glossary](./glossary.md).

If the book's difficulty worries you, or if you struggle with chapters such as scheduling or memory
management, see [How to Read This Book](./how-to-read.md), which suggests where to start according
to your background and how to read hard chapters in two passes.

## About This Edition

This edition is a systematic rewrite and revision based on **Go 1.26**. It has six parts: the
panorama and history, the implementation of language features, concurrency, memory, the compiler and
toolchain, and heterogeneous compute and Go in the AI era. Go 1.27 was released in August 2026, and
the book notes the changes it brings where they are relevant. Each section follows, as far as
possible, the thread of problem, design, evolution, trade-offs and implementation, and its claims
are checked against the Go source and primary design documents.

Even so, the source keeps evolving, and the book will contain slips and passages that age with new
versions. If you suspect an error, please open an issue or pull request in the
[GitHub repository](https://github.com/golang-design/under-the-hood/issues); we will keep revising.

## Further Reading

- <a id="ref-cox-2018"></a>[Cox, 2018] Russ Cox. What is Software Engineering? (Go & Versioning,
  Part 9). May 30, 2018. https://research.swtch.com/vgo-eng
- <a id="ref-go-authors-2012"></a>[Go Authors, 2012] The Go Authors. Go 1 and the Future of Go
  Programs.
  2012. https://go.dev/doc/go1compat
