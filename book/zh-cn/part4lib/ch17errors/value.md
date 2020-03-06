---
weight: 4301
title: "17.1 错误的演化"
---

# 17.1 错误的演化

错误 `error` 在 Go 中表现为一个内建的接口类型：

```go
type error interface {
	Error() string
}
```

任何实现了 `Error() string` 方法的类型都能作为 `error` 类型进行传递，成为错误值。

## 17.1.1 错误类型的历史形态

早期的 Go 甚至没有错误处理 [Gerrand, 2010] [Cox, 2019]，当时的 `os.Read` 函数进行系统调用可能产生错误，
而该接口是通过 `int64` 类型进行错误返回的：

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

之后才演变为了 Go 1 中被人们熟知的 `error` 接口类型，其在编译器中的实现为：

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

可见之所以从理解上我们可以将 error 认为是一个接口，是因为在编译器实现中，
是通过查询某个类型是否实现了 `Error` 方法来创建 Error 类型的。

<!-- TODO: go 1.0 russ cox 关于错误处理的言论 -->

## 17.1.2 错误处理的基本策略

由于 Go 中的错误处理设计得非常简洁，在其他现代编程语言里都几乎找不见此类做法。
Go 团队也曾多次撰写文章来教导 Go 语言的用户 [Gerrand, 2011] [Pike, 2015]。无论怎样，非常常见的策略有如下三种：

### 哨兵错误

```go
if err === ErrSomething { ... }
```

这种错误处理方式通过特定值表示成功和不同错误，依靠调用方对错误进行检查。
例如比较著名的 `io.EOF = errors.New("EOF")`。

这种错误处理的方式引入了上下层代码的依赖，如果被调用放的错误类型发生了变化，
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

## 17.1.5 尝试与争议

Go 团队开始着手正式考虑对错误处理进行改进时，
逐渐涌现了很多关于错误处理的反馈 [Lohuizen, 2018]。
根据这些反馈，Go 团队将错误处理的改进这一实际问题，拆分为了一下两个子问题 [Cox, 2018]：

1. 错误检查：出现错误时，没有足够的堆栈信息，如何增强错误发生时的上下文信息，如何合理格式化一个错误？
2. 错误处理：处理方式啰嗦而冗长，每个返回错误的函数都要求调用方进行显式处理，如何减少这种代码出现的密集程度？

我们根据现有已经被拒绝的关于错误处理的两个设计提案在本节中进行讨论，
并在下一节中讨论已经在 Go 1.13 中接收的关于如何增强错误上下文信息、
对某个错误的类型进行审计的『错误检查』的设计。

### check/handle 关键字

Go 团队在重新考虑错误处理的时候提出过两种不同的方案，第一种方案就是引入新的关键字
`check`/`handle` 进行组合。我们来看这样一个例子：

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

在上面的 `CopyFile` 函数中，每一次的 `Open`、`Create`、`Copy`、`Close`
都需要对错误进行处理。这就使得整个代码变得非常的啰嗦，不断的有新的 `err` 需要进行检查。
最初 Russ Cox 提出引入一组新的关键字来统一对某个过程的错误进行简化，例如：

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

这种使用 `check` 和 `handle` 的方式会当 `err` 发生时，直接进入 `check` 关键字上方
最近的一个 `handle err` 块进行错误处理。在官方的这个例子中其实就已经发生了语言上模棱两可的地方，
当函数最下方的 `w.Close` 产生调用时，
上方与其最近的一个 `handle err` 还会再一次调用 `w.Close`，这其实是多余的。

此外，这种方式看似对代码进行了简化，但仔细一看这种方式与 `defer` 函数进行错误处理之间
并没有带来任何本质区别，例如：

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

### 内建函数 `try()`

紧随 `check/handle` 的提案，Robert Griesemer 提出了使用内建函数 `try()`
配合延迟语句来替代 `check/handle`，它能够接收最后一个返回值为 error 的函数，
并将除 `error` 之外的返回值进行返回：

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
					os.Remove(dst) // 仅当 try 失败时才调用
				}
		}()

		try(io.Copy(w, r))
		try(w.Close())
		return nil
}
```

这种做法与 `check/handle` 的关键字组合本质上并没有发生任何变化，
`try()` 内建函数的提案无非只是提供了一种可以减少 `if err != nil { ... }` 出现频率的方法。

从这两份不同的提案中，Go 团队似乎错误处理的改进与
『如何减少 `if err != nil { ... }` 的出现』直接化了等号，这种纯粹写法风格上的问题，
是该提案遭到社区强烈反对的原因之一。

<!-- TODO: 还有其他原因：try() 使得错误不透明，不方便调试 -->

## 17.1.6 小结

本节我们回顾了 Go 语言早期对错误处理的演化过程，包括 error 类型作为接口的来历。
随后我们讨论了 Go 语言在 Go 1.13 之前进行错误处理的常见手段，并详细讨论了
公认的较为优秀的提供错误处理原语的包 `pkg/errors`。
并在最后，简单讨论了 Go 团队着重考虑过的几个关于改进错误处理方式的提案。

## 进一步阅读的参考文献

- [Gerrand, 2010] Andrew Gerrand. Defer, Panic and Recover. August 2010. https://blog.golang.org/defer-panic-and-recover
- [Gerrand, 2011] Andrew Gerrand. Error handling in Go. July 2011. https://blog.golang.org/error-handling-and-go
- [Pike, 2015] Rob Pike. Errors are values. January 2015. https://blog.golang.org/errors-are-values
- [Cox, 2019] Russ Cox. Experiment, Simplify, Ship. August 2019. https://blog.golang.org/experiment
- [Cox, 2018] Russ Cox. Error Values — Problem Overview. August 2018. https://github.com/golang/proposal/blob/master/design/go2draft-error-values-overview.md
- [Lohuizen, 2018] Marcel van Lohuizen. Error Handling — Draft Design. August 2018. https://github.com/golang/proposal/blob/master/design/go2draft-error-handling.md
- [Griesemer, 2019] Robert Griesemer, Proposal: A built-in Go error check function, "try". July 2019. https://github.com/golang/go/issues/32437#issuecomment-512035919

<!-- https://groups.google.com/forum/#!searchin/golang-nuts/error$20handling$20research%7Csort:date/golang-nuts/_sE6BxUDVBw/a59qnkwiCgAJ
http://www.open-std.org/jtc1/sc22/wg21/docs/papers/2019/p0709r3.pdf
https://stackoverflow.com/questions/46586/goto-still-considered-harmful -->

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)