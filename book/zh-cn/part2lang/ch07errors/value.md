---
weight: 2401
title: "7.1 问题的演化"
---

# 7.1 问题的演化

程序中的错误，指程序预见到、却无法正常完成的情形：文件不存在，连接被拒绝，输入格式有误。
一个例程遇到这类情形时如何告知调用方，调用方又如何应对，是语言设计中一个由来已久的问题。
大体上有两种传统：一种把错误作为返回值交给调用方，另一种把错误作为异常，沿调用栈传播到
某个处理程序。Go 属于前一种传统，它把错误定义为一个普通的接口类型，由调用方显式检查。

本节先回顾这两种传统各自的理论来源，再根据 Go 仓库的提交记录，追溯 `error` 类型从 2008 年
到 Go 1 的演变，随后说明 `error` 在语言中的定义，以及「错误即值」这一主张的含义。最后指出
早期的错误检查方式留下的问题，即附加上下文与保留错误的身份二者难以兼得。这一问题在 Go 1.13
得到解决，详见 [7.2](./inspect.md)。

## 7.1.1 两种传统

以返回值报告错误的做法，最典型的是 Unix 的系统调用：调用失败时返回 `-1`，具体原因写入全局
变量 `errno`。这种做法简单，代价有二：其一，错误信息与正常结果共用同一个返回值，`-1`
既是数值又是失败的标记；其二，调用方可以完全不检查返回值，编译器对此无能为力。

异常处理的系统论述始于 John Goodenough 1975 年发表于 CACM 的论文 *Exception Handling: Issues and a
Proposed Notation* [[Goodenough, 1975](#ref-goodenough-1975)]。这篇论文梳理了异常的分类与处理程序应满足的
要求，并区分了处理完异常之后控制流的两种去向：回到引发异常之处继续执行（恢复式），
或者终止引发异常的操作（终止式）。CLU 以及后来的 C++、Java 等主流语言采用的都是终止式。

Barbara Liskov 与 Alan Snyder 1979 年的论文 *Exception Handling in CLU*
[[Liskov and Snyder, 1979](#ref-liskov-snyder-1979)]描述了 CLU 语言的异常机制，它与 Go
的错误处理有颇多相似之处。按照 1979 年 10 月的 CLU 参考手册
[[Liskov et al., 1979](#ref-liskov-et-al-1979)]，例程可能发出的异常写在其类型之中，例如 `string$fetch`
的类型是 `proctype (string, int) returns (char) signals (bounds)`；发出的异常总是交给直接调用方，
并且必须由直接调用方处理；调用方若要继续向上传递，需要用 `resignal` 语句显式地再次发出；
未被处理的异常则一律转换为 `failure`，表示某个下层抽象以意外的方式失败了。把「交给直接调用方」
换成「作为最后一个返回值」，把 `resignal` 换成 `return err`，把 `failure` 换成 `panic`，几乎就是 Go
的做法。区别在于，CLU 的异常仍然是一种控制结构，而 Go 的错误只是一个值。

C++ 与 Java 走向了另一个方向：异常可以越过任意多层栈帧自动传播，直到遇到类型匹配的 `catch`。Java
又引入了受检异常（checked exception），要求方法在签名中以 `throws` 声明可能抛出的异常。
这一设计后来饱受争议。C# 的首席设计者 Anders Hejlsberg 在 2003 年的访谈中解释 C# 为何没有
采用受检异常时，指出了两个问题：可版本化（versionability），即新版本的方法增加一种异常会
破坏已有的调用方；以及可扩展性（scalability），即在大型系统中，每一层汇聚下层的异常，`throws`
子句会失控地膨胀 [[Venners and Eckel, 2003](#ref-venners-eckel-2003)]。

Joe Duffy 在 2016 年回顾微软 Midori 操作系统的错误模型时 [[Duffy, 2016](#ref-duffy-2016)]，
提出了另一个关键区分：**可恢复的错误**（recoverable error）与**缺陷**（bug）。前者通常源于程序对数据的校
验，例如输入不合法，程序应当处理它们；后者是程序员没有预料到的错误，例如数组越界、空指针解引用，
程序无法从中可靠地恢复，因此不应尝试恢复。Go 的设计恰好对应这一区分：可恢复的错误以 `error` 值返回，
缺陷则引发 panic（见 [6.3](../ch06func/panic.md) 与 [[Gerrand, 2010](#ref-gerrand-2010)]）。Go FAQ
对为何没有异常的解释，在 [6.3.7](../ch06func/panic.md) 中已有介绍，这里不再重复。

## 7.1.2 error 的由来

Go 的错误类型并非一开始就是今天的样子。从提交记录看，它经历了三个阶段。

最初是返回 `errno`。2008 年 9 月 10 日，Rob Pike 提交了 `os` 包的雏形
（795004c6b5）[[Pike, 2008a](#ref-pike-2008a)]，其中的函数直接把系统调用返回的错误号交给调用方：

```go
// src/lib/os/os_file.go（2008 年 9 月，当时的语法与今天不同）
export func Read(fd int64, b *[]byte) (ret int64, errno int64) {
	r, e := syscall.read(fd, &b[0], int64(len(b)));  // BUG：本应可以直接 return
	return r, e
}
```

当天稍晚，Pike 又提交了一个错误类型（92ae2cc8a3）[[Pike, 2008b](#ref-pike-2008b)]，提交说明是「add an
Error type to be used as a singleton pointer」。`ErrnoToError` 为每个错误号只创建一个 `*Error`，
于是两个错误是否相同，可以直接比较指针；`nil` 表示没有错误：

```go
// src/lib/os/os.go（2008 年 9 月）
// 错误是单例结构。用 Print()/String() 方法获取其内容，
// 它们会处理 nil（无错误）的情形。
export type Error struct {
	s string
}

var ErrorTab = new(map[int64] *Error);

func ErrnoToError(errno int64) *Error {
	if errno == 0 {
		return nil
	}
	err, ok := ErrorTab[errno]
	if ok {
		return err
	}
	e := new(Error);
	e.s = syscall.errstr(errno);
	ErrorTab[errno] = e;
	return e;
}

export func Read(fd int64, b *[]byte) (ret int64, err *Error) {
	r, e := syscall.read(fd, &b[0], int64(len(b)));
	return r, ErrnoToError(e)
}
```

（注释为笔者所译。）可以看到，用一个唯一的值标记一类错误、调用方以 `==` 比较的做法，即后文
所说的哨兵错误，是 Go 最早的错误形式。

第二个阶段是接口。2009 年 4 月 17 日，Pike 分步完成了自己称为「Big Error Shift」的修改。第一步
（aaf63f8d06）[[Pike, 2009](#ref-pike-2009)]把 `os.Error` 从结构体改为接口：

```go
// src/lib/os/error.go（2009 年 4 月）
// Error 可以表示任何可打印的错误情形。
type Error interface {
	String() string
}
```

第二步（45ed7297e8）把错误号也改造为实现该接口的类型 `Errno`，`os.EPERM`、`os.ENOENT` 等
变量不再是查表得到的指针，而是 `Errno` 值。从此任何具有 `String() string` 方法的类型都可以
充当错误，错误的表示不再局限于一个字符串。同年 6 月，Russ Cox 引入了 `os.EOF`（64684cc2a2）。

第三个阶段是 Go 1 的内建 `error`。2011 年 11 月 1 日，Russ Cox 在同一天提交了一组修改：
在语言规范中加入预声明类型 `error`（d9877e22fe），在编译器中实现它（2a0e15d36c），新建只有一个函数 `New`
的 `errors` 包（e4ae30f5f5），并在 `io` 包中加入 `EOF`，取代原先的 `os.EOF`（c06cf03f0b）[[Cox,
2011](#ref-cox-2011)]。Go 1 的发布说明 [[Go Authors, 2012](#ref-go-authors-2012)]解释
了这样做的理由：错误最初出现在实现 `os` 包的时候，看起来与操作系统相关，所以放在 `os` 中；
但后来发现错误比操作系统更基础，例如 `os` 所依赖的 `syscall` 也需要使用错误，而把错误放在 `os`
中会给许多包引入原本不必要的依赖。方法名从 `String` 改为 `Error`，则是为了避免一个只是实现了常用的
`String` 方法的类型，意外地满足了错误接口。

还有一处细节值得一提。2009 年的 `os.NewError` 会按字符串去重，相同文本的两次调用得到同一个错误；Go
1 的 `errors.New` 则每次都分配一个新的 `errorString`，Go 1.26 的文档明确写道，即使文本相同，
每次调用 `New` 返回的错误值也各不相同。因此，一个哨兵错误的身份在于那个变量所持有的指针，而
不在于它的文本。

## 7.1.3 语言中的 error

Go 语言规范 [[Go Authors, 2026](#ref-go-authors-2026)]把 `error` 列为预声明类型，定义为：

```go
type error interface {
	Error() string
}
```

在类型检查器中，`error` 与 `int`、`string` 一样定义在全域块（universe block）中。Go 1.26 的
`types2` 这样构造它：

```go
// src/cmd/compile/internal/types2/universe.go
// type error interface{ Error() string }
{
	obj := NewTypeName(nopos, nil, "error", nil)
	typ := (*Checker)(nil).newNamed(obj, nil, nil)

	// error.Error() string
	recv := newVar(RecvVar, nopos, nil, "", typ)
	res := newVar(ResultVar, nopos, nil, "", Typ[String])
	sig := NewSignatureType(recv, nil, nil, nil, NewTuple(res), false)
	err := NewFunc(nopos, nil, "Error", sig)

	// interface{ Error() string }
	ityp := &Interface{methods: []*Func{err}, complete: true}
	computeInterfaceTypeSet(nil, nopos, ityp) // 预先计算类型集，避免延迟计算带来的数据竞争

	typ.fromRHS = ityp
	typ.Underlying()
	def(obj)
}
```

（注释为笔者所译。）`error` 是一个命名类型，它的底层类型是只含一个方法的接口，所属包为空。
这与 `any` 不同，`any` 只是 `interface{}` 的别名。除了是预声明的之外，`error` 与用户定义的
接口没有区别：它可以被嵌入其他接口（例如 `net.Error` 嵌入了 `error`），可以用 `==` 比较，
可以存入切片与映射。

在运行时，`error` 是一个非空接口，表示为 [4.2.1](../ch04type/interface.md) 所述的 `iface`：一个
指向接口表 `itab` 的指针加上一个数据指针。只有两个字都为 `nil` 时，`error` 才等于 `nil`。由此
产生了一个常见的陷阱：函数返回一个值为 `nil` 的具体类型指针，得到的 `error` 却不等于 `nil`。[4.2.2](../ch04type/interface.md)
以 `error` 为例详细分析了这一现象，Go FAQ 中也有专门的条目
*Why is my nil error value not equal to nil?*。

## 7.1.4 错误即值

`error` 是普通的值，这一点的意义常被低估。Andrew Gerrand 2011 年的博文
[[Gerrand, 2011](#ref-gerrand-2011)]已经以此为出发点介绍 Go 的错误处理。Rob Pike 在 2015 年 1 月的博文
*Errors are values* [[Pike, 2015](#ref-pike-2015)]中回忆，2014 年秋季在东京的 GoCon 上，
一位参会者又一次提起了那个常见的抱怨：错误检查的代码过于重复。Pike 认为，持这种看法的程序员忽略了一个基本
事实：错误是值。值可以编程，错误既然是值，也就可以编程。

文中的例子是一个连续写入的场景。每次写入都检查错误会显得冗长，但可以定义一个类型，把第一个
错误记录下来，此后的写入直接跳过，最后统一检查一次：

```go {run=true}
package main

import (
	"errors"
	"fmt"
	"io"
	"os"
)

// errWriter 记录第一个写入错误，此后的写入都不再执行
type errWriter struct {
	w   io.Writer
	err error
}

func (ew *errWriter) write(buf []byte) {
	if ew.err != nil {
		return
	}
	_, ew.err = ew.w.Write(buf)
}

// quotaWriter 写满 n 个字节后返回错误
type quotaWriter struct{ n int }

func (q *quotaWriter) Write(p []byte) (int, error) {
	if len(p) > q.n {
		return 0, errors.New("quota exceeded")
	}
	q.n -= len(p)
	return os.Stdout.Write(p)
}

func main() {
	ew := &errWriter{w: &quotaWriter{n: 8}}
	ew.write([]byte("head\n"))
	ew.write([]byte("body\n")) // 超出配额，此后的写入都被跳过
	ew.write([]byte("tail\n"))
	if ew.err != nil {
		fmt.Println("error:", ew.err)
	}
}
```

```
head
error: quota exceeded
```

标准库中也有同样的做法。`bufio.Scanner` 的 `Scan` 方法只返回一个布尔值，扫描过程中遇到的
错误保存在 `Scanner` 内部，循环结束后由 `Err` 方法统一取出；`bufio.Writer` 在一次写入失败后，
后续的写入与 `Flush` 都会返回同一个错误。这些例子的共同点是：错误被当作状态保存、推迟检查，
而不是每次都立即判断。Pike 在文末也提醒，无论采用何种写法，都必须检查错误。这里简化的只是
检查的写法，检查本身仍不可省略。

## 7.1.5 检查的困境

错误既然是值，调用方就需要一种方法判断某个错误是不是自己关心的那一个。在 Go 1.13 之前，常见的
做法有三种。

第一种是与哨兵错误比较，例如 `err == io.EOF`。第二种是对自定义的错误类型做类型断言，例如
`err.(*os.PathError)`，取出其中的字段。第三种是在 `err.Error()` 返回的字符串中查找子串。
第三种最不可取，它依赖面向人的错误文本，文本一旦修改，检查便悄然失效。

前两种做法各有隐患。哨兵错误是导出的变量，而非常量，任何导入该包的代码都可以改写它。Dave Cheney 在
2016 年的文章 *Constant errors* 中指出了这一点，并提出以字符串为底层类型的常量错误作为替代
[[Cheney, 2016e](#ref-cheney-2016e)]。下面的程序演示了这几个性质：

```go {run=true}
package main

import (
	"errors"
	"fmt"
	"io"
)

// constErr 以字符串为底层类型，可以声明为常量
type constErr string

func (e constErr) Error() string { return string(e) }

const ErrClosed = constErr("closed")

func main() {
	// errors.New 每次返回不同的指针，文本相同也不相等
	fmt.Println(errors.New("EOF") == errors.New("EOF"))

	// 导出的哨兵是变量，包外代码可以改写它
	saved := io.EOF
	io.EOF = errors.New("EOF")
	fmt.Println(saved == io.EOF)
	io.EOF = saved

	// 常量错误按值比较，且无法被改写
	var err error = constErr("closed")
	fmt.Println(err == ErrClosed)

	// 以 %v 附加上下文之后，与原错误不再相等
	wrapped := fmt.Errorf("read config: %v", io.EOF)
	fmt.Println(wrapped == io.EOF, wrapped)
}
```

```
false
false
true
false read config: EOF
```

更根本的问题在最后一行。错误从底层向上传播时，每一层通常都想补充一句上下文，说明自己当时在
做什么。但用 `fmt.Errorf` 和 `%v` 把下层错误格式化进新的消息之后，得到的是一个全新的错误，
原来的身份随之丢失：`==` 比较不再成立，类型断言也无法命中。于是调用方面临两难：附加上下文，
就失去了检查根因的能力；保留检查能力，就不能附加上下文。

社区为此做过不少尝试。Dave Cheney 于 2015 年底创建的 `github.com/pkg/errors` 用 `Wrap` 包装错误、用
`Cause` 取出根因，并在包装时记录调用栈，被广泛采用 [[Cheney, 2016d](#ref-cheney-2016d)]。2018 年 8 月，Go
团队发布了 Go 2 的错误处理与错误值两组草案设计 [[Lohuizen, 2018](#ref-lohuizen-2018)]，Russ Cox
为错误值草案撰写的问题概述 [[Cox, 2018](#ref-cox-2018)]指出，无论用 `fmt.Errorf` 还是新的类型包装错误，
都会使相等比较与类型断言失效，这反过来使人们不愿包装错误，错误信息也就不够有用。最终落地的是 Go 1.13
的方案 [[Neil, 2019](#ref-neil-2019)] [[Neil and Amsterdam, 2019](#ref-neil-amsterdam-2019)]：`fmt.Errorf`
的 `%w` 动词保留被包装的错误 [[Cox, 2019a](#ref-cox-2019a)]，`errors.Is` 与 `errors.As`
沿包装链检查。这一机制的实现见 [7.2](./inspect.md)，错误消息与上下文的组织见 [7.3](./context.md)，
库作者应当以何种形式暴露错误见 [7.4](./semantics.md)。

## 7.1.6 演化年表

| 时间 | 版本 | 变化 | 主要贡献者 |
| :-- | :-- | :-- | :-- |
| 2008 年 9 月 | 开发初期 | `os` 函数返回 `errno int64`；同日改为单例 `*os.Error` | Rob Pike |
| 2009 年 4 月 | 开发初期 | `os.Error` 改为接口，方法为 `String() string` | Rob Pike |
| 2011 年 11 月 | Go 1 | 内建 `error`，方法为 `Error() string`；`errors` 包；`io.EOF` | Russ Cox |
| 2015 年 1 月 | | 博文 *Errors are values* | Rob Pike |
| 2018 年 8 月 | | Go 2 错误处理与错误值草案设计 | Russ Cox、Marcel van Lohuizen、Jonathan Amsterdam、Damien Neil |
| 2019 年 7 月 | | `try` 提案被拒绝 | Robert Griesemer |
| 2019 年 9 月 | Go 1.13 | `%w`；`errors.Unwrap`、`Is`、`As` | Marcel van Lohuizen、Damien Neil、Jonathan Amsterdam |
| 2023 年 2 月 | Go 1.20 | `errors.Join`；`fmt.Errorf` 支持多个 `%w` | Damien Neil |
| 2023 年 8 月 | Go 1.21 | `errors.ErrUnsupported` | Andy Pan |
| 2025 年 6 月 | | 决定不再追求错误处理的专门语法 | Robert Griesemer |
| 2026 年 2 月 | Go 1.26 | 泛型的 `errors.AsType` | Julien Cretel |

这张年表中，语言本身只改动过一次，即 Go 1 引入内建的 `error`；此后的每一项改进都发生在标准库中。`error`
接口始终只有一个方法，新增的能力都建立在可选的约定之上，例如错误可以再实现一个 `Unwrap` 方法
[[Go Authors, 2023](#ref-go-authors-2023)]。Russ Cox 在 2019 年的博文中把 Go 的演进方式概括为「实验、
简化、发布」，并说明 `check` 与 `try` 的实验之所以被放弃，是因为看不出它们能让 Go 的开发整体上更简单
[[Cox, 2019b](#ref-cox-2019b)]。为减少 `if err != nil` 而提出的语法，则一一被否决
[[Griesemer, 2019](#ref-griesemer-2019)]，这段历史见 [7.5](./future.md)。

## 延伸阅读

- <a id="ref-goodenough-1975"></a>[Goodenough, 1975] John B. Goodenough. *Exception Handling: Issues and a
  Proposed Notation.* Communications of the ACM 18(12):683–696, 1975.
  https://doi.org/10.1145/361227.361230
- <a id="ref-liskov-snyder-1979"></a>[Liskov and Snyder, 1979] Barbara Liskov, Alan Snyder. *Exception
  Handling in CLU.* IEEE Transactions on Software Engineering SE-5(6):546–558, 1979.
  https://doi.org/10.1109/TSE.1979.230191
- <a id="ref-liskov-et-al-1979"></a>[Liskov et al., 1979] Barbara Liskov 等. *CLU Reference Manual.*
  MIT/LCS/TR-225, 1979（第 12 章 Exception Handling and Exits）.
  https://bitsavers.org/pdf/mit/lcs/tr/MIT-LCS-TR-0225.pdf
- <a id="ref-venners-eckel-2003"></a>[Venners and Eckel, 2003] Bill Venners, Bruce Eckel. *The Trouble
  with Checked Exceptions: A Conversation with Anders Hejlsberg, Part II.* Artima, 2003.
  https://www.artima.com/articles/the-trouble-with-checked-exceptions
- <a id="ref-duffy-2016"></a>[Duffy, 2016] Joe Duffy. *The Error Model.* 2016.
  https://joeduffyblog.com/2016/02/07/the-error-model/
- <a id="ref-gerrand-2010"></a>[Gerrand, 2010] Andrew Gerrand. *Defer, Panic, and Recover.* The Go Blog,
  2010. https://go.dev/blog/defer-panic-and-recover
  （值派之外那条「真正异常」支线的背景，呼应 [6.3](../ch06func/panic.md)）
- <a id="ref-pike-2008a"></a>[Pike, 2008a] Rob Pike. *rudimentary beginnings of soon-to-be-real os
  library.* Go 提交 795004c6b5, 2008. https://go.googlesource.com/go/+/795004c6b5
- <a id="ref-pike-2008b"></a>[Pike, 2008b] Rob Pike. *add an Error type to be used as a singleton
  pointer.* Go 提交 92ae2cc8a3, 2008. https://go.googlesource.com/go/+/92ae2cc8a3
- <a id="ref-pike-2009"></a>[Pike, 2009] Rob Pike. *Step 1 of the Big Error Shift.* Go 提交 aaf63f8d06,
  2009. https://go.googlesource.com/go/+/aaf63f8d06 ；Step 2：
  https://go.googlesource.com/go/+/45ed7297e8
- <a id="ref-cox-2011"></a>[Cox, 2011] Russ Cox. *errors: new package.* Go 提交 e4ae30f5f5, 2011.
  https://go.googlesource.com/go/+/e4ae30f5f5 ；*spec: add error*：
  https://go.googlesource.com/go/+/d9877e22fe
- <a id="ref-go-authors-2012"></a>[Go Authors, 2012] The Go Authors. *Go 1 Release Notes: The error type
  and errors package.* 2012. https://go.dev/doc/go1#errors
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Go programming language
  specification: Errors* 与 *src/errors/*、*src/fmt/errors.go.* https://go.dev/ref/spec ；
  https://github.com/golang/go/tree/master/src/errors ；Go 1.26 的
  [src/errors/errors.go](https://github.com/golang/go/blob/release-branch.go1.26/src/errors/errors.go)
- <a id="ref-pike-2015"></a>[Pike, 2015] Rob Pike. *Errors are values.* The Go Blog, 2015.
  https://go.dev/blog/errors-are-values
- <a id="ref-gerrand-2011"></a>[Gerrand, 2011] Andrew Gerrand. *Error handling and Go.* The Go Blog, 2011.
  https://go.dev/blog/error-handling-and-go
- <a id="ref-cheney-2016e"></a>[Cheney, 2016e] Dave Cheney. *Constant errors.* 2016.
  https://dave.cheney.net/2016/04/07/constant-errors
- <a id="ref-cheney-2016d"></a>[Cheney, 2016d] Dave Cheney. *pkg/errors: Simple error handling
  primitives.* https://github.com/pkg/errors
- <a id="ref-lohuizen-2018"></a>[Lohuizen, 2018] Marcel van Lohuizen. *Error Handling, Draft Design
  (check/handle).* 2018. https://go.googlesource.com/proposal/+/master/design/go2draft-error-handling.md
- <a id="ref-cox-2018"></a>[Cox, 2018] Russ Cox. *Error Values, Problem Overview.* 2018.
  https://github.com/golang/proposal/blob/master/design/go2draft-error-values-overview.md
  （go2 草案对「错误即值」演化问题的总览）
- <a id="ref-neil-2019"></a>[Neil, 2019] Damien Neil. *Go 1.13 launch decision about error values.* 2019.
  https://github.com/golang/go/issues/29934#issuecomment-489682919 ；
  <a id="ref-cox-2019a"></a>[Cox, 2019a] Russ Cox. *Response regarding "proposal: Go 2 error values".*
  2019. https://github.com/golang/go/issues/29934#issuecomment-490087200
  （`%w`/`Is`/`As` 收敛成型前的关键决策讨论）
- <a id="ref-neil-amsterdam-2019"></a>[Neil and Amsterdam, 2019] Damien Neil, Jonathan Amsterdam. *Working
  with Errors in Go 1.13.* The Go Blog, 2019. https://go.dev/blog/go1.13-errors
  （`%w`、`Unwrap`、`Is`、`As`）
- <a id="ref-cox-2019b"></a>[Cox, 2019b] Russ Cox. *Experiment, Simplify, Ship.* The Go Blog, 2019.
  https://go.dev/blog/experiment
- <a id="ref-griesemer-2019"></a>[Griesemer, 2019] Robert Griesemer. *Proposal: A built-in Go error check
  function, "try" (golang/go#32437).* 2019. https://github.com/golang/go/issues/32437 （被拒绝的 `try`
  提案；提案评审委员会的说明见 https://github.com/golang/go/issues/32437#issuecomment-512035919 ）
- <a id="ref-go-authors-2023"></a>[Go Authors, 2023] The Go Authors. *Go 1.20 Release Notes: errors.*
  2023. https://go.dev/doc/go1.20#errors （`errors.Join` 与多 `%w`）
- 本书 [6.3 恐慌与恢复](../ch06func/panic.md)、[7.2 错误值检查](./inspect.md)、[7.5
  错误处理的未来](./future.md)。
