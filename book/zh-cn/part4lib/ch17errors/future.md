---
weight: 4303
title: "17.3 错误处理的未来"
---

# 17.3 错误处理的未来

TODO: 讨论社区里的一些优秀的方案、讨论目前标准库不具备的能力以及 x/errors 为什么被拒，以及未来可能的设计

## 17.3.1 来自社区的方案

### `pkg/errors` 的错误处理原语

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

如果我们进一步观察这个问题的现象，可以将整段代码抽象为下面的逻辑结构：

```
       write       read           write
conn -------> conn -------> conn -------> conn
 |             |             |
 | error       | error       | error
 |             |             |
 v             v             v
 err           err          err
```

如果我们尝试将这段充满分支的逻辑进行高层抽象，将其转化为一个单一链条：

```
   +- - - - - - - write(); read(); write();- - - - - - +
   |												   |
   |												   v
SafeConn ------> SafeConn ------> SafeConn -------> SafeConn
```

则能够得到下面的代码：

```go
type SafeConn struct {
	conn   net.Conn
	r	  *bufio.Reader
	status string
	err	error
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

## 17.3.2 `x/errors` 堆栈信息与 `runtime.Caller` 的性能优化

TODO:

## 17.3.4 其他可能的设计

TODO:

## 进一步阅读的参考文献

- [Cheney, 2016a] Dave Cheney. My philosophy for error handling. April 2016. https://dave.cheney.net/paste/gocon-spring-2016.pdf
- [Cheney, 2016b] Dave Cheney. Don’t just check errors, handle them gracefully. April 2016. https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully
- [Cheney, 2016c] Dave Cheney. Stack traces and the errors package. June, 12 2016. https://dave.cheney.net/2016/06/12/stack-traces-and-the-errors-package)
- [Cheney, 2016d] Dave Cheney. pkg/errors: Simple error handling primitives. Last access: Jan 14, 2019 https://github.com/pkg/errors/tree/614d223910a179a466c1767a985424175c39b465

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
