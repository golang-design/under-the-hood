---
weight: 1306
title: "3.6 主 goroutine 的生与死"
---

# 3.6 主 goroutine 的生与死

先看两个例子。第一个程序会输出什么？

```go {run=true}
package main

import "fmt"

var (
	a = c + b // 依赖 b 与 c
	b = f("b")
	c = f("c")
	d = 3
)

func f(name string) int {
	d++
	fmt.Printf("初始化 %s，此时 d = %d\n", name, d)
	return d
}

func init() { fmt.Println("init：a, b, c, d =", a, b, c, d) }

func main() { fmt.Println("main") }
```

`a` 虽然声明在最前面，却是最后一个被初始化的：

```
初始化 b，此时 d = 4
初始化 c，此时 d = 5
init：a, b, c, d = 9 4 5 5
main
```

第二个例子：`main` 返回时，仍在运行的其他 goroutine 会怎样？

```go {run=true}
package main

import (
	"fmt"
	"time"
)

func main() {
	go func() {
		time.Sleep(10 * time.Millisecond)
		fmt.Println("后台 goroutine 完成")
	}()
	fmt.Println("main 返回")
}
```

程序只输出「main 返回」。后台 goroutine 尚未来得及输出，进程就已经结束。

两个问题的答案都与程序的第一个 goroutine 有关。[3.5](./boot.md) 讲到，运行时完成启动之后，会创建
一个 goroutine 执行 `runtime.main`。该函数先完成若干准备工作，然后按确定的顺序执行所有包的初始化
代码，再调用用户的 `main.main`，并在 `main.main` 返回时结束整个进程。这个 goroutine 称为
**主 goroutine**（main goroutine）。

## 3.6.1 `main.main` 之前的准备

在调用用户代码之前，`runtime.main` 主要完成三项工作：

1. 启动系统监控线程 sysmon（[9.8](../../part3concurrency/ch09sched/sysmon.md)）。它在后台周期性地
   执行检查，例如抢占运行时间过长的 goroutine、在必要时触发垃圾回收。sysmon 独占一个线程，不运行
   任何 goroutine；在 WebAssembly（`GOARCH=wasm`）平台上不启动 sysmon。
2. 初始化 `runtime` 包，然后启用垃圾回收。在此之前，垃圾回收器处于关闭状态。Go 1.25 起，这一步还会
   启动 GOMAXPROCS 的自动更新：在用户未显式设置 GOMAXPROCS 时，若可用的 CPU 数或容器的 CPU 配额发生
   变化，运行时随之调整 GOMAXPROCS。
3. 按顺序初始化程序依赖的其余所有包。

[3.5](./boot.md) 开头的程序在 `main` 中观察到的 5 个运行时 goroutine，都是主 goroutine 在这几步中
创建的：`runtime` 包的 `init` 启动一个在必要时强制触发垃圾回收的 goroutine；启用垃圾回收时启动两个
后台 goroutine，分别负责清扫和向操作系统归还内存；GOMAXPROCS 的自动更新由一个 goroutine 执行；最后
一个负责运行终结器（finalizer），它在首次调用 `runtime.SetFinalizer` 时创建，而 `os` 包在初始化
`os.Stdin` 等变量时就会调用这个函数。

精简后的代码如下（`runtime/proc.go`，Go 1.26 [[Go Authors, 2026b](#ref-go-authors-2026b)]）：

```go
func main() { // runtime.main，运行在主 goroutine 上
	mainStarted = true
	if haveSysmon {
		systemstack(func() { newm(sysmon, nil, -1) }) // 1. 启动 sysmon
	}

	lockOSThread()                  // 初始化期间绑定主线程（见下文）
	doInit(runtime_inittasks)       // 2. 初始化 runtime 包
	gcenable()                      //    启用垃圾回收
	defaultGOMAXPROCSUpdateEnable() //    启动 GOMAXPROCS 的自动更新
	for m := &firstmoduledata; m != nil; m = m.next {
		doInit(m.inittasks)   // 3. 按链接器确定的顺序初始化其余包
	}
	unlockOSThread()

	fn := main_main // 用户的 main.main
	fn()
	runExitHooks(0) // 执行退出钩子
	exit(0)         // 结束进程
}
```

代码中的 `main_main` 在 `proc.go` 中只有声明，并以 `//go:linkname main_main main.main`
指示链接器把它解析为用户的 `main.main` [[Go Authors, 2026d](#ref-go-authors-2026d)]。源码注释说明，
链接器布置运行时的代码时尚不知道 `main` 包的地址，因此这里经由函数值间接调用。

`lockOSThread` 是为少数平台准备的：某些系统库只允许在进程的主线程上调用，例如 macOS 的图形界面库。
初始化期间，主 goroutine 始终绑定在主线程上；如果在 `init` 中调用 `runtime.LockOSThread`，`main.main`
也将在主线程上运行。

由这段代码可以得出一个容易被忽视的事实：**所
有包的初始化代码与 `main.main` 都在同一个 goroutine 上依次执行。** `init` 中可以启动新的 goroutine，
但两个 `init` 之间、最后一个 `init` 与 `main.main` 之间不存在并发。例外出现在以 `-buildmode=c-archive` 或
`c-shared` 构建的库中：C 线程可能在 Go 的初始化完成之前就回调 Go 函数，运行时以一个名为 `main_init_done`
的 channel 让它等待初始化结束 [[Taylor, 2016](#ref-taylor-2016)]。

剩下的问题是：一个程序往往依赖数十乃至上百个包，它们的初始化先后如何确定？

## 3.6.2 包的初始化顺序

### 依赖图与拓扑序

包 P 导入包 Q 时，P 的初始化代码可能用到 Q 中的变量，因此 Q 必须先于 P 初始化。把每个包视为一个
顶点，若 P 导入 Q，就连一条从 Q 指向 P 的有向边，表示 Q 必须先完成。Go 禁止循环导入，因此这张图
中不存在环，是一张**有向无环图**（directed acyclic graph，DAG）。合法的初始化顺序，就是这张图的
一个**拓扑序**（topological order）：包含所有顶点的一个序列，其中每条边的起点都排在终点之前。
求拓扑序的过程称为**拓扑排序**（topological sort）。

### Kahn 算法

本节所用的算法来自 A. B. Kahn 1962 年的论文《Topological sorting of large
networks》[[Kahn, 1962](#ref-kahn-1962)]。该论文面向大型工程项目的进度安排：数千道工序，
每道工序都必须等待其前置工序完成，需要由计算机排出一个可行的执行顺序。

Kahn 算法为每个顶点维护一个计数，即尚未完成的前置顶点个数（入度）。计数为零的顶点构成就绪集合。
每一步从就绪集合中取出一个顶点输出，再把它所有后继的计数减一，计数降为零的后继随即加入就绪集合。
每个顶点和每条边都只处理一次，因此算法的运行时间与顶点数和边数之和成正比。

该算法同时给出了判定环的方法。若仍有顶点未输出而就绪集合已经为空，则剩余的每个顶点都至少有一个
未完成的前置顶点。从任一剩余顶点出发，沿未完成的前置顶点反向追溯，由于顶点数有限，必然回到某个
已经经过的顶点，即图中存在环。反之，环上的顶点相互等待，永远不会进入就绪集合。因此，「算法无法
继续」与「存在循环依赖」是等价的 [[Knuth, 1997](#ref-knuth-1997)]。

### Go 的规则

Kahn 算法的每一步可能有多个顶点同时就绪，选择其中任何一个都能得到合法的拓扑序。Go 则要求顺序唯一：
同一个程序无论在何处构建、构建多少次，初始化顺序都应相同。Go 语言规范规定
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

> 给定按导入路径排序的全部包，每一步初始化列表中第一个尚未初始化、且其导入的所有包均已初始化的包。
> 重复这一步骤，直至所有包初始化完毕。

换言之，当就绪集合中有多个包时，总是选择导入路径按字典序最小的一个。

下面的交互图以一个真实程序的初始化过程（经过简化）演示这条规则。可以单步执行，也可以添加一条导入
关系制造环，观察算法如何停止。

<div class="viz" data-viz="init-order"></div>

按字典序，`internal/godebug` 排在 `sync` 之前，但它导入了 `sync`，因此必须等待 `sync` 初始化完成。
最终的顺序是：

```
errors → sync → internal/godebug → syscall → time → io/fs → os → main
```

在真实程序中，可以用环境变量 `GODEBUG=inittrace=1`（Go 1.16 起可用）验证这一顺序。运行时每初始化
完一个包，就输出一行记录，依次给出相对程序启动的时刻、初始化耗时、分配的字节数和分配次数：

```go {run=true env="GODEBUG=inittrace=1"}
package main

import "fmt"

func main() { fmt.Println("hello") }
```

在一台 macOS（Apple 芯片）机器上的输出如下，时间数值每次运行都会不同：

```
init internal/bytealg @0 ms, 0 ms clock, 0 bytes, 0 allocs
init internal/runtime/sys @0.13 ms, 0 ms clock, 0 bytes, 0 allocs
init runtime @0.14 ms, 0.024 ms clock, 0 bytes, 0 allocs
init errors @0.24 ms, 0 ms clock, 0 bytes, 0 allocs
init iter @0.28 ms, 0 ms clock, 16 bytes, 1 allocs
init sync @0.30 ms, 0.008 ms clock, 0 bytes, 0 allocs
init internal/godebug @0.33 ms, 0.13 ms clock, 312 bytes, 7 allocs
init syscall @0.49 ms, 0.009 ms clock, 1368 bytes, 7 allocs
init time @0.51 ms, 0.008 ms clock, 0 bytes, 0 allocs
init io/fs @0.54 ms, 0 ms clock, 0 bytes, 0 allocs
init os @0.55 ms, 0.046 ms clock, 7840 bytes, 22 allocs
init unicode @0.62 ms, 0 ms clock, 512 bytes, 4 allocs
init reflect @0.64 ms, 0 ms clock, 0 bytes, 0 allocs
hello
```

`sync` 与 `internal/godebug` 的先后与交互图一致。列表中没有 `fmt`：没有初始化代码的包不会出现在
其中。据链接器源码中的注释估计，标准库中大约一半的包属于这种情况。

### 包内的变量与 `init` 函数

单个包的初始化分两步：先初始化包级变量，再依次调用 `init` 函数。

包级变量的初始化顺序使用同一个算法，只是排序依据由导入路径换成了声明顺序：每一步，初始化声明顺序
最靠前、且其依赖的变量均已初始化的变量。开头的例子中，`a` 依赖 `b` 和 `c`；`b` 和 `c` 调用了
`f`，而 `f` 读写 `d`，因此 `b` 和 `c` 都依赖 `d`。编译器分析依赖时会追溯到函数体内部，所以尽管
`b = f("b")` 中没有直接出现 `d`，`b` 仍然依赖 `d`。由此：

1. `a`、`b`、`c` 都有未初始化的依赖，只有 `d = 3` 可以先初始化；
2. 此时 `b` 是声明最靠前的可初始化变量，调用 `f` 后 `d` 变为 4，`b` 等于 4；
3. 接着初始化 `c`，`d` 变为 5，`c` 等于 5；
4. 最后初始化 `a = c + b`，结果为 9。

将交互图切换到「包内变量」场景，可以逐步观察这一过程。依赖关系由编译器根据源码中的引用静态确定，
与运行时的值无关，因此把 `a = c + b` 改为 `a = b + c`，顺序不变。变量之间若存在循环依赖，编译将会
失败。例如：

```go
package main

var (
	a = d
	d = f()
)

func f() int { return a }

func main() {}
```

`a` 依赖 `d`，`d` 依赖 `f`，`f` 又读取 `a`，构成一个环。编译器报告如下：

```
./main.go:4:2: initialization cycle for a
	./main.go:4:2: a refers to d
	./main.go:5:2: d refers to f
	./main.go:8:6: f refers to a
```

包之间的循环导入同样无法通过编译（错误信息为 `import cycle not allowed`）。正因为不允许循环导入，
包的初始化顺序总是存在的。

包级变量全部初始化之后，`init` 函数按它们在源码中出现的顺序调用。一个包可以有多个 `init` 函数
[[Go Authors, 2026c](#ref-go-authors-2026c)]；它们分布在不同文件中时，顺序取决于文件交给编译器的先后。
语言规范建议构建系统按文件名的字典序提交文件 [[Go Authors, 2026a](#ref-go-authors-2026a)]，`go`
命令即是如此，因此 `init` 的顺序也随之确定。程序中的任何位置都不能引用 `init` 函数，因而也无法显式调用它。

## 3.6.3 初始化顺序的计算

排序在链接时完成，运行时只负责按序执行。编译器为包生成一条初始化任务记录（符号 `p..inittask`），
其中依次列出需要调用的函数：编译器为包级变量生成的初始化函数，以及用户编写的各个 `init`。该包导入
了哪些包，则以一种专用的重定位项（`R_INITORDER`）附在记录上，指向被导入包的记录。运行时看到的
记录结构如下：

```go
// runtime/proc.go
type initTask struct {
	state uint32 // 0 = 未初始化，1 = 正在初始化，2 = 已完成
	nfns  uint32 // 其后紧接 nfns 个函数指针：包级变量的初始化函数与各个 init
}
```

链接器（`cmd/link/internal/ld/inittask.go` [[Go Authors, 2026b](#ref-go-authors-2026b)]）从 `main`
包的记录出发，沿 `R_INITORDER` 收集全部记录及其依赖关系，然后执行 Kahn 算法，以一个按名称排序的堆作为就绪
集合，每次取出字典序最小的记录。没有任何函数需要调用的记录只参与排序，不写入最终的列表。
排好的顺序写入可执行文件。程序启动后，`runtime.main` 依次对每条记录调用 `doInit1`：

```go
// runtime/proc.go（省略 inittrace 的计时代码）
func doInit1(t *initTask) {
	switch t.state {
	case 2: // 已完成
		return
	case 1: // 正在初始化时再次进入，说明链接器给出的顺序有误
		throw("recursive call during initialization - linker skew")
	default:
		t.state = 1
		// 依次取出记录之后的 nfns 个函数指针并调用
		firstFunc := add(unsafe.Pointer(t), 8)
		for i := uint32(0); i < t.nfns; i++ {
			p := add(firstFunc, uintptr(i)*goarch.PtrSize)
			f := *(*func())(unsafe.Pointer(&p))
			f()
		}
		t.state = 2
	}
}
```

`state` 的三个取值各有用途：「已完成」保证每个包只初始化一次；「正在初始化」用于发现排序错误，正常
的程序不会进入 `case 1`。

这种由链接器排序、运行时执行的分工是 Go 1.21 引入的 [[Go Authors, 2023](#ref-go-authors-2023)]。在此之前，
运行时在初始化一个包之前，会先递归地初始化它所导入的包（Go 1.20 的 `initTask` 中带有一个依赖列表，`doInit`
依次递归处理）。语言规范只要求被导入的包先于导入者初始化，并未规定两个互不依赖的包的先后。
依赖列表的次序由编译器处理 `import` 声明的先后决定，因此实际顺序取决于 `import` 语句的书写顺序这类细节。Go
1.21 把「按导入路径排序、选取第一个可初始化的包」写入规范，初始化顺序从此唯一确定。
少数旧程序依赖了某种未经规定的顺序，例如两个互不导入的包向同一张全局表注册内容，升级后行为可能发生变化。
正确的做法是通过 `import` 显式表达依赖关系。

## 3.6.4 主 goroutine 的返回与进程退出

`main.main` 返回后，`runtime.main` 并不等待其他 goroutine，语言规范对此有明确规定
[[Go Authors, 2026a](#ref-go-authors-2026a)]。它只做很少的收尾工作。如果此时另一个 goroutine 正在执行由
panic 引发的 `defer`，就让出处理器稍作等待，因为该 panic 可能被 `recover`；如果 panic
已经进入输出错误信息的阶段，就不再返回，由那个 goroutine 输出完整的信息并以退出码 2 结束进程。除此之外，
运行时执行已登记的退出钩子（目前标准库中只有覆盖率统计用它写出计数数据），然后调用 `exit(0)`。
操作系统随即回收整个进程，其余 goroutine 立即终止，它们的 `defer` 也不会执行。

开头的第二个例子正是如此。要让后台工作完成，`main` 必须显式地等待。Go 1.25 为 `sync.WaitGroup` 增加了
`Go` 方法 [[Go Authors, 2025](#ref-go-authors-2025)]，将「计数加一、启动 goroutine、结束时计数减一」
合并为一步：

```go {run=true}
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	var wg sync.WaitGroup
	for i := range 3 {
		wg.Go(func() {
			time.Sleep(time.Duration(i) * time.Millisecond)
			fmt.Println("任务", i, "完成")
		})
	}
	wg.Wait() // 等待三个任务全部结束
	fmt.Println("全部完成，main 返回")
}
```

`main.main` 返回只是程序结束的方式之一。常见的几种方式比较如下：

| 结束方式 | 退出码 | `main` 中的 `defer` | 其他 goroutine |
| --- | --- | --- | --- |
| `main.main` 返回 | 0 | 返回前已执行 | 立即终止 |
| 调用 `os.Exit(n)` | n | 不执行 | 立即终止 |
| 其他 goroutine 发生未被 `recover` 的 panic | 2 | 不执行 | 立即终止 |
| 所有 goroutine 均处于阻塞状态（死锁） | 2 | 不执行 | 全部阻塞 |
| 主 goroutine 调用 `runtime.Goexit` | 2 | 执行 | 继续运行，全部结束后报错退出 |

其中两行值得单独说明。第三行意味着 goroutine 之间没有故障隔离：任何一个 goroutine 中未被 `recover`
捕获的 panic，都会使整个进程退出，即使主 goroutine 一切正常：

```go {run=true}
package main

import (
	"fmt"
	"time"
)

func main() {
	defer fmt.Println("main 的 defer 不会执行")
	go func() { panic("后台 goroutine 出错") }()
	time.Sleep(time.Second)
	fmt.Println("不会执行到这里")
}
```

输出为 `panic: 后台 goroutine 出错` 以及该 goroutine 的调用栈，退出码为 2。如果 panic 发生在主
goroutine 自身，情况略有不同：panic 沿调用栈展开时会执行 `main` 中的 `defer`，然后进程同样以退出码
2 结束。

最后一行较为少见。`runtime.Goexit` 使当前 goroutine 在执行完自身的 `defer` 之后终止。主 goroutine
调用它时，`main.main` 并未返回，因此进程不会退出，其他 goroutine 照常运行；待它们全部结束，运行时
发现已不存在任何 goroutine，只能报错退出：

```go {run=true}
package main

import (
	"fmt"
	"runtime"
	"time"
)

func main() {
	go func() {
		time.Sleep(10 * time.Millisecond)
		fmt.Println("另一个 goroutine 仍在运行")
	}()
	defer fmt.Println("main 的 defer 照常执行")
	runtime.Goexit()
}
```

```
main 的 defer 照常执行
另一个 goroutine 仍在运行
fatal error: no goroutines (main called runtime.Goexit) - deadlock!
```

## 3.6.5 为什么不等待其他 goroutine

「主线程结束即进程结束」并不是唯一的设计。

C 语言规定，从 `main` 返回等同于调用 `exit`，而在 Linux、macOS 等系统上，`exit` 会终止进程中的所有线程。Go
沿用了这一规则。Java 的规则不同：只要还有非守护线程在运行，`main` 返回后程序就不会退出；
只有被标记为**守护线程**（daemon thread）的后台线程，才会在其他线程全部结束时被一并终止
[[Gosling et al., 2023](#ref-gosling-et-al-2023)]。

Go 没有采用 Java 的做法，原因在于 goroutine 的设计。`go f()` 不返回任何句柄，程序既无法查询某个
goroutine 是否仍在运行，也无法从外部终止它。如果运行时在退出前等待所有 goroutine，一个未能退出的
后台 goroutine 就会使程序永远无法结束，并且没有任何手段使其停止。Go 的选择是把决定权交给 `main`：
程序何时结束由 `main` 决定，需要等待的工作由程序员显式等待。代价是，遗漏等待成了 Go 并发程序中的
常见错误。

这一问题还有更一般的讨论。2018 年，Nathaniel J. Smith 在《Notes on structured concurrency, or: Go
statement considered harmful》一文中 [[Smith, 2018](#ref-smith-2018)]把 `go` 语句比作早年的 `goto`：`goto`
使控制流可以跳到程序的任意位置，`go` 则使一段并发执行的代码比启动它的函数存活得更久。
二者都破坏了一个基本的推理前提，即函数返回时，它所启动的工作已经全部完成。Smith
主张每个并发任务都应隶属于某个代码块，代码块结束之前必须等待其启动的任务全部结束，
这种编程方式称为**结构化并发**（structured concurrency）。Go 没有改变 `go` 语句的语义，
但提供了朝这一方向发展的工具：`golang.org/x/sync/errgroup` 把等待一组 goroutine
与收集它们的错误结合在一起，`context` 负责传递取消信号，Go 1.25 的 `WaitGroup.Go` 则使「启动时即登记」
成为最自然的写法。

至此，一个 Go 程序从启动、初始化到退出的全过程已经完整。sysmon 的具体职责与垃圾回收的运作方式，
分别在[第 9 章](../../part3concurrency/ch09sched)和[第 13 章](../../part4memory/ch13gc)中展开。

## 延伸阅读

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *The Go Programming Language
  Specification*, "Package initialization" 与 "Program initialization and execution" 两节.
  https://go.dev/ref/spec#Package_initialization
  本节两条初始化规则的出处。
- <a id="ref-kahn-1962"></a>[Kahn, 1962] A. B. Kahn. "Topological sorting of large networks."
  *Communications of the ACM*, 5(11): 558–562, 1962. https://doi.org/10.1145/368996.369025
  本节所述排序算法的出处。Go 的链接器使用的就是该算法，并在就绪集合中按字典序选取。
- <a id="ref-knuth-1997"></a>[Knuth, 1997] Donald E. Knuth. *The Art of Computer Programming, Volume 1:
  Fundamental Algorithms*, 3rd ed., §2.2.3（Algorithm T）. Addison-Wesley, 1997. 以计数与队列实现拓扑排序
  的经典论述，并讨论了环的检测。
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. *Go 1.21 Release Notes*, "Changes to
  the language". https://go.dev/doc/go1.21
  初始化顺序由实现细节变为语言规范的那次修改。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `runtime/proc.go`（`main`、`doInit1`）
  与 `cmd/link/internal/ld/inittask.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/link/internal/ld/inittask.go
  https://github.com/golang/go/blob/master/src/runtime/proc.go （`func main`、`doInit`、`doInit1`、`initTask`）
  链接器排序与运行时执行的源码。
- <a id="ref-smith-2018"></a>[Smith, 2018] Nathaniel J. Smith. "Notes on structured concurrency, or: Go
  statement considered harmful." 2018.
  https://vorpus.org/blog/notes-on-structured-concurrency-or-go-statement-considered-harmful/
  结构化并发的出发点，有助于理解 Go 的退出规则与 `errgroup` 的定位。
- <a id="ref-gosling-et-al-2023"></a>[Gosling et al., 2023] James Gosling et al. *The Java Language
  Specification, Java SE 21 Edition*, §12.8 "Program Exit".
  https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html#jls-12.8
  Java 的程序退出规则，可与 Go 的设计对照。
- <a id="ref-go-authors-2025"></a>[Go Authors, 2025] The Go Authors. *Go 1.25 Release
  Notes*（`sync.WaitGroup.Go`）. https://go.dev/doc/go1.25
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. *Effective Go: The init function.*
  https://go.dev/doc/effective_go#init
- <a id="ref-taylor-2016"></a>[Taylor, 2016] Ian Lance Taylor. "runtime: main_init_done can be implemented
  more efficiently." Go issue #15943, 2016. https://github.com/golang/go/issues/15943
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. *Command compile.*
  https://go.dev/cmd/compile/
- 本书 [3.5 Go 程序启动引导](./boot.md)、[9.8 系统监控](../../part3concurrency/ch09sched/sysmon.md)、[11
  同步模式](../../part3concurrency/ch11sync)。

