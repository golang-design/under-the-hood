---
weight: 100
title: "Preface"
---

# Preface

The Go language has a history of more than a decade since it first appeared in 2009.
Looking across the history of most programming languages, what is surprising is that over the dozen or so years Go has evolved,
the language itself has not changed all that much, and Go users have been able to keep writing applications that remain backward compatible.
From the standpoint of language design, Go was built from the very beginning around principles such as low cost, high concurrency, and simplicity, and it is hard not to be curious about the implementation mechanisms and the concrete working principles that sit behind that simple design.
This book is one that discusses the technical principles in the Go source code and the course of their evolution.

## A Word to the Reader

The reader may wonder: designs are always evolving, source code is always changing, so why spend the effort studying source code that one may never touch in actual work?
The author thinks otherwise, because "software engineering happens when code is read by someone other than its original author." In the process of reading source code,
beyond deepening our understanding of the language itself, what matters more is understanding the fundamental principles behind a given design,
along with the engineering decisions, practices, and implementation techniques that arose while others were realizing that design.
Code can always be torn down and rewritten, but principles can "live forever."

The vision behind this book is to cover every aspect of the Go language. This includes the Go runtime components that user code touches directly,
the toolchain closely tied to key language features, many important standard libraries, and so on. In some cases,
this book discusses differences in implementation across platforms, but the focus is primarily on Linux amd64.

## Prerequisites for Reading

The reader of this book should have some basic computer science literacy, having taken at least one course in **programming** and one in **data structures**, for example being able to talk comfortably about concepts such as hash tables and red-black trees. If you have a basic grasp of **discrete mathematics** and **probability theory**, and some degree of understanding of mathematical concepts such as predicates and random variables, it will help with reading parts of this book.

The references in this book fall into two distinct kinds. At the end of each chapter there is a list of further-reading references,
whose main purpose is to point the reader toward topics the book does not explore further; such topics usually lie beyond the scope of the whole book,
and these references give readers interested in that material room to read further.
The second kind is the bibliography at the end of the book; these are the main works cited and consulted while writing this book, and the reader can select and look up the works it drew on according to their own needs.

This book does not require that the reader already know how to use Go, so it opens with a quick introduction to the Go language specification. If you already have experience coding in Go and related development experience, it will help you read this book.

If you are worried about the book's barrier to entry, or find chapters such as scheduling, stealing, and memory heavy going, [How to Read This Book](./how-to-read.md) offers concrete advice on choosing a starting point based on your background, and on reading the harder chapters in two passes.

## About This Edition

The content of this book has undergone a systematic rewrite and revision against **Go 1.26** as its baseline, covering six major parts: panorama and history, language features, concurrency,
memory, the compiler and toolchain, and heterogeneous compute and AI (the last part also touches on a few frontier features of Go 1.27). Each section tries, as far as possible, to return to the thread of "problem, design, evolution, trade-offs, implementation" as it
unfolds, and is checked against the Go source code and first-hand design documents.

Even so, the source code keeps evolving, and the book will inevitably contain omissions or material that has gone stale with newer versions. If, while reading, you
suspect that some passage is mistaken, you are welcome to open an Issue or Pull Request in the [GitHub repository](https://github.com/golang-design/under-the-hood/issues),
and we will keep revising it.
