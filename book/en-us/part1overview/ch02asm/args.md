---
weight: 1204
title: "2.4 Argument Passing and Stack Frame Layout"
---

# 2.4 Argument Passing and Stack Frame Layout

In [2.3](./callconv.md) the arguments travel in registers, but register values are not durable (the
next function call may overwrite them), and registers have no memory address, so their address
cannot be taken. Even under ABIInternal, therefore, every call still reserves a region on the stack.
This section first explains what that region holds, then analyzes the stack check at the start of
almost every function and how the scheduler uses that check to pause a goroutine, and finally
discusses why Go does not adopt C's calling convention.

## 2.4.1 The Region Reserved on the Stack

Take the example from the Go ABI specification [[Go Authors, 2026a](#ref-go-authors-2026a)]:

```go
func F(a1 uint8, a2 [2]uintptr, a3 uint8) (r1 struct{ x uintptr; y [2]uintptr }, r2 string)
```

By the rules of 2.3, `a1` and `a3` go into AX and BX; `a2` is an array and is passed on the stack;
the result `r1` contains an array and is likewise on the stack; `r2` decomposes into a pointer and a
length, which are returned in AX and BX. The region the caller prepares on the stack, from low
addresses to high, is:

| Offset | Contents | State at the call |
| --- | --- | --- |
| 0 | `a2` (16 bytes) | written by the caller |
| 16 | `r1` (24 bytes) | uninitialized, written by `F` before it returns |
| 40 | 1 byte reserved for `a1` | uninitialized |
| 41 | 1 byte reserved for `a3` | uninitialized |
| 42 | alignment padding (6 bytes) | |

That makes 48 bytes. In the compiler's `-S` output, the first line for `F` is
`main.F STEXT nosplit size=53 args=0x30 ...`, where `0x30` is 48.

The last rows of the table deserve attention: although the arguments travel in registers, the caller
still reserves a slot on the stack for each register argument, without writing to it. This region is
called the arguments' **spill space**, and it is used in the following cases:

- When `F` needs to grow the stack (2.4.2), it must first save the register arguments to memory. At
  that point `F`'s own stack is nearly exhausted and may have no room for them, while the region
  reserved by the caller is already there.
- When `F` takes the address of an argument (such as `&a1`), the argument needs a fixed memory
  location.
- An argument that must be spilled to memory for any other reason is also stored here. When the
  runtime prints a call stack, it reads argument values from here; if an argument has not been
  written back since, the printed value may be stale, and the runtime marks it with a trailing `?`.

The cost is some extra stack usage. By the ABI specification's estimate, the median waste is 16
bytes per call; the specification lists removing the reserved spill space entirely as a long-term
goal [[Go Authors, 2026a](#ref-go-authors-2026a)].

Which registers keep their values across a call is also part of a calling convention. C's
conventions define a set of **callee-saved registers**: a callee that uses them must restore their
original values before returning. ABIInternal has no such registers: apart from the registers with
fixed meanings listed in the table below, any register may be overwritten during a call, and a
caller that still needs a value after the call must save it on the stack itself. The ABI
specification notes that this design significantly simplifies the garbage collector and the
compiler's register allocator, at the cost of some performance
[[Go Authors, 2026a](#ref-go-authors-2026a)]. For the garbage collector, scanning a stack does not
require tracking which pointer was parked in which register by which frame. The registers with fixed
meanings on amd64 are:

| Register | Meaning |
| --- | --- |
| SP | stack pointer |
| BP | frame pointer, used by debuggers and profilers to walk the call chain |
| R14 | points to the current goroutine |
| X15 | always zero at calls and returns |

In addition, DX carries the closure context pointer when a closure is called, but this meaning holds
only at the moment of the call.

## 2.4.2 The Stack Check at Function Entry

A goroutine's stack starts small and is replaced by a larger one when it runs short. A new
goroutine's stack starts at 2 KiB; since Go 1.19 the runtime also computes the average stack usage
of goroutines in each garbage collection cycle and uses it to adjust the initial stack size of
goroutines reused from the free list [[Go Authors, 2022](#ref-go-authors-2022)]
([14.2.5](../../part4memory/ch14stack/alloc.md)). Almost every function therefore begins by
confirming that enough stack space remains. The recursive function `Deep` below has one argument `n`
and a 16-byte array among its locals:

```go
//go:noinline
func Deep(n int) int {
	var buf [2]int
	buf[n&1] = n
	if n == 0 {
		return buf[0]
	}
	return Deep(n-1) + buf[1]
}
```

Compiled for linux/amd64, the start and end of the function look like this (the middle is omitted):

```
TEXT	main.Deep(SB), ABIInternal, $32-8
CMPQ	SP, 16(R14)                    // compare with the current goroutine's guard
JLS	69                             // not above the guard: jump to the end to grow the stack
PUSHQ	BP                             // check passed: save BP, allocate space for locals
MOVQ	SP, BP
SUBQ	$24, SP
...
MOVQ	AX, 8(SP)                      // offset 69: store argument n from AX in the spill space reserved by the caller
CALL	runtime.morestack_noctxt(SB)   // switch to a larger stack
MOVQ	8(SP), AX                      // fetch n back
JMP	0                              // return to the start and check again
```

The 32-byte frame has three parts: 8 bytes to save BP, 16 bytes for the array `buf`, and 8 bytes of
spill space reserved for the argument of the call to `Deep(n-1)`.

The instructions at the start of a function that do this preparation are called the **function
prologue**. R14 points to the current goroutine's `g` struct, and at offset 16 sits the goroutine's
**stack guard** (the field `stackguard0`). Once SP is not above the guard, the function jumps to its
end: it first saves the register arguments in the spill space described in 2.4.1, then calls
`morestack` ([2.2](./frame.md)) to switch stacks, then fetches the arguments back and returns to the
start to check again.

The guard is not at the very bottom of the stack but 928 bytes above it (on linux/amd64). Of these,
800 bytes are for chains of `NOSPLIT` functions, which do no check (the linker verifies that such
call chains stay within this limit); the other 128 bytes let a function with a frame of at most 128
bytes compare SP with the guard directly, without first subtracting its own frame size
[[Go Authors, 2026b](#ref-go-authors-2026b)]. A function with a larger frame needs one more step of
computation; when the frame exceeds 4096 bytes, subtracting the frame size from SP may also wrap
around, so the borrow must be checked as well. The two functions below have local arrays of 1 KiB
and 8 KiB respectively:

```
TEXT	main.Medium(SB), ABIInternal, $1040-0
LEAQ	-912(SP), R12                  // 912 = 1040 - 128
CMPQ	R12, 16(R14)

TEXT	main.Huge(SB), ABIInternal, $8208-0
MOVQ	SP, R12
SUBQ	$8080, R12                     // 8080 = 8208 - 128
JCS	63                             // borrow occurred (SP below 8080): go straight to growing the stack
CMPQ	R12, 16(R14)
```

Another class of functions omits the check entirely. In the output for `Add` at the start of
[2.3](./callconv.md), the function is marked `NOSPLIT` although the source made no such request. On
amd64, if a function's frame is smaller than 128 bytes and it calls no function other than a few
argument-less runtime functions (such as `runtime.panicBounds`, which reports an out-of-range
index), the stack it uses cannot go beyond the margin reserved below the guard, so
`cmd/internal/obj` marks it `NOSPLIT` automatically and skips the check
[[Go Authors, 2026b](#ref-go-authors-2026b)].

To grow the stack, the runtime allocates a new stack twice the size of the old one, copies the whole
contents of the old stack over, and then adjusts the pointers on the stack that point into the stack
([14.3](../../part4memory/ch14stack/grow.md)). The program below deepens a recursion step by step in
a new goroutine and watches the address of a local variable: when the stack moves, the address
changes.

```go {run=true}
package main

import (
	"fmt"
	"unsafe"
)

//go:noinline
func down(n int) {
	if n > 0 {
		down(n - 1)
	}
}

func main() {
	done := make(chan bool)
	go func() { // the new goroutine's stack starts at 2 KiB
		var x int // the address of x changes when the stack moves
		old, last := uintptr(unsafe.Pointer(&x)), 0
		for depth := 1; depth <= 1000; depth++ {
			down(depth)
			if now := uintptr(unsafe.Pointer(&x)); now != old {
				fmt.Printf("stack moved at depth %3d, %3d levels deeper than last time\n", depth, depth-last)
				old, last = now, depth
			}
		}
		done <- true
	}()
	<-done
}
```

On darwin/arm64 the output is:

```
stack moved at depth  29,  29 levels deeper than last time
stack moved at depth  93,  64 levels deeper than last time
stack moved at depth 221, 128 levels deeper than last time
stack moved at depth 477, 256 levels deeper than last time
stack moved at depth 989, 512 levels deeper than last time
```

The number of extra recursion levels between consecutive moves doubles each time: 64, 128, 256, 512.
On this machine, each level of `down` takes 32 bytes, so 64 levels is exactly 2 KiB. The stack moved
5 times, growing to 4 KiB, 8 KiB, 16 KiB, 32 KiB and 64 KiB in turn; the space added each time
equals the size of the old stack, which corresponds to the extra levels in the next stretch. When
run on the web page, the program is compiled to WebAssembly, each level takes only 16 bytes, and the
output becomes 58, 186, 442 and 954 levels, with gaps of 128, 256 and 512 levels, again doubling.
Because the stack size doubles each time, the bytes copied across all moves sum to no more than the
final stack size, so the total cost of growing is proportional to the final stack size.

## 2.4.3 Preemption Borrows the Same Check

When a goroutine has been running continuously for more than 10 milliseconds, system monitoring
([9.8](../../part3concurrency/ch09sched/sysmon.md)) asks it to yield the processor so that other
goroutines get a chance to run. The most direct approach borrows the stack check above: set the
goroutine's guard to a value larger than any stack address. At its next function call the check
necessarily fails and execution enters `morestack`. The runtime sees that the guard holds this
special value, concludes that the stack is not actually short, and so does not grow it; instead it
yields the processor as if `runtime.Gosched` had been called, and the guard is restored to its
original value when the goroutine is scheduled again [[Go Authors, 2026c](#ref-go-authors-2026c)].

```go
// runtime/proc.go, preemptone (excerpt; the comment is a translation)
gp.preempt = true
// Every call checks the stack pointer against gp.stackguard0 to detect stack overflow.
// Setting it to stackPreempt folds preemption into the regular stack overflow check.
gp.stackguard0 = stackPreempt // 0xfffffffffffffade on 64-bit platforms
```

This approach adds no instructions to the code, but its limitation is clear: it takes effect only at
function calls. A loop that calls no function never performs the check, and before Go 1.14 such a
loop could occupy the processor indefinitely. Go 1.14 introduced asynchronous preemption based on
operating system signals [[Clements, 2019](#ref-clements-2019)]; `preemptone` issues that request
right after setting the guard, as detailed in [9.7](../../part3concurrency/ch09sched/preemption.md).

## 2.4.4 Why Not C's Calling Convention

C and C++ programs on Linux follow one platform calling convention and can call each other directly.
The register-passing proposal for Go (2.3) explicitly chose not to adopt the platform convention
[[Clements, 2020](#ref-clements-2020)], for two reasons.

First, the benefit of sharing a convention is limited. Intuitively, sharing the convention with C
should lower the cost of calling C functions; but goroutine stacks grow and shrink dynamically, and
scheduling is done by the Go runtime rather than the operating system, so a call into non-Go code
must switch to a fixed stack and notify the scheduler whether or not the conventions agree.
Debuggers and profilers generally rely on DWARF debug information or frame pointers to walk the
stack, and they work with Go even though it does not adopt the platform convention.

Second, C's convention does not suit Go. The ELF ABIs for x86-64, arm64 and RISC-V do not pass
aggregates larger than two words in registers, so a slice, which is three words, can only be passed
in memory; these conventions usually reserve at most two registers for return values, while Go
functions often return a result plus an `error` of two words, three words in total. The callee-saved
registers in platform conventions place an extra burden on the garbage collector (2.4.1). Moreover,
the platform conventions differ from one another in the details, and defining its own convention
lets Go use the same structure on all architectures [[Clements, 2020](#ref-clements-2020)].

A self-defined convention also provides conveniences that platform conventions lack: R14 always
points to the current goroutine, so the function prologue reads the guard with a single instruction;
X15 is always zero; and multiple return values can all be placed in registers. More important,
ABIInternal is maintained by the compiler, the runtime and the assembler together in one code base
and can evolve with the releases: Go 1.17 moved arguments from the stack to registers with no change
to user code, and removing the reserved spill space of 2.4.1 in the future would work the same way.

The cost shows up when interacting with C. Calling a C function through cgo requires switching from
the goroutine's stack to the thread's `g0` stack (C code does no stack checks, and pointers on its
stack cannot be adjusted when a stack moves), rearranging the arguments according to C's convention,
saving and restoring registers, and notifying the scheduler that the thread is temporarily outside
the Go runtime's management. A cgo call therefore costs far more than an ordinary Go function call,
as detailed in [15.6](../../part5toolchain/ch15compile/cgo.md).

## Further Reading

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Go internal ABI
  specification*. `src/cmd/compile/abi-internal.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/abi-internal.md
  https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md Frame layout, the
  rationale for the spill space, the registers with fixed meanings, and the improvement ideas in
  the "Future directions" section.
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `runtime/stack.go` and
  `cmd/internal/obj/x86/obj6.go` (`stacksplit`).
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/internal/obj/x86/obj6.go
  https://github.com/golang/go/tree/master/src/runtime (`runtime/stack.go`, `preempt.go`,
  `internal/abi/stack.go`) How the guard size is derived, how the three kinds of check in the
  prologue are generated, and which functions may omit the check.
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. `runtime/preempt.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/preempt.go The comment at the
  top of the file describes the various preemption points and how preemption borrows the stack
  check.
- <a id="ref-clements-2019"></a>[Clements, 2019] Austin Clements. "Proposal: Non-cooperative
  goroutine preemption." Go proposal 24543, 2019.
  https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md Why
  checks at function calls alone are not enough, and how Go 1.14's signal-based preemption is
  designed.
- <a id="ref-clements-2020"></a>[Clements, 2020] Austin Clements. "Proposal: Register-based Go
  calling convention." Go proposal 40724, 2020.
  https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md It compares the
  pros and cons of adopting the platform convention versus defining a convention of Go's own.
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *Go 1.19 Release
  Notes*, "Runtime". https://go.dev/doc/go1.19#runtime The initial stack size of new goroutines is
  now based on historical average usage.
- This book: [2.1 The Plan 9 Assembly Language](./asm.md),
  [2.3 Calling Convention and the Register ABI](./callconv.md),
  [6.1 Function Calls](../../part2lang/ch06func/func.md),
  [14 Execution Stack Management](../../part4memory/ch14stack),
  [9.7 Cooperation and Preemption](../../part3concurrency/ch09sched/preemption.md),
  [15 The Compiler Pipeline](../../part5toolchain/ch15compile).
