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
- [3.5 Bootstrapping a Go Program](./boot.md)
- [3.6 The Life and Death of the Main Goroutine](./main.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>An adequate bootstrap is a contradiction in terms.</I></br>
<div class="quote-right">
-- Alan J. Perlis, "Epigrams on Programming"
</div>
</div>

The `main` function a user writes is not where a program really begins, and its return is more than
the end of one function. This chapter follows the complete life of a Go program:

1. The `go` command breaks a build into many steps and uses a cache to skip the parts that have not
   changed (3.1).
2. The compiler translates the source of each package into machine code and inserts many calls into
   the runtime along the way (3.2).
3. The compiler is itself written in Go, so it must be built by an earlier version of Go (3.3).
4. The linker combines all packages and the whole runtime into one executable (3.4).
5. After the operating system starts that file, the runtime first initializes itself and then
   creates the first goroutine (3.5).
6. That goroutine initializes all packages in dependency order, calls `main.main`, and ends the
   process when it returns (3.6).

This thread runs through the whole book. The scheduler, memory allocator and garbage collector
discussed in later chapters are initialized in step 5 and begin serving user code in step 6. It also
shows a basic property of Go: the runtime is linked into the same binary as the user code, and the
two start and end together in one process.
