---
weight: 1202
title: "2.2 Stack Frames and Symbols in Assembly"
---

# 2.2 Stack Frames and Symbols in Assembly

[2.1](./asm.md) gave the pseudo-registers and addressing syntax of Plan 9 assembly, which is about "how to write one line of assembly". This section raises our view to a complete routine: how a hand-written assembly function declares its own symbol with `TEXT ·name(SB)`, how it states its stack frame size with `$framesize-argsize`, and what `NOSPLIT` means. We will match these conventions point by point against three real routines in the runtime (`Cas`, `gogo`, `morestack`), and once you finish reading, the assembly symbols in the chapters on the scheduler and stack management turn from gibberish into readable, on-the-spot operations.

## 2.2.1 From Go Source to Plan 9 Assembly: A Slot-by-Slot Mapping of CAS

Let us ground the abstraction. The runtime's atomic compare-and-swap `Cas` is hand-written assembly on amd64, and its Go prototype lines up field by field with the assembly implementation, making it a good sample for observing "how Go source maps to Plan 9 assembly". The Go side carries only a declaration (the function body lives in a `.s` file):

```go
// internal/runtime/atomic: declaration only, the implementation is in atomic_amd64.s
//
//	if *ptr == old { *ptr = new; return true } else { return false }
func Cas(ptr *uint32, old, new uint32) bool
```

The corresponding amd64 implementation:

```asm
// internal/runtime/atomic/atomic_amd64.s
TEXT ·Cas(SB), NOSPLIT, $0-17
	MOVQ	ptr+0(FP), BX      // BX = ptr        (pointer, 8 bytes, offset 0)
	MOVL	old+8(FP), AX      // AX = old        (int32, 4 bytes, offset 8)
	MOVL	new+12(FP), CX     // CX = new        (int32, 4 bytes, offset 12)
	LOCK
	CMPXCHGL	CX, 0(BX)  // atomic: if *ptr==AX then *ptr=CX
	SETEQ	ret+16(FP)         // if equal, write 1 back to the return-value slot (offset 16)
	RET
```

Matching it point by point lets us read the code, and also feel what FP does:

- `TEXT ·Cas(SB)` declares the global symbol `Cas` using SB; `·` is the package-name separator, which the toolchain completes to `internal/runtime/atomic.Cas`. The function name is given as an offset from SB, exactly the role of SB in 2.1.2.
- `$0-17` is the frame-size statement: **local frame of 0 bytes, arguments plus return value totaling 17 bytes**. `17 = 8 + 4 + 4 + 1`, exactly the sum of `*uint32` (8), two `uint32` (4 each), and the `bool` return value (1). `NOSPLIT` means this code inserts no stack-growth check and will not itself trigger `morestack`.
- The three `MOVx ...(FP)` instructions move the three **arguments** from the caller's stack frame into registers; offsets 0, 8, 12 correspond one to one with the layout of the parameters in the Go signature. `MOVQ` moves 8 bytes (a pointer), `MOVL` moves 4 bytes (an int32); the suffix encodes the operand width (B/W/L/Q correspond to 1/2/4/8 bytes).
- `LOCK` is not an instruction but a **prefix** that modifies the next instruction; it makes `CMPXCHGL` atomically take exclusive hold of the target cache line on a multi-core machine. `CMPXCHGL` implicitly uses AX as the comparison baseline: if `*ptr == AX` it writes CX and sets the flag.
- `SETEQ ret+16(FP)` writes 1 or 0 back to the **return-value slot** based on the flag; offset 16 sits right at the end of the 17-byte region.

Worth remembering is that this assembly is written with the syntax once, yet has a separate back-end implementation per architecture: the `atomic_*.s` files for 386, arm64, and riscv64 each use the same `·Cas(SB)` and the same `ptr+0(FP)` style, landing on each architecture's real atomic instructions. This is what "one syntax, many back ends" from 2.1.1 looks like at the smallest scale.

## 2.2.2 Two Places Where the Runtime Drops Down to Assembly: gogo and morestack

CAS showed "the calling convention plus one special instruction". The stack switch in the scheduler shows the **one thing only assembly can do**: move the entire execution context elsewhere. Go saves a goroutine's context (SP, PC, the g pointer, and so on) in a `gobuf` structure, and the job of `gogo` is to restore some `gobuf` into the real registers, thereby "jumping into" that goroutine:

```asm
// runtime/asm_amd64.s (trimmed: the g != nil check and experimental branches omitted)
TEXT gogo<>(SB), NOSPLIT, $0
	get_tls(CX)
	MOVQ	DX, g(CX)            // write the target g back to TLS
	MOVQ	DX, R14              // R14 is always the current g (regabi convention)
	MOVQ	gobuf_sp(BX), SP     // restore the stack pointer: the stack switch happens in this one line
	MOVQ	gobuf_bp(BX), BP     // restore the frame base
	MOVQ	gobuf_pc(BX), BX     // fetch the target PC
	JMP	BX                       // jump there; from now on the CPU runs on the new goroutine
```

The key is `MOVQ gobuf_sp(BX), SP` and the trailing `JMP BX`: one line swaps the stack pointer, one line swaps the program counter, and the CPU's execution context migrates wholesale from one goroutine to another. This kind of operation, "reading and writing SP/PC as if they were ordinary data", has no counterpart at all in high-level languages and can only be done down at the assembly level. As an aside, `R14` always equaling the current g is part of the `<ABIInternal>` register calling convention; the calling convention itself is detailed in [2.3](./callconv.md), and here we only need to know that it explains why the assembly can use `R14` directly to fetch the current goroutine.

The other place is `morestack`, the prologue of stack growth. Go's stack grows on demand ([14](../../part4memory/ch14stack)); the compiler inserts a check at the function entry, and when it finds the stack insufficient it jumps here. `morestack` must save the **current function's context** into `g.sched` before switching to the g0 system stack, otherwise the context is lost the moment the stack is moved:

```asm
// runtime/asm_amd64.s (trimmed essentials)
TEXT runtime·morestack(SB), NOSPLIT|NOFRAME, $0-0
	get_tls(CX)
	MOVQ	g(CX), DI                       // DI = current g
	MOVQ	g_m(DI), BX                      // BX = m
	MOVQ	0(SP), AX                        // fetch the PC of the function being grown (bare 0(SP): hardware SP)
	MOVQ	AX, (g_sched+gobuf_pc)(DI)       // store into g.sched.pc
	LEAQ	8(SP), AX                        // compute its SP
	MOVQ	AX, (g_sched+gobuf_sp)(DI)       // store into g.sched.sp
	// ... switch to the m.g0 stack, finally CALL runtime·newstack(SB) to finish growth and reschedule
```

Note that here `0(SP)` and `8(SP)` are both **bare offsets** using the hardware SP (the trap from 2.1.2): `morestack` reads the return address directly on the machine stack, so it must use the real stack pointer rather than the pseudo SP. It often appears in the form `morestack_noctxt`, which is nothing more than a two-line thin wrapper that first zeroes the context register and then jumps into `morestack`:

```asm
TEXT runtime·morestack_noctxt(SB), NOSPLIT, $0
	MOVL	$0, DX
	JMP	runtime·morestack(SB)
```

Once you grasp these two passages, the "save/restore context" that recurs throughout the scheduling and stack-management chapters is no longer mysterious: they all amount to arranging PC, SP, and a few convention registers precisely at the assembly level.

## 2.2.3 Its Role and Trade-offs in This Book

[2.1](./asm.md) and this section together form a reading vocabulary, not an assembly tutorial. Go chooses to maintain its own Plan 9-style cross-architecture assembler rather than reuse an off-the-shelf tool like GNU as, and this is a clear engineering trade-off: the **cost** is keeping yet another assembler, linker, and object-file format, with a new back end to add for each new architecture; the **benefit** is full control over code generation, calling conventions, stack layout, and coordination with the runtime, and making "one toolchain cross-compiling to all architectures" possible. Performance and controllability never come for free; their price is exactly the long-term maintenance burden of this in-house infrastructure. This is of a piece with the trade-off in [2.3 Calling Conventions](./callconv.md) of choosing a custom ABI and in [6.1](../../part2lang/ch06func/func.md) of managing function calls in-house; all three are the same "build it yourself for the sake of control" design posture.

Treat these two sections as scaffolding for later reading. When [9.4](../../part3concurrency/ch09sched/schedule.md) uses `gogo`/`mcall` to switch goroutines, when [9.6](../../part3concurrency/ch09sched/signal.md) saves context inside a signal, and when [14](../../part4memory/ch14stack) discusses stack growth, the reader knows what abstraction layer those assembly symbols live in: FP fetches arguments, SP fetches locals, SB fetches globals, PC governs jumps, all translated by Go's own toolchain to real hardware. Armed with this vocabulary, those few lowest-level pages of the runtime become readable.

## Further Reading

1. The Go Authors. *runtime/asm_amd64.s, internal/runtime/atomic.* https://github.com/golang/go/tree/master/src/runtime
   (the source of `gogo`/`morestack`/`Cas` in this section)
2. The Go Authors. *Debugging Go Code with GDB.* https://go.dev/doc/gdb
   (debugging by matching assembly against the runtime context)
3. This book: [2.1 Plan 9 Assembly Language](./asm.md), [2.3 Calling Conventions and the Register ABI](./callconv.md) (custom ABI),
   [6.1 Function Calls](../../part2lang/ch06func/func.md),
   [9.4 The Scheduling Loop](../../part3concurrency/ch09sched/schedule.md) (gogo/mcall stack switching),
   [14 Stack Management](../../part4memory/ch14stack) (morestack and stack growth).
