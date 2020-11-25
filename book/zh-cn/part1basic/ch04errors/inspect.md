---
weight: 1402
title: "4.2 错误值检查"
---

# 4.2 错误值检查

我们先来看第一个问题：如何对一个传播链条中的错误类型进行断言？

在标准库中，`errors` 包中最为重要的一个 `New` 函数能够从给定格式的字符串中创建一个错误，
它的内部实现仅仅是对 `error` 接口的一个实现 `errorString`：

```go
package errors

type errorString struct              { s string }
func (e *errorString) Error() string { return e.s }

func New(text string) error { return &errorString{text} }
```

当然，这远远不够。为了能够对错误进行格式化，在使用 Go 的过程中通常还会需要将 `New` 
与 `fmt.Sprintf` 进行组合，达到格式化的目的：

```go
func E(format string, a ...interface{}) error {
	return errors.New(fmt.Sprintf(format, a...))
}
```

但这种依靠字符串进行错误定义的方式的可处理性几乎为零，将会在调用上下文之间引入强依赖，
因为一个具体的错误值在 `fmt` 格式化封装的过程中被转移为了一个字符串类型，进而不能对
错误传播过程中错误的来源进行断言。
为此，Go 在 `errors` 包中引入了一系列 API 来增强错误检查的手段。

## 4.2.1 错误传播链

首先，为了建立错误传播链，`fmt.Errorf` 函数允许使用 `%w` 动词对一个错误进行包装。
在 `Errorf` 的实现中，它会将需要包装的 `err` 包装为一个实现了 `Error() string` 
和 `Unwrap() error` 两个接口的 `wrapError` 结构，其包含需要封装的新错误消息以及原始错误：

```go
type wrapError struct {
	msg string
	err error
}
func (e *wrapError) Error() string { return e.msg }
func (e *wrapError) Unwrap() error { return e.err }
```

`fmt` 包本身对格式化的支持定义了 `pp` 结构，会将格式化后的内容存储在 `buf` 中。
但在错误传播链条的包装上，为了不破坏原始错误值，额外使用了 `wrapErrs` 和 `wrappedErr`
两个字段，其中 `wrapErrs` 用于格式化过程中判断是否对错误进行了包装，`wrappedErr`
则用于存储原始的错误：

```go
type pp struct {
	buf buffer       // 本质为 []byte 类型
	...
	wrapErrs bool
	wrappedErr error // wrappedErr 记录了 %w 动词的 err
}
```

方法 `Errorf` 会首先使用 `newPrinter` 和 `doPrintf` 对格式进行处理，
将带有动词的格式字符串和参数进行拼接。
具体而言，`Errorf` 总是假设出现 `%w` 动词，并 `doPrintf` 函数内部将对
`error` 类型的参数进行特殊处理。当有错误保存在 `wrappedErr` 时，说明需要对
错误进行一层包装，否则说明是一个原始的错误构造：

```go
package fmt
import "errors"
func Errorf(format string, a ...interface{}) error {
	p := newPrinter()
	p.wrapErrs = true     // 假设格式化过程中可能包含 %w 动词，设置为 true
	p.doPrintf(format, a) // 对 format 和实际的参数进行拼接，用于后续打印
	s := string(p.buf)    // 拼接好的内容保存在 buf 内
	var err error
	if p.wrappedErr == nil {
		err = errors.New(s)               // 构造原始错误
	} else {
		err = &wrapError{s, p.wrappedErr} // 对错误进行包装
	}
	p.free()
	return err
}
```

`doPrintf` 函数最终将调用 `handleMethods` 方法来对错误进行记录。当遇到 `%w` 动词时，会判断 `%w` 对应的参数值是否为 `error` 类型，并将错误保存到 `wrappedErr` 内，并将后续处理退化为 `%v` 的后续拼接与格式化。

```go
// 调用链 doPrintf -> printArg -> handleMethods
func (p *pp) handleMethods(verb rune) (handled bool) {
	...
	if verb == 'w' {
		err, ok := p.arg.(error)
		// 判断与 %w 对应的值是否为 error 类型，否则处理为错误的动词组合
		if !ok || !p.wrapErrs || p.wrappedErr != nil {
			...
			return true
		}
		// 保存 err，并将其退化为 %v 动词
		p.wrappedErr = err
		verb = 'v'
	}
	...
}
```

显然，`%w` 这个动词的主要目的是将 `err` 记录到 `wrappedErr` 这个同时实现了 `Error() string` 和 `Unwrap() error` 的错误中，
从而能安全的将 `verb` 转化为 `%v` 动词对参数进行后续的格式化拼接。

## 4.2.2 错误值拆包

但形成错误链条后，使用 `Unwrap` 便能将一个已被 `fmt` 包装过的 `error` 进行拆包，
其实现的核心思想是对错误值是否实现了 `Unwrap() error` 方法进行一次类型断言：

```go
func Unwrap(err error) error {
	// 断言 err 实现了 Unwrap 方法
	u, ok := err.(interface { Unwrap() error })
	if !ok { return nil }
	return u.Unwrap()
}
```

在 `fmt.Errorf` 的实现中，已经看到，错误链条错误使用了 `wrapError` 进行包装，
而这一类型恰好实现了 `Unwrap() error` 方法。

## 4.2.3 错误断言

`Is` 用于检查当前的两个错误是否相等。之所以需要这个函数是因为一个错误可能被包装了多层，
那么我们需要支持这个错误在包装过多层后的判断。
可想而知，在实现上需要一个 `for` 循环对其进行 `Unwrap` 操作：

```go
func Is(err, target error) bool {
	if target == nil { return err == target }
	isComparable := reflect.TypeOf(target).Comparable()
	for {
		// 如果 target 错误是可比较的，则直接进行比较
		if isComparable && err == target { return true }

		// 如果 err 实现了 Is 方法，则调用其实现进行判断
		if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
			return true
		}
		// 否则，对 err 进行 Unwrap
		if err = Unwrap(err); err == nil { return false }

		// 如果 Unwrap 成功，则继续判断
	}
}
```

可见 `Is` 方法的目的是替换使用 `==` 形式的错误断言：

```go
if err == io.ErrUnexpectedEOF {
	// ... 处理错误
}

=>

if errors.Is(err, io.ErrUnexpectedEOF) {
	// ... 处理错误
}
```

值得注意的是，`Is` 方法要求自定义的错误值实现 `Is(error) bool` 方法来进行自定义的错误断言，
否则错误的比较仍然只是使用 `==` 算符。

方法 `As` 的实现与 `Is` 基本类似，但不同之处在于 `As` 的目的是将某个错误给拆封
到具体的变量中，因此对于一个错误链而言，需要一个循环不断对错误进行 `Unwrap`，
当错误值实现了 `As(interface{}) bool` 方法时，则可完成拆封：

```go
func As(err error, target interface{}) bool {
	if target == nil {
		panic("errors: target cannot be nil")
	}
	val := reflect.ValueOf(target)
	typ := val.Type()
	if typ.Kind() != reflect.Ptr || val.IsNil() {
		panic("errors: target must be a non-nil pointer")
	}
	if e := typ.Elem(); e.Kind() != reflect.Interface && !e.Implements(errorType) {
		panic("errors: *target must be interface or implement error")
	}
	targetType := typ.Elem()
	for err != nil {
		// 若可直接将 err 拆封到 target
		if reflect.TypeOf(err).AssignableTo(targetType) {
			val.Elem().Set(reflect.ValueOf(err))
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
var errorType = reflect.TypeOf((*error)(nil)).Elem()
```

可见，由于错误链的存在，`errors.As` 方法的目的是替换类型断言式的错误断言：

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

## 4.2.4 小结

`errors` 包中对错误检查的设计通过暴露 `New`、`Unwrap`、`Is` 和 `As` 四个方法完成
在复杂函数调用链条中使用 `fmt.Errorf` 封装的错误传播链条的拆解。
其中 `New` 负责原始错误的创建，`Unwrap` 允许对错误传播链条进行一次拆包，
`Is` 则提供了在复杂错误链中，对错误类型进行断言的能力；
而 `As` 解决了将错误从错误链拆解到某个目标错误类型的能力。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).