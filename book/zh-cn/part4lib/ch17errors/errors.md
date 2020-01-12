---
weight: 4302
title: "17.2 错误检查 与 errors 包"
---


# 17.2 错误检查 与 errors 包

在 Go 1.13 以前，标准库中的 error 包仅包含一个 `New` 函数：

```go
package errors

// New 从给定格式的字符串中创建一个错误
func New(text string) error {
	return &errorString{text}
}

// errorString 是一个平凡的 error 实现
type errorString struct {
	s string
}

func (e *errorString) Error() string {
	return e.s
}
```

另一个与 error 相关的函数则位于 `fmt` 包中：

```go
func Errorf(format string, a ...interface{}) error {
	return errors.New(Sprintf(format, a...))
}
```

其形式也就仅仅只是对 `errors.New` 加上 `fmt.Sprintf` 的一个简单封装。
如上一节中对错误处理的讨论，这种依靠字符串进行错误定义的方式的可处理性几乎为零，会在上下文之间引入强依赖。

## 错误检查

从 Go 1.13 起，Go 在 errors 包中引入了一系列新的 API 来增强错误检查的手段。

### `Unwrap`

Unwrap 的目的是将一个已被 fmt 包装过的 error 进行拆封，其实现逻辑利用了 `.(type)` 断言：

```go
func Unwrap(err error) error {
	u, ok := err.(interface {
		Unwrap() error
	}) // 断言 err 实现了 Unwrap 方法
	if !ok {
		return nil // 如果没有实现，则拆封失败
	}
	return u.Unwrap() // 否则调用实现的 Unwrap 方法
}
```

### `Is` 与 `As`

`Is` 用于检查当前的两个 err 是否相等。之所以需要这个函数是因为一个错误可能被包装了多层，
那么我们需要支持这个错误在包装过多层后的判断，因而可想而知在实现上需要一个 for 循环对其进行 Unwrap：

```go
func Is(err, target error) bool {
	if target == nil {
		return err == target
	}

	isComparable := reflectlite.TypeOf(target).Comparable()
	for {
		// 如果 target err 是可比较的，则直接进行比较
		if isComparable && err == target {
			return true
		}
		// 如果 err 实现了 Is 方法，则调用其实现进行判断
		if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
			return true
		}
		// 否则，对 err 进行 Unwrap
		if err = Unwrap(err); err == nil {
			return false
		}
		// 如果 Unwrap 成功，则继续判断
	}
}
```

可见 `errors.Is` 方法的目的是替换如下形式的错误检查：

```go
if err == io.ErrUnexpectedEOF {
	// ... 处理错误
}

=>

if errors.Is(err, io.ErrUnexpectedEOF) {
	// ... 处理错误
}
```

`As` 的实现与 `Is` 基本相同，不同之处在于 `As` 的目的是将某个 err 给拆封到 target 中，因此对于一个
错误链而言，需要一个循环不断对错误进行 Unwrap，当错误实现 `As` 方法时，直接调用 `As`：

```go
func As(err error, target interface{}) bool {
	if target == nil {
		panic("errors: target cannot be nil")
	}
	val := reflectlite.ValueOf(target)
	typ := val.Type()
	if typ.Kind() != reflectlite.Ptr || val.IsNil() {
		panic("errors: target must be a non-nil pointer")
	}
	if e := typ.Elem(); e.Kind() != reflectlite.Interface && !e.Implements(errorType) {
		panic("errors: *target must be interface or implement error")
	}
	targetType := typ.Elem()
	for err != nil {
		// 若可直接将 err 拆封到 target
		if reflectlite.TypeOf(err).AssignableTo(targetType) {
			val.Elem().Set(reflectlite.ValueOf(err))
			return true
		}
		// 判断 err 是否实现 As 方法，若已实现则直接调用
		if x, ok := err.(interface{ As(interface{}) bool }); ok && x.As(target) {
			return true
		}
		// 否则对错误链进行 Unwrap
		err = Unwrap(err)
	}
	return false
}
var errorType = reflectlite.TypeOf((*error)(nil)).Elem()
```

由于错误链的存在， `errors.As` 方法的目的是替换如下形式的错误检查：

```go
if e, ok := err.(*os.PathError); ok {
	// ... 处理错误
}

=>

var e *os.PathError
if errors.As(err, &e) {
	// ... 处理错误
}
```

### fmt.Errorf 中的 `%w`

`fmt.Errorf` 函数增加了一个 `%w` 动词，允许对一个错误进行封装：

```go
package fmt

import "errors"

func Errorf(format string, a ...interface{}) error {
	p := newPrinter()
	p.wrapErrs = true
	p.doPrintf(format, a)
	s := string(p.buf)
	var err error
	if p.wrappedErr == nil {
		err = errors.New(s)
	} else {
		err = &wrapError{s, p.wrappedErr}
	}
	p.free()
	return err
}
```

在 Go 1.13 的 Errorf 的实现中，将需要包装的 err 包装为一个 `wrapError`，包含错误消息本身与对错误的封装：

```go
type wrapError struct {
	msg string
	err error
}

func (e *wrapError) Error() string {
	return e.msg
}

func (e *wrapError) Unwrap() error { // 支持 errors.Unwrap 方法
	return e.err
}
```

错误的封装利用了 `pp` 结构：

```go
type pp struct {
	buf buffer // []byte
	(...)
	// 当格式化过程中可能包含 %w 动词时，设置为 true
	wrapErrs bool
	// wrappedErr 记录了 %w 动词的 err
	wrappedErr error
}
```

我们也并不关心 `newPrinter` 和 `doPrintf` 具体做了什么，我们只想知道如果出现 `%w` 动词，具体如何对错误进行封装，
可以观察到 `doPrintf` 函数内部调用了 `printArg`，而具体处理一个 error 类型时，会调用 `handleMethods` 方法来处理具体的动词，
对于 `%w` 的处理就在这里：

```go
func (p *pp) handleMethods(verb rune) (handled bool) {
	if p.erroring {
		return
	}
	if verb == 'w' {
		// 判断与 %w 对应的值是否为 error 类型，否则处理为错误的动词组合
		err, ok := p.arg.(error)
		if !ok || !p.wrapErrs || p.wrappedErr != nil {
			p.wrappedErr = nil
			p.wrapErrs = false
			p.badVerb(verb)
			return true
		}
		// 保存 err，并将其转化为 %v 的情况
		p.wrappedErr = err
		verb = 'v'
	}

	(...)
}
```

很明显关于 `%w` 这个动词的处理仅仅就是将 err 记录到 wrappedErr 这个变量中，
并将 verb 修改为 v 将其转化为 `%v` 动词进行后续的格式化处理。

## 进一步阅读的参考文献

- [Github discussion, proposal: Go 2 error values](https://github.com/golang/go/issues/29934)
- [Go 1.13 Lunch Decision, proposal: Go 2 error values](https://github.com/golang/go/issues/29934#issuecomment-489682919)
- [Russ Cox's Response, proposal: Go 2 error values](https://github.com/golang/go/issues/29934#issuecomment-490087200)
- [Jonathan Amsterdam and Bryan C. Mills, Error Values: Frequently Asked Questions, August 2019](https://github.com/golang/go/wiki/ErrorValueFAQ)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)