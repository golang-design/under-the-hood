---
weight: 1202
title: "2.2 汇编中的栈帧与符号"
---

# 2.2 汇编中的栈帧与符号

运行时中的原子操作 `Cas` 在 amd64 上由一个汇编函数实现，其第一行是：

```asm
TEXT ·Cas(SB), NOSPLIT, $0-17
```

要读懂这一行及其后的代码，首先需要了解函数调用时栈上发生的变化。本节先以一段真实的反汇编画出栈的
布局，再据此阅读 `Cas`，最后阅读运行时中两段直接改写栈指针与程序计数器的代码。

## 2.2.1 栈帧的布局

amd64 的 `CALL` 指令完成两件事：把返回地址（`CALL` 的下一条指令的地址）压入栈中，SP 随之减 8；然后
跳转到目标函数。`RET` 的操作与之相反，从栈中弹出返回地址并跳回。被调函数开始执行后，通常先把 BP
寄存器的旧值压入栈中，再下移 SP，为局部变量预留空间。Go 在 amd64 上启用了**帧指针**（frame
pointer）：BP 始终指向当前函数栈帧中的固定位置，各层栈帧中保存的 BP 构成一条链表，调试器和性能剖析
工具沿着这条链表即可逐层回溯调用关系。

一次函数调用在栈上占用的区域称为**栈帧**（stack frame）。手写汇编所遵循的调用约定（见
[2.3](./callconv.md)）通过栈传递参数和返回值：调用方在执行 `CALL` 之前，把它们写在自身栈帧的底部，
紧邻返回地址。下面的汇编函数有两个参数、一个返回值和 24 字节的局部变量：

```asm
// func frame(a, b int) int
TEXT ·frame(SB), $24-24
	MOVQ	a+0(FP), AX     // 参数 a
	MOVQ	b+8(FP), BX     // 参数 b
	MOVQ	AX, x-8(SP)     // 带名字：伪寄存器 SP，局部变量 x
	MOVQ	BX, 0(SP)       // 不带名字：硬件 SP
	ADDQ	BX, AX
	MOVQ	AX, ret+16(FP)  // 返回值
	RET
```

`$24-24` 声明栈帧的大小：减号之前是局部变量所占的字节数，减号之后是参数与返回值合计的字节数（`a`、
`b`、`ret` 各 8 字节）。中间的减号只是分隔符，并不表示减法 [[Go Authors, 2026a](#ref-go-authors-2026a)]。

在 darwin/arm64 上交叉编译到 linux/amd64，再用 `go tool objdump` 反汇编，结果如下：

```
PUSHQ BP              // 汇编器插入：保存 BP 的旧值
MOVQ SP, BP
SUBQ $0x18, SP        // 汇编器插入：为局部变量预留 24 字节
MOVQ 0x28(SP), AX     // a+0(FP)
MOVQ 0x30(SP), BX     // b+8(FP)
MOVQ AX, 0x10(SP)     // x-8(SP)
MOVQ BX, 0(SP)        // 0(SP)
ADDQ BX, AX
MOVQ AX, 0x38(SP)     // ret+16(FP)
ADDQ $0x18, SP        // 汇编器插入：释放局部变量的空间
POPQ BP
RET
```

源码中没有出现的前三行和最后两行由汇编器插入。把每个记号换算为相对硬件 SP 的位置，栈的布局如下：

| 位置 | 内容 | 汇编中的写法 |
| --- | --- | --- |
| `SP+0x38` | 返回值 | `ret+16(FP)` |
| `SP+0x30` | 参数 `b` | `b+8(FP)` |
| `SP+0x28` | 参数 `a` | `a+0(FP)`，伪寄存器 FP 指向此处 |
| `SP+0x20` | 返回地址 | 由 `CALL` 压入 |
| `SP+0x18` | BP 的旧值 | 伪寄存器 SP 指向此处 |
| `SP+0x10` | 局部变量 `x` | `x-8(SP)` |
| `SP+0x08` | 局部变量 | |
| `SP+0x00` | 局部变量 | `0(SP)`，硬件 SP 指向此处 |

表中上面三行位于调用方的栈帧中，下面五行属于本函数的栈帧。`x-8(SP)` 与 `0(SP)` 看上去只差一个名字，
实际相距 16 字节；伪寄存器 SP 比硬件 SP 高出的 24 字节，恰好是局部变量所占的空间。

这个函数的开头没有栈空间检查。它不调用其他函数，局部变量又少于 128 字节，汇编器据此判定它使用的栈
不会超出预留的余量，于是省略了检查。这项检查的内容以及余量的来源，见 [2.4](./args.md)。

## 2.2.2 阅读 `Cas`

有了上面的布局，`Cas` 便不难理解。它在 Go 中只有声明，函数体位于汇编文件中：

```go
// internal/runtime/atomic/stubs.go
// 原子地执行：if *ptr == old { *ptr = new; return true } else { return false }
func Cas(ptr *uint32, old, new uint32) bool
```

```asm
// internal/runtime/atomic/atomic_amd64.s
TEXT ·Cas(SB),NOSPLIT,$0-17
	MOVQ	ptr+0(FP), BX      // BX = ptr（指针 8 字节，偏移 0）
	MOVL	old+8(FP), AX      // AX = old（uint32 4 字节，偏移 8）
	MOVL	new+12(FP), CX     // CX = new（uint32 4 字节，偏移 12）
	LOCK
	CMPXCHGL	CX, 0(BX)      // 若 *ptr 等于 AX，则将 CX 写入 *ptr，并置 ZF 标志
	SETEQ	ret+16(FP)         // ZF 置位时写入 1，否则写入 0
	RET
```

逐项说明如下：

- `TEXT ·Cas(SB)` 声明当前包中的函数 `Cas`，即 `internal/runtime/atomic.Cas`。
- `NOSPLIT` 指示汇编器不在函数开头插入栈空间检查。这类函数只能使用很少的栈，链接器会核对由这类函数
  组成的调用链，确保它们合计使用的栈不超出余量。
- `$0-17`：没有局部变量；参数与返回值共 17 字节，其中指针 8 字节，两个 `uint32` 各 4 字节，`bool` 返回值
  1 字节。偏移 0、8、12、16 正是它们依次紧密排列的位置。`go vet` 的 `asmdecl` 检查器依据 Go
  声明算出这些偏移，与汇编中的写法逐一核对 [[Go Authors, 2026c](#ref-go-authors-2026c)]。
- `MOVQ` 传送 8 字节，`MOVL` 传送 4 字节，与参数的大小相对应。
- `LOCK` 前缀作用于下一条指令，保证 `CMPXCHGL` 的比较与写入在多核环境下作为一个原子操作完成，其他
  核不会观察到中间状态 [[Intel, n.d.](#ref-intel-nd)]。

arm64 上的 `Cas` 位于 `atomic_arm64.s` 中，其声明同样是 `$0-17`，取参数同样写作 `ptr+0(FP)`、
`old+8(FP)`，只是其间的指令换成了 arm64 的指令。各种体系结构共享的是函数声明、帧大小以及参数的
写法，指令本身则各不相同。

## 2.2.3 把 SP 与 PC 作为数据：`gogo` 与 `morestack`

一个 goroutine 暂停时，运行时把它的 SP、PC 等寄存器的值保存在一个名为 `gobuf` 的小结构体中；恢复它的执行，
就是把这些值重新装入寄存器。`gogo` 完成的正是这项工作（节选自 `runtime/asm_amd64.s`
[[Go Authors, 2026b](#ref-go-authors-2026b)]）：

```asm
TEXT gogo<>(SB), NOSPLIT, $0      // BX 指向目标 goroutine 的 gobuf
	// ……先把当前 goroutine 设为目标 goroutine
	MOVQ	gobuf_sp(BX), SP       // 切换栈
	MOVQ	gobuf_bp(BX), BP
	MOVQ	gobuf_pc(BX), BX
	JMP	BX                         // 跳转到目标 goroutine 上次暂停的位置
```

一条 `MOVQ` 替换了栈，一条 `JMP` 替换了接下来要执行的指令。从这一刻起，处理器在另一个栈上执行另一个
goroutine 的代码。这两步无法用 Go 语言表达，因此 `gogo` 只能用汇编实现。

`morestack` 在 goroutine 的栈即将耗尽时被调用（[2.4](./args.md)）。它需要先记录调用它的函数（记作 f）及其
执行位置，待换上更大的栈之后再回到该处继续执行：

```asm
TEXT runtime·morestack(SB),NOSPLIT|NOFRAME,$0-0
	// ……DI 指向当前 goroutine 的 g
	MOVQ	0(SP), AX                    // 栈顶为返回地址，即调用者 f 的执行位置
	MOVQ	AX, (g_sched+gobuf_pc)(DI)   // 保存为 f 的 PC
	LEAQ	8(SP), AX                    // 越过返回地址即为 f 的 SP
	MOVQ	AX, (g_sched+gobuf_sp)(DI)   // 保存为 f 的 SP
	// ……切换到当前线程的 g0 栈
	CALL	runtime·newstack(SB)         // 分配更大的栈，并把旧栈的内容迁移过去
```

这里的 `0(SP)`、`8(SP)` 不带名字，指硬件 SP。`NOFRAME` 表示 `morestack` 不建立自己的栈帧，因此进入
时 SP 恰好指向 `CALL` 刚压入的返回地址，可以直接读取。原来的栈已接近耗尽，`morestack` 不能继续在其上
运行，于是切换到当前线程的 `g0` 栈（[3.5](../ch03life/boot.md)），再调用以 Go 实现的 `newstack`。

调度（[9.4](../../part3concurrency/ch09sched/schedule.md)）、信号
（[9.6](../../part3concurrency/ch09sched/signal.md)）和栈
（[第 14 章](../../part4memory/ch14stack/readme.md)）等章节中出现的汇编，大多属于这两种形式：通过 `FP`
访问参数，或者把 SP、PC 作为普通数据读写。在 GDB 中可以对照源码反汇编，并逐个查看 goroutine 的调用栈，
把这些汇编与运行时的现场对照阅读 [[Go Authors, 2026d](#ref-go-authors-2026d)]。

## 延伸阅读

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. "A Quick Guide to Go's Assembler."
  https://go.dev/doc/asm
  `TEXT`、帧大小、`NOSPLIT` 等标记以及伪寄存器的官方说明。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `runtime/asm_amd64.s`、
  `internal/runtime/atomic/atomic_amd64.s`、`runtime/textflag.h`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/asm_amd64.s
  https://github.com/golang/go/tree/master/src/runtime
  本节 `gogo`、`morestack`、`Cas` 的出处；`textflag.h` 列出了 `NOSPLIT` 等全部标记。
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. `asmdecl` 检查器.
  https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/asmdecl
  `go vet` 借助它核对汇编中的参数名、偏移与 Go 声明是否一致。
- <a id="ref-intel-nd"></a>[Intel, n.d.] Intel. *Intel 64 and IA-32 Architectures Software Developer's
  Manual*, Volume 2, "CMPXCHG" 与 "LOCK".
  https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html
  `LOCK CMPXCHG` 的原始说明。
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Debugging Go Code with GDB.*
  https://go.dev/doc/gdb
  （把汇编与运行时现场对照调试）
- 本书 [2.1 Plan 9 汇编语言](./asm.md)、[2.3 调用约定与寄存器 ABI](./callconv.md)（自定义 ABI）、
  [6.1 函数调用](../../part2lang/ch06func/func.md)、
  [9.4 调度循环](../../part3concurrency/ch09sched/schedule.md)（gogo/mcall 栈切换）、
  [14.3 栈的增长](../../part4memory/ch14stack/grow.md)（morestack 与栈增长）.

