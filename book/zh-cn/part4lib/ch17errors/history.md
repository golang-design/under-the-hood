---
weight: 4301
title: "17.1 错误处理的历史及其演化"
---

# 17.1 错误处理的历史及其演化

`error` 在 Go 中表现为一个内建的接口类型：

```go
type error interface {
    Error() string
}
```

任何实现了 `Error() string` 方法的类型都能作为 `error` 类型进行传递。

## `error` 类型的历史形态

早期的 Go 甚至没有错误处理，当时的 `os.Read` 函数进行系统调用可能产生错误，而该接口是通过 `int64` 类型进行错误返回的：

```go
export func Read(fd int64, b *[]byte) (ret int64, errno int64) {
    r, e := syscall.read(fd, &b[0], int64(len(b)));
    return r, e
}
```

随后，Go 团队将这一 `errno` 转换抽象成了一个类型：

```go
export type Error struct { s string }

func (e *Error) Print() { ... }
func (e *Error) String() string { ... }

export func Read(fd int64, b *[]byte) (ret int64, err *Error) {
    r, e := syscall.read(fd, &b[0], int64(len(b)));
    return r, ErrnoToError(e)
}
```

之后才演变为了我们所熟知的 error 接口类型，其在编译器中的实现为：

```go
// go/src/cmd/compile/internal/gc/universe.go
func makeErrorInterface() *types.Type {
	field := types.NewField()
	field.Type = types.Types[TSTRING]
	f := functypefield(fakeRecvField(), nil, []*types.Field{field})

	field = types.NewField()
	field.Sym = lookup("Error")
	field.Type = f

	t := types.New(TINTER)
	t.SetInterface([]*types.Field{field})
	return t
}
```

可见之所以从理解上我们可以将 error 认为是一个接口，是因为在编译器实现中，是通过查询某个类型是否实现了 `Error` 方法
来创建 Error 类型的。


## 错误处理的基本策略

Go 中的错误处理非常常见的策略有如下三种：

### 『哨兵』错误

```go
if err === ErrSomething { ... }
```

这种错误处理方式通过特定值表示成功和不同错误，依靠调用方对错误进行检查。例如比较著名的 `io.EOF = errors.New("EOF")`。

这种错误处理的方式引入了上下层代码的依赖，如果被调用放的错误类型发生了变化，则调用方也需要对代码进行修改：

```go
func readf(path string) error {
    err := file.Open(path)
    if err != nil {
        return fmt.Errorf("cannot open file: %v", err)
    }
}

func main() {
    err := readf("~/.ssh/id_rsa.pub")
    if strings.Contains(err.Error(), "not found") {
        ...
    }
}
```

这类错误处理的方式是非常危险的，因为它在调用方和被调用方之间建立了牢不可破的依赖关系。

哨兵错误还有一个相当致命的危险，那就是这种方式所定义的错误并非常量，例如：

```go
package io

var EOF = errors.New("EOF")
```

而当我们将此错误类型公开给其他包使用后，我们非常难以避免这种事情发生：

```go
package main

import "io"

func init() {
    io.EOF = nil
}
```

这种事情甚至严重到：

```go
import "cropto/rsa"

func init() {
    rsa.ErrVerification = nil
}
```

在硕大的代码依赖中，我们几乎无法保证这种恶意代码不会出现在某个依赖的包中。
为了安全起见，变量错误类型可以被建议的修改：

```diff
-var EOF = errors.New("EOF")
+const EOF = ioError("EOF")
+type ioEorror string
+
+func (e ioError) Error() string { return string(e) }
```

### 自定义错误

```go
if err, ok := err.(SomeErrorType); ok { ... }
```

这类错误处理的方式通过自定义的错误类型来表示特定的错误，同样依赖上层代码对错误值进行检查，不同的是需要使用类型断言进行检查。
例如：

```go
type CustomizedError struct {
    Line int
    Msg  string
    File string
}
func (e CustomizedError) Error() string {
    return fmt.Sprintf("%s:%d: %s", e.File, e.Line, e.Msg)
}
```

这种错误处理的好处在于，可以将错误包装起来，提供更多的上下文信息，但错误的实现方必须向上层公开实现的错误类型，不可避免的同样需要产生依赖关系。

### 隐式错误

```go
if err != nil { return err }
```

这种错误处理的方式直接返回错误的任何细节，直接将错误进一步报告给上层。这种情况下，错误在当前调用方这里完全没有进行任何加工，与没有进行处理几乎是等价的，这回产生的一个致命问题在于：丢失调用的上下文信息，如果某个错误连续向上层传播了多次，那么上层代码可能在输出某个错误时，根本无法判断该错误的错误信息究竟从哪儿传播而来。以上面提到的文件打开的例子为例，错误信息可能就只有一个 `not found`。

## `pkg/errors` 的错误处理原语

`pkg/errors` 是一个较为公认的优秀的进行错误处理的包，与官方的 errors 包不同，它首先提供了 `Wrap`：

```go
func Wrap(err error, message string) error {
	if err == nil {
		return nil
    }
    
    // 首先将错误产生的上下文进行保存
	err = &withMessage{
		cause: err,
		msg:   message,
    }
    
    // 再将 withMessage 错误的调用堆栈保存为 withStack 错误
	return &withStack{
		err,
		callers(),
	}
}

type withMessage struct {
	cause error
	msg   string
}

func (w *withMessage) Error() string { return w.msg + ": " + w.cause.Error() }
func (w *withMessage) Cause() error  { return w.cause }

type withStack struct {
	error
	*stack // 携带 stack 的信息
}

func (w *withStack) Cause() error { return w.error }

func callers() *stack {
	const depth = 32
	var pcs [depth]uintptr
	n := runtime.Callers(3, pcs[:])
	var st stack = pcs[0:n]
	return &st
}
```

这是一种依赖运行时接口的解决方案，通过 `runtime.Caller` 来获取错误出现时的堆栈信息。通过 `Wrap()` 产生的错误类型 `withMessage` 还实现了 `causer` 接口：

```go
type causer interface {
    Cause() error
}
```

当我们需要对一个错误进行检查时，则可以通过 `errors.Cause(err error)` 来返回一个错误产生的原因，进而获得了错误产生的上下文信息：

```go
func Cause(err error) error {
	type causer interface {
		Cause() error
	}

	for err != nil {
		cause, ok := err.(causer)
		if !ok {
			break
		}
		err = cause.Cause()
	}
	return err
}
```

进而可以做到：

```go
switch err := errors.Cause(err).(type) {
case *CustomError:
    // ...
}
```

得益于 `fmt.Formatter` 接口，`pkg/errors` 还实现了 `Fomat(fmt.State, rune)` 方法，
进而在使用 `%+v` 进行错误答应时，能携带堆栈信息：

```go
func (w *withStack) Format(s fmt.State, verb rune) {
	switch verb {
	case 'v':
		if s.Flag('+') {            // %+v 支持携带堆栈信息的输出
			fmt.Fprintf(s, "%+v", w.Cause())
			w.stack.Format(s, verb) // 将 runtime.Caller 获得的信息进行打印
			return
		}
		fallthrough
	case 's':
		io.WriteString(s, w.Error())
	case 'q':
		fmt.Fprintf(s, "%q", w.Error())
	}
}
```

得到形如下面格式的错误输出：

```go
current message: causer message
main.causer
    /path/to/caller/main.go:5
main.caller
    /path/to/caller/main.go:12
main.main
    /path/to/caller/main.go:27
```

## 对错误链条进行高层抽象

我们再来看另一种错误处理的哲学，现在我们来考虑下面这个例子：

```go
conn, err := net.Dial("tcp", "localhost:1234")
if err != nil {
    panic(err)
}
_, err := conn.Write(command1)
if err != nil {
    panic(err)
}

r := bufio.NewReader(conn)
status, err := r.ReadString('\n')
if err != nil {
    panic(err)
}
if status == "ok" {
    _, err := conn.Write(command2)
    if err != nil {
        panic(err)
    }
}
```

我们很明确的能够观察到错误处理带来的问题：为清晰的阅读代码的整体逻辑带来了障碍。我们希望上面的代码能够清晰的展现最重要的代码逻辑：

```go
conn := net.Dial("tcp", "localhost:1234")
conn.Write(command1)
r := bufio.NewReader(conn)
status := r.ReadString('\n')
if status == "ok" {
    conn.Write(command2)
}
```

如果我们进一步观察这个问题的现象，可以将整段代码抽象为下面的逻辑结构：

```
      write         read          write
conn -------> conn -------> conn -------> conn
 |             |             |
 | error       | error       | error
 |             |             |
 v             v             v
 err           err           err
```

如果我们尝试将这段充满分支的逻辑进行高层抽象，将其转化为一个单一链条：

```
   +- - - - - - - write(); read(); write();- - - - - - +
   |                                                   |
   |                                                   v
SafeConn ------> SafeConn ------> SafeConn -------> SafeConn
```

则能够得到下面的代码：

```go
type SafeConn struct {
    conn   net.Conn
    r      *bufio.Reader
    status string
    err    error
}
func safeDial(n, addr string) SafeConn {
    conn, err := net.Dial(n, addr)
    r := bufio.NewReader(conn)
    return SafeConn{conn, r, "ok", err}
}

func (c *SafeConn) write(b []byte) {
    if c.err != nil && status == "ok" {
        return
    }
    _, c.err = c.conn.Write(b)
}
func (c *SafeConn) read() {
    if err != nil {
        return
    }
    c.status, c.err = c.r.ReadString('\n')
}
```

则当建立连接时候：

```go
c := safeDial("tcp", "localhost:1234") // 如果此条指令出错
c.write(command1) // 不会发生任何事情
c.read()          // 不会发生任何事情
c.write(command2) // 不会发生任何事情

// 最后对进行整个流程的错误处理
if c.err != nil || c.status != "ok" {
    panic("bad connection")
}
```

这种将错误进行高层抽象的方法通常包含以下四个一般性的步骤：

1. 建立一种新的类型
2. 将原始值进行封装
3. 将原始行为进行封装
4. 将分支条件进行封装


## 争议

### 对错误处理进行改进的反馈

从 Go 团队开始着手正式考虑对错误处理进行改进时，逐渐涌现了很多关于错误处理的反馈 [Lohuizen, 2018]。
根据这些反馈，Go 团队将错误处理的改进拆分为了一下两个方面：

1. 错误检查：出现错误时，没有足够的堆栈信息，如何增强错误发生时的上下文信息，如何合理格式化一个错误？
2. 错误处理：处理方式啰嗦而冗长，每个返回错误的函数都要求调用方进行显式处理，如何减少这种代码出现的密集程度？

我们根据现有已经被拒绝的关于『错误处理』的两个提案在本节中进行讨论，并在下一节中讨论已经在 Go 1.13 中接收的关于如何增强错误上下文信息、对某个错误的类型进行审计的『错误检查』的设计。

### check/handle 关键字

Go 团队在重新考虑错误处理的时候提出过两种不同的方案，第一种方案就是引入新的关键字 `check`/`handle` 进行组合。为此官方举出了一个典型的例子：

```go
func CopyFile(src, dst string) error {
    r, err := os.Open(src)
    if err != nil {
        return fmt.Errorf("copy %s %s: %v", src, dst, err)
    }
    defer r.Close()

    w, err := os.Create(dst)
    if err != nil {
        return fmt.Errorf("copy %s %s: %v", src, dst, err)
    }

    if _, err := io.Copy(w, r); err != nil {
        w.Close()
        os.Remove(dst)
        return fmt.Errorf("copy %s %s: %v", src, dst, err)
    }

    if err := w.Close(); err != nil {
        os.Remove(dst)
        return fmt.Errorf("copy %s %s: %v", src, dst, err)
    }
}
```

在上面的 `CopyFile` 函数中，每一次的 Open, Create, Copy, Close 都需要对错误进行处理。这就使得整个代码变得非常的啰嗦，不断的有新的 err 需要进行检查。
最初 Go 团队希望引入一组新的关键字来统一对某个过程的错误进行简化，例如：

```go
func CopyFile(src, dst string) error {
	handle err {
		return fmt.Errorf("copy %s %s: %v", src, dst, err)
	}

	r := check os.Open(src)
	defer r.Close()

	w := check os.Create(dst)
	handle err {
		w.Close()
		os.Remove(dst) // (only if a check fails)
	}

	check io.Copy(w, r)
	check w.Close()  // 此处发生 err 调用上方的 handle 块时还会再额外调用一次 w.Close()
	return nil
}
```

这种使用 check 和 handle 的方式会当 err 发生时，直接进入 check 关键字上方最近的一个 handle err 块进行错误处理。在官方的这个例子中其实就已经发生了语言上模棱两可的地方，当函数最下方的 `w.Close` 产生调用时，上方与其最近的一个 `handle err` 还会再一次调用 `w.Close`，这其实是多余的。

此外，这种方式看似对代码进行了简化，但仔细一看这种方式与 defer 函数进行错误处理之间并没有带来任何本质区别，例如：

```go
func CopyFile(src, dst string) (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("copy %s %s: %v", src, dst, err)
        }
    }()

    r, err := os.Open(src)
    if err != nil {
        return
    }
    defer r.Close()

    w, err := os.Create(dst)
    if err != nil {
        return
    }

    defer func() {
        if err != nil {
            w.Close()
            os.Remove(dst)
        }
    }()
    _, err = io.Copy(w, r)
    if err != nil {
        return
    }

    err = w.Close()
    if err != nil {
        return
    }
}
```

不难看出，官方给出的 check handle 关键字，仅仅只是对现有代码的简单翻译。
具体来说，官方的 handle 关键字仅仅只是等价于：

```go
handle err { ... }

=> 

defer func() {
    if err != nil {
        err = ...
    }
}()
```

而 check 关键字仅仅只是等价于：

```go
check somefunc()

=>

err = somefunc()
if err != nil {
    return
}
```

### try 内建函数

紧随 check/handle 的提案，提出了一个内建函数 `try()`，它能够接收
最后一个返回值为 error 的函数，并将除 error 之外的返回值进行返回：

```go
x1, x2, ..., xn = try(f())

=>

t1, ..., tn, te := f()
if te != nil {
        err = te
        return
}
x1, ..., xn = t1, ..., tn
```

```go
func CopyFile(src, dst string) (err error) {
        defer func() {
                if err != nil {
                    err = fmt.Errorf("copy %s %s: %v", src, dst, err)
                }
        }()

        r := try(os.Open(src))
        defer r.Close()

        w := try(os.Create(dst))
        defer func() {
                w.Close()
                if err != nil {
                    os.Remove(dst) // only if a “try” fails
                }
        }()

        try(io.Copy(w, r))
        try(w.Close())
        return nil
}
```

这种做法与 check/handle 的关键字组合本质上并没有发生任何变化，
try() 内建函数的提案无非只是提供了一种可以减少 `if err != nil { ... }` 出现频率的方法。

从这两份不同的提案中，Go 团队似乎错误处理的改进与『如何减少 `if err != nil { ... }` 的出现』直接化了等号，这种纯粹写法风格上的问题，应该是该提案遭到社区强烈反对的原因。

## 小结

本节我们回顾了 Go 语言早期对错误处理的演化过程，包括 error 类型作为接口的来历。
随后我们讨论了 Go 语言在 Go 1.13 之前进行错误处理的常见手段，并详细讨论了
公认的较为优秀的提供错误处理原语的包 `pkg/errors`。
并在最后，简单讨论了从 Go 1.12 进入开发周期后，Go 团队所考虑的几个关于改进错误处理方式的提案。

## 进一步阅读的参考文献

- [Gerrand, 2010] [Andrew Gerrand, Defer, Panic and Recover, August 2010](https://blog.golang.org/defer-panic-and-recover)
- [Gerrand, 2011] [Andrew Gerrand, Error handling in Go, July 2011](https://blog.golang.org/error-handling-and-go)
- [Pike, 2015] [Rob Pike, Errors are values, January 2015](https://blog.golang.org/errors-are-values)
- [Cheney, 2016a] [Dave Cheney, My philosophy for error handling, April 2016](https://dave.cheney.net/paste/gocon-spring-2016.pdf)
- [Cheney, 2016b] [Dave Cheney, Don’t just check errors, handle them gracefully, April 2016](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Cheney, 2016c] [Dave Cheney, Stack traces and the errors package, June 2016](https://dave.cheney.net/2016/06/12/stack-traces-and-the-errors-package)
- [Cheney, 2016d] [Dave Cheney, pkg/errors: Simple error handling primitives](https://github.com/pkg/errors)
- [Cox, 2019] [Russ Cox, Experiment, Simplify, Ship, August 2019](https://blog.golang.org/experiment)
- [Cos, 2018] [Russ Cox, Error Values — Problem Overview, August 2018](https://github.com/golang/proposal/blob/master/design/go2draft-error-values-overview.md)
- [Lohuizen, 2018] [Marcel van Lohuizen, Error Handling — Draft Design, August 2018](https://github.com/golang/proposal/blob/master/design/go2draft-error-handling.md)
- [Griesemer, 2019] [Robert Griesemer, Proposal: A built-in Go error check function, "try", July 2019](https://github.com/golang/go/issues/32437#issuecomment-512035919)


## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)