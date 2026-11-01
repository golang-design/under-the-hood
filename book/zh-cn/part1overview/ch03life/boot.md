---
weight: 1305
title: "3.5 Go 程序启动引导"
---

# 3.5 Go 程序启动引导

执行到 `main` 的第一行时，运行时已经完成了大量工作。下面的程序在进入 `main` 后立即记录运行时的
状态：

```go {run=true}
package main

import (
	"fmt"
	"runtime"
	"runtime/metrics"
)

func main() {
	// 先读取状态再输出：输出本身也会分配内存，改变这些状态
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	s := []metrics.Sample{
		{Name: "/sched/goroutines:goroutines"},
		{Name: "/sched/threads/total:threads"},
	}
	metrics.Read(s)
	user := runtime.NumGoroutine()

	fmt.Printf("版本与平台：%s %s/%s\n", runtime.Version(), runtime.GOOS, runtime.GOARCH)
	fmt.Printf("CPU 数：%d，GOMAXPROCS：%d\n", runtime.NumCPU(), runtime.GOMAXPROCS(0))
	fmt.Printf("goroutine：共 %d 个，NumGoroutine 只报告 %d 个\n", s[0].Value.Uint64(), user)
	fmt.Printf("系统线程：%d 个\n", s[1].Value.Uint64())
	fmt.Printf("堆：%d KiB，栈：%d KiB\n", ms.HeapSys>>10, ms.StackInuse>>10)
	fmt.Printf("垃圾回收：%d 次\n", ms.NumGC)
}
```

在一台 darwin/arm64 机器上的输出如下：

```
版本与平台：go1.26.10 darwin/arm64
CPU 数：18，GOMAXPROCS：18
goroutine：共 6 个，NumGoroutine 只报告 1 个
系统线程：5 个
堆：3840 KiB，栈：256 KiB
垃圾回收：0 次
```

CPU 数、线程数和内存用量随机器而异；即使在同一台机器上，线程数（我们观察到 4 至 6 个）和堆的大小
也会随每次运行变化。在网站上运行时，程序运行于浏览器中的 js/wasm 环境，只有一个线程，CPU 数、GOMAXPROCS
和线程数均为 1，堆为 384 KiB，栈为 128 KiB。

6 个 goroutine 中只有 1 个在执行用户的 `main`，其余 5 个是运行时的后台 goroutine，例如垃圾回收的
清扫与内存归还，`NumGoroutine` 不把它们计算在内。这些 goroutine 以及多出的几个线程，都是在调用
`main.main` 之前不久才创建的（[3.6](./main.md)）。本节讨论更早的阶段：从操作系统开始执行程序，到
第一个 goroutine 开始运行。这一阶段的起点没有任何 goroutine，也无法分配内存，只有一个线程和操作系统
提供的一段栈，运行时必须在此基础上逐步建立起自身。下文以 Linux 和 x86-64（amd64）为例，所用的程序
是 [3.4](./link.md) 中编译出的 `hello`。

## 3.5.1 程序入口与初始栈

执行 `./hello` 时，Linux 内核完成三项工作：按照可执行文件的程序头，把代码和数据映射到链接器指定的
地址；为程序建立初始栈，写入命令行参数、环境变量等信息；跳转到文件头中记录的入口地址。`hello` 不
依赖共享库，不需要动态链接器参与，内核直接跳转到 Go 的代码。入口正是 3.4 中那条引用链的起点：

```
$ objdump -f hello | grep start
start address: 0x0000000000480580
$ go tool nm hello | grep ' _rt0_amd64_linux$'
  480580 T _rt0_amd64_linux
```

初始栈的内容由 x86-64 的 System V ABI 规定 [[Matz et al., 2014](#ref-matz-et-al-2014)]，自栈顶起依次为：

```
argc：参数个数
argv：参数指针数组，以 0 结尾
envp：环境变量指针数组，以 0 结尾
auxv：辅助向量，由（类型，值）对组成，以 AT_NULL 结尾
……（参数与环境变量的字符串内容）
```

**辅助向量**（auxiliary vector，auxv）是内核以（类型，值）对的形式传递给程序的一组信息，例如内存
页的大小（`AT_PAGESZ`）、一个指向 16 字节随机数据的指针（`AT_RANDOM`），以及内核映射到进程中的
vDSO 的位置。Go 运行时稍后会用到这些信息。

入口代码本身只有几条指令。每种操作系统与体系结构的组合各有一个入口，它们很快汇合到同一体系结构
共用的 `rt0_go`：

```asm
// runtime/rt0_linux_amd64.s 与 runtime/asm_amd64.s（Go 1.26）
TEXT _rt0_amd64_linux(SB),NOSPLIT,$-8
	JMP	_rt0_amd64(SB)

TEXT _rt0_amd64(SB),NOSPLIT,$-8
	MOVQ	0(SP), DI	// 栈顶：argc
	LEAQ	8(SP), SI	// 其后：argv
	JMP	runtime·rt0_go(SB)
```

macOS 的情况有所不同。Go 程序在 macOS 上总是动态链接 `libSystem`（3.4），因此由系统的动态链接器
dyld 首先运行，再像调用 C 程序的 `main` 那样，把参数个数和参数列表放在寄存器中传入。所以
`_rt0_arm64_darwin` 只有一条跳转到 `rt0_go` 的指令。

## 3.5.2 g0、m0 与线程本地存储

3.4 中 `hello` 的 `main.main`，编译后的第一条指令是：

```
CMPQ	SP, 16(R14)
```

几乎每个 Go 函数的序言都包含这样一条比较：检查栈指针是否已越过当前 goroutine 栈的警戒线
（[2.4](../ch02asm/args.md)），若已越过，则先扩展栈再继续执行
（[第 14 章](../../part4memory/ch14stack/readme.md)）。`R14` 中保存着指向当前 goroutine 描述符的
指针，`16(R14)` 即其中的警戒线字段 `stackguard0`。由此可见，在执行第一个 Go 函数之前，必须先存在
一个 goroutine 及其栈，并且当前线程能够找到它。

运行时以结构体 `g` 描述一个 goroutine，以结构体 `m` 描述一个操作系统线程。每个 `m` 还拥有一个特殊的
goroutine `g0`，它使用线程自身的栈，不执行用户代码，只用于运行时的内部工作，例如选择下一个要运行的
goroutine，或者为其他 goroutine 扩展栈（[第 9 章](../../part3concurrency/ch09sched/readme.md)）。

此时尚不能分配内存，主线程的 `m` 与 `g0` 因而无法动态创建。它们是两个全局变量 `runtime.m0` 和
`runtime.g0`，由链接器在数据段中预留空间，程序加载后即已存在。`rt0_go` 首先完成三项工作（有删节）：

```asm
TEXT runtime·rt0_go(SB),NOSPLIT|NOFRAME|TOPFRAME,$0
	// 1. 在操作系统提供的栈上，自当前位置向下划出 64 KB 作为 g0 的栈
	MOVQ	$runtime·g0(SB), DI
	LEAQ	(-64*1024)(SP), BX
	MOVQ	BX, g_stackguard0(DI)       // 函数序言中比较的警戒线
	MOVQ	BX, (g_stack+stack_lo)(DI)
	MOVQ	SP, (g_stack+stack_hi)(DI)

	// 2. 通过 CPUID 查询处理器厂商与版本信息
	MOVL	$0, AX
	CPUID
	...

	// 3. 设置线程本地存储，并写入、读回一个值以确认其可用
	LEAQ	runtime·m0+m_tls(SB), DI
	CALL	runtime·settls(SB)
	...
	get_tls(BX)
	LEAQ	runtime·g0(SB), CX
	MOVQ	CX, g(BX)       // 当前 goroutine 为 g0
	LEAQ	runtime·m0(SB), AX
	MOVQ	CX, m_g0(AX)    // m0.g0 = g0
	MOVQ	AX, g_m(CX)     // g0.m = m0
```

第 3 步解决「线程如何找到当前 goroutine」的问题。同一进程中的线程共享全部地址空间，
为每个线程提供一个私有的位置需要操作系统的支持，即**线程本地存储**（thread-local storage，TLS）[[Drepper,
2013](#ref-drepper-2013)]。在 Linux 的 x86-64 上，段寄存器 FS 的基址指向当前线程的 TLS
区域；运行时通过系统调用 `arch_prctl` 设置这一基址，再在固定偏移处存放指向当前 goroutine 的指针。
前文提到的 `R14` 是 Go 1.17 引入基于寄存器的调用约定（[2.3](../ch02asm/callconv.md)）之后的优化：执行 Go
代码期间，当前 goroutine 的指针同时保存在 `R14` 中 [[Go Authors, 2026a](#ref-go-authors-2026a)]，
比每次访问 TLS 更快；从外部进入 Go 代码时，例如处理操作系统发来的信号或 C 代码回调 Go 函数，再从 TLS
中重新载入。

第 2 步通过 `CPUID` 指令记录处理器的厂商是否为 Intel，以及处理器的版本信息。目前运行时用前者决定
内存复制的策略：在支持相应特性的 Intel 处理器上，2 KB 以上的大块复制改用 `REP MOVSB` 指令。此外，
以 `GOAMD64=v3` 编译的程序要求处理器支持相应的指令集扩展，`rt0_go` 在第 3 步之后检查这一要求，不满足
时输出 `This program can only be run on AMD64 processors with v3 microarchitecture support.` 并退出。
这项检查有意安排在设置 TLS 之后，以确保出错时能够正常输出信息。

## 3.5.3 运行时的初始化次序

自此，`rt0_go` 可以调用 Go 函数。它依次调用以下四个函数：

```asm
	CALL	runtime·check(SB)       // 核对编译器的假设，例如 int8 占 1 字节
	...                             // 传入 argc 与 argv
	CALL	runtime·args(SB)        // 保存参数，读取辅助向量
	CALL	runtime·osinit(SB)      // 统计本进程可用的 CPU 个数
	CALL	runtime·schedinit(SB)   // 初始化运行时的其余部分
```

`check` 一旦发现编译器的假设不成立，便立即终止程序，以免日后出现难以追查的错误。`args` 从辅助向量
中取出页大小和 16 字节随机数据的地址。`osinit` 在 Linux 上通过系统调用 `sched_getaffinity` 查询本
进程可以使用的 CPU 集合并计数；由于此时仍无法分配内存，它在 `g0` 的栈上开辟一个 8 KB 的缓冲区接收
结果，源码注释对此作了专门说明 [[Go Authors, 2026b](#ref-go-authors-2026b)]。

`schedinit` 负责初始化运行时的其余部分。精简后的代码如下（`runtime/proc.go`，Go 1.26
[[Go Authors, 2026b](#ref-go-authors-2026b)]）：

```go
func schedinit() {
	gp := getg()            // 当前 goroutine，此时为 g0
	sched.maxmcount = 10000 // 线程数上限

	stackinit()      // 初始化 goroutine 栈的缓存池
	randinit()       // 随机数生成器，种子取自 AT_RANDOM
	mallocinit()     // 内存分配器：检查页大小，随机化堆基址
	cpuinit(godebug) // 查询处理器支持的指令集扩展
	alginit()        // 选定 map 的哈希函数，此后方可使用 map
	...
	typelinksinit()  // 整理链接器写入的类型信息，需要使用 map
	...
	goargs()         // 将参数和环境变量转换为 Go 字符串
	goenvs()
	gcinit()         // 垃圾回收器：仅设置参数，3.6 中才启用

	// procs 取环境变量 GOMAXPROCS 的值，未设置时取默认值（3.5.4）
	procresize(procs) // 创建 procs 个 P，主线程持有第一个
}
```

这些调用之间存在严格的先后约束，源码中以「必须在……之前运行」一类注释逐一注明。下面分析其中两处。

第一处是堆。Go 1.26 在 64 位平台上默认将堆的基址随机化，使对象地址难以预测
[[Go Authors, 2026e](#ref-go-authors-2026e)]。在 darwin/arm64 上将同一个程序运行三次，
同一个堆对象的地址分别为 `0x5ed4deda6040`、`0x40a67d326040` 和 `0x7cb2110b0340`；以
`GOEXPERIMENT=norandomizedheapbase64` 关闭这一功能后，地址总是以 `0x140` 开头。因此，
初始化堆（`mallocinit`）之前必须先初始化随机数生成器（`randinit`），而后者的种子取自内核经由辅助向量提供的
16 字节随机数据。

第二处是 map。处理器支持 AES 指令时，Go 使用它计算 map 的哈希值，速度高于纯软件实现。是否支持需要
先由 `cpuinit` 通过 `CPUID` 逐项查询；在 `alginit` 选定哈希函数之前，运行时自身的代码同样不能使用
map。

这与 [3.6](./main.md) 讨论的包初始化属于同一类问题：一组操作之间存在先后约束，需要找出满足全部约束
的执行顺序。区别在于，包的初始化顺序由链接器自动求出，而这里的顺序由运行时的作者手工排定，并以注释
记录理由。

## 3.5.4 处理器 P 与 GOMAXPROCS

`schedinit` 的最后一步是创建 P。**处理器**（processor，P）是调度器中执行 Go 代码所需的资源：线程
必须持有一个 P 才能运行 goroutine，因此 P 的数量决定了同一时刻最多有多少个 goroutine 并行执行，这个
数量就是 `GOMAXPROCS`。线程、P 与 goroutine 之间的协作见 [9.3](../../part3concurrency/ch09sched/mpg.md)。
主线程获得第一个 P，记作 P0。

若设置了环境变量 `GOMAXPROCS`，则使用其值 [[Go Authors, 2026d](#ref-go-authors-2026d)]。
未设置时的默认值经历过两次修改。Go 1.5 之前，默认值为 1，即使在多核机器上也只用一个核执行 Go 代码；Go 1.5
起改为 CPU 的个数 [[Cox, 2015](#ref-cox-2015)]。

第二次修改与容器有关。Linux 通过 cgroup 的带宽控制（CFS bandwidth control）实现容器的 CPU 限额，
限额以「每个周期内最多可用的 CPU 时间」表示，周期默认为 100 毫秒
[[Linux Kernel, n.d.](#ref-linux-kernel-nd)]。例如，64 核机器上一个限额为 2 个 CPU 的容器，每
100 毫秒最多使用 200 毫秒的 CPU 时间。容器内的程序看到的仍是 64 个 CPU，Go 1.24 及以前的版本因而把
`GOMAXPROCS` 设为 64。负载较高时，64 个线程同时运行，约 3 毫秒即耗尽当前周期 200 毫秒的配额，
在该周期剩余的时间里，整个容器被暂停执行，请求延迟随之出现明显的波动。社区为此开发了在启动时读取限额的库，
例如 Uber 的 `automaxprocs` [[Uber, n.d.](#ref-uber-nd)]。

Go 1.25 将这一功能纳入运行时 [[Pratt and Amedee, 2025](#ref-pratt-amedee-2025)]。在 Linux 上，
默认值取以下两者中的较小者：本进程可用的 CPU 个数；容器的 CPU 限额，向上取整且不小于 2。程序运行期间，
系统监控线程 sysmon（[3.6](./main.md)）每秒检查一次，可用的 CPU 或限额发生变化时随之调整
[[Go Authors, 2026c](#ref-go-authors-2026c)]。一旦通过环境变量或 `runtime.GOMAXPROCS` 显式设置，
便不再自动调整。这里的限额对应 Kubernetes 等容器平台中的「CPU limit」；「CPU request」以权重的方式分配
CPU，不影响这一默认值。

## 3.5.5 第一个 goroutine

`schedinit` 返回后，`rt0_go` 只剩下两步：

```asm
	MOVQ	$runtime·mainPC(SB), AX   // runtime.main 的地址
	PUSHQ	AX
	CALL	runtime·newproc(SB)       // 为其创建 goroutine，放入运行队列
	POPQ	AX
	CALL	runtime·mstart(SB)        // 主线程进入调度循环，不再返回
	CALL	runtime·abort(SB)         // 若返回则说明出现错误
```

`newproc` 是 `go` 语句的运行时实现，`go f()` 编译后即是对它的调用。它为 `runtime.main` 创建一个
goroutine，分配一段初始栈（Linux 上为 2 KB，此时已经可以分配内存），使其从 `runtime.main` 的入口
开始执行，并放入 P0 的本地运行队列。第一个 goroutine 执行的是 `runtime.main` 而非用户的
`main.main`：`runtime.main` 先完成 3.6.1 所述的准备工作，再调用 `main.main`。3.4 的引用链中
`runtime.mainPC -> runtime.main -> … -> main.main` 一段，对应的正是这一层间接调用。

`mstart` 使主线程开始执行调度。它首先安装信号处理函数
（[9.6](../../part3concurrency/ch09sched/signal.md)），然后在 `g0` 的栈上进入调度循环：选出一个可运行
的 goroutine，切换到它的栈上执行；该 goroutine 暂停后，回到 `g0` 选择下一个。此时运行队列中只有一个
goroutine，于是 `runtime.main` 开始执行，后续过程见 3.6。`mstart` 不会返回，主线程此后在执行
goroutine 与调度循环之间往复。

整个过程可归纳为：

1. 内核加载程序，在栈上写入参数、环境变量和辅助向量，跳转到入口 `_rt0_amd64_linux`；
2. 入口取出参数个数与参数列表，转入 `rt0_go`；
3. 从操作系统提供的栈中划出 64 KB 作为 `g0` 的栈；
4. 通过 `CPUID` 查询处理器信息；
5. 设置线程本地存储，并使 `m0` 与 `g0` 相互关联；
6. `check`、`args`、`osinit`：自检，读取页大小、随机数据和可用 CPU 个数；
7. `schedinit`：按依赖次序初始化栈、随机数、堆、哈希函数等；
8. 创建 `GOMAXPROCS` 个 P，主线程持有 P0；
9. `newproc`：为 `runtime.main` 创建第一个 goroutine，放入 P0 的运行队列；
10. `mstart`：进入调度循环，开始执行 `runtime.main`。

下面的交互图可以逐步演示这一过程，右侧显示每一步完成后进程中已经存在的结构；改变 CPU 个数和容器
限额，可以观察第 8 步创建的 P 的数量。

<div class="viz" data-viz="boot-sequence"></div>

## 3.5.6 为什么自行实现启动过程

C 程序同样有启动过程，由 C 库提供：链接时自动加入的启动代码先完成环境的设置，再调用 `main`。Go 在
Linux 上不依赖 C 库，而是直接发起系统调用（Linux 保证系统调用接口长期稳定），因此程序入口、线程
本地存储和新线程的创建都需要运行时自行完成，每种操作系统与体系结构的组合都需要一小段汇编代码。由此
换来的是 3.4 中不依赖任何共享库的可执行文件，以及运行时对 goroutine 的栈、线程和信号的完全控制。

包含 C 代码、由系统的 C 链接器完成链接的程序遵循另一条路径：C 库的启动代码首先运行，它所调用的
`main` 是 Go 运行时以汇编实现的同名函数，该函数直接跳转到 `rt0_go`；线程本地存储已由 C 库的线程库
设置完毕，`rt0_go` 随之跳过自行设置的步骤。

## 延伸阅读

- <a id="ref-matz-et-al-2014"></a>[Matz et al., 2014] Michael Matz, Jan Hubička, Andreas Jaeger, Mark
  Mitchell (eds.). *System V Application Binary Interface, AMD64 Architecture Processor Supplement*.
  https://gitlab.com/x86-psABIs/x86-64-ABI
  （2014 年版 PDF：https://www.uclibc.org/docs/psABI-x86_64.pdf ，ELF 进程栈与辅助向量 auxv 的布局）
  存档：https://web.archive.org/web/20260918150420/https://www.uclibc.org/docs/psABI-x86_64.pdf
  其中「Process Initialization」一节规定了程序启动时栈的布局和辅助向量各项的类型编号。
- <a id="ref-drepper-2013"></a>[Drepper, 2013] Ulrich Drepper. "ELF Handling For Thread-Local Storage."
  2013. https://akkadia.org/drepper/tls.pdf
  线程本地存储在 Linux 等系统上如何由编译器、链接器和操作系统共同实现。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. "Go internal ABI specification."
  `src/cmd/compile/abi-internal.md`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/abi-internal.md
  规定 amd64 上以 `R14` 保存当前 goroutine，并说明了理由。
- <a id="ref-cox-2015"></a>[Cox, 2015] Russ Cox. "Go 1.5 GOMAXPROCS Default." 2015.
  https://go.dev/s/go15gomaxprocs
  把 `GOMAXPROCS` 的默认值从 1 改为 CPU 个数的提案。
- <a id="ref-pratt-amedee-2025"></a>[Pratt and Amedee, 2025] Michael Pratt, Carlos Amedee.
  "Container-aware GOMAXPROCS." *The Go Blog*, 2025. https://go.dev/blog/container-aware-gomaxprocs
  Go 1.25 依据容器限额设置默认值的背景与设计。
- <a id="ref-linux-kernel-nd"></a>[Linux Kernel, n.d.] The Linux Kernel documentation. "CFS Bandwidth
  Control." https://docs.kernel.org/scheduler/sched-bwc.html
  容器 CPU 限额（每个周期的配额）的工作方式。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `runtime/asm_amd64.s`（`rt0_go`）与
  `runtime/proc.go`（`schedinit`、`newproc`、 `mstart`），Go 1.26.
  https://github.com/golang/go/tree/release-branch.go1.26/src/runtime
  https://github.com/golang/go/tree/master/src/runtime （`rt0_linux_amd64.s`、`rt0_darwin_amd64.s`）
  https://github.com/golang/go/blob/master/src/runtime/proc.go
  本节代码的出处。
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *runtime/cgroup_linux.go（cgroup
  感知的 `GOMAXPROCS` 默认值，Go 1.25+）.*
  https://github.com/golang/go/blob/master/src/runtime/cgroup_linux.go
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Package runtime 文档.*
  https://pkg.go.dev/runtime
- <a id="ref-go-authors-2026e"></a>[Go Authors, 2026e] The Go Authors. *Go 1.26 Release Notes*, "Heap base
  address randomization". https://go.dev/doc/go1.26#heap-base-address-randomization
  64 位平台上默认随机化堆的基址，以及关闭这一功能的 `GOEXPERIMENT`。
- <a id="ref-uber-nd"></a>[Uber, n.d.] Uber. *automaxprocs.* https://github.com/uber-go/automaxprocs
  在启动时依据容器的 CPU 限额设置 `GOMAXPROCS` 的库。
- 本书 [1.2 Go 语言综述](../ch01intro/go.md)（二进制内含微型操作系统的视角）、[9.1
  调度问题与 GMP 模型](../../part3concurrency/ch09sched/model.md)（P 列表与调度循环）、[9.6
  信号处理机制](../../part3concurrency/ch09sched/signal.md)。
- 本书 [第 12 章 内存分配器](../../part4memory/ch12alloc/)、[第
  13 章 垃圾回收器](../../part4memory/ch13gc/)（`mallocinit`、`gcinit` 所建起的结构）、[3.6
  主 Goroutine 的生与死](./main.md)。

