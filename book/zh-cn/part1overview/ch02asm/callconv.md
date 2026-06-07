---
weight: 1202
title: "2.2 调用规范"
---

# 2.2 调用规范

> 本节内容对标 Go 1.26。文中的寄存器名、栈帧布局与序言代码以 amd64 为例，
> 其余体系结构（arm64、riscv64 等）结构相同而寄存器名不同，可对照
> `src/cmd/compile/abi-internal.md` 的「Architecture specifics」一节。

一次函数调用，在机器层面要回答一连串具体的问题：参数放哪里，返回值放哪里，谁负责保存哪些
寄存器，栈帧怎样布局，返回地址压在何处。把这些问题的答案固定下来，就是调用规范（calling
convention），它也常被称作 ABI（application binary interface）。ABI 不是某一段代码，而是一份
**契约**：编译器生成的代码、手写的 Plan 9 汇编（[2.1](./asm.md)）、运行时里的底层例程，三方各自
独立编写，却要在调用的那一刻严丝合缝地对接。契约一旦写定，三方就都按它来摆放数据，谁也不必
知道对方的内部细节。

[6.1](../../part2lang/ch06func/func.md) 已从语言视角讲过函数调用从栈到寄存器的演进，那里关心的是
「一次 `f(a, b)` 在 Go 语义上发生了什么」。这一节补足它在汇编与运行时层面的另一半：同一次调用，
落到机器指令上是如何约定的。两者合起来，函数调用这件事才算讲完整。

## 2.2.1 两套 ABI：ABI0 与 ABIInternal

Go 同时维护着两套调用规范，理解它们的分工是读懂运行时里那些奇怪符号标注的钥匙。

**ABI0** 是早期的、**基于栈**的规范：所有参数与返回值一律通过栈内存传递，调用方在自己的栈帧里
按顺序摆好参数，被调用方从固定偏移处取用。它的好处是布局稳定、可预测，人脑能算清每个参数的
偏移。手写汇编因此一律遵循 ABI0，`go.dev/doc/asm` 描述的就是这套稳定 ABI。ABI0 还有一个常被
忽略的性质：它是 Go 唯一**承诺稳定**的 ABI，是汇编与 Go 之间唯一可靠的接缝。

**ABIInternal** 是 Go 1.17 引入的、**基于寄存器**的内部规范：尽量把参数与返回值放进寄存器，省去
大量进出栈内存的读写。所有由 Go 源码编译出的函数都走 ABIInternal。它的名字里「Internal」二字是
郑重的警告：这套 ABI **不稳定**，会随 Go 版本变化，任何外部代码都不应依赖它的细节。换来的是
约 5% 的整体提速，且这份提速对用户代码完全透明，源码一字不改，重新编译即享。

在 amd64 上，ABIInternal 用如下 9 个整数寄存器顺序传递整型参数与返回值，浮点用 `X0`–`X14`：

```
RAX, RBX, RCX, RDI, RSI, R8, R9, R10, R11
```

参数的分配是**递归**的：一个值按其类型拆成基础部件，每个部件占一个寄存器。一个 `string` 拆成
指针与长度两个寄存器，一个 `[]T` 拆成三个，一个小结构体按字段逐个铺开。装不下的（寄存器用尽，
或含有非平凡数组的值）整个退回栈上传递。这条规则有一个值得记住的边界：**含数组的参数一律走栈**，
因为按下标访问数组要算偏移，而偏移没法落在寄存器里；Go 1.15 标准库里只有 0.7% 的函数签名含数组，
为这极少数破例不值得，于是干脆全栈传。

两套并存，意味着边界处需要**桥接**。当 ABIInternal 的 Go 代码调用 ABI0 的汇编函数，或反过来，
两边对「参数在哪」的理解并不一致，链接器会自动插入一小段**包装代码**（ABI wrapper）做参数的
搬运：把寄存器里的实参摆到栈上对应位置，或反向搬回。这层桥接由内部 ABI 提案（27539）规定，
对调用双方透明。它在符号表里露出马脚，运行时里同一个名字常带 ABI 标注后缀：

```
runtime.morestack_noctxt.abi0       // ABI0 版本
runtime.systemstack<ABIInternal>    // ABIInternal 版本
```

读运行时反汇编时，看到 `·f<ABIInternal>` 与 `·g.abi0` 这类标注，便知道链接器在此处可能架了一座
桥。多数情况下你不必关心桥的存在；只有在手写汇编里直接调用 Go 函数，或反过来被 Go 调用时，
才需要清楚自己站在哪一侧 ABI。

## 2.2.2 一个掺杂栈传与寄存器传的例子

抽象规则不如一个例子来得清楚。取 ABI 规范里那个精心设计的签名，它故意同时含有能进寄存器的
标量与必须走栈的数组：

```go
func f(a1 uint8, a2 [2]uintptr, a3 uint8) (
    r1 struct{ x uintptr; y [2]uintptr }, r2 string)
```

按 2.2.1 的递归分配，在 amd64（整数寄存器 `RAX, RBX, ...`）上结果是：

- `a1`、`a3` 是能进寄存器的标量，分到 `RAX`、`RBX`；
- `a2` 是非平凡数组，**整个退回栈上**；
- 返回值 `r1` 含数组，也走栈；`r2` 是 `string`，拆成 base 与 len 两部分，回填 `RAX`、`RBX`
  （返回时寄存器重新从头计数，与入参不冲突）。

于是入口时只有 `a2` 在栈上有初值，栈帧布局如下，其余区域调用时一律不初始化：

```
        +------------------------------+
        | a3Spill  uint8               |   寄存器参数的溢出槽
        | a1Spill  uint8               |   （调用方预留，调用时空着）
        +------------------------------+
        | r1.y  [2]uintptr             |   栈传返回值
        | r1.x  uintptr                |
        +------------------------------+
        | a2    [2]uintptr             |   栈传参数（唯一带初值者）
        +------------------------------+ ↓ 低地址
```

这个例子把三件事一次说清：标量优先进寄存器，含数组的值整体走栈，而**每个寄存器参数仍在栈上
留有一格溢出槽**待命。把它和 2.2.1 那条「全栈传」的 ABI0 对照，差别一目了然：ABI0 下 `a1`、`a3`
连同 `a2` 全在栈上按序排开，没有寄存器、也无需溢出槽；ABIInternal 把能搬的都搬进了寄存器，省下
的正是那几次进出栈内存的读写。

## 2.2.3 栈帧、溢出槽与寄存器约定

一次调用压入一个**栈帧**，自高地址向低地址，依次容纳：调用方为被调用方预留的栈传参数区与栈传
返回值区、被调用方的局部变量、需要保存的寄存器、以及返回地址。amd64 上以低地址在下的惯例画出，
一个含寄存器传参的调用，其栈帧大致是这样：

```
        +------------------------------+
        |   寄存器参数的溢出槽（spill）   |   ← 调用方预留，调用时不填
        +------------------------------+
        |       栈传返回值                |
        +------------------------------+
        |       栈传参数                  |
        +------------------------------+ ↓ 低地址
```

这里的**溢出槽**（spill space）是寄存器 ABI 特有的设计，也是一处精巧的取舍。寄存器传参省下了
栈读写，但寄存器会被后续指令覆写，一旦函数中途需要扩栈（见下一节），就得有地方把这些寄存器
实参先「溢」出来暂存。关键在于：**这块暂存空间由调用方在自己的栈帧里预留**，而非被调用方。原因
是被调用方扩栈时，它自己的栈帧可能根本腾不出空间，让调用方提前备好，扩栈路径才有落脚点。这块
槽位同时充当实参的「家」，traceback 打印参数、`reflect` 调用归约参数都借它，是一处一举多用的安排。

寄存器还分两类约定。amd64 上 `R14` 恒定指向**当前 goroutine**（即 `g`），`RSP`/`RBP` 是栈指针与
帧指针，`RDX` 在调用闭包时传递闭包上下文。值得点出的是：Go 的 ABIInternal **没有调用方保存／
被调用方保存（callee-save）的寄存器**之分，一次调用可以覆写任何没有固定含义的寄存器，包括参数
寄存器。这简化了实现，代价是调用前后调用方若还要用某个寄存器里的值，得自己负责保存。

## 2.2.4 序言里的栈增长检查，与抢占搭的便车

Go 的调用规范还嵌进了一件别家 ABI 少有的事：**栈增长检查**。Go 的 goroutine 栈很小（初始 2KB），
按需增长（[14 执行栈](../../part4memory/ch14stack)），这要求几乎每个函数在干正事之前，先确认当前栈
空间还够用。于是编译器在几乎每个函数的**序言**（prologue）里都插入一小段检查：把栈指针 `SP` 与
`g.stackguard0` 比一比，不够就跳去 `morestack` 扩栈，扩完再从头执行本函数。下面是 `go tool objdump`
对一个普通函数序言的实拍（arm64 上 `R28` 即 `g`，`16(R28)` 是 `g.stackguard0`，与 amd64 同构）：

```asm
MOVD 16(R28), R16            // R16 = g.stackguard0
CMP  R16, RSP                // 比较栈指针与栈保护边界
BLS  <morestack tail>        // SP 低于边界，栈快用尽，跳去扩栈
MOVD.W R30, -32(RSP)         // 检查通过，正常的栈帧建立
...                          // 函数体
// 序言开头跳来的尾巴：
MOVD R30, R3
CALL runtime.morestack_noctxt.abi0(SB)   // 扩栈
JMP  本函数(SB)               // 扩栈后回到序言重跑
```

注意尾巴里那个 `.abi0` 后缀，`morestack` 是用手写汇编实现的，走 ABI0，正是上一节所说的边界。

序言代码并非千篇一律，编译器按栈帧大小分三档优化（`StackSmall = 128`、`StackBig = 4096` 字节）：
帧 $\le$ `StackSmall` 的函数，栈底预留的余量足以容纳它，于是只需一条 `CMP guard, SP` 加一次跳转，
省掉一条减法指令；帧介于二者之间的，要先算出 `SP - framesize` 再比；帧 $\ge$ `StackBig` 的索性
不比，无条件调 `morestack`。这种「为小帧函数省一条指令」的斤斤计较，正因为这段检查会出现在
**几乎每一个函数**里，省下的常数乘以调用频次便相当可观。

真正巧妙的是，这段为栈增长而生的检查，被 Go 的**协作式抢占**搭了便车（[9.7](../../part3concurrency/ch09sched/preemption.md)）。
运行时想让某个 goroutine 让出 CPU 时，并不需要另设一套打断机制，只消把它的 `stackguard0` 改写成
一个**永远比任何合法 `SP` 都大**的哨兵值 `stackPreempt`：

```go
// 请求抢占：把栈保护边界改成哨兵值（runtime/preempt.go 速写）
gp.preempt = true
gp.stackguard0 = stackPreempt   // 一个绝不会被合法 SP 满足的值
```

这样一来，该 goroutine 下一次进入任意函数序言、做那条 `CMP guard, SP` 时，检查必然「失败」，
跳进 `morestack`。`morestack` 发现 `stackguard0` 是 `stackPreempt` 而非真的栈不足，便顺势把控制权
交还调度器，完成一次让出，让出后再把 `stackguard0` 复位为 `stack.lo + stackGuard`。一个看似纯粹的
ABI 细节（序言里那条栈检查），同时服务了**栈增长**与**协作式抢占**两件事。这是 Go 把多种机制叠在
同一个低成本检查点上的典型手法：检查点你反正每次调用都要付，那就让它一票多用。当然，这条路
只在函数调用处生效，对不含调用的紧凑循环无能为力，那是异步抢占要补的另一半，[9.7](../../part3concurrency/ch09sched/preemption.md)
专门展开。

## 2.2.5 为何自定义 ABI

Go 没有沿用所在平台的标准 ABI（如 amd64 上的 System V AMD64 ABI），而是从头定义了自己的两套
ABI。这是一个有明确代价、也有明确收益的选择。

放进谱系里看会更清楚。多数原生编译型语言（C、C++、Rust）直接复用平台 ABI，于是它们之间、以及
与操作系统接口之间能零成本互调，代价是被平台约定锁死，难以为自己的运行时定制。带托管运行时的
语言则普遍另起炉灶：JVM、CLR 都有自己的内部调用约定，与平台 ABI 只在 JNI、P/Invoke 这类受控
边界处对接。Go 选的是后一条路，且走得更彻底，它连汇编器（[2.1](./asm.md)）都是自有的，整条
工具链对调用规范握有完全的话语权。System V ABI 用 `rdi, rsi, rdx, rcx, r8, r9` 传整型参数，Go 却
另选了 `RAX, RBX, RCX, ...` 这一串，并把 `R14` 钉死为当前 goroutine，这些都是平台 ABI 给不了的
自由。

代价是**与外部目标文件不能直接互通**。调用一段 C 代码（cgo），就要跨越 ABI 边界：Go 的寄存器约定、
栈布局、`g` 指针约定与 C 世界全不一样，每次过界都要切换栈、保存／恢复一批寄存器、调整调用约定，
这是实打实的开销，也是 cgo「调用一次不便宜」的根源之一（[15 编译器](../../part5toolchain/ch15compile)）。

收益是**对调用规范的完全掌控**。最有说服力的证据，正是 2.2.1 那次从栈到寄存器的切换：ABI0 演进到
ABIInternal，给整个生态带来约 5% 的提速，而用户代码一行未改。这件事之所以能透明地发生，恰恰
**因为这套 ABI 是 Go 自己的**，不必兼容任何外部约定，运行时与编译器同属一个项目、同步演进，改
ABI 不会惊动谁。若 Go 当初绑定了平台 System V ABI，这类优化要么做不成，要么会破坏与外部世界的
二进制兼容。

这与 [2.1](./asm.md) 维护一套自有的 Plan 9 汇编器、[6.1](../../part2lang/ch06func/func.md) 在调用约定上
反复打磨，是同一种哲学的不同侧面：**Go 宁可牺牲与外部世界的无缝互通，也要保住对自身实现的主权。**
正是这份主权，让它能在不惊动用户代码的前提下，一次又一次地优化运行时的底层。性能的提升从不
白来，这一次，它换走的是与 C 世界免费互通的便利。

## 延伸阅读的文献

1. The Go Authors. *Go internal ABI specification (ABIInternal).*
   https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md
   （ABIInternal 的权威说明：参数分配算法、溢出槽、各体系结构寄存器映射）
2. Austin Clements et al. *Proposal: Register-based Go calling convention*（40724，Go 1.17）.
   https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md
   （为何用统一的自定义 ABI 而非平台 ABI，以及约 5% 提速的来由）
3. The Go Authors. *Proposal: Create an undefined internal calling convention*（27539）.
   https://go.googlesource.com/proposal/+/master/design/27539-internal-abi.md
   （ABI0 与 ABIInternal 之间透明 wrapper 的设计）
4. The Go Authors. *A Quick Guide to Go's Assembler*（ABI0、伪寄存器、稳定汇编 ABI）.
   https://go.dev/doc/asm
5. The Go Authors. *runtime/stack.go、preempt.go、internal/abi/stack.go.*
   https://github.com/golang/go/tree/master/src/runtime
   （序言栈检查、`stackPreempt` 哨兵、`StackSmall`/`StackBig` 帧分档）
6. 本书 [2.1 Plan 9 汇编](./asm.md)、[6.1 函数调用](../../part2lang/ch06func/func.md)、
   [14 执行栈管理](../../part4memory/ch14stack)、
   [9.7 协作与抢占](../../part3concurrency/ch09sched/preemption.md)、
   [15 编译器](../../part5toolchain/ch15compile)。

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
