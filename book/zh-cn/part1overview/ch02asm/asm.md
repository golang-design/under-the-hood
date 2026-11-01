---
weight: 1201
title: "2.1 Plan 9 汇编语言"
---

# 2.1 Plan 9 汇编语言

打开 `runtime/asm_amd64.s`，可以看到这样的代码（Go 1.26）：

```asm
TEXT runtime·gogo(SB), NOSPLIT, $0-8
	MOVQ	buf+0(FP), BX		// gobuf
	MOVQ	gobuf_g(BX), DX
	MOVQ	0(DX), CX		// make sure g != nil
	JMP	gogo<>(SB)
```

它看起来像 x86 汇编，却与 Intel 手册中的写法不符：指令名为 `MOVQ`，操作数中出现了 `(SB)`、`(FP)`，
函数名中还夹着一个 `·`。这是 Go 自己的汇编语言，其写法源自 Plan 9 操作系统。Go 1.26 的 `runtime`
目录中共有 182 个 `.s` 文件（涵盖各种体系结构与操作系统），讨论调度、栈和信号的章节会反复引用它们。

本节讨论三个问题：Go 中哪些代码必须用汇编编写，Go 为何拥有一套自己的汇编语言，以及其中最容易误读的
几个记号。

## 2.1.1 汇编的用途

amd64 有 16 个 64 位通用**寄存器**（register），在 Go 汇编中写作 `AX`、`BX`、`CX`、`DX`、`SI`、
`DI`、`BP`、`SP` 以及 `R8` 至 `R15`；用于浮点与向量运算的寄存器写作 `X0`、`X1` 等。其中两个寄存器
具有专门的用途：**程序计数器**（program counter，PC）保存下一条待执行指令的地址，跳转即改写它；
**栈指针**（stack pointer，SP）指向当前栈顶。每个 goroutine 都有自己的栈，函数调用时由高地址向低
地址占用一段空间，返回时释放。

Go 代码几乎全部由编译器翻译为机器指令，只有以下几类工作需要手写汇编：

- **切换 goroutine**：同时把 SP 与 PC 替换为另一个 goroutine 保存的值（`gogo`、`mcall`）。Go 语言
  中没有改写栈指针的语句。
- **原子操作**：比较并交换等操作需要使用处理器提供的专门指令，例如 amd64 上带 `LOCK` 前缀的
  `CMPXCHG`。
- **与操作系统交互**：发起系统调用、接收信号时，数据必须按操作系统的约定放入指定的寄存器。
- **少数热点代码**：`memmove`、字符串查找以及部分密码算法，改用一次处理多个数据的向量指令手写，
  性能可以提高数倍。

## 2.1.2 来历：继承自 Plan 9 的工具链

Plan 9 是贝尔实验室继 Unix 之后开发的操作系统，Go 最初的设计者中，Ken Thompson 与 Rob Pike 都曾参与其中。
1990 年前后，Thompson 为 Plan 9 编写了一组 C 编译器，每种体系结构一个
[[Thompson, 1990](#ref-thompson-1990)] [[Pike, n.d.b](#ref-pike-ndb)]；Pike 则为与之配套的汇编语言撰写了手
册 [[Pike, n.d.a](#ref-pike-nda)]。

这组工具的分工与传统工具链不同。编译器和汇编器输出的目标文件中，指令尚未编码为处理器最终执行的字节序列；
链接器（Plan 9 称为 loader）兼任汇编器的后半部分与全局优化器，在合并所有文件时才确定每条指令的具体编码。
汇编语言因此可以比机器指令高一个层次：程序员写的是「把这个常数放入 R0」，需要一条还是几条机器指令完成，
由工具决定。Thompson 在论文的结论中对这一设计的评价是：编译很快，链接很慢
[[Thompson, 1990](#ref-thompson-1990)]。

Go 起初沿用了这种做法，代价同样是链接缓慢：每链接一个程序，所有包的指令都要重新处理一遍。Go 1.3（2014 年）
把指令编码移到编译每个包的阶段，每个包只需处理一次 [[Cox, 2013](#ref-cox-2013)]；Go 1.5 又把整个工具链从
C 改写为 Go。如今的构建流程如下：

```
foo.go ──► cmd/compile ──┐
                         ├──► cmd/internal/obj ──► foo.o ──► cmd/link ──► 可执行文件
foo.s  ──► cmd/asm ──────┘
```

编译器与汇编器把结果交给同一个公共库 `cmd/internal/obj`，由它确定最终的机器指令
[[Go Authors, 2026b](#ref-go-authors-2026b)]，并在每个函数开头插入栈空间检查（[2.4](./args.md)）。链接器
`cmd/link` 只负责合并各个包并完成地址重定位（[3.4](../ch03life/link.md)）。手写的汇编函数与编译生成的函数
经由同一条路径，受到相同的处理。

汇编语言高于机器指令一层的设计也保留了下来。arm64 的每条指令长 4 字节，无法容纳 `0x123456789` 这样
大的立即数。在 arm64 汇编中写一条 `MOVD $0x123456789, R0`，交叉编译到 linux/arm64 后用
`go tool objdump` 查看，它被展开为三条指令，每条装入 16 位：

```
MOVD $26505, R0        // 0x6789
MOVK $(9029<<16), R0   // 0x2345，写入第 16 至 31 位
MOVK $(1<<32), R0      // 0x1，写入第 32 至 47 位
```

## 2.1.3 取舍

这一设计换来的是各种体系结构上一致的写法。指令名仍随体系结构而不同，amd64 写作 `MOVQ`，arm64 写作 `MOVD`；
但操作数一律源在前、目标在后，数据宽度一律由指令名的最后一个字母表示（`B`、`W`、`L`、`Q` 分别表示 1、2、
4、8 字节），函数、参数和局部变量的写法处处相同。掌握了一种体系结构上的 Go 汇编，换到另一种只需查阅指令
表。所有体系结构的支持都集中在同一套工具中，交叉编译也无须另行安装工具链 [[Pike, 2016](#ref-pike-2016)]，
`GOOS=linux GOARCH=amd64 go build` 在任何机器上都可以直接执行。

付出的代价是与外部生态的隔阂。Go 汇编与 Intel 语法、GNU 汇编器（AT&T 语法）都不相同，从其他来源
引入的汇编代码需要改写；Go 也必须自行维护汇编器、链接器和目标文件格式，每支持一种新的体系结构，
都需要编写相应的代码。

## 2.1.4 四个伪寄存器

Go 汇编中最容易误读的，是四个形似寄存器、实际并不存在的记号，称为**伪寄存器**
（pseudo-register）[[Go Authors, 2026a](#ref-go-authors-2026a)]。汇编器会把它们换算为真实寄存器加偏移的形
式：

| 记号 | 用于定位 | 示例 |
| --- | --- | --- |
| `FP` | 本函数的参数与返回值 | `a+0(FP)`、`ret+16(FP)` |
| `SP` | 本函数的局部变量 | `x-8(SP)` |
| `SB` | 函数与全局变量 | `runtime·gogo(SB)` |
| `PC` | 邻近的指令，用于跳转 | `JMP 2(PC)` |

`SB`（static base）表示程序地址空间的起点，`runtime·gogo(SB)` 即函数 `runtime.gogo` 的地址。中点
`·` 对应 Go 中的 `.`；省略包名写作 `·gogo(SB)` 时，指当前包中的 `gogo`。

通过 `FP` 访问参数时必须带上参数名，且偏移必须与 Go 中的函数声明一致。`func add(a, b int) int` 的
参数写作 `a+0(FP)`、`b+8(FP)`，返回值写作 `ret+16(FP)`。处理器只使用偏移，名字供阅读者和
`go vet` 核对：若把 `b+8(FP)` 误写为 `b+4(FP)`，`go vet` 会报告
`invalid offset b+4(FP); expected b+8(FP)`。

最容易出错的是 `SP`。amd64 本身就有一个名为 SP 的硬件寄存器，Go 汇编依据记号前是否带有名字区分二者：
`x-8(SP)` 带有名字，指伪寄存器，自局部变量区的顶端向下计算；`8(SP)` 不带名字，指硬件栈指针，自栈的
最低端向上计算。二者相差整个局部变量区的大小。[2.2](./frame.md) 将以一段真实的反汇编，把这些记号
换算为实际的地址。

## 延伸阅读

- <a id="ref-thompson-1990"></a>[Thompson, 1990] Ken Thompson. "Plan 9 C Compilers." *Plan 9 Programmer's
  Manual*, Volume 2. 最初以 "A New C Compiler" 为题发表于 *Proceedings of the Summer 1990 UKUUG
  Conference*, London, 1990. https://9p.io/sys/doc/compiler.html
  Plan 9 编译器、汇编器与链接器的分工，以及由链接器确定最终指令的做法。
- <a id="ref-pike-nda"></a>[Pike, n.d.a] Rob Pike. "A Manual for the Plan 9 Assembler." *Plan 9
  Programmer's Manual*, Volume 2. https://9p.io/sys/doc/asm.html
  Go 汇编写法的直接来源，FP、SP、SB、PC 等伪寄存器均在此定义。
- <a id="ref-cox-2013"></a>[Cox, 2013] Russ Cox. "Go 1.3 Linker Overhaul." 2013.
  https://golang.org/s/go13linker
  把指令编码从链接器移至编译阶段的设计文档，说明了改动的动机。
- <a id="ref-pike-2016"></a>[Pike, 2016] Rob Pike. "The Design of the Go Assembler." GopherCon 2016.
  https://go.dev/talks/2016/asm.slide
  `cmd/asm` 如何以一个程序加若干张表支持所有体系结构。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. "A Quick Guide to Go's Assembler."
  https://go.dev/doc/asm
  伪寄存器、`TEXT` 指令与帧大小写法的官方说明。
- <a id="ref-pike-ndb"></a>[Pike, n.d.b] Rob Pike. *How to Use the Plan 9 C Compiler.*
  http://doc.cat-v.org/plan_9/2nd_edition/papers/comp
  （Plan 9 工具链与寄存器约定的背景）
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *cmd/asm、cmd/internal/obj.*
  https://github.com/golang/go/tree/master/src/cmd/asm
  （把统一汇编翻译到各架构后端的实现）
- 本书 [2.2 汇编中的栈帧与符号](./frame.md)（`Cas`/`gogo`/`morestack` 例程）、
  [2.3 调用约定与寄存器 ABI](./callconv.md)（自定义 ABI）、
  [6.1 函数调用](../../part2lang/ch06func/func.md).

