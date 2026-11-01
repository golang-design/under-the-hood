---
weight: 1203
title: "2.3 Calling Convention and the Register ABI"
---

# 2.3 Calling Convention and the Register ABI

Here is the simplest possible function. Compile it for linux/amd64 and have the compiler print the
generated assembly (`go build -gcflags=-S`, with lines irrelevant to this section removed):

```go
//go:noinline
func Add(a, b int) int { return a + b }
```

```
main.Add STEXT nosplit size=4 args=0x10 locals=0x0 funcid=0x0 align=0x0
	TEXT	main.Add(SB), NOSPLIT|NOFRAME|ABIInternal, $0-16
	ADDQ	BX, AX
	RET
```

The body is two instructions: add BX to AX, then return. The source does not say where the arguments
`a` and `b` come from or where the result goes; the caller and the callee agree on that beforehand.
The caller puts `a` in AX and `b` in BX, and `Add` leaves the result in AX. The two sides may live
in different packages and be compiled at different times; as long as both follow the same rules,
they can call each other correctly. Such rules are called a **calling convention**. A calling
convention together with the rules for how data is laid out in memory makes up an **application
binary interface** (ABI). The `ABIInternal` in the output above is the name of one of the ABIs Go
uses.

## 2.3.1 Stack-Based and Register-Based Argument Passing

The simplest calling convention passes every argument on the stack: the caller writes the arguments
to the stack in order, and the callee reads them at fixed offsets. The cdecl convention commonly
used by C on 32-bit x86 works this way. Its rules are simple: the stack is almost unlimited in
capacity, every argument has a definite address in memory, and the compiler's implementation is
fairly direct.

The cost is that every argument makes a round trip through memory: written once by the caller and
read once by the callee. Registers are few but far faster to access than memory, and the shorter a
function is and the more often it is called, the larger the share of this overhead. Later calling
conventions therefore mostly pass the first few arguments in registers and use the stack only when
registers run out. C programs on Linux and macOS follow the System V AMD64 ABI on amd64, which
passes integer arguments in 6 registers and floating-point arguments in 8
[[Lu et al., n.d.](#ref-lu-et-al-nd)].

## 2.3.2 Go's Two Conventions

Go originally followed Plan 9 and passed all arguments and results on the stack. The hand-written
assembly in [2.2](./frame.md) reads its arguments as `a+0(FP)`, which follows this convention.

The main obstacle to register-based passing was existing assembly code. The standard library and
many third-party packages contain a great deal of hand-written assembly, all written in terms
of "which byte on the stack holds the argument", and it could not all be rewritten at once. In 2018,
Austin Clements proposed splitting the calling convention in two, one for hand-written assembly and
one for compiler-generated code, with compiler-generated wrapper functions translating between them
[[Clements, 2018](#ref-clements-2018)]:

- **ABI0**: the original convention, with all arguments and results passed on the stack, frozen from
  then on. Hand-written assembly is written to this convention
  [[Go Authors, 2026c](#ref-go-authors-2026c)].
- **ABIInternal**: every function compiled from Go source uses this convention. Internal in the name
  means it is for use inside the Go toolchain only; it may change between versions, and external
  code should not depend on its details [[Go Authors, 2026a](#ref-go-authors-2026a)].

On this basis, Clements and others proposed a register-based calling convention in 2020 as the
concrete content of ABIInternal [[Clements, 2020](#ref-clements-2020)]. Go 1.17 (2021) first enabled
it on linux/amd64, darwin/amd64 and windows/amd64. According to the release notes, a representative
set of Go packages and programs ran about 5% faster as a result, and executables typically shrank by
about 2% [[Go Authors, 2021](#ref-go-authors-2021)]. Go 1.18 extended it to arm64, ppc64/ppc64le and
amd64 on all operating systems, with speedups usually above 10% on arm64 and ppc64
[[Go Authors, 2022a](#ref-go-authors-2022a)]; Go 1.19 added riscv64
[[Go Authors, 2022b](#ref-go-authors-2022b)]. The change does not affect the behavior of any safe Go
code, and user code benefits after a recompile.

The proposal did not adopt each platform's existing C calling convention
[[Clements, 2020](#ref-clements-2020)]. The reasons involve stack management and scheduling, and are
left to the last part of [2.4](./args.md).

## 2.3.3 Register Assignment

On amd64, ABIInternal uses 9 integer registers in order, AX, BX, CX, DI, SI, R8, R9, R10 and R11,
and 15 floating-point registers, X0 through X14 [[Go Authors, 2026a](#ref-go-authors-2026a)]. The
assignment rules can be summarized in four points:

1. The method receiver (if any) is assigned first, then the arguments one by one in order. Each
   argument is decomposed into components of basic types, and each component takes one register: a
   `string` and an interface decompose into two components, a slice into pointer, length and
   capacity, and a struct field by field. Integers and pointers use integer registers;
   floating-point numbers use floating-point registers.
2. An argument goes entirely into registers or entirely on the stack. If the remaining registers
   cannot hold all of its components, the whole argument is passed on the stack, and any registers
   it tentatively took are returned for later arguments.
3. An argument that contains an array of length greater than 1 is passed entirely on the stack.
   Accessing array elements usually requires computing an offset at run time, and registers cannot
   be addressed by a computed offset.
4. Results are assigned by the same rules, with registers starting again from AX and X0.

The table below lists the actual assignment for several functions on linux/amd64 with Go 1.26:

| Function | Arguments | Results |
| --- | --- | --- |
| `func Add(a, b int) int` | `a`→AX, `b`→BX | AX |
| `func Mix(s string, f float64, n int) (int, float64)` | `s`→AX, BX; `f`→X0; `n`→CX | AX, X0 |
| `func (f *File) Write(p []byte) (n int, err error)` | `f`→AX; `p`→BX, CX, DI | `n`→AX; `err`→BX, CX |
| `func Arr(a [2]int, b int) int` | `a`→stack; `b`→AX | AX |
| `func Many(a, b, c, d, e, f, g, h int, s string, t int) int` | `a` through `h`→AX through R10; `s`→stack; `t`→R11 | AX |

The last row best illustrates rule 2. When `main` consists of the single statement
`println(Many(1, 2, 3, 4, 5, 6, 7, 8, "x", 9))`, the code that calls `Many` is as follows (the
register holding the string address varies with context; here it is DX):

```
LEAQ	go:string."x"(SB), DX
MOVQ	DX, (SP)          // pointer of s, written to the stack
MOVQ	$1, 8(SP)         // length of s, written to the stack
MOVL	$1, AX            // a
MOVL	$2, BX            // b
                          // c through g are loaded into CX, DI, SI, R8, R9 in turn
MOVL	$8, R10           // h
MOVL	$9, R11           // t
CALL	main.Many(SB)
```

The 8 `int` arguments take the first 8 registers. `s` needs two registers and only R11 remains, so
`s` as a whole is passed on the stack; `t`, which follows, needs only one register, and R11 happens
to be left for it.

The interactive figure below assigns arguments and results by the same rules. You can pick other
functions or add arguments yourself; "Switch to ABI0" shows the layout of the same function when
everything is passed on the stack.

<div class="viz" data-viz="abi-regassign"></div>

An argument may not be split between registers and the stack because the callee may take the address
of an argument (such as `&s`). In that case the argument must be stored whole in memory; if it had
been passed in pieces, it would first have to be reassembled in memory, at a cost proportional to
its size. As for whether the registers suffice, an appendix to the ABI specification gathers
statistics from the Kubernetes kubelet (v1.18.8): the number of floating-point registers has almost
no effect on the result and is fixed at 8 in the study; with that, 9 integer registers let 92.1% of
functions pass all arguments and results in registers, and adding more integer registers raises that
share only very slowly [[Go Authors, 2026a](#ref-go-authors-2026a)].

## 2.3.4 Converting Between the Two Conventions

When Go code calls an assembly function, the caller puts the arguments in registers while the callee
reads them from the stack, so a conversion is needed between the two, and the compiler does this
work. Before compiling a package, `go build` first runs the assembler with the `-gensymabis` option
to extract, from the `.s` files in the package, the ABI used by each symbol; the compiler reads this
information through the `-symabis` option and uses it to decide how to call those functions.

The `add` below is written in assembly following ABI0, and `main` calls it first directly and then
as a function value:

```go
func add(a, b int) int // body in add_amd64.s, written to ABI0

func main() {
	f := add
	println(add(1, 2), f(3, 4))
}
```

For the direct call, the compiler knows that `add` follows ABI0 and passes the arguments at the call
site according to ABI0:

```
MOVQ	$1, (SP)          // arguments written to the stack
MOVQ	$2, 8(SP)
CALL	main.add(SB)
XORPS	X15, X15          // restore the two registers with fixed meanings
MOVQ	(TLS), R14
MOVQ	16(SP), AX        // read the result from the stack
```

A function value, however, may be called by arbitrary Go code following ABIInternal, so the compiler
generates an extra function that converts between the two conventions
[[Go Authors, 2026b](#ref-go-authors-2026b)]. Compiling with `-gcflags=-d=abiwrap`, the compiler
reports `ABIInternal to ABI0 wrapper for add`, and the generated function is as follows (omitting
the instructions at the start that save BP and allocate the frame and those at the end that restore
them):

```
TEXT	main.add(SB), DUPOK|NOSPLIT|ABIWRAPPER|ABIInternal, $32-16
MOVQ	AX, (SP)          // write the register arguments to the stack
MOVQ	BX, 8(SP)
CALL	main.add(SB)      // call the ABI0 version implemented in assembly
XORPS	X15, X15
MOVQ	(TLS), R14
MOVQ	16(SP), AX        // load the result back into a register
```

Such a function is called an **ABI wrapper**.

Both pieces of code have two extra instructions after the call. ABIInternal gives two registers
fixed meanings: X15 is always zero, which makes bulk-clearing stack frames convenient, and R14
always points to the current goroutine. In ABI0 the values of these two registers are undefined, so
they must be restored when returning from ABI0 code to ABIInternal code; the opposite direction
needs no handling. XORing X15 with itself yields zero; the pointer to the current goroutine is read
again from **thread-local storage** (TLS), which is what `(TLS)` denotes.

In the linked symbol table both versions are present, and the assembly implementation carries the
`.abi0` suffix:

```
$ GOOS=linux GOARCH=amd64 go build -o wrap.bin .
$ go tool nm wrap.bin | grep main.add
  47a7e0 T main.add
  47a7c0 T main.add.abi0
```

## Further Reading

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Go internal ABI
  specification*. `src/cmd/compile/abi-internal.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/abi-internal.md
  https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md The complete rules of
  ABIInternal: the assignment algorithm, frame layout, register usage on each architecture and the
  rationale behind every rule; the appendix contains the kubelet register usage statistics.
- <a id="ref-clements-2020"></a>[Clements, 2020] Austin Clements. "Proposal: Register-based Go
  calling convention." Go proposal 40724, 2020.
  https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md The
  register-passing proposal, explaining why Go did not adopt each platform's C calling convention.
- <a id="ref-clements-2018"></a>[Clements, 2018] Austin Clements. "Proposal: Create an undefined
  internal calling convention." Go proposal 27539, 2018.
  https://go.googlesource.com/proposal/+/master/design/27539-internal-abi.md The design that
  separates ABI0 from ABIInternal and bridges them with wrapper functions.
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.17 Release
  Notes*, "Compiler". https://go.dev/doc/go1.17 Register-based passing enabled on amd64; the roughly
  5% speedup and roughly 2% size reduction come from here.
- <a id="ref-lu-et-al-nd"></a>[Lu et al., n.d.] H.J. Lu, Michael Matz, Milind Girkar, Jan Hubička,
  Andreas Jaeger, Mark Mitchell (eds.). *System V Application Binary Interface, AMD64 Architecture
  Processor Supplement*. https://gitlab.com/x86-psABIs/x86-64-ABI The calling convention C programs
  follow on amd64, for comparison with Go's.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  `cmd/compile/internal/ssagen/abi.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/internal/ssagen/abi.go
  The compiler code that generates ABI wrapper functions (`makeABIWrapper`).
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *A Quick Guide to Go's
  Assembler* (ABI0, pseudo-registers, the stable assembly ABI). https://go.dev/doc/asm
- <a id="ref-go-authors-2022a"></a>[Go Authors, 2022a] The Go Authors. *Go 1.18 Release Notes*,
  "Compiler". https://go.dev/doc/go1.18#compiler
  Register-based passing extended to arm64, ppc64/ppc64le and amd64 on all operating systems.
- <a id="ref-go-authors-2022b"></a>[Go Authors, 2022b] The Go Authors. *Go 1.19 Release
  Notes*, "RISC-V". https://go.dev/doc/go1.19#riscv64 riscv64 switches to register-based passing.
- This book: [2.1 The Plan 9 Assembly Language](./asm.md),
  [2.4 Argument Passing and Stack Frame Layout](./args.md),
  [6.1 Function Calls](../../part2lang/ch06func/func.md).
