---
weight: 1104
title: "1.4 Plan 9 汇编语言"
---

# 1.4 Plan 9 汇编语言

TODO: 请不要阅读此小节，内容编排中

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

## 指令

全局数据符号由以 DATA 指令开头的序列
全局数据符号由一系列以 DATA 指令起始和一个 GLOBL 指令定义。
每个 DATA 指令初始化相应内存的一部分。未明确初始化的内存为零。
该 DATA 指令的一般形式是

```
DATA	symbol+offset(SB)/width, value
```

在给定的 offset 和 width 处初始化该符号的内存为 value。
DATA 必须使用增加的偏移量来写入给定符号的指令。

该 GLOBL 指令声明符号是全局的。参数是可选标志，并且数据的大小被声明为全局，
除非 DATA 指令已初始化，否则初始值将全为零。该 GLOBL 指令必须遵循任何相应的 DATA 指令。

例如：

```
DATA divtab<>+0x00(SB)/4, $0xf4f8fcff
DATA divtab<>+0x04(SB)/4, $0xe6eaedf0
...
DATA divtab<>+0x3c(SB)/4, $0x81828384
GLOBL divtab<>(SB), RODATA, $64

GLOBL runtime·tlsoffset(SB), NOPTR, $4
```

| 指令 | 操作符 | 解释 |
|:-----|:-----|:------|
| JMP
| MOVL
| MOVQ
| MOVEQ
| LEAQ
| SUBQ
| ANDQ
| CALL
| PUSHQ
| POPQ
| CLD
| CMPQ
| CPUID
| JEQ
| 

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
（例如，`syscall` 包中的函数 `Syscall` 应使用名称 `·Syscall` 而不是 `syscall·Syscall` 其TEXT指令中的等效名称）。
对于更复杂的情况，需要显式注释。
这些注释使用标准 `#include` 文件中定义的伪指令 `funcdata.h`。

如果函数没有参数且没有结果，则可以省略指针信息。这是由一个参数大小 `$n-0` 注释指示 `TEXT` 对指令。
否则，指针信息必须由Go源文件中的函数的Go原型提供，即使对于未直接从Go调用的汇编函数也是如此。
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


## 进一步阅读的参考文献

- [A Quick Guide to Go's Assembler](https://golang.org/doc/asm)
- [Rob Pike, How to Use the Plan 9 C Compiler](http://doc.cat-v.org/plan_9/2nd_edition/papers/comp)
- [Rob Pike, A Manual for the Plan 9 assembler](https://9p.io/sys/doc/asm.html)
- [Debugging Go Code with GDB](https://golang.org/doc/gdb)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)