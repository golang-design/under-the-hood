---
weight: 1104
title: "1.4 Plan 9 汇编语言"
---

# 1.4 Plan 9 汇编语言

本节我们快速介绍 Go 语言使用的 Plan 9 汇编，以方便在后续章节中能够流畅的阅读 Go 源码中关于汇编的部分。

对于一段 Go 程序，我们可以通过下面的命令来获得编译后的汇编代码：

```shell
go build -gcflags "-N -l" -ldflags=-compressdwarf=false -o main.out main.go
go tool objdump -s "main.main" main.out > main.S
# or
go tool compile -S main.go
# or
go build -gcflags -S main.go
```

FUNCDATA 和 PCDATA 指令包含了由垃圾回收器使用的信息，他们由编译器引入。

## 常量

## 符号

## 汇编程序指令(assembler directives)

#### DATA

全局数据符号由以 **DATA 指令**开头的序列
全局数据符号由一系列以 DATA 指令起始和一个 GLOBL 指令定义。
每个 DATA 指令初始化相应内存的一部分。未明确初始化的内存为零。
该 DATA 指令的一般形式是

```assembly
DATA	symbol+offset(SB)/width, value
```

在给定的 offset 和 width 处初始化该符号的内存为 value。
DATA 必须使用增加的偏移量来写入给定符号的指令。

该 GLOBL 指令声明符号是全局的。参数是可选标志，并且数据的大小被声明为全局，
除非 DATA 指令已初始化，否则初始值将全为零。该 GLOBL 指令必须遵循任何相应的 DATA 指令。

例如：

```assembly
DATA divtab<>+0x00(SB)/4, $0xf4f8fcff
DATA divtab<>+0x04(SB)/4, $0xe6eaedf0
...
DATA divtab<>+0x3c(SB)/4, $0x81828384
GLOBL divtab<>(SB), RODATA, $64

GLOBL runtime·tlsoffset(SB), NOPTR, $4
```

为了更加方便读者更加容易上手，对上述指令再做一些**冗余的解释**

首先看`DATA divtab<>+0x00(SB)/4, $0xf4f8fcff` 表示的是`divtab<>` 在 0 偏移处有一个 4 字节大小的值`0xf4f8fcff`

下边连续多条`DATA...`都一样，注意偏移发生了变化，以 4 递增。最终偏移是`0x3c`

然后继续看`GLOBL divtab<>(SB), RODATA, $64` ，这条给变量`divtab<>`加了一个 flag `RODATA` ，表示里边存的是只读变量，最后的`$64`表示的是这个变量占用了 64 字节的空间（容易看出来`0x3c + 4 = 0x40= 10进制的64`

`GLOBL runtime·tlsoffset(SB), NOPTR, $4` 这条指令中，`NOPTR`这个 flag 表示这个变量中存的不是指针

关于更多 flag，[请查看源码](https://github.com/golang/go/blob/c53315d6cf1b4bfea6ff356b4a1524778c683bb9/src/runtime/textflag.h)

#### TEXT

```asm
TEXT runtime·profileloop(SB),NOSPLIT,$8
	MOVQ	$runtime·profileloop1(SB), CX
	MOVQ	CX, 0(SP)
	CALL	runtime·externalthreadhandler(SB)
	RET
```

上边整段汇编代码称为一个`TEXT block` ，`runtime.profileloop(SB)`后边有一个`NOSPLIT` flag，紧随其后的`$8`表示`frame size` 通常 `frame size` 的构成都是形如`$24-8` (中间的`-`只起到分隔的作用)，表示的是这个`TEXT block` 运行的时候需要占用 24 字节空间，参数和返回值要额外占用 8 字节空间（这 8 字节占用的是调用方栈帧里的空间）

但是如果有 NOSPLIT 这个 flag，则可以忽略参数和返回值占用的空间，就像上述这个例子，只有一个`$8` 。表示 frame size 只有 8 字节大小。这从汇编中也能看出来 `MOVQ CX, 0(SP)` ,因为 MOVQ 表示这个操作的操作对象是 8 字节的

> MOV 指令有有好几种后缀 MOVB MOVW MOVL MOVQ 分别对应的是 1 字节 、2 字节 、4 字节、8 字节

## 指令(instruction)

指令有几大类，**一类是用于数据移动的**，比如 MOV 系列，MOVQ、MOVL 等等(都是 MOV，只不过 Q 和 L 的后缀表示了指令操作数的字节大小)，还有**一类是用于跳转的**，无条件跳转，有条件跳转等等。还有**一类是用于逻辑运算和算术运算**的。（PS：应该还有其他的类）

还有一些类似于指令，但是其实是指令的 prefix，比如 `LOCK` （但是如果理解为指令也可以吧）关于 LOCK 的解释，下文中还会有涉及

| 指令                                           | 操作符 | 解释 |
| ---------------------------------------------- | ------ | ---- |
| JMP                                            |        |      |
| MOVL                                           |        |      |
| MOVQ                                           |        |      |
| MOVEQ                                          |        |      |
| LEAQ                                           |        |      |
| SUBQ                                           |        |      |
| ANDQ                                           |        |      |
| CALL                                           |        |      |
| PUSHQ                                          |        |      |
| POPQ                                           |        |      |
| CLD                                            |        |      |
| CMPQ                                           |        |      |
| CPUID                                          |        |      |
| JEQ                                            |        |      |
| ...还有很多（TODO：按指令的类型、功能 进行分类 |        |      |

## 运行时协调

为保证垃圾回收正确运行，在大多数栈帧中，运行时必须知道所有全局数据的指针。
Go 编译器会将这部分信息耦合到 Go 源码文件中，但汇编程序必须进行显式定义。

被标记为 `NOPTR` 标志的数据符号会视为不包含指向运行时分配数据的指针。
带有 `R0DATA` 标志的数据符号在只读存储器中分配，因此被隐式标记为 `NOPTR`。
总大小小于指针的数据符号也被视为隐式标记 `NOPTR`。
在一份汇编源文件中是无法定义包含指针的符号的，因此这种符号必须定义在 Go 原文件中。
一个良好的经验法则是 `R0DATA` 在 Go 中定义所有非符号而不是在汇编中定义。

每个函数还需要注释，在其参数，结果和本地堆栈框架中给出实时指针的位置。
对于没有指针结果且没有本地堆栈帧或没有函数调用的汇编函数，
唯一的要求是在同一个包中的 Go 源文件中为函数定义 Go 原型。
汇编函数的名称不能包含包名称组件
（例如，`syscall` 包中的函数 `Syscall` 应使用名称 `·Syscall` 而不是 `syscall·Syscall` 其 TEXT 指令中的等效名称）。
对于更复杂的情况，需要显式注释。
这些注释使用标准 `#include` 文件中定义的伪指令 `funcdata.h`。

如果函数没有参数且没有结果，则可以省略指针信息。这是由一个参数大小 `$n-0` 注释指示 `TEXT` 对指令。
否则，指针信息必须由 Go 源文件中的函数的 Go 原型提供，即使对于未直接从 Go 调用的汇编函数也是如此。
（原型也将 `go vet` 检查参数引用。）在函数的开头，假定参数被初始化但结果假定未初始化。
如果结果将在调用指令期间保存实时指针，则该函数应首先将结果归零，
然后执行伪指令 `GO_RESULTS_INITIALIZED`。
此指令记录结果现在已初始化，应在堆栈移动和垃圾回收期间进行扫描。
通常更容易安排汇编函数不返回指针或不包含调用指令;
标准库中没有汇编函数使用 `GO_RESULTS_INITIALIZED`。

如果函数没有本地堆栈帧，则可以省略指针信息。这由 `TEXT` 指令上的本地帧大小 `$0-n` 注释表示。如果函数不包含调用指令，也可以省略指针信息。否则，本地堆栈帧不能包含指针，并且汇编必须通过执行伪指令 `TEXTNO_LOCAL_POINTERS` 来确认这一事实。因为通过移动堆栈来实现堆栈大小调整，所以堆栈指针可能在任何函数调用期间发生变化：甚至指向堆栈数据的指针也不能保存在局部变量中。

汇编函数应始终给出 Go 原型，既可以提供参数和结果的指针信息，也可以 `go vet` 检查用于访问它们的偏移量是否正确。

## 寄存器

### 通用寄存器

Plan 9 中的通用寄存器包括：

AX
BX
CX
DX
DI
SI
BP
SP
R8
R9
R10
R11
R12
R13
R14
PC

### 伪寄存器

伪寄存器不是真正的寄存器，而是由工具链维护的虚拟寄存器，例如帧指针。

FP, Frame Pointer：帧指针，参数和本地
PC, Program Counter: 程序计数器，跳转和分支
SB, Static Base: 静态基指针, 全局符号
SP, Stack Pointer: 当前栈帧开始的地方

所有用户定义的符号都作为偏移量写入伪寄存器 FP 和 SB。

汇编代码中需要表示用户定义的符号(变量)时，可以通过 SP 与偏移还有变量名的组合，比如`x-8(SP)` ，因为 SP 指向的是栈顶，所以偏移值都是负的，`x`则表示变量名

## 寻址模式

汇编语言的一个很重要的概念就是它的寻址模式，Plan 9 汇编也不例外，它支持如下寻址模式：

```
R0              数据寄存器
A0              地址寄存器
F0              浮点寄存器
CAAR, CACR, 等  特殊名字
$con            常量
$fcon           浮点数常量
name+o(SB)      外部符号
name<>+o(SB)    局部符号
name+o(SP)      自动符号
name+o(FP)      实际参数
$name+o(SB)     外部地址
$name<>+o(SB)   局部地址
(A0)+           间接后增量
-(A0)           间接前增量
o(A0)
o()(R0.s)

symbol+offset(SP) 引用函数的局部变量，offset 的合法取值是 [-framesize, 0)
    局部变量都是 8 字节，那么第一个局部变量就可以用 localvar0-8(SP) 来表示

如果是 symbol+offset(SP) 形式，则表示伪寄存器 SP
如果是 offset(SP) 则表示硬件寄存器 SP
```

```asm
TEXT pkgname·funcname(SB),NOSPLIT,$-8
    JMP	_rt0_amd64(SB)
```

## 实战

接下来，我们一起阅读 `asm_amd64.s`中的汇编

#### 第一个汇编：实现 CAS 操作

```assembly
// asm_amd64.s

// bool Cas(int32 *val, int32 old, int32 new)
// Atomically:
//	if(*val == old){
//		*val = new;
//		return 1;
//	} else
//		return 0;
TEXT runtime∕internal∕atomic·Cas(SB),NOSPLIT,$0-17
	MOVQ	ptr+0(FP), BX
	MOVL	old+8(FP), AX
	MOVL	new+12(FP), CX
	LOCK
	CMPXCHGL	CX, 0(BX)
	SETEQ	ret+16(FP)
	RET
```

我们先看第一个汇编，使用汇编实现 CAS (compare and swap)操作

我们一条一条的看，先看`TEXT runtime∕internal∕atomic·Cas(SB),NOSPLIT,$0-17` 。`$0-17`表示的意思是这个`TEXT block`运行的时候，需要开辟的栈帧大小是 0 ，而`17 = 8 + 4 + 4 + 1 = sizeof(pointer of int32) + sizeof(int32) + sizeof(int32) + sizeof(bool)` （返回值是 bool ，占据 1 个字节

然后我们再看 block 内的第一条指令 ， 这里的 FP，是伪寄存器(pseudo) ，里边存的是 Frame Pointer, FP 配合偏移 可以指向函数调用参数或者临时变量

`MOVQ ptr+0(FP), BX` 这一句话是指把函数的第一个参数`ptr+0(FP)`移动到 BX 寄存器中

`MOVQ` 代表移动的是 8 个字节,Q 代表 64bit ，参数的引用是 `参数名称+偏移(FP)`,可以看到这里名称用了 ptr,并不是 val,变量名对汇编不会有什么影响，但是语法上是必须带上的，可读性也会更好些。

后边两条 MOVL 不再赘述

`LOCK` 并不是指令，而是一个指令的前缀 (instruction prefix)，是用来修饰 `CMPXCHGL CX,0(BX)` 的

> The LOCK prefix ensures that the CPU has exclusive ownership of the appropriate cache line for the duration of the operation, and provides certain additional ordering guarantees. This may be achieved by asserting a bus lock, but the CPU will avoid this where possible. If the bus is locked then it is only for the duration of the locked instruction

`CMPXCHGL` 有两个操作数，`CX` 和 `0(BX)` ,`0(BX)` 代表的是 val 的地址  
`offset(BX)` 是一种 `addressing model` , 把寄存器里存的值 + offset 作为目标地址

CMPXCHGL 指令做的事情，首先会把 `destination operand`(也就是 `0(BX)`)里的值 和 AX 寄存器里存的值做比较，如果一样的话会把 CX 里边存的值保存到 `0(BX)` 这块地址里 (虽然这条指令里并没有出现 AX，但是还是用到了，汇编里还是有不少这样的情况)  
CMPXCHGL 最后的那个 L 应该表示的是操作长度是 32 bit ，从函数的定义来看 old 和 new 都是 int32
函数返回一个 Bool 占用 8bit ，`SETEQ` 会在 AX 和 CX 相等的时候把 1 写进 ret+16(FP) (否则写 0

## 进一步阅读的参考文献

- [A Quick Guide to Go's Assembler](https://golang.org/doc/asm)
- [Rob Pike, How to Use the Plan 9 C Compiler](http://doc.cat-v.org/plan_9/2nd_edition/papers/comp)
- [Rob Pike, A Manual for the Plan 9 assembler](https://9p.io/sys/doc/asm.html)
- [Debugging Go Code with GDB](https://golang.org/doc/gdb)

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
