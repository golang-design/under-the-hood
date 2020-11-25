---
weight: 1401
title: "4.1 问题的演化"
---

# 4.1 问题的演化

错误 `error` 在 Go 中表现为一个内建的接口类型，任何实现了 `Error() string`
方法的类型都能作为 `error` 类型进行传递，成为错误值：

```go
type error interface {
	Error() string
}
```

作为内建接口类型，编译器负责在参数传递检查时，对值类型所实现的方法进行检查。
当类型实现了 `Error() string` 方法后，才允许其作为 error 进行传递：

```go
// go/src/cmd/compile/internal/gc/universe.go
func makeErrorInterface() *types.Type {
	field := types.NewField()
	field.Type = types.Types[TSTRING]
	f := functypefield(fakeRecvField(), nil, []*types.Field{field})

	// 查找是否实现了 Error
	field = types.NewField()
	field.Sym = lookup("Error")
	field.Type = f

	t := types.New(TINTER)
	t.SetInterface([]*types.Field{field})
	return t
}
```

## 4.1.1 错误的历史形态

早期的 Go 甚至没有错误处理 [Gerrand, 2010] [Cox, 2019b]，
当时的 `os.Read` 函数进行系统调用可能产生错误，而该接口是通过 `int64` 类型进行错误返回的：

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

之后才演变为了 Go 1 中被人们熟知的 `error` 接口类型。

可见之所以从理解上我们可以将 error 认为是一个接口，是因为在编译器实现中，
是通过查询某个类型是否实现了 `Error` 方法来创建 Error 类型的。

<!-- TODO: go 1.0 russ cox 关于错误处理的言论 -->

## 4.1.2 处理错误的基本策略

由于 Go 中的错误处理设计得非常简洁，在其他现代编程语言里都几乎找不见此类做法。
Go 团队也曾多次撰写文章来教导 Go 语言的用户 [Gerrand, 2011] [Pike, 2015]。
无论怎样，非常常见的策略包含哨兵错误、自定义错误以及隐式错误三种。

### 哨兵错误

哨兵错误的处理方式通过特定值表示成功和不同错误，依靠调用方对错误进行检查：

```go
if err === ErrSomething { ... }
```

例如，比较著名的 `io.EOF = errors.New("EOF")`。

这种错误处理的方式引入了上下层代码的依赖，如果被调用方的错误类型发生了变化，
则调用方也需要对代码进行修改：

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
除此之外，哨兵错误还有一个相当致命的危险，那就是这种方式所定义的错误并非常量，例如：

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

这种事情甚至严重到，如果在引入的依赖中，有人恶意将这样验证错误值进行修改的代码包含进去，
将导致重大的安全问题：

```go
import "cropto/rsa"
func init() {
	rsa.ErrVerification = nil
}
```

在硕大的代码依赖中，我们几乎无法保证这种恶意代码不会出现在某个依赖的包中。
为了安全起见，变量错误类型可以修改为常量错误：

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

这类错误处理的方式通过自定义的错误类型来表示特定的错误，同样依赖上层代码对错误值进行检查，
不同的是需要使用类型断言进行检查。
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

这种错误处理的好处在于，可以将错误包装起来，提供更多的上下文信息，
但错误的实现方必须向上层公开实现的错误类型，不可避免的同样需要产生依赖关系。

### 隐式错误

```go
if err != nil { return err }
```

这种错误处理的方式直接返回错误的任何细节，直接将错误进一步报告给上层。这种情况下，
错误在当前调用方这里完全没有进行任何加工，与没有进行处理几乎是等价的，
这会产生的一个致命问题在于：丢失调用的上下文信息，如果某个错误连续向上层传播了多次，
那么上层代码可能在输出某个错误时，根本无法判断该错误的错误信息究竟从哪儿传播而来。
以上面提到的文件打开的例子为例，错误信息可能就只有一个 `not found`。

## 4.1.3 处理错误的本质

回顾处理错误的基本策略我们可以看出，在 Go 语言中错误处理这一话题基本上是围绕以下三个问题进行的：

1. 错误值检查：如何对一个传播链条中的错误类型进行断言？
2. 错误格式与上下文：出现错误时，没有足够的堆栈信息，如何增强错误发生时的上下文信息并合理格式化一个错误？
3. 错误处理语义：每个返回错误的函数都要求调用方进行显式处理，处理方式啰嗦而冗长，如何减少这种代码出现的密集程度？

我们在后面的小节中对这些问题进行一一讨论。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).