---
weight: 1302
title: "3.2 Go 程序编译流程"
---

# 3.2 Go 程序编译流程

下面两个函数几乎相同，都在函数内创建一个 `point` 并取它的地址：

```go {run=true}
package main

import (
	"fmt"
	"testing"
)

type point struct{ x, y int }

func sum(p *point) int { return p.x + p.y }

// p 的地址只传给了 sum，sum 返回后不再被引用
func local() int {
	p := point{1, 2}
	return sum(&p)
}

// p 的地址返回给调用者，其生命期超出 escape 本身
func escape() *point {
	p := point{3, 4}
	return &p
}

var sink *point // 防止编译器把结果优化掉

func main() {
	a := testing.AllocsPerRun(100, func() { _ = local() })
	b := testing.AllocsPerRun(100, func() { sink = escape() })
	fmt.Println("local 每次调用的堆分配次数：", a)
	fmt.Println("escape 每次调用的堆分配次数：", b)
}
```

`testing.AllocsPerRun` 将函数运行 100 次，计算平均每次调用发生的堆分配次数：

```
local 每次调用的堆分配次数： 0
escape 每次调用的堆分配次数： 1
```

`local` 中的 `p` 分配在栈上，随函数返回自动释放；`escape` 中的 `p` 分配在堆上，需要由垃圾回收器
回收。这一决定是编译器在程序运行之前作出的。加上 `-gcflags=-m`，编译器会报告它的判断（摘录与 `p`
有关的几行）：

```
$ go build -gcflags=-m -o /dev/null .
./main.go:10:6: can inline sum
./main.go:13:6: can inline local
./main.go:19:6: can inline escape
./main.go:10:10: p does not escape
./main.go:20:2: moved to heap: p
```

编译器如何判断 `p` 的生命期是否超出函数，「can inline」又是什么含义？本节按照编译器的处理顺序，
依次说明它把源码转换为何种表示，在其上进行了哪些分析与变换，最终如何生成机器指令。

## 3.2.1 编译器的阶段

[3.1](./cmd.md) 提到，`go build` 每次调用编译器 `compile` 编译一个包，产出一个目标文件。
编译器内部是一条流水线，每个阶段把程序转换为另一种表示，再交给下一阶段
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

1. **词法与语法分析**：把源码文本切分为词法单元（关键字、标识符、字面量、运算符），再按语法规则
   组织为**语法树**（syntax tree）。
2. **类型检查**：确定每个标识符所指的声明以及每个表达式的类型，类型错误在此阶段报告。
3. **内联与逃逸分析**：把小函数的函数体展开到调用处；判断每个变量应分配在栈上还是堆上。
4. **降级**（walk）：把 `go` 语句、channel 与 map 操作等语言特性改写为对运行时函数的调用。
5. **优化**：转换为更接近机器、便于分析的中间表示，执行数十趟优化。
6. **代码生成**：选择目标体系结构的指令，分配寄存器，写出目标文件。

前两个阶段关心程序是否正确，后几个阶段关心程序如何高效执行。下面的交互图以 3.2.6 的 `larger` 函数
为例，逐个阶段展示其表示的变化。

<div class="viz" data-viz="build-pipeline"></div>

## 3.2.2 语法分析与类型检查

第一个阶段由 `cmd/compile/internal/syntax` 完成。Go 的语法有意设计得易于解析：读到一个词法单元时，
不需要知道前面的标识符是类型名还是变量名，就能确定语句的结构。C 语言中 `T * x;` 究竟是声明一个
指针还是计算一次乘法，取决于 `T` 是否为类型名；Go 的声明总以 `var`、`func`、`type` 等关键字开头，
不存在这种歧义。Rob Pike 在 2012 年的《Go at Google》一文中指出，Go 的解析无须类型信息或符号表，这使得
编译器以及各种工具都可以写得小而快 [[Pike, 2012](#ref-pike-2012)]。

类型检查由 `cmd/compile/internal/types2` 完成，泛型的类型推断也在这一阶段进行
（[8.3](../../part2lang/ch08generics/checker.md)）。标准库中另有 `go/parser` 与 `go/types`，供
`gofmt`、`go vet`、gopls 等工具使用，编译器本身并不使用。`types2` 是 `go/types` 移植到编译器中的
版本，二者共用同一套测试。

## 3.2.3 内联

函数调用有固定的开销：准备参数、跳转、建立栈帧、返回时再跳回。更大的损失在于，调用者无法看到被调
函数内部的行为，许多优化因此无法进行。把被调函数的函数体直接展开到调用处，可以同时消除这两个问题，
这种变换称为**内联**（inlining）。

内联的代价是代码体积增大、编译时间延长，因此只对小函数进行。编译器以函数体语法树的节点数作为其
**内联成本**，成本不超过 80 时才内联；函数体中每调用一个不可内联的函数，成本另加 57（`cmd/compile/internal/inline/inl.go`）。`-gcflags=-m=2`
会输出成本，例如 3.2.6 将要讨论的
`larger` 函数：

```
./main.go:3:6: can inline larger with cost 14 as: func(int, int) int { m := a; if b > a { m = b }; return m }
```

开头例子中的 `sum`、`local`、`escape` 均被内联。[3.1](./cmd.md) 的实验中，修改 `greet.Hello` 的
函数体后 `main` 也必须重新编译，原因正在于此：`Hello` 的函数体已经内联到 `main` 中。

80 的预算对所有函数一视同仁，然而程序的运行时间往往集中在少数几个函数上。从 Go 1.21 起，可以把线上采集的
CPU 性能剖析数据放入主包目录（文件名为 `default.pgo`），编译器据此找出调用最频繁的位置，
对这些位置把预算放宽到 2000。这种方法称为**性能制导优化**（profile-guided optimization，PGO）[[Go
Authors, 2026d](#ref-go-authors-2026d)]。

## 3.2.4 逃逸分析

局部变量分配在函数的栈帧中，函数返回时随栈帧一并释放，没有额外开销。然而，如果函数返回后仍有
指针指向某个局部变量，这个变量就不能随栈帧消失，只能分配在堆上，在不再被引用之后由垃圾回收器回收。

C 语言把这一问题留给程序员：返回局部变量的地址是一种错误，程序随后会读到已被覆盖的内存。Go 允许
`return &p`，并保证其安全，办法是由编译器判断每个变量是否会逃出其所在的函数，这称为**逃逸分析**（escape
analysis）。`escape.go` 开头的注释把需要保证的性质归结为两条不变式：

1. 指向栈上对象的指针不能存放在堆中；
2. 指向栈上对象的指针，其生命期不能超过该对象。

编译器构造一张带权有向图：顶点表示变量等存储位置，边表示赋值，边的权重记录沿途取地址与解引用的
次数。随后检查是否存在一条路径，把某个变量的地址带入堆中或带出函数；若存在，该变量即分配在堆上。`escape`
中的 `p` 经 `return &p` 被带出函数，因此报告「moved to heap」。`sum` 的参数 `p` 只被读取了
两个字段，报告「does not escape」；这一结论会随包的导出数据一并保存，其他包调用 `sum` 时，同样知道
把栈上变量的地址传给它是安全的。

逃逸分析是保守的：无法证明不逃逸的变量，一律按逃逸处理。把地址存入全局变量、通过 channel 发送、
作为参数传给新的 goroutine，或传给编译器无法分析的函数（例如经由接口调用的方法），通常都会使变量
分配在堆上。

这一思想并非 Go 首创。1990 年代，函数式语言和 Java 的研究者都在探索如何由编译器发现「对象不会逃出所在函
数」，从而将其分配在栈上。1999 年的 OOPSLA 会议上，IBM 的 Choi 等人与 Blanchet 分别发表了面向 Java
的逃逸分析 [[Choi et al., 1999](#ref-choi-et-al-1999)] [[Blanchet, 1999](#ref-blanchet-1999)]。Java
虚拟机在即时编译阶段进行这项分析；Go 则在编译时进行，每次构建都会执行，其结论可以通过 `-gcflags=-m`
直接查看。堆分配的减少，也相应减轻了垃圾回收的负担（[第 13 章](../../part4memory/ch13gc/readme.md)）。

## 3.2.5 语言特性的降级

接下来的阶段称为 walk。它把复杂的语句分解为若干简单步骤，确定求值顺序，并把高级语言特性改写为更
低级的形式：`switch` 转换为二分查找或跳转表，`go` 语句、channel 与 map 的操作则转换为对运行时函数的
调用。以下面的函数为例：

```go
func work() {}

func send(ch chan int, m map[string]int) {
	go work()
	ch <- 1
	m["k"]++
}
```

用 `go build -trimpath -gcflags=-S` 输出 `send` 的汇编（darwin/arm64，省略了指令地址一列和部分
辅助指令）：

```
TEXT  main.send(SB), ABIInternal, $48-16
MOVD  16(g), R16                       // 读取当前 goroutine 的警戒线
CMP   R16, RSP                         // 比较栈指针与警戒线
BLS   112                              // 栈空间不足，跳转到末尾扩展栈
...
MOVD  $main.work·f(SB), R0
CALL  runtime.newproc(SB)              // go work()
MOVD  main.ch(FP), R0
MOVD  $main..stmp_0(SB), R1
CALL  runtime.chansend1(SB)            // ch <- 1
MOVD  $type:map[string]int(SB), R0
MOVD  main.m+8(FP), R1
MOVD  $go:string."k"(SB), R2
CALL  runtime.mapassign_faststr(SB)    // 定位 m["k"] 的存储位置
MOVD  (R0), R1
ADD   $1, R1, R1                       // ++
MOVD  R1, (R0)
...
RET   (R30)
...
CALL  runtime.morestack_noctxt(SB)     // 扩展栈，然后从函数入口重新执行
JMP   0
```

三行 Go 代码转换为三次运行时调用。goroutine、channel 和 map 的语义大部分由运行时实现，编译器负责在
恰当的位置调用它们，并准备好所需的信息。开头的三条指令和末尾的 `morestack` 同样由编译器插入：需要
栈空间的函数在入口处检查剩余的栈空间是否足够，不足则先扩展栈（像 3.2.6 的 `larger` 这样不使用栈的
小函数则省略这一检查）。goroutine 的栈因此可以从很小的尺寸开始，按需增长
（[第 14 章](../../part4memory/ch14stack/readme.md)）。

编译器与运行时之间还有许多类似的分工，常见的几处如下：

| Go 代码 | 编译器生成的代码 | 运行时的职责 |
| --- | --- | --- |
| `go f()` | 调用 `runtime.newproc` | 创建 goroutine，交给调度器（[9.4](../../part3concurrency/ch09sched/schedule.md)） |
| `ch <- v`、`<-ch` | 调用 `runtime.chansend1`、`runtime.chanrecv1` | 收发与阻塞（[第 10 章](../../part3concurrency/ch10chan/readme.md)） |
| 需要栈空间的函数入口 | 检查栈边界，不足时调用 `morestack` | 分配更大的栈并迁移（[第 14 章](../../part4memory/ch14stack/readme.md)） |
| 向堆中写入指针 `*p = q` | 插入写屏障，在垃圾回收期间额外记录 | 回收器据此避免遗漏对象（[13.2](../../part4memory/ch13gc/barrier.md)） |
| 含指针的类型 | 生成标明指针字段位置的位图 | 回收器据此扫描对象（[4.1](../../part2lang/ch04type/type.md)） |

## 3.2.6 静态单赋值形式

在此之前，程序仍保留着源码的形态：一个变量可以被多次赋值，这给优化带来了困难。考虑下面的函数：

```go
func larger(a, b int) int {
	m := a
	if b > a {
		m = b
	}
	return m
}
```

要回答「执行 `return m` 时 `m` 的值是什么」，必须找出所有对 `m` 的赋值，再判断哪些赋值能够到达这里。
若改变表示方式，问题就会简化：每赋值一次，就引入一个新的名字。`m := a` 记作 `m1`，`m = b` 记作
`m2`；两条控制流路径在 `return` 之前汇合，在汇合处放置一个特殊的选择操作，「若来自 `if` 分支则取
`m2`，否则取 `m1`」，其结果记作 `m3`。经过这样的改写，每个名字只在一处被定义，要了解一个值，只需
查看它的定义。

这种表示称为**静态单赋值形式**（static single assignment form，SSA），汇合处的选择操作称为 φ 函数。它由
Barry Rosen、Mark Wegman、Kenneth Zadeck 等人于 1980 年代后期在研究如何判定程序中两个表达式恒等时提出
[[Rosen et al., 1988](#ref-rosen-et-al-1988)]；1991 年，Ron Cytron 等人给出了把任意程序高效转换为 SSA
形式的算法 [[Cytron et al., 1991](#ref-cytron-et-al-1991)]，此后它成为编译器的标准中间表示，GCC 与 LLVM
均以其为核心。原因在于，许多优化在 SSA 形式上都变得直接：一个值若为常量，所有使用处都可以替换为该常量；
两个值的计算完全相同，只需计算一次；一个值若从未被使用，即可删除。

Go 原来的后端继承自 Plan 9 的 C 编译器，并不使用 SSA。Go 1.7（2016 年）在 amd64 上启用了基于 SSA 的新后端
[[Go Authors, 2016](#ref-go-authors-2016)]，Go 1.8 将其推广到所有体系结构
[[Go Authors, 2017](#ref-go-authors-2017)]。设置 `GOSSAFUNC` 可以查看一个函数在每一趟优化之后的形态；
在函数名后加 `+` 会同时输出到终端，否则只生成网页 `ssa.html`
[[Go Authors, 2026b](#ref-go-authors-2026b)]：

```
$ GOSSAFUNC=larger+ go build -o /dev/null .
```

`larger` 刚转换为 SSA 形式时如下（删去了几个无关的值）：

```
b1:
    v7 = Arg <int> {a}
    v8 = Arg <int> {b}
    v10 = Less64 <bool> v7 v8          // a < b
    If v10 -> b3 b2
b2: <- b1 b3
    v12 = Phi <int> v7 v11 (m[int])    // φ 函数：取 v7（m1）或 v11（m2）
    Ret ...
b3: <- b1
    v11 = Copy <int> v8 (b[int], m[int])
    Plain -> b2
```

`b1`、`b2`、`b3` 是三个**基本块**（basic block），即顺序执行的指令序列，块末尾决定控制流的去向。
源码中的 `m` 变成了三个值：`v7`、`v11` 和汇合处的 `v12`，其中 `v12` 即 φ 函数。`larger` 共经过 54 趟
处理，其中几趟的效果最为明显：

- `branchelim` 发现两条路径只是为了选出一个值，于是把分支改写为条件选择，三个基本块合并为一个：`v12 = CondSelect <int> v8 v7 v10`；
- `lower` 把与体系结构无关的操作替换为 arm64 的指令：比较替换为 `CMP`，条件选择替换为 `CSEL`；
- `regalloc` 为每个值分配寄存器：`a` 位于 `R0`，`b` 位于 `R1`，结果写回 `R0`。

最终生成的机器码只有三条指令：

```
CMP   R0, R1            // 比较 b 与 a
CSEL  GT, R1, R0, R0    // 若 b 大于 a 则取 b，否则取 a，结果写入 R0
RET
```

其中没有分支指令。处理器会预测分支的走向，预测失败时必须丢弃已经推测执行的工作；`CSEL` 不涉及分支，
也就不存在预测失败的代价。

## 3.2.7 目标文件与导出数据

编译器写出的目标文件中，除了机器码以及供链接器使用的信息（[3.4](./link.md)），还有一份**导出数据**（export
data），其中包含其他包导入本包时所需的全部信息：导出的类型与函数签名、可内联的函数体、泛型
函数的函数体，以及逃逸分析对每个参数的结论 [[Go Authors, 2026c](#ref-go-authors-2026c)]。

包 Q 导入包 P 时，编译器只读取 P 的导出数据，而不读取 P 的源码。导出数据还包含了 P 的公开接口所涉及
的、来自更底层的包的信息，因此 Q 对每个直接导入的包只需读取一个文件。C 与 C++ 的做法恰好相反：`#include`
把头文件的文本原样插入，同一个头文件在每个包含它的源文件中都要重新解析，而头文件又会
包含其他头文件。Pike 在《Go at Google》中举过 Google 内部的一个例子：一个大型 C++ 程序在展开头文件
之后，交给编译器的输入约为源码本身的两千倍 [[Pike, 2012](#ref-pike-2012)]。

这种做法也有代价：越是上层的包，导出数据中携带的下层信息越多，一组被广泛使用的大型类型几乎会出现在每个包的
导出数据中。编译器的对策是为导出数据建立索引，只解码实际用到的部分
[[Go Authors, 2026a](#ref-go-authors-2026a)]。

由此可以看出 Go 编译器的取向：每次只编译一个包，包与包之间只通过导出数据联系，各个包可以并行编译；
优化以包内为主，内联预算也设定得较小。这换来了很快的编译速度，使 [3.1](./cmd.md) 所述「只重新编译
修改过的包」的增量构建真正节省时间；付出的是一部分运行性能，性能制导优化正是为了在需要之处弥补这部分
损失。

## 延伸阅读

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. "Introduction to the Go compiler."
  `cmd/compile/README.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/README.md
  https://github.com/golang/go/blob/master/src/cmd/compile/README.md
  编译器各阶段与导出数据的官方说明，本节的阶段划分出自此文。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. "Introduction to the Go compiler's
  SSA backend." `cmd/compile/internal/ssa/README.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/internal/ssa/README.md
  https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssa/README.md
  SSA 后端中的值、基本块与改写规则，以及 `GOSSAFUNC` 的用法。
- <a id="ref-rosen-et-al-1988"></a>[Rosen et al., 1988] Barry K. Rosen, Mark N. Wegman, F. Kenneth
  Zadeck. "Global Value Numbers and Redundant Computations." *Proceedings of the 15th ACM Symposium on
  Principles of Programming Languages (POPL)*, 1988. SSA 最早出现的论文之一，用于发现程序中相等的值。
- <a id="ref-cytron-et-al-1991"></a>[Cytron et al., 1991] Ron Cytron, Jeanne Ferrante, Barry K. Rosen,
  Mark N. Wegman, F. Kenneth Zadeck. "Efficiently Computing Static Single Assignment Form and the Control
  Dependence Graph." *ACM Transactions on Programming Languages and Systems*, 13(4): 451–490, 1991.
  https://doi.org/10.1145/115372.115320
  给出了构造 SSA 形式的高效算法，此后为各种编译器普遍采用。
- <a id="ref-choi-et-al-1999"></a>[Choi et al., 1999] Jong-Deok Choi, Manish Gupta, Mauricio Serrano,
  Vugranam C. Sreedhar, Sam Midkiff. "Escape Analysis for Java." *Proceedings of OOPSLA '99*, 1999.
  https://doi.org/10.1145/320384.320386
  面向 Java 的逃逸分析，目的同样是把对象分配在栈上。
- <a id="ref-pike-2012"></a>[Pike, 2012] Rob Pike. "Go at Google: Language Design in the Service of
  Software Engineering." 2012. https://go.dev/talks/2012/splash.article
  Go 为何把编译速度作为设计目标，以及 C++ 头文件展开的例子。
- <a id="ref-go-authors-2016"></a>[Go Authors, 2016] The Go Authors. *Go 1.7 Release Notes*, "Compiler
  Toolchain". https://go.dev/doc/go1.7
  基于 SSA 的新后端首次随正式版本发布。
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Making Unified Intermediate
  Representation (UIR) Changes* (`cmd/compile/internal/noder/README.md`).
  https://github.com/golang/go/blob/master/src/cmd/compile/internal/noder/README.md
  （IR 构造与导出数据格式。）
- <a id="ref-blanchet-1999"></a>[Blanchet, 1999] Bruno Blanchet. "Escape Analysis for Object-Oriented
  Languages: Application to Java." *Proceedings of OOPSLA '99*, 1999: 20–34.
  https://doi.org/10.1145/320384.320387
  与 Choi 等人同期发表的另一种 Java 逃逸分析。
- <a id="ref-go-authors-2017"></a>[Go Authors, 2017] The Go Authors. *Go 1.8 Release Notes*, "Compiler
  Toolchain". https://go.dev/doc/go1.8#compiler
  SSA 后端推广到所有体系结构。
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Profile-guided optimization.*
  https://go.dev/doc/pgo
  `default.pgo` 的用法与 PGO 所做的优化。
- 本书 [15.1 词法与文法](../../part5toolchain/ch15compile/parse.md)、[15.2
  中间表示](../../part5toolchain/ch15compile/ssa.md)、[8.3
  类型检查技术](../../part2lang/ch08generics/checker.md)。
- 本书 [1.1 编程语言的发展](../ch01intro/history.md)、[13.2
  写屏障技术](../../part4memory/ch13gc/barrier.md)、[第
  14 章 执行栈管理](../../part4memory/ch14stack/readme.md)。

