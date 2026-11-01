---
weight: 1102
title: "1.2 Go 语言综述"
---

# 1.2 Go 语言综述

先编译一个只打印一行文字的程序，考察生成的可执行文件中包含哪些内容（Go 1.26.10，darwin/arm64）：

```go
package main

import "fmt"

func main() { fmt.Println("hello") }
```

```
$ go build -o hello main.go
$ wc -c < hello
 2508994
$ go tool nm hello | grep -c ' T '
2024
$ go tool nm hello | grep -c ' T runtime\.'
1400
$ go tool nm hello | grep ' T main\.'
10009f630 T main.main
```

`go tool nm` 列出文件中带有名称的函数与变量，`T` 一列表示函数。源码中只有一个函数 `main.main`，可执行
文件中却有 2024 个函数，其中 1400 个属于 `runtime` 包。它们构成了 Go **运行时**（runtime）的主体，每个
Go 程序都包含运行时。链接器如何决定保留哪些函数，见 [3.4](../ch03life/link.md)。

本节为全书建立一个总体框架：Go 由哪几个部分组成，做出了哪些与主流语言不同的设计决定，以及这些决定
分别在本书的哪一部分展开。

## 1.2.1 三个组成部分

**语言**是程序员直接书写的部分：语法、类型、并发与错误处理。它被有意设计得很小，一共只有 25 个关键字
[[Go Authors, 2026a](#ref-go-authors-2026a)]。语言本身的系统介绍可参阅 Donovan 与 Kernighan 的教材
[[Donovan and Kernighan, 2015](#ref-donovan-kernighan-2015)]，本书讨论的是它的实现。

**运行时**是链接进每个程序的那部分代码。它把大量 goroutine 分配到少数操作系统线程上轮流执行，为对象
分配内存，回收不再使用的内存，并为每个 goroutine 提供一个按需增长的栈。这些工作原本大多由操作系统
承担，Go 在自身的进程中又实现了一遍，因此运行时常被比作一个小型操作系统。

**工具链**负责把源码变为可运行、可诊断、可维护的程序，包括 `go` 命令、编译器、链接器、模块系统，
以及测试与性能分析工具。Go 的设计者在 2022 年的回顾中指出，语言本身只是 Go 取得成功的一小部分原因，库、
工具、惯例以及整体的软件工程方法同样重要 [[Cox et al., 2022](#ref-cox-et-al-2022)]。

不妨与 C 和 Java 作一比较。C 程序也有运行时，但非常精简，只包括启动代码与 C 标准库，线程与内存基本
直接交由操作系统管理。Java 的运行时是一个通常需要单独安装的虚拟机，程序在虚拟机上运行。Go 则把运行时
直接链接进可执行文件：把一个文件复制到目标机器上即可运行，goroutine 的调度与垃圾回收对程序员几乎不可见。
其代价是可执行文件更大，运行时本身也相当复杂，本书的大部分篇幅都在讨论它。

## 1.2.2 几项不同寻常的设计决定

**并发是语言的一部分。** 启动一个并发执行的函数只需一个 `go` 关键字，goroutine 之间通过 channel 传递
数据：

```go
ch := make(chan int)
go func() { ch <- compute() }() // 在新的 goroutine 中计算，并发送结果
result := <-ch                  // 在此等待结果
```

这种写法之所以可行，是因为 goroutine 的开销很小。下面的程序启动一万个 goroutine，使它们全部阻塞在
同一个 channel 上，再测量内存的增长：

```go {run=true}
package main

import (
	"fmt"
	"runtime"
)

func main() {
	const n = 10000
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)

	block := make(chan struct{})
	for range n {
		go func() { <-block }() // 启动后立即阻塞，始终保持存活
	}
	runtime.ReadMemStats(&after)

	stack := after.StackInuse - before.StackInuse
	heap := after.HeapInuse - before.HeapInuse
	fmt.Println("goroutine 数:", runtime.NumGoroutine())
	fmt.Println("平均每个：栈", stack/n, "字节，堆上的记录", heap/n, "字节")
	close(block)
}
```

在 darwin/arm64 上的一次运行结果如下（每次运行的结果会相差几个字节）：

```
goroutine 数: 10001
平均每个：栈 2097 字节，堆上的记录 684 字节
```

在浏览器中（js/wasm）运行，结果为栈 2048 字节、堆上 516 字节，具体数值随平台略有差异。每个 goroutine
的栈最小为 2 KB（`runtime/stack.go` 中的 `stackMin`），不足时再增长
（[第 14 章](../../part4memory/ch14stack/readme.md)）；运行时还会根据垃圾回收时测得的平均栈大小，调整新
goroutine 的初始栈大小。堆上的部分是运行时为每个 goroutine 记录的状态，以及它在 channel 上等待时留下
的记录。作为对比，操作系统线程的栈通常以 MB 计。其代价是运行时需要实现一个复杂的调度器
（[第 9 章](../../part3concurrency/ch09sched/readme.md)）。这一并发思想的来源见 [1.3](./csp.md)。

**接口无须显式声明。** 一个类型只要具有接口所要求的方法，就自动满足该接口，无须书写 `implements`
[[Pike, 2012](#ref-pike-2012)]：

```go {run=true}
package main

import (
	"fmt"
	"os"
	"strings"
)

// upper 从未声明自己实现了 io.Writer，
// 但它具有签名相符的 Write 方法，因此满足该接口。
type upper struct{ n int }

func (u *upper) Write(p []byte) (int, error) {
	u.n += len(p)
	return os.Stdout.Write([]byte(strings.ToUpper(string(p))))
}

func main() {
	u := &upper{}
	fmt.Fprintf(u, "hello, %s\n", "gopher") // Fprintf 只要求参数实现 io.Writer
	fmt.Println("写出字节数:", u.n)
}
```

```
HELLO, GOPHER
写出字节数: 14
```

其好处是可以在事后为他人定义的类型设计接口，`io.Reader`、`io.Writer` 这类只有一个方法的小接口因而得到广泛
使用 [[Go Authors, 2026b](#ref-go-authors-2026b)]。其代价是经由接口的调用需要先查表才能找到实际的方法，
编译器通常无法将其内联（[4.2](../../part2lang/ch04type/interface.md)）。

**错误是普通的值。** 函数把错误作为一个返回值交给调用方，由调用方就地检查，不存在 `try`/`catch` 式的
控制转移：

```go
f, err := os.Open(name)
if err != nil {
	return fmt.Errorf("open %s: %w", name, err) // 附加上下文信息，返回给上一层
}
defer f.Close() // 清理代码紧邻打开操作，在函数返回时执行
```

其好处是出错路径清晰可见，代价是代码中大量重复的 `if err != nil`（[第
7 章](../../part2lang/ch07errors/readme.md)；`defer` 见 [6.2](../../part2lang/ch06func/defer.md)）。

**切片是底层数组的视图。** Go 内建了三种容器：切片、map 与 channel，其中最常用的是切片。切片记录了一个
底层数组、起始位置、可访问的元素个数（长度）以及最多可扩展到的元素个数（容量）。赋值与传参复制的只是
切片本身，而不是底层数组：

```go {run=true}
package main

import "fmt"

func main() {
	s := make([]int, 3, 4) // 长度 3，底层数组容量 4
	t := append(s, 4)      // 容量足够：t 与 s 共享同一个底层数组
	t[0] = 99
	fmt.Println(s, t) // s 同样观察到 99

	u := append(t, 5) // 容量不足：分配新数组，u 与 t 从此互不影响
	u[1] = 77
	fmt.Println(t, u)
}
```

```
[99 0 0] [99 0 0 4]
[99 0 0 4] [99 77 0 4 5]
```

传递切片的开销很小，代价是两个切片可能在不知不觉中共用同一个数组；`append` 之后二者是否仍然共用，取决于
容量是否足够（[5.1](../../part2lang/ch05data/slice.md)）。

**不做隐式的处理。** Go 没有运算符重载，数值类型之间不会自动转换，导入而未使用的包、声明而未使用的
变量都会导致编译错误 [[Pike, 2012](#ref-pike-2012)]：

```go
package main

import "os"

func main() {
	var a int32 = 1
	var b int64 = a
	_ = b
}
```

```
./main.go:3:8: "os" imported and not used
./main.go:7:16: cannot use a (variable of type int32) as int64 value in variable declaration
```

书写时多付出几个字符，换来的是仅凭一行代码就能判断它做了什么。

## 1.2.3 本书结构

- **第一部分 全景与历史**：Go 的设计缘由（第 1 章），Go 的汇编语言与调用约定
  （[第 2 章](../ch02asm/readme.md)），一个程序从构建到退出的全过程（[第 3 章](../ch03life/readme.md)）。
- **第二部分 语言特性的实现**：类型与接口（[第 4 章](../../part2lang/ch04type/readme.md)）、切片、
  字符串与 map（[第 5 章](../../part2lang/ch05data/readme.md)）、函数、defer 与 panic（[第
  6 章](../../part2lang/ch06func/readme.md)）、错误处理
  （[第 7 章](../../part2lang/ch07errors/readme.md)）、泛型
  （[第 8 章](../../part2lang/ch08generics/readme.md)）。
- **第三部分 并发**：goroutine 调度器（[第 9 章](../../part3concurrency/ch09sched/readme.md)）、channel
  与 select（[第 10 章](../../part3concurrency/ch10chan/readme.md)）、锁、原子操作与内存模型
  （[第 11 章](../../part3concurrency/ch11sync/readme.md)）。
- **第四部分 内存**：内存分配器（[第 12 章](../../part4memory/ch12alloc/readme.md)）、垃圾回收器
  （[第 13 章](../../part4memory/ch13gc/readme.md)）、goroutine 的栈
  （[第 14 章](../../part4memory/ch14stack/readme.md)）。
- **第五部分 编译器与工具链**：编译器（[第 15 章](../../part5toolchain/ch15compile/readme.md)）、
  调试与性能分析工具（[第 16 章](../../part5toolchain/ch16tools/readme.md)）、模块与依赖
  （[第 17 章](../../part5toolchain/ch17modules/readme.md)）。
- **第六部分 异构计算与 AI 时代的 Go**：GPU、图形、AI 推理与 Agent 运行时
  （[第 18 章](../../part6hetero/ch18gpu/readme.md) 至
  [第 21 章](../../part6hetero/ch21agent/readme.md)）。

## 1.2.4 贯穿全书的线索

2015 年，Rob Pike 把 Go 社区的若干共识归纳为 19 条「Go 格言」（Go
Proverbs）[[Pike, 2015](#ref-pike-2015)]，其中几条恰好概括了上述设计决定：「清晰好过聪明」（Clear is
better than clever），「少量复制好过少量依赖」（A little copying is better than a little dependency），
以及「不要通过共享内存来通信，而应通过通信来共享内存」（Don't communicate by sharing memory, share memory
by communicating）。

后续各章讨论每一处实现时，都可以追问两个问题：这样做换来了什么，又付出了什么代价。答案往往可以追溯到
[1.1](./history.md) 所讨论的那些问题。

## 延伸阅读

- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *The Go Programming Language
  Specification*. https://go.dev/ref/spec
  语言规范，全书讨论语言规则时的依据。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *Effective Go*.
  https://go.dev/doc/effective_go
  官方的编程风格指南，解释了许多惯用法背后的考虑。
- <a id="ref-pike-2012"></a>[Pike, 2012] Rob Pike. "Go at Google: Language Design in the Service of
  Software Engineering." 2012. https://go.dev/talks/2012/splash.article
  本节所述各项设计决定的动机。
- <a id="ref-cox-et-al-2022"></a>[Cox et al., 2022] Russ Cox, Robert Griesemer, Rob Pike, Ian Lance
  Taylor, Ken Thompson. "The Go Programming Language and Environment." *Communications of the ACM*, 65(5):
  70–78, 2022. https://doi.org/10.1145/3488716
  设计者的回顾：语言只是 Go 取得成功的一小部分原因，库、工具、惯例与软件工程方法同样重要。
- <a id="ref-donovan-kernighan-2015"></a>[Donovan and Kernighan, 2015] Alan A. A. Donovan, Brian W.
  Kernighan. *The Go Programming Language*. Addison-Wesley, 2015. 系统介绍 Go 语言的教材。
- <a id="ref-pike-2015"></a>[Pike, 2015] Rob Pike. "Go Proverbs." Gopherfest, 2015.
  https://go-proverbs.github.io/
  Go 格言的全文。

