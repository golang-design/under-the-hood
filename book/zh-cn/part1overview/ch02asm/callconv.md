---
weight: 1203
title: "2.3 调用约定与寄存器 ABI"
---

# 2.3 调用约定与寄存器 ABI

下面是一个最简单的函数。把它编译到 linux/amd64，并让编译器输出生成的汇编（`go build -gcflags=-S`，
已删去与本节无关的行）：

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

函数体只有两条指令：把 BX 加到 AX 上，然后返回。源码并未说明参数 `a`、`b` 从何处取得、结果存放在
何处，这些由调用方与被调函数事先约定：调用方把 `a` 放入 AX、`b` 放入 BX，`Add` 把结果留在 AX 中。
双方可能位于不同的包中、在不同的时间编译，只要遵守同一套规则，就能正确地相互调用。这样的规则称为
**调用约定**（calling convention）。调用约定与数据在内存中的布局规则合称**应用二进制接口**
（application binary interface，ABI）。上面输出中的 `ABIInternal` 即是 Go 所用的一种 ABI 的名称。

## 2.3.1 栈传参与寄存器传参

最简单的调用约定是全部参数经由栈传递：调用方依次把参数写入栈中，被调函数按固定的偏移读取。32 位
x86 上 C 语言常用的 cdecl 约定即是如此。这种约定规则简单：栈的容量几乎不受限制，每个参数在内存中
都有确定的地址，编译器的实现也较为直接。

其代价是每个参数都要经过一次内存往返：调用方写入一次，被调函数读出一次。寄存器的数量虽少，访问却
远快于内存；函数越短小、调用越频繁，这部分开销所占的比例就越大。因此，后来的调用约定大多先用寄存器
传递前几个参数，寄存器不足时才使用栈。Linux 与 macOS 上的 C 程序在 amd64 上遵循 System V AMD64
ABI，它用 6 个寄存器传递整数参数，用 8 个寄存器传递浮点参数 [[Lu et al., n.d.](#ref-lu-et-al-nd)]。

## 2.3.2 Go 的两套约定

Go 最初沿用 Plan 9 的做法，参数与返回值全部经由栈传递。[2.2](./frame.md) 中的手写汇编以 `a+0(FP)`
读取参数，遵循的就是这套约定。

改用寄存器传参的主要障碍是已有的汇编代码。标准库与许多第三方包中有大量手写汇编，它们都按「参数位于
栈上的第几个字节」编写，无法同时改写。2018 年，Austin Clements 提出把调用约定一分为二，手写汇编与
编译器生成的代码各用一套，二者之间由编译器生成的包装函数相互转接 [[Clements, 2018](#ref-clements-2018)]：

- **ABI0**：即原有的约定，参数与返回值全部经由栈传递，此后保持不变。手写汇编均按此约定编写
  [[Go Authors, 2026c](#ref-go-authors-2026c)]。
- **ABIInternal**：由 Go 源码编译而来的函数一律使用这套约定。名称中的 Internal 表示它仅供 Go 工具链
  内部使用，可能随版本改变，外部代码不应依赖其细节 [[Go Authors, 2026a](#ref-go-authors-2026a)]。

在此基础上，Clements 等人于 2020 年提出了基于寄存器的调用约定，作为 ABIInternal 的具体内容
[[Clements, 2020](#ref-clements-2020)]。Go 1.17（2021 年）首先在 linux/amd64、darwin/amd64 与
windows/amd64 上启用这套约定。据其发布说明，一组有代表性的 Go 包和程序因此提速约 5%，可执行文件通常缩小约
2% [[Go Authors, 2021](#ref-go-authors-2021)]。Go 1.18 将其推广到 arm64、ppc64/ppc64le
以及所有操作系统上的 amd64，arm64 与 ppc64 上的提速通常在 10% 以上
[[Go Authors, 2022a](#ref-go-authors-2022a)]；Go 1.19 又加入了 riscv64
[[Go Authors, 2022b](#ref-go-authors-2022b)]。这一改动不影响任何安全的 Go 代码的行为，
用户代码只需重新编译即可受益。

这份提案没有沿用各平台现有的 C 调用约定 [[Clements, 2020](#ref-clements-2020)]，其原因涉及栈的管理与调度，
留待 [2.4](./args.md) 的最后一部分讨论。

## 2.3.3 寄存器的分配

amd64 上，ABIInternal 依次使用 9 个整数寄存器 AX、BX、CX、DI、SI、R8、R9、R10、R11，以及 15 个浮点
寄存器 X0 至 X14 [[Go Authors, 2026a](#ref-go-authors-2026a)]。分配规则可以归纳为四条：

1. 先分配方法的接收者（如果有），再按顺序逐个分配参数。每个参数分解为基本类型的分量，每个分量占用一个
   寄存器：`string` 与接口分解为两个分量，切片分解为指针、长度、容量三个分量，结构体按字段分解。
   整数与指针使用整数寄存器，浮点数使用浮点寄存器。
2. 一个参数要么全部放入寄存器，要么全部放在栈上。若剩余的寄存器容纳不下它的全部分量，该参数便整体
   经由栈传递，已尝试占用的寄存器退还给后续参数使用。
3. 参数中只要含有长度大于 1 的数组，就整体经由栈传递。访问数组元素通常需要在运行时计算偏移，而寄存器
   无法按计算出的偏移寻址。
4. 返回值按同样的规则分配，寄存器重新从 AX 与 X0 开始使用。

下表列出几个函数在 linux/amd64、Go 1.26 上的实际分配：

| 函数 | 参数 | 返回值 |
| --- | --- | --- |
| `func Add(a, b int) int` | `a`→AX，`b`→BX | AX |
| `func Mix(s string, f float64, n int) (int, float64)` | `s`→AX、BX，`f`→X0，`n`→CX | AX，X0 |
| `func (f *File) Write(p []byte) (n int, err error)` | `f`→AX，`p`→BX、CX、DI | `n`→AX，`err`→BX、CX |
| `func Arr(a [2]int, b int) int` | `a`→栈，`b`→AX | AX |
| `func Many(a, b, c, d, e, f, g, h int, s string, t int) int` | `a` 至 `h`→AX 至 R10，`s`→栈，`t`→R11 | AX |

最后一行最能说明第 2 条规则。当 `main` 中只有 `println(Many(1, 2, 3, 4, 5, 6, 7, 8, "x", 9))` 一条
语句时，调用 `Many` 的代码如下（暂存字符串地址的寄存器随上下文而定，这里是 DX）：

```
LEAQ	go:string."x"(SB), DX
MOVQ	DX, (SP)          // s 的指针，写入栈中
MOVQ	$1, 8(SP)         // s 的长度，写入栈中
MOVL	$1, AX            // a
MOVL	$2, BX            // b
                          // c 至 g 依次装入 CX、DI、SI、R8、R9
MOVL	$8, R10           // h
MOVL	$9, R11           // t
CALL	main.Many(SB)
```

8 个 `int` 参数占用了前 8 个寄存器。`s` 需要两个寄存器，此时只剩 R11 一个，因此 `s` 整体经由栈传递；
排在其后的 `t` 只需一个寄存器，R11 恰好留给了它。

下面的交互图按同样的规则逐一分配参数和返回值，可以选择其他函数，也可以自行增加参数；「改用 ABI0」
显示同一函数在全部经由栈传递时的布局。

<div class="viz" data-viz="abi-regassign"></div>

规定一个参数不得一部分位于寄存器、一部分位于栈上，是因为被调函数可能对参数取地址（如 `&s`）。此时该
参数必须完整地存放在内存中；若它被拆开传递，就需要先在内存中重新拼合，其代价与参数的大小成正比。
至于寄存器是否够用，ABI 规范的附录统计了 Kubernetes 中的 kubelet（v1.18.8）：浮点寄存器的数目对结果几乎
没有影响，统计中固定为 8 个；在此前提下，有 9 个整数寄存器时，92.1% 的函数可以把全部参数和返回值
放入寄存器，再增加整数寄存器，这一比例的增长已十分缓慢 [[Go Authors, 2026a](#ref-go-authors-2026a)]。

## 2.3.4 两套约定之间的转换

Go 代码调用汇编函数时，调用方把参数放在寄存器中，被调函数却从栈上读取，二者之间需要转换，这项工作由
编译器完成。`go build` 在编译一个包之前，先以 `-gensymabis` 选项运行汇编器，从包中的 `.s` 文件里
提取每个符号所用的 ABI；编译器通过 `-symabis` 选项读入这份信息，据此决定如何调用这些函数。

下面的 `add` 用汇编按 ABI0 编写，`main` 先直接调用它，再把它作为函数值调用：

```go
func add(a, b int) int // 函数体位于 add_amd64.s，按 ABI0 编写

func main() {
	f := add
	println(add(1, 2), f(3, 4))
}
```

直接调用时，编译器知道 `add` 遵循 ABI0，便在调用处按 ABI0 传递参数：

```
MOVQ	$1, (SP)          // 参数写入栈中
MOVQ	$2, 8(SP)
CALL	main.add(SB)
XORPS	X15, X15          // 恢复两个具有固定含义的寄存器
MOVQ	(TLS), R14
MOVQ	16(SP), AX        // 从栈上读取返回值
```

函数值则可能被任意 Go 代码按 ABIInternal 调用，为此编译器另外生成一个函数，负责在两套约定之间转换
[[Go Authors, 2026b](#ref-go-authors-2026b)]。以 `-gcflags=-d=abiwrap` 编译时，编译器报告
`ABIInternal to ABI0 wrapper for add`，生成的函数如下（省略了开头保存 BP、分配栈帧以及结尾恢复的指令）：

```
TEXT	main.add(SB), DUPOK|NOSPLIT|ABIWRAPPER|ABIInternal, $32-16
MOVQ	AX, (SP)          // 把寄存器中的参数写入栈中
MOVQ	BX, 8(SP)
CALL	main.add(SB)      // 调用汇编实现的 ABI0 版本
XORPS	X15, X15
MOVQ	(TLS), R14
MOVQ	16(SP), AX        // 把返回值装回寄存器
```

这样的函数称为 **ABI 包装函数**（ABI wrapper）。

两段代码在调用之后都多出两条指令。ABIInternal 规定两个寄存器具有固定的含义：X15 恒为零，便于批量
清零栈帧；R14 始终指向当前的 goroutine。在 ABI0 中，这两个寄存器的值没有定义，因此从 ABI0 代码回到
ABIInternal 代码时必须恢复它们，反方向的转换则无须处理。X15 与自身做异或即得到零；当前 goroutine
的指针则从**线程本地存储**（thread-local storage，TLS）中重新读出，`(TLS)` 即指这块存储。

链接后的符号表中两个版本同时存在，汇编实现的版本带有 `.abi0` 后缀：

```
$ GOOS=linux GOARCH=amd64 go build -o wrap.bin .
$ go tool nm wrap.bin | grep main.add
  47a7e0 T main.add
  47a7c0 T main.add.abi0
```

## 延伸阅读

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Go internal ABI specification*.
  `src/cmd/compile/abi-internal.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/abi-internal.md
  https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md
  ABIInternal 的完整规则：分配算法、栈帧布局、各体系结构的寄存器用途以及每条规则的设计理由；附录
  载有 kubelet 的寄存器使用统计。
- <a id="ref-clements-2020"></a>[Clements, 2020] Austin Clements. "Proposal: Register-based Go calling
  convention." Go proposal 40724, 2020.
  https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md
  寄存器传参的提案，说明了 Go 为何不采用各平台的 C 调用约定。
- <a id="ref-clements-2018"></a>[Clements, 2018] Austin Clements. "Proposal: Create an undefined internal
  calling convention." Go proposal 27539, 2018.
  https://go.googlesource.com/proposal/+/master/design/27539-internal-abi.md
  把 ABI0 与 ABIInternal 分开、以包装函数相互转接的设计。
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.17 Release Notes*, "Compiler".
  https://go.dev/doc/go1.17
  寄存器传参在 amd64 上启用；约 5% 的提速与约 2% 的体积缩减出自此处。
- <a id="ref-lu-et-al-nd"></a>[Lu et al., n.d.] H.J. Lu, Michael Matz, Milind Girkar, Jan Hubička, Andreas
  Jaeger, Mark Mitchell (eds.). *System V Application Binary Interface, AMD64 Architecture Processor
  Supplement*. https://gitlab.com/x86-psABIs/x86-64-ABI
  amd64 上 C 程序遵循的调用约定，可与 Go 的约定对照。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  `cmd/compile/internal/ssagen/abi.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/internal/ssagen/abi.go
  编译器生成 ABI 包装函数的代码（`makeABIWrapper`）。
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *A Quick Guide to Go's
  Assembler*（ABI0、伪寄存器、稳定汇编 ABI）. https://go.dev/doc/asm
- <a id="ref-go-authors-2022a"></a>[Go Authors, 2022a] The Go Authors. *Go 1.18 Release Notes*,
  "Compiler". https://go.dev/doc/go1.18#compiler
  寄存器传参推广到 arm64、ppc64/ppc64le 以及所有操作系统上的 amd64。
- <a id="ref-go-authors-2022b"></a>[Go Authors, 2022b] The Go Authors. *Go 1.19 Release Notes*, "RISC-V".
  https://go.dev/doc/go1.19#riscv64
  riscv64 改用寄存器传参。
- 本书 [2.1 Plan 9 汇编语言](./asm.md)、[2.4 参数传递与栈帧布局](./args.md)、
  [6.1 函数调用](../../part2lang/ch06func/func.md).

