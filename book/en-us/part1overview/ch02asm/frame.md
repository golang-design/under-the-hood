---
weight: 1202
title: "2.2 Stack Frames and Symbols in Assembly"
---

# 2.2 Stack Frames and Symbols in Assembly

The atomic operation `Cas` in the runtime is implemented on amd64 by an assembly function whose
first line is:

```asm
TEXT ·Cas(SB), NOSPLIT, $0-17
```

To read this line and the code after it, you first need to know what happens on the stack during a
function call. This section first draws the stack layout from a real disassembly, then uses it to
read `Cas`, and finally reads two pieces of runtime code that write the stack pointer and the
program counter directly.

## 2.2.1 Stack Frame Layout

The amd64 `CALL` instruction does two things: it pushes the return address (the address of the
instruction after `CALL`) onto the stack, decrementing SP by 8, and then jumps to the target
function. `RET` does the reverse: it pops the return address off the stack and jumps back. Once the
callee starts, it usually pushes the old value of the BP register and then lowers SP to reserve
space for local variables. Go enables a **frame pointer** on amd64: BP always points to a fixed
position in the current function's frame, and the saved BP values in successive frames form a linked
list. Debuggers and profilers follow this list to walk the call chain frame by frame.

The region that one function call occupies on the stack is called a **stack frame**. The calling
convention that hand-written assembly follows (see [2.3](./callconv.md)) passes arguments and
results on the stack: before executing `CALL`, the caller writes them at the bottom of its own
frame, next to the return address. The assembly function below has two arguments, one result and 24
bytes of local variables:

```asm
// func frame(a, b int) int
TEXT ·frame(SB), $24-24
	MOVQ	a+0(FP), AX     // argument a
	MOVQ	b+8(FP), BX     // argument b
	MOVQ	AX, x-8(SP)     // with a name: pseudo-register SP, local variable x
	MOVQ	BX, 0(SP)       // without a name: hardware SP
	ADDQ	BX, AX
	MOVQ	AX, ret+16(FP)  // result
	RET
```

`$24-24` declares the frame size: before the hyphen is the number of bytes of local variables, and
after it the combined size of arguments and results (`a`, `b` and `ret` take 8 bytes each). The
hyphen is only a separator and does not denote subtraction
[[Go Authors, 2026a](#ref-go-authors-2026a)].

Cross-compiled on darwin/arm64 for linux/amd64 and disassembled with `go tool objdump`, the result
is:

```
PUSHQ BP              // inserted by the assembler: save the old BP
MOVQ SP, BP
SUBQ $0x18, SP        // inserted by the assembler: reserve 24 bytes for locals
MOVQ 0x28(SP), AX     // a+0(FP)
MOVQ 0x30(SP), BX     // b+8(FP)
MOVQ AX, 0x10(SP)     // x-8(SP)
MOVQ BX, 0(SP)        // 0(SP)
ADDQ BX, AX
MOVQ AX, 0x38(SP)     // ret+16(FP)
ADDQ $0x18, SP        // inserted by the assembler: release the locals
POPQ BP
RET
```

The first three and last two lines, absent from the source, were inserted by the assembler.
Converting each notation to a position relative to the hardware SP gives the following stack layout:

| Position | Contents | Notation in assembly |
| --- | --- | --- |
| `SP+0x38` | result | `ret+16(FP)` |
| `SP+0x30` | argument `b` | `b+8(FP)` |
| `SP+0x28` | argument `a` | `a+0(FP)`; the pseudo-register FP points here |
| `SP+0x20` | return address | pushed by `CALL` |
| `SP+0x18` | old value of BP | the pseudo-register SP points here |
| `SP+0x10` | local variable `x` | `x-8(SP)` |
| `SP+0x08` | local variable | |
| `SP+0x00` | local variable | `0(SP)`; the hardware SP points here |

The top three rows of the table lie in the caller's frame and the bottom five belong to this
function's frame. `x-8(SP)` and `0(SP)` look as if they differ only by a name, but they are 16 bytes
apart; the pseudo-register SP sits 24 bytes above the hardware SP, exactly the space taken by the
local variables.

This function has no stack check at its start. It calls no other function and its locals take fewer
than 128 bytes, so the assembler concludes that the stack it uses cannot exceed the reserved margin
and omits the check. What the check does and where the margin comes from are covered in
[2.4](./args.md).

## 2.2.2 Reading `Cas`

With this layout in hand, `Cas` is not hard to follow. In Go it is only declared; its body lives in
an assembly file:

```go
// internal/runtime/atomic/stubs.go
// Atomically executes: if *ptr == old { *ptr = new; return true } else { return false }
func Cas(ptr *uint32, old, new uint32) bool
```

```asm
// internal/runtime/atomic/atomic_amd64.s
TEXT ·Cas(SB),NOSPLIT,$0-17
	MOVQ	ptr+0(FP), BX      // BX = ptr (a pointer is 8 bytes, offset 0)
	MOVL	old+8(FP), AX      // AX = old (a uint32 is 4 bytes, offset 8)
	MOVL	new+12(FP), CX     // CX = new (a uint32 is 4 bytes, offset 12)
	LOCK
	CMPXCHGL	CX, 0(BX)      // if *ptr equals AX, store CX into *ptr and set the ZF flag
	SETEQ	ret+16(FP)         // write 1 if ZF is set, 0 otherwise
	RET
```

The details, item by item:

- `TEXT ·Cas(SB)` declares the function `Cas` in the current package, that is,
  `internal/runtime/atomic.Cas`.
- `NOSPLIT` tells the assembler not to insert the stack check at the start of the function. Such
  functions may use very little stack, and the linker checks the call chains formed by them to
  ensure their combined stack use stays within the margin.
- `$0-17`: no local variables; the arguments and result total 17 bytes: 8 for the pointer, 4 for
  each `uint32`, and 1 for the `bool` result. Offsets 0, 8, 12 and 16 are exactly where they sit,
  packed one after another. The `asmdecl` checker of `go vet` computes these offsets from the Go
  declaration and checks them one by one against the assembly
  [[Go Authors, 2026c](#ref-go-authors-2026c)].
- `MOVQ` moves 8 bytes and `MOVL` moves 4, matching the sizes of the arguments.
- The `LOCK` prefix applies to the next instruction. It guarantees that the comparison and the write
  of `CMPXCHGL` complete as one atomic operation on a multicore machine, so no other core observes
  an intermediate state [[Intel, n.d.](#ref-intel-nd)].

On arm64, `Cas` lives in `atomic_arm64.s`. Its declaration is likewise `$0-17`, and the arguments
are fetched the same way, as `ptr+0(FP)` and `old+8(FP)`; only the instructions in between are arm64
instructions. What the architectures share is the function declaration, the frame size and the
notation for arguments; the instructions themselves differ.

## 2.2.3 SP and PC as Data: `gogo` and `morestack`

When a goroutine pauses, the runtime saves the values of its SP, PC and other registers in a small
struct named `gobuf`; resuming the goroutine means loading these values back into the registers.
This is exactly what `gogo` does (excerpt from `runtime/asm_amd64.s`
[[Go Authors, 2026b](#ref-go-authors-2026b)]):

```asm
TEXT gogo<>(SB), NOSPLIT, $0      // BX points to the target goroutine's gobuf
	// ... first make the current goroutine the target goroutine
	MOVQ	gobuf_sp(BX), SP       // switch stacks
	MOVQ	gobuf_bp(BX), BP
	MOVQ	gobuf_pc(BX), BX
	JMP	BX                         // jump to where the target goroutine last paused
```

One `MOVQ` replaces the stack, and one `JMP` replaces the next instruction to execute. From this
moment the processor runs another goroutine's code on another stack. These two steps cannot be
expressed in the Go language, so `gogo` can only be implemented in assembly.

`morestack` is called when a goroutine's stack is about to run out ([2.4](./args.md)). It must first
record the function that called it (call it f) and its execution position, so that it can return
there and continue once a larger stack is in place:

```asm
TEXT runtime·morestack(SB),NOSPLIT|NOFRAME,$0-0
	// ... DI points to the current goroutine's g
	MOVQ	0(SP), AX                    // the top of the stack is the return address, f's execution position
	MOVQ	AX, (g_sched+gobuf_pc)(DI)   // save it as f's PC
	LEAQ	8(SP), AX                    // skipping the return address gives f's SP
	MOVQ	AX, (g_sched+gobuf_sp)(DI)   // save it as f's SP
	// ... switch to the current thread's g0 stack
	CALL	runtime·newstack(SB)         // allocate a larger stack and move the old contents over
```

Here `0(SP)` and `8(SP)` carry no name and refer to the hardware SP. `NOFRAME` means `morestack`
sets up no frame of its own, so on entry SP points exactly at the return address just pushed by
`CALL`, which can be read directly. The original stack is nearly exhausted and `morestack` cannot
keep running on it, so it switches to the current thread's `g0` stack ([3.5](../ch03life/boot.md))
and then calls `newstack`, which is implemented in Go.

Most of the assembly in the chapters on scheduling
([9.4](../../part3concurrency/ch09sched/schedule.md)), signals
([9.6](../../part3concurrency/ch09sched/signal.md)) and stacks
([Chapter 14](../../part4memory/ch14stack/readme.md)) takes one of these two forms: it accesses
arguments through `FP`, or it reads and writes SP and PC as ordinary data. In GDB you can
disassemble against the source and inspect each goroutine's call stack, reading this assembly side
by side with the runtime's live state [[Go Authors, 2026d](#ref-go-authors-2026d)].

## Further Reading

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. "A Quick Guide to Go's
  Assembler." https://go.dev/doc/asm The official description of `TEXT`, frame sizes, flags such as
  `NOSPLIT`, and the pseudo-registers.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `runtime/asm_amd64.s`,
  `internal/runtime/atomic/atomic_amd64.s`, `runtime/textflag.h`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/asm_amd64.s
  https://github.com/golang/go/tree/master/src/runtime The source of `gogo`, `morestack` and `Cas`
  in this section; `textflag.h` lists all flags, including `NOSPLIT`.
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. The `asmdecl` checker.
  https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/asmdecl With it, `go vet` checks that
  argument names and offsets in assembly agree with the Go declaration.
- <a id="ref-intel-nd"></a>[Intel, n.d.] Intel. *Intel 64 and IA-32 Architectures Software
  Developer's Manual*, Volume 2, "CMPXCHG" and "LOCK".
  https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html The original
  description of `LOCK CMPXCHG`.
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Debugging Go Code with GDB.*
  https://go.dev/doc/gdb
  (Debugging assembly against the runtime's live state)
- This book: [2.1 The Plan 9 Assembly Language](./asm.md),
  [2.3 Calling Convention and the Register ABI](./callconv.md) (the custom ABI),
  [6.1 Function Calls](../../part2lang/ch06func/func.md),
  [9.4 The Scheduling Loop](../../part3concurrency/ch09sched/schedule.md) (stack switching in
  gogo/mcall), [14.3 Stack Growth](../../part4memory/ch14stack/grow.md) (morestack and stack
  growth).
