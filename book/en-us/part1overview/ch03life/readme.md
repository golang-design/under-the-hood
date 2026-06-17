---
weight: 1300
title: "Chapter 3 The Life of a Program"
bookCollapseSection: true
---

# Chapter 3 The Life of a Program

- [3.1 Starting from the `go` Command](./cmd.md)
- [3.2 The Go Compilation Pipeline](./compile.md)
- [3.3 Bootstrapping the Language](./bootstrap.md)
- [3.4 Module Linking](./link.md)
- [3.5 Go Program Startup and Bootstrapping](./boot.md)
- [3.6 The Birth and Death of the Main Goroutine](./main.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>An adequate bootstrap is a contradiction in terms.</I></br>
<div class="quote-right">
-- Alan J. Perlis, "Epigrams on Programming"
</div>
</div>

The `main` function the reader types is never where the program truly begins. For a line of source to become a running process, it first has to pass through a long chain: the `go` command breaks the build into an action graph and hands it to the compiler and linker, the compiler itself must be bootstrapped from a previous version of Go, the linker stitches the entire runtime into the binary, and once the operating system loads it, an assembly entry point lays down the first goroutine, only then does `main.main` get its turn to run, and at the moment it returns it carries the whole process away with it. This chapter walks down that lifeline from start to finish, explaining exactly what happens before and after `main` without leaving anything out. It is both the master entry point to the later parts of the book (runtime, concurrency, memory, toolchain) and the starting point for understanding Go's fundamental trait that the runtime and user code share a single binary.
