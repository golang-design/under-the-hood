---
weight: 1304
title: "3.4 Module Linking"
---

# 3.4 Module Linking

The compiler ([3.2](./compile.md)) compiles each package into an object file, but object files
cannot run directly: they refer to one another's functions and variables, and the final addresses of
those symbols are not known at compile time. Combining all the object files and the runtime into a
single program that the operating system can load and execute is the job of the **linker**. Go's
linker is `cmd/link`, which `go build` invokes as `go tool link`.

Take a program that prints one line:

```go
package main

import "fmt"

func main() { fmt.Println("hello") }
```

Compile it for linux/amd64 and have the compiler print assembly (`go build -gcflags=-S`). The call
to `fmt.Fprintln` in `main.main` looks like this (`fmt.Println` has been inlined into a call to
`fmt.Fprintln`, and the source position column is omitted):

```
0x0041 00065   CALL  fmt.Fprintln(SB)
0x0040 fe e8 00 00 00 00 48 83 c4 38 5d c3 e8 00 00 00
rel 66+4 t=R_CALL fmt.Fprintln+0
```

`e8` is the x86 `CALL` opcode, and the four bytes after it should hold the call target, yet they are
all zero. The compiler handles one package at a time; while compiling `main` it cannot know where
`fmt.Fprintln` will end up, so it leaves a gap and records it in the last line: the four bytes
starting at byte 66 are to be filled in once the address of `fmt.Fprintln` is known. In the final
executable the same instruction reads:

```
$ go tool objdump -s '^main.main$' hello | grep Fprintln
  print.go:315		0x49e161		e8dab0ffff		CALL fmt.Fprintln(SB)
```

The gap has been filled. The size is also striking: `main.main` is only 83 bytes, yet the whole file
is 2,414,502 bytes. The linker filled in the address, and it also wrote the remaining two million or
so bytes.

## 3.4.1 What the Linker Does

The **object file** that the compiler produces for each package (see [3.2](./compile.md)) holds the
package's machine code and data, plus two tables. One is the **symbol** table, which lists the
functions and global variables the package defines, such as `fmt.Fprintln` and `os.Stdout`. The
other is the **relocation** table, which records every address in the code and data that remains to
be filled in; the line beginning with `rel` above is one relocation entry.

The linker reads the object files of the `main` package and of every package it depends on, directly
or indirectly (the runtime included), and performs four tasks in turn
[[Levine, 2000](#ref-levine-2000)]:

1. **Symbol resolution**: bind each reference to an external symbol to its unique definition.
2. **Dead-code elimination**: find the symbols reachable from the program entry point and discard
   the rest (3.4.3).
3. **Layout**: arrange the surviving symbols into the segments of the executable by kind (code,
   read-only data and writable data each have their place), which gives every symbol a definite
   address.
4. **Relocation**: use the relocation entries to fill in all the addresses (3.4.2), and write the
   file in the format the operating system requires (ELF on Linux).

## 3.4.2 Relocation

The `CALL` instruction does not hold the absolute address of `fmt.Fprintln`. It holds the offset
from the next instruction to `fmt.Fprintln`, and the CPU adds the two to obtain the jump target. All
the linker has to do here is a subtraction:

```
$ go tool nm hello | grep ' fmt.Fprintln$'
  499240 T fmt.Fprintln
```

`fmt.Fprintln` is at `0x499240`. The call instruction starts at `0x49e161` and is 5 bytes long, so
the next instruction is at `0x49e166`. `0x499240 - 0x49e166 = -0x4f26`, which in little-endian byte
order is `da b0 ff ff`, the four bytes that follow `e8` in the final file.

Another kind of relocation fills in the absolute address of a target, for example the address of a
global variable stored in a table. The compiler distinguishes the ways of filling in by type
(`R_CALL`, `R_PCREL`, `R_ADDR`, and so on), and the linker handles them per target architecture in
`cmd/link/internal/ld/data.go`.

The benefit of relative addressing is that as long as the relative positions of the parts of the
code do not change, the offsets already filled in need no modification. The operating system can
therefore place the program at a different address on every load, which makes function locations
hard for an attacker to predict; this is address space layout randomization (ASLR). An executable
that can be loaded at any address is a position-independent executable (PIE). Go 1.26 produces PIE
by default on macOS, Windows, Android and iOS (except on Windows with the race detector enabled); on
Linux the program is by default loaded at a fixed address near `0x400000`, and `-buildmode=pie`
selects PIE when it is needed.

## 3.4.3 Dead-Code Elimination

The standard library has hundreds of packages, and a program typically uses only a small part of
them. The linker starts from the program entry point, follows the references between symbols, and
marks every reachable symbol; unmarked symbols are not written to the final file. This is the same
algorithm as the mark phase of the garbage collector
([Chapter 13](../../part4memory/ch13gc/readme.md)), except that the collector starts from global
variables and stacks and follows pointers between objects.

`-ldflags=-dumpdep` makes the linker print one line, "referrer -> referee", for every symbol it
marks [[Go Authors, 2026b](#ref-go-authors-2026b)]. Filtering the ten thousand or so lines of output
down to the path leading to `main.main` gives:

```
$ CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags=-dumpdep -o /dev/null . 2>&1 \
    | grep -E '^_ |-> (_rt0_amd64|runtime\.(rt0_go|mainPC|main|main_main·f)|main\.main)$'
_ -> _rt0_amd64_linux
_ -> runtime.unreachableMethod
_ -> go:main.inittasks
_rt0_amd64_linux -> _rt0_amd64
_rt0_amd64 -> runtime.rt0_go
runtime.rt0_go -> runtime.mainPC
runtime.mainPC -> runtime.main
runtime.main -> runtime.main_main·f
runtime.main_main·f -> main.main
```

`_` denotes a root of the traversal. The real starting point is `_rt0_amd64_linux`, where the
operating system enters the program, and `main.main` is referenced only indirectly, through the
runtime's startup code. [3.5](./boot.md) describes the work the program does along this path.

For ordinary functions, reachability analysis is straightforward. The difficulty is methods. A
directly called method is no different from an ordinary function, but for a call through an
interface, such as `q.Quack()`, the linker cannot know the dynamic type of `q` and so cannot tell
which type's `Quack` to keep. Go's linker (`cmd/link/internal/ld/deadcode.go`
[[Go Authors, 2026a](#ref-go-authors-2026a)]) takes this approach: it records every method called
through an interface in the program (method name plus signature) and, for each type converted to an
interface, keeps every method whose name and signature match. The source comment describes the
strategy as "extremely conservative, but easy and
correct" [[Go Authors, 2026a](#ref-go-authors-2026a)].

Reflection complicates matters further. If the `name` in `reflect.Value.MethodByName(name)` is known
only at run time, any exported method may be called. The compiler marks such calls, and once the
linker reaches a marked function it stops filtering: every exported method of every type converted
to an interface is kept. If `name` is a constant, only methods with that name are kept.

The following program demonstrates this (`//go:noinline` keeps the compiler from inferring the
concrete type behind the interface):

```go
type Duck struct{}

func (Duck) Quack() string { return "quack" }
func (Duck) Swim() string  { return "swim" } // never called

type Quacker interface{ Quack() string }

//go:noinline
func newQuacker() Quacker { return Duck{} }

//go:noinline
func unused() { fmt.Println("unused") } // never called

func main() { fmt.Println(newQuacker().Quack()) }
```

```
$ CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o duck . && go tool nm duck | grep ' main\.'
  49e1e0 T main.(*Duck).Quack
  49e120 T main.Duck.Quack
  49e160 T main.main
  49e140 T main.newQuacker
```

Both `unused` and `Swim` are gone (`(*Duck).Quack` is a wrapper method that the compiler generates
for the pointer type). Now change `main` to obtain `q := newQuacker()` first, and add a reflective
call:

| Extra code in `main` | `Swim` | File size (bytes) | Functions |
| --- | --- | --- | --- |
| none | removed | 2,414,840 | 1,944 |
| `reflect.ValueOf(q).MethodByName("Swim")` | kept | 2,544,376 | 2,031 |
| same, but the method name is a string built at run time | kept | 3,562,204 | 3,342 |

(linux/amd64; the function count is the number of symbols of type `T` or `t` in the `go tool nm`
output.) The third case adds 1,398 functions and 47% in size, all of them exported methods
that "might be called through reflection". `text/template` calls methods by the name written in the
template, and that name is a string known only at run time, so programs that use it grow noticeably.

The interactive figure below walks through this process: step through it to watch the work queue
change, or add a reflective call to see how `Swim` is kept. The order in which the linker actually
processes symbols differs from the figure, but the order does not affect the final set of retained
symbols.

<div class="viz" data-viz="link-deadcode"></div>

## 3.4.4 What an Executable Contains

`go tool nm -size hello` lists the size of every symbol. The 1,941 functions in `hello` total
612,583 bytes, of which the `runtime` package accounts for 434,726 bytes (71%) and `main.main` for
only 83. The scheduler, the memory allocator and the garbage collector are all included: a Go
program depends on no external virtual machine or runtime library, because the runtime is itself
part of the executable.

The largest part of the file is not even code. `objdump -h hello` shows a code segment of 643,505
bytes, while the table named `.gopclntab` takes 681,250 bytes. This table maps any instruction
address to its function, its source line and the positions of pointers on the stack. Printing the
call stack on a panic and scanning stacks during garbage collection
([Chapter 14](../../part4memory/ch14stack/readme.md)) both depend on it, so it cannot be removed.
What can be removed is the part intended for debuggers: `-ldflags="-s -w"` strips the symbol table
(`-s`) and the DWARF debugging information (`-w`) [[Go Authors, 2026b](#ref-go-authors-2026b)],
shrinking `hello` from 2,414,502 to 1,605,794 bytes, and a panic still prints a call stack.

The linker also writes build information, including the Go version, the modules depended on and
their versions, and the build flags. `go version -m hello` reads it without running the program, and
the vulnerability scanner `govulncheck` uses it to decide whether a program contains module versions
with known vulnerabilities. A program can read it itself:

```go {run=true}
package main

import (
	"fmt"
	"runtime/debug"
)

func main() {
	info, ok := debug.ReadBuildInfo() // read the build info the linker wrote into the file
	if !ok {
		fmt.Println("no build info")
		return
	}
	fmt.Println("Go version: " + info.GoVersion)
	fmt.Println("main package: " + info.Path)
	for _, s := range info.Settings {
		if s.Value != "" {
			fmt.Printf("  %s=%s\n", s.Key, s.Value)
		}
	}
}
```

Running `go run main.go` on darwin/arm64 produces the output below. When run on the website, the
last lines are `CGO_ENABLED=0`, `GOARCH=wasm` and `GOOS=js`; when built in a module managed by Git,
version control information such as `vcs.revision` is included as well.

```
Go version: go1.26.10
main package: command-line-arguments
  -buildmode=exe
  -compiler=gc
  CGO_ENABLED=1
  GOARCH=arm64
  GOOS=darwin
  GOARM64=v8.0
```

## 3.4.5 Static and Dynamic Linking

There are two ways to use an external library. One copies the code in use into the program and is
called **static linking**. The other records in the program only a reference to a symbol in the
library, and the system loads the library and completes the linking when the program starts; this is
**dynamic linking**. A library used this way can be shared among programs and is called a **shared
library** (a `.so` file on Linux).

Early Unix supported only static linking, and nearly every program carried its own copy of the C
library, so disk and memory held many identical copies. Shared libraries reached mainstream Unix in
the late 1980s: those of System V Release 3 (1987) had to be loaded at fixed, pre-agreed addresses,
while SunOS 4.0 (1988) implemented dynamic linking performed at program start
[[Gingell et al., 1987](#ref-gingell-et-al-1987)], which System V Release 4 later adopted as well.
Multiple processes share one copy of a library in memory, and upgrading a library does not require
recompiling the programs that use it; Linux and the BSD systems still work this way. The cost is
that every program start must look up and link the shared libraries, and whether the program can run
at all depends on the library versions installed on the target machine
[[Drepper, 2011](#ref-drepper-2011)].

Plan 9 at Bell Labs deliberately did not support dynamic linking, and every program was statically
linked. Go's toolchain comes from the authors of Plan 9 ([2.1](../ch02asm/asm.md)) and inherits the
practice: a pure Go program compiles to a single file that depends on no shared library.

```
$ file hello
hello: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), statically linked, Go BuildID=...
```

There are two exceptions. The first is cgo: when a program calls C code, Go hands the final link to
the system's C linker, and the result usually links the C library dynamically. When cgo is
available, the standard library's `net` and `os/user` also compile in implementations that call the
C library: `os/user` queries users through the C library by default; `net` uses the pure Go DNS
resolver by default on Unix, but in some configurations (for example when `/etc/nsswitch.conf` uses
a feature the pure Go resolver does not support) switches to the C library's `getaddrinfo`. A
program that imports these two packages therefore also links the C library dynamically when cgo is
available. Setting `CGO_ENABLED=0`, or using the build tags `netgo` and `osusergo`, restricts them
to the pure Go implementations. The second exception is macOS: Apple guarantees a stable interface
to the kernel only through the system library `libSystem`, and since Go 1.11 Go has made system
calls through it on macOS [[Go Authors, 2018](#ref-go-authors-2018)], so a Go program on macOS
always links this library dynamically:

```
$ go build -o hello . && otool -L hello
hello:
	/usr/lib/libSystem.B.dylib (compatibility version 0.0.0, current version 0.0.0)
	/usr/lib/libresolv.9.dylib (compatibility version 0.0.0, current version 0.0.0)
```

The two approaches compare as follows:

| | Static linking | Dynamic linking |
| --- | --- | --- |
| Deployment | Copy a single file; a container image can be based on the empty image (`FROM scratch`) | The target machine needs matching library versions |
| Startup | Runs directly | Shared libraries must be loaded and symbols resolved first |
| Size and memory | Each program carries its own copy of the library code | Processes share one copy |
| Fixing a vulnerability | Every program that uses the library must be recompiled and redistributed | Replace the library file and restart the processes |

Go is used mainly for servers and container environments, where every release rebuilds the image
anyway, so the convenience of "one file is everything" stands out. The cost appears in the last row
of the table: after a vulnerability is fixed in the standard library or a dependency, every program
that uses it must be recompiled. The build information described above exists to find those
programs.

## 3.4.6 The Linker Rewrite

Go's first linker was the Plan 9 C linker, which was translated automatically into Go together with
the compiler in Go 1.5 ([3.3](./bootstrap.md)). The translation kept the original design: every
symbol is an in-memory object, looked up through a large table keyed by name. The larger the
program, the larger the objects and the table, and linking gradually became one of the slowest and
most memory-hungry steps of the build, while build speed had been one of Go's primary design goals
from the start [[Pike, 2012](#ref-pike-2012)].

Starting in 2019, the Go team rewrote the core of the linker [[Clements, 2019](#ref-clements-2019)]:
object files use a new format, symbols are identified by integer indices, and references record
those indices directly; the linker reads symbols on demand instead of creating an object for each
symbol and looking it up by name. According to the Go 1.15 release notes, on amd64 Linux and other
systems, a representative set of large programs linked on average 20% faster and used 30% less
memory [[Go Authors, 2020](#ref-go-authors-2020)]; Go 1.16 added a further 20% to 25% speedup and 5%
to 15% memory reduction (linux/amd64) [[Go Authors, 2021](#ref-go-authors-2021)].

## Further Reading

- <a id="ref-levine-2000"></a>[Levine, 2000] John R. Levine. *Linkers and Loaders*. Morgan
  Kaufmann, 2000. The classic textbook on linking and loading, with dedicated chapters on symbols,
  relocation and shared libraries.
- <a id="ref-gingell-et-al-1987"></a>[Gingell et al., 1987] Robert A. Gingell, Meng Lee, Xuong T.
  Dang, Mary S. Weeks. "Shared Libraries in SunOS." *Proceedings of the Summer 1987 USENIX
  Conference*, 1987. An early design of Unix shared libraries, explaining the motivation for
  introducing them.
- <a id="ref-drepper-2011"></a>[Drepper, 2011] Ulrich Drepper. "How To Write Shared
  Libraries." 2011. https://akkadia.org/drepper/dsohowto.pdf The concrete costs of dynamic linking
  in start-up time and code generation.
- <a id="ref-clements-2019"></a>[Clements, 2019] Austin Clements. "Building a better Go
  linker." 2019. https://go.dev/s/better-linker The design document for the Go linker rewrite.
- <a id="ref-go-authors-2020"></a>[Go Authors, 2020] The Go Authors. *Go 1.15 Release
  Notes*, "Linker". https://go.dev/doc/go1.15 Measured link speed and memory use after the rewrite.
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.16 Release
  Notes*, "Linker". https://go.dev/doc/go1.16 Further speedup and memory savings on top of Go 1.15.
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors.
  `cmd/link/internal/ld/deadcode.go` (Go 1.26).
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/link/internal/ld/deadcode.go
  https://github.com/golang/go/tree/master/src/cmd/link/internal (`ld/deadcode.go`, `loader`: the
  new object file format and symbol indices) The implementation of dead-code elimination. The
  comment before the function `deadcode` explains the three ways a method can be called and how each
  is handled.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *cmd/link documentation and
  source (including the linker flags `-dumpdep`, `-s` and `-w`).* https://pkg.go.dev/cmd/link ;
  https://github.com/golang/go/tree/master/src/cmd/link
- <a id="ref-pike-2012"></a>[Pike, 2012] Rob Pike. *Go at Google: Language Design in the Service of
  Software Engineering (build speed as a first-class design goal).* 2012.
  https://go.dev/talks/2012/splash.article
- <a id="ref-go-authors-2018"></a>[Go Authors, 2018] The Go Authors. *Go 1.11 Release
  Notes*, "Runtime". https://go.dev/doc/go1.11#runtime The runtime on macOS and iOS now makes system
  calls through `libSystem.dylib`.
- This book: [2.1 The Plan 9 Assembly Language](../ch02asm/asm.md),
  [3.2 The Go Compilation Pipeline](./compile.md), [3.5 Bootstrapping a Go Program](./boot.md),
  [1.1 The Evolution of Programming Languages](../ch01intro/history.md),
  [17 Modules and Dependencies](../../part5toolchain/ch17modules).
- Reachability, as used for dead-code elimination (from the previous edition):
  https://en.wikipedia.org/wiki/Reachability
