---
weight: 1201
title: "2.1 The Plan 9 Assembly Language"
---

# 2.1 The Plan 9 Assembly Language

Open `runtime/asm_amd64.s` and you find code like this (Go 1.26):

```asm
TEXT runtime·gogo(SB), NOSPLIT, $0-8
	MOVQ	buf+0(FP), BX		// gobuf
	MOVQ	gobuf_g(BX), DX
	MOVQ	0(DX), CX		// make sure g != nil
	JMP	gogo<>(SB)
```

It resembles x86 assembly but does not match the notation in Intel's manuals: the instruction is
spelled `MOVQ`, operands include `(SB)` and `(FP)`, and the function name contains a `·`. This is
Go's own assembly language, whose notation descends from the Plan 9 operating system. The Go 1.26
`runtime` directory holds 182 `.s` files (covering various architectures and operating systems), and
the chapters on scheduling, stacks and signals cite them repeatedly.

This section addresses three questions: which Go code must be written in assembly, why Go has an
assembly language of its own, and which of its notations are easiest to misread.

## 2.1.1 What Assembly Is Used For

amd64 has sixteen 64-bit general-purpose **registers**, written in Go assembly as `AX`, `BX`, `CX`,
`DX`, `SI`, `DI`, `BP`, `SP` and `R8` through `R15`; floating-point and vector registers are written
`X0`, `X1` and so on. Two registers have dedicated roles. The **program counter** (PC) holds the
address of the next instruction to execute, and a jump overwrites it. The **stack pointer** (SP)
points to the top of the current stack. Each goroutine has its own stack, which a function call
claims from high addresses toward low addresses and which a return releases.

The compiler translates nearly all Go code into machine instructions. Only the following kinds of
work need hand-written assembly:

- **Switching goroutines**: replacing both SP and PC with the values saved for another goroutine
  (`gogo`, `mcall`). The Go language has no statement that writes the stack pointer.
- **Atomic operations**: compare-and-swap and similar operations need dedicated processor
  instructions, such as `CMPXCHG` with the `LOCK` prefix on amd64.
- **Talking to the operating system**: when issuing system calls or receiving signals, data must be
  placed in specific registers according to the operating system's convention.
- **A few hot paths**: `memmove`, string search and some cryptographic algorithms are hand-written
  with vector instructions that process several data items at once, which can make them several
  times faster.

## 2.1.2 Origin: A Toolchain Inherited from Plan 9

Plan 9 is the operating system Bell Labs developed after Unix, and two of Go's original designers,
Ken Thompson and Rob Pike, worked on it. Around 1990, Thompson wrote a set of C compilers for Plan
9, one per architecture [[Thompson, 1990](#ref-thompson-1990)] [[Pike, n.d.b](#ref-pike-ndb)]; Pike
wrote the manual for the accompanying assembly language [[Pike, n.d.a](#ref-pike-nda)].

The division of labor in this toolset differs from a traditional toolchain. In the object files that
the compiler and assembler emit, instructions are not yet encoded as the byte sequences the
processor finally executes. The linker (called the loader in Plan 9) acts as the second half of the
assembler and as a global optimizer, fixing the encoding of each instruction only when it merges all
the files. The assembly language can therefore sit one level above machine instructions: the
programmer writes "put this constant in R0", and the tools decide whether one machine instruction or
several are needed. Thompson's verdict on this design, in the conclusion of his paper, is that
compilation is fast and linking is slow [[Thompson, 1990](#ref-thompson-1990)].

Go initially followed the same approach, with the same cost in slow linking: every time a program
was linked, the instructions of all packages had to be processed again. Go 1.3 (2014) moved
instruction encoding into the step that compiles each package, so each package is processed once
[[Cox, 2013](#ref-cox-2013)]; Go 1.5 then rewrote the whole toolchain from C to Go. The build flow
today is:

```
foo.go ──► cmd/compile ──┐
                         ├──► cmd/internal/obj ──► foo.o ──► cmd/link ──► executable
foo.s  ──► cmd/asm ──────┘
```

The compiler and the assembler hand their results to the same shared library, `cmd/internal/obj`,
which determines the final machine instructions [[Go Authors, 2026b](#ref-go-authors-2026b)] and
inserts a stack check at the start of each function ([2.4](./args.md)). The linker `cmd/link` only
merges the packages and relocates addresses ([3.4](../ch03life/link.md)). Hand-written assembly
functions and compiler-generated functions travel the same path and receive the same treatment.

The design in which assembly sits one level above machine instructions has survived as well. Every
arm64 instruction is 4 bytes long and cannot hold an immediate as large as `0x123456789`. Write
`MOVD $0x123456789, R0` in arm64 assembly, cross-compile to linux/arm64 and inspect the result with
`go tool objdump`, and it has been expanded into three instructions that load 16 bits each:

```
MOVD $26505, R0        // 0x6789
MOVK $(9029<<16), R0   // 0x2345, written to bits 16 through 31
MOVK $(1<<32), R0      // 0x1, written to bits 32 through 47
```

## 2.1.3 Trade-offs

What this design buys is a uniform notation across architectures. Instruction names still vary by
architecture (`MOVQ` on amd64, `MOVD` on arm64), but operands always list the source first and the
destination second; the data width is always given by the last letter of the instruction name (`B`,
`W`, `L` and `Q` for 1, 2, 4 and 8 bytes); and functions, arguments and local variables are written
the same way everywhere. Once you know Go assembly on one architecture, moving to another only
requires consulting its instruction table. Support for every architecture lives in one set of tools,
so cross-compiling needs no separate toolchain installation [[Pike, 2016](#ref-pike-2016)], and
`GOOS=linux GOARCH=amd64 go build` runs directly on any machine.

The cost is isolation from the surrounding ecosystem. Go assembly differs from both Intel syntax and
the GNU assembler's AT&T syntax, so assembly code from other sources has to be rewritten. Go must
also maintain its own assembler, linker and object file format, and each new architecture requires
writing the corresponding code.

## 2.1.4 The Four Pseudo-Registers

The notations in Go assembly that are easiest to misread are four that look like registers but do
not exist as such. They are called **pseudo-registers**
[[Go Authors, 2026a](#ref-go-authors-2026a)]. The assembler converts them into a real register plus
an offset:

| Notation | Locates | Example |
| --- | --- | --- |
| `FP` | this function's arguments and results | `a+0(FP)`, `ret+16(FP)` |
| `SP` | this function's local variables | `x-8(SP)` |
| `SB` | functions and global variables | `runtime·gogo(SB)` |
| `PC` | a nearby instruction, for jumps | `JMP 2(PC)` |

`SB` (static base) stands for the origin of the program's address space, so `runtime·gogo(SB)` is
the address of the function `runtime.gogo`. The middle dot `·` corresponds to `.` in Go; writing
`·gogo(SB)` without a package name refers to `gogo` in the current package.

Accessing an argument through `FP` requires its name, and the offset must agree with the Go function
declaration. For `func add(a, b int) int`, the arguments are written `a+0(FP)` and `b+8(FP)`, and
the result `ret+16(FP)`. The processor uses only the offset; the name is there for readers and for
`go vet` to check. If `b+8(FP)` is mistakenly written `b+4(FP)`, `go vet` reports
`invalid offset b+4(FP); expected b+8(FP)`.

`SP` is the notation most prone to error. amd64 has a hardware register named SP, and Go assembly
distinguishes the two by whether the notation carries a name. `x-8(SP)` has a name and refers to the
pseudo-register, counted downward from the top of the local variable area; `8(SP)` has no name and
refers to the hardware stack pointer, counted upward from the bottom of the stack. The two differ by
the size of the entire local variable area. [2.2](./frame.md) uses a real disassembly to convert
these notations into actual addresses.

## Further Reading

- <a id="ref-thompson-1990"></a>[Thompson, 1990] Ken Thompson. "Plan 9 C Compilers." *Plan 9
  Programmer's Manual*, Volume 2. Originally published as "A New C Compiler" in *Proceedings of the
  Summer 1990 UKUUG Conference*, London, 1990. https://9p.io/sys/doc/compiler.html The division of
  labor among the Plan 9 compiler, assembler and linker, and the practice of letting the linker fix
  the final instructions.
- <a id="ref-pike-nda"></a>[Pike, n.d.a] Rob Pike. "A Manual for the Plan 9 Assembler." *Plan 9
  Programmer's Manual*, Volume 2. https://9p.io/sys/doc/asm.html The direct source of Go's assembly
  notation; the pseudo-registers FP, SP, SB and PC are all defined here.
- <a id="ref-cox-2013"></a>[Cox, 2013] Russ Cox. "Go 1.3 Linker Overhaul." 2013.
  https://golang.org/s/go13linker The design document for moving instruction encoding from the
  linker to the compile step, explaining the motivation for the change.
- <a id="ref-pike-2016"></a>[Pike, 2016] Rob Pike. "The Design of the Go Assembler." GopherCon 2016.
  https://go.dev/talks/2016/asm.slide
  How `cmd/asm` supports every architecture with one program and a set of tables.
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. "A Quick Guide to Go's
  Assembler." https://go.dev/doc/asm The official description of the pseudo-registers, the `TEXT`
  directive and the frame size notation.
- <a id="ref-pike-ndb"></a>[Pike, n.d.b] Rob Pike. *How to Use the Plan 9 C Compiler.*
  http://doc.cat-v.org/plan_9/2nd_edition/papers/comp
  (Background on the Plan 9 toolchain and register conventions)
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *cmd/asm, cmd/internal/obj.*
  https://github.com/golang/go/tree/master/src/cmd/asm
  (The implementation that translates the uniform assembly to each architecture's backend)
- This book: [2.2 Stack Frames and Symbols in Assembly](./frame.md) (the `Cas`, `gogo` and
  `morestack` routines), [2.3 Calling Convention and the Register ABI](./callconv.md) (the custom
  ABI), [6.1 Function Calls](../../part2lang/ch06func/func.md).
