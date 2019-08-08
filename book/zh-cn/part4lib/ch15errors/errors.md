# 15.2 `errors` 包与错误检查

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

TODO:

```go
func Unwrap(err error) error {
	u, ok := err.(interface {
		Unwrap() error
	})
	if !ok {
		return nil
	}
	return u.Unwrap()
}
```

### `Is` 与 `As`

TODO:


```go
func Is(err, target error) bool {
	if target == nil {
		return err == target
	}

	isComparable := reflectlite.TypeOf(target).Comparable()
	for {
		if isComparable && err == target {
			return true
		}
		if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
			return true
		}
		if err = Unwrap(err); err == nil {
			return false
		}
	}
}
```

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
		if reflectlite.TypeOf(err).AssignableTo(targetType) {
			val.Elem().Set(reflectlite.ValueOf(err))
			return true
		}
		if x, ok := err.(interface{ As(interface{}) bool }); ok && x.As(target) {
			return true
		}
		err = Unwrap(err)
	}
	return false
}
```

### `%w`

TODO:


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

type wrapError struct {
	msg string
	err error
}

func (e *wrapError) Error() string {
	return e.msg
}

func (e *wrapError) Unwrap() error {
	return e.err
}
```

## 进一步阅读的参考文献

- [Github discussion, proposal: Go 2 error values](https://github.com/golang/go/issues/29934)
- [Go 1.13 Lunch Decision, proposal: Go 2 error values](https://github.com/golang/go/issues/29934#issuecomment-489682919)
- [Russ Cox's Response, proposal: Go 2 error values](https://github.com/golang/go/issues/29934#issuecomment-490087200)
- [Jonathan Amsterdam and Bryan C. Mills, Error Values: Frequently Asked Questions, August 2019](https://github.com/golang/go/wiki/ErrorValueFAQ)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)