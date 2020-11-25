---
weight: 1405
title: "4.5 错误处理的未来"
---

# 4.5 错误处理的未来

TODO: 讨论社区里的一些优秀的方案、以及未来可能的设计

## 4.5.1 来自社区的方案

在错误处理这件事情上，其实社区提供了许多非常优秀的方案，
其中一个非常出色的工作来自 Dave Cheney 和他的错误原语。

### 错误原语

`pkg/errors` 与标准库中 `errors` 包不同，它首先提供了 `Wrap`：

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
		if !ok { break }
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
进而在使用 `%+v` 进行错误打印时，能携带堆栈信息：

```go
func (w *withStack) Format(s fmt.State, verb rune) {
	switch verb {
	case 'v':
		if s.Flag('+') {			// %+v 支持携带堆栈信息的输出
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

### 基于错误链的高层抽象

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

如果我们进一步观察这个问题的现象，可以将整段代码抽象为图 1 所示的逻辑结构。

<div class="img-center" style="margin: 0 auto; max-width: 50%">
<img src="./../../../assets/errors-branch.png"/>
<strong>图 1: 产生分支的错误处理手段</strong>
</div>

如果我们尝试将这段充满分支的逻辑进行高层抽象，将其转化为一个单一链条，则能够得到 图 2 所示的隐式错误链条。

<div class="img-center" style="margin: 0 auto; max-width: 50%">
<img src="./../../../assets/errors-chan.png"/>
<strong>图 2: 消除分支的链式错误处理手段</strong>
</div>

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
	if c.err != nil && status == "ok" { return }
	_, c.err = c.conn.Write(b)
}
func (c *SafeConn) read() {
	if err != nil { return }
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

## 4.5.2 其他可能的设计

TODO:

Generics + Error handling? 

Either Coproduct

https://www.ituring.com.cn/article/508191
https://www.bookstack.cn/read/mostly-adequate-guide-chinese/ch8.4.md

## 4.5.3 历史性评述

TODO:

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
