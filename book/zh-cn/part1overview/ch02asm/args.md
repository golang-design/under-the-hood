---
weight: 1204
title: "2.4 参数传递与栈帧布局"
---

# 2.4 参数传递与栈帧布局

[2.3](./callconv.md) 中的参数改由寄存器传递，但寄存器中的值并不持久，下一次函数调用就可能将其覆盖；
寄存器也没有内存地址，无法对其取地址。因此即使在 ABIInternal 下，每次调用仍须在栈上保留一块区域。
本节先说明这块区域中存放的内容，再分析几乎每个函数开头都有的栈空间检查，以及调度器如何借助这项检查
暂停一个 goroutine，最后讨论 Go 为何不采用 C 的调用约定。

## 2.4.1 栈上保留的区域

以 Go ABI 规范中的示例为例 [[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
func F(a1 uint8, a2 [2]uintptr, a3 uint8) (r1 struct{ x uintptr; y [2]uintptr }, r2 string)
```

按照 2.3 的规则，`a1` 与 `a3` 分别放入 AX 与 BX；`a2` 是数组，经由栈传递；返回值 `r1` 含有数组，同样
位于栈上；`r2` 分解为指针和长度两个分量，返回时放在 AX 与 BX 中。调用方在栈上准备的区域自低地址向
高地址依次为：

| 偏移 | 内容 | 调用时的状态 |
| --- | --- | --- |
| 0 | `a2`（16 字节） | 已由调用方写入 |
| 16 | `r1`（24 字节） | 未初始化，由 `F` 在返回前写入 |
| 40 | 为 `a1` 预留的 1 字节 | 未初始化 |
| 41 | 为 `a3` 预留的 1 字节 | 未初始化 |
| 42 | 对齐填充（6 字节） | |

共 48 字节。编译器的 `-S` 输出中，`F` 的第一行是 `main.F STEXT nosplit size=53 args=0x30 ...`，其中
`0x30` 即 48。

表中最后几行值得注意：参数虽然经由寄存器传递，调用方仍在栈上为每个寄存器参数预留了位置，但并不写入。
这块区域称为参数的**溢出区**（spill space），用于以下几种情况：

- `F` 需要扩栈时（2.4.2），必须先把寄存器中的参数保存到内存。此时 `F` 自身的栈已接近耗尽，未必能再
  为这些参数腾出空间，而调用方预留的区域早已就绪。
- `F` 对参数取地址（如 `&a1`）时，参数需要一个固定的内存位置。
- 参数因其他原因需要溢出到内存时，也存放在这里。运行时打印调用栈时从这里读取参数的值；若参数在此后
  未被写回，打印出的值可能已经过时，运行时会在其后标注 `?`。

其代价是栈空间的占用有所增加。据 ABI 规范估计，这部分空间的浪费中位数为每次调用 16 字节；规范把完全
去掉预留的溢出区列为长期目标 [[Go Authors, 2026a](#ref-go-authors-2026a)]。

调用之后哪些寄存器的值保持不变，也是调用约定的一部分。C 的调用约定规定了一组**被调方保存寄存器**
（callee-saved register），被调函数若使用它们，必须在返回前恢复原值。ABIInternal 没有这类寄存器：
除下表所列具有固定含义的寄存器外，任何寄存器都可能在调用中被改写，调用方若在调用之后仍需要某个值，
须自行将其保存到栈上。ABI 规范指出，这一设计显著简化了垃圾回收器与编译器的寄存器分配器，
代价是损失一部分性能 [[Go Authors, 2026a](#ref-go-authors-2026a)]。对垃圾回收器而言，
扫描栈时无须追查某个指针被哪一层函数暂存在了哪个寄存器中。amd64 上具有固定含义的寄存器如下：

| 寄存器 | 含义 |
| --- | --- |
| SP | 栈指针 |
| BP | 帧指针，调试器与性能剖析工具借助它回溯调用链 |
| R14 | 指向当前 goroutine |
| X15 | 在调用与返回时恒为零 |

此外，调用闭包时 DX 传递闭包的上下文指针，但这一含义仅在调用发生的时刻成立。

## 2.4.2 函数开头的栈检查

goroutine 的栈起初很小，不足时再更换为更大的栈。新建 goroutine 的栈从 2 KiB 开始；自 Go 1.19 起，
运行时还在每轮垃圾回收中统计各 goroutine 栈的平均使用量，据此调整从空闲链表复用的 goroutine 的栈大小
[[Go Authors, 2022](#ref-go-authors-2022)]（[14.2.5](../../part4memory/ch14stack/alloc.md)）。因此，
几乎每个函数在开头都要先确认剩余的栈空间是否足够。下面的递归函数 `Deep` 有一个参数 `n`，局部变量中有一个
16 字节的数组：

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

编译到 linux/amd64 后，函数的开头与结尾如下（省略了中间部分）：

```
TEXT	main.Deep(SB), ABIInternal, $32-8
CMPQ	SP, 16(R14)                    // 与当前 goroutine 的警戒线比较
JLS	69                             // 不高于警戒线：跳转到末尾扩栈
PUSHQ	BP                             // 检查通过：保存 BP，为局部变量分配空间
MOVQ	SP, BP
SUBQ	$24, SP
……
MOVQ	AX, 8(SP)                      // 偏移 69：把 AX 中的参数 n 存入调用方预留的溢出区
CALL	runtime.morestack_noctxt(SB)   // 更换为更大的栈
MOVQ	8(SP), AX                      // 取回 n
JMP	0                              // 回到开头重新检查
```

32 字节的帧由三部分组成：保存 BP 的 8 字节、数组 `buf` 的 16 字节，以及调用 `Deep(n-1)` 时为其参数
预留的 8 字节溢出区。

函数开头的这几条准备指令称为**函数序言**（prologue）。R14 指向当前 goroutine 的 `g` 结构体，其偏移
16 处存放该 goroutine 的**警戒线**（stack guard，即字段 `stackguard0`）。一旦 SP 不高于警戒线，函数
便跳转到末尾：先把寄存器中的参数保存到 2.4.1 所述的溢出区，再调用 `morestack`（[2.2](./frame.md)）
更换栈，随后取回参数，回到开头重新检查。

警戒线并不位于栈的最底端，而是位于其上方 928 字节处（linux/amd64）。其中 800 字节供不做检查的 `NOSPLIT`
函数链使用，链接器会核对这类调用链不超出此限；另外 128 字节使栈帧不超过 128 字节的函数可以直接用 SP
与警戒线比较，不必先减去自身栈帧的大小 [[Go Authors, 2026b](#ref-go-authors-2026b)]。
栈帧更大的函数需要多做一步计算；栈帧超过 4096 字节时，SP 减去帧大小还可能发生回绕，因此还要检查借位。
下面两个函数的局部变量分别是 1 KiB 与 8 KiB 的数组：

```
TEXT	main.Medium(SB), ABIInternal, $1040-0
LEAQ	-912(SP), R12                  // 912 = 1040 - 128
CMPQ	R12, 16(R14)

TEXT	main.Huge(SB), ABIInternal, $8208-0
MOVQ	SP, R12
SUBQ	$8080, R12                     // 8080 = 8208 - 128
JCS	63                             // 发生借位（SP 小于 8080）：直接转去扩栈
CMPQ	R12, 16(R14)
```

还有一类函数完全省去了检查。[2.3](./callconv.md) 开头 `Add` 的输出中标有 `NOSPLIT`，而源码并未提出
这一要求。在 amd64 上，若一个函数的栈帧小于 128 字节，且除少数不带参数的运行时函数（如报告下标越界的
`runtime.panicBounds`）外不调用任何函数，它使用的栈就不会超出警戒线以下预留的余量，`cmd/internal/obj`
便自动将其标记为 `NOSPLIT`，省去检查 [[Go Authors, 2026b](#ref-go-authors-2026b)]。

扩栈时，运行时分配一块大小为原来两倍的新栈，把旧栈的内容整体复制过去，再调整栈上指向栈内的指针
（[14.3](../../part4memory/ch14stack/grow.md)）。下面的程序在一个新 goroutine 中逐步加深递归，并观察
一个局部变量的地址：栈被移动时，该地址随之改变。

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
	go func() { // 新 goroutine 的栈从 2 KiB 开始
		var x int // 栈被移动时，x 的地址随之改变
		old, last := uintptr(unsafe.Pointer(&x)), 0
		for depth := 1; depth <= 1000; depth++ {
			down(depth)
			if now := uintptr(unsafe.Pointer(&x)); now != old {
				fmt.Printf("递归 %3d 层时栈被移动，比上次多 %3d 层\n", depth, depth-last)
				old, last = now, depth
			}
		}
		done <- true
	}()
	<-done
}
```

在 darwin/arm64 上的输出为：

```
递归  29 层时栈被移动，比上次多  29 层
递归  93 层时栈被移动，比上次多  64 层
递归 221 层时栈被移动，比上次多 128 层
递归 477 层时栈被移动，比上次多 256 层
递归 989 层时栈被移动，比上次多 512 层
```

相邻两次移动之间增加的递归层数依次翻倍：64、128、256、512。在这台机器上，`down` 每层占用 32 字节，
64 层恰好是 2 KiB。栈共移动 5 次，依次增长为 4 KiB、8 KiB、16 KiB、32 KiB 与 64 KiB；每次新增的空间等于
旧栈的大小，正好对应下一段多出的层数。在网页上运行时，程序被编译为 WebAssembly，每层只占 16 字节，
输出变为 58、186、442、954 层，间隔同样是 128、256、512 层，逐次翻倍。由于栈的大小每次翻倍，历次复制
的字节数之和不会超过最终栈的大小，扩栈的总开销与栈的最终大小成正比。

## 2.4.3 抢占借用同一项检查

一个 goroutine 连续运行超过 10 毫秒时，系统监控（[9.8](../../part3concurrency/ch09sched/sysmon.md)）
会请求它让出处理器，使其他 goroutine 也有机会运行。最直接的做法是借用上述栈检查：把该 goroutine 的
警戒线改为一个大于任何栈地址的值。它下一次调用函数时，检查必然失败，于是进入 `morestack`。运行时发现
警戒线是这一特殊值，便知道并非栈空间不足，因此不扩栈，而是如同调用 `runtime.Gosched` 一样让出处理器；
待它再次被调度执行时，警戒线恢复原值 [[Go Authors, 2026c](#ref-go-authors-2026c)]。

```go
// runtime/proc.go，preemptone（节选，注释为译文）
gp.preempt = true
// 每次函数调用都会比较当前的栈指针与 gp.stackguard0，以检查栈是否溢出。
// 将其设为 stackPreempt，便把抢占并入了常规的栈溢出检查。
gp.stackguard0 = stackPreempt // 在 64 位平台上为 0xfffffffffffffade
```

这种做法无须在代码中增加任何指令，局限也很明显：它只在函数调用时生效。不调用任何函数的循环永远不会
执行这项检查，在 Go 1.14 之前，这样的循环可以一直占用处理器。Go 1.14 引入了基于操作系统信号的异步
抢占 [[Clements, 2019](#ref-clements-2019)]，`preemptone` 在设置警戒线之后紧接着发出这一请求，详见
[9.7](../../part3concurrency/ch09sched/preemption.md)。

## 2.4.4 为何不采用 C 的调用约定

Linux 上的 C 与 C++ 程序遵循同一套平台调用约定，可以直接相互调用。Go 的寄存器传参提案（2.3）明确
选择不采用平台约定 [[Clements, 2020](#ref-clements-2020)]，理由有两方面。

其一，共用约定的收益有限。直观上看，与 C 共用约定可以降低调用 C 函数的开销；但 goroutine 的栈会动态
伸缩，调度也由 Go 运行时而非操作系统完成，调用非 Go 代码时，无论约定是否相同，都必须切换到固定的栈并
通知调度器。调试器与性能剖析工具普遍依赖 DWARF 调试信息或帧指针回溯，Go 不采用平台约定，也能与之
配合。

其二，C 的约定并不适合 Go。x86-64、arm64 与 RISC-V 的 ELF ABI 都不用寄存器传递超过两个字的聚合类型，
占三个字的切片因此只能经由内存传递；这些约定通常最多为返回值保留两个寄存器，而 Go
函数常常返回一个结果加一个占两个字的 `error`，共三个字。平台约定中的被调方保存寄存器会给垃圾回收器带来额外
负担（2.4.1）。此外，各平台的约定在细节上各不相同，自行定义约定，就可以在所有体系结构上沿用同一种结构
[[Clements, 2020](#ref-clements-2020)]。

自行定义的约定还提供了平台约定所没有的便利：R14 始终指向当前 goroutine，函数序言用一条指令即可读到
警戒线；X15 恒为零；多个返回值都可以放在寄存器中。更重要的是，ABIInternal 由编译器、运行时与汇编器在
同一个代码库中共同维护，可以随版本演进：Go 1.17 把参数从栈移到寄存器，用户代码无须任何修改；将来去掉
2.4.1 中预留的溢出区，也是如此。

代价体现在与 C 交互时。经由 cgo 调用 C 函数，需要从 goroutine 的栈切换到线程的 `g0` 栈（C 代码不做
栈检查，其栈上的指针也无法在栈移动时得到调整），按 C 的约定重新安排参数、保存和恢复寄存器，还要通知
调度器该线程暂时脱离 Go 运行时的管理。因此，一次 cgo 调用的开销远大于一次普通的 Go 函数调用，详见
[15.6](../../part5toolchain/ch15compile/cgo.md)。

## 延伸阅读

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *Go internal ABI specification*.
  `src/cmd/compile/abi-internal.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/abi-internal.md
  https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md
  栈帧布局、溢出区的设计理由、具有固定含义的寄存器，以及「未来方向」一节中的改进设想。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `runtime/stack.go` 与
  `cmd/internal/obj/x86/obj6.go`（`stacksplit`）.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/internal/obj/x86/obj6.go
  https://github.com/golang/go/tree/master/src/runtime （`runtime/stack.go`、`preempt.go`、`internal/abi/stack.go`）
  警戒线大小的推导，函数序言中三种检查的生成方式，以及哪些函数可以省去检查。
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. `runtime/preempt.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/preempt.go
  文件开头的注释说明了各种抢占时机，以及如何借用栈检查实现抢占。
- <a id="ref-clements-2019"></a>[Clements, 2019] Austin Clements. "Proposal: Non-cooperative goroutine
  preemption." Go proposal 24543, 2019.
  https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md
  仅靠函数调用处的检查为何不够，以及 Go 1.14 基于信号的抢占如何设计。
- <a id="ref-clements-2020"></a>[Clements, 2020] Austin Clements. "Proposal: Register-based Go calling
  convention." Go proposal 40724, 2020.
  https://go.googlesource.com/proposal/+/master/design/40724-register-calling.md
  其中比较了采用平台约定与自行定义约定的利弊。
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *Go 1.19 Release Notes*, "Runtime".
  https://go.dev/doc/go1.19#runtime
  新 goroutine 的初始栈大小改为依据历史平均用量确定。
- 本书 [2.1 Plan 9 汇编语言](./asm.md)、[2.3 调用约定与寄存器 ABI](./callconv.md)、
  [6.1 函数调用](../../part2lang/ch06func/func.md)、
  [14 执行栈管理](../../part4memory/ch14stack)、
  [9.7 协作与抢占](../../part3concurrency/ch09sched/preemption.md)、
  [15 编译器](../../part5toolchain/ch15compile)。

