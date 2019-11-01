// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package errors

import (
	"internal/reflectlite"
)

// Unwrap 返回在 err 上调用 Unwrap 方法的结果，如果错误的类型包含一个 Unwrap 方法则返回错误。
// 否则，Unwrap 返回 nil。
func Unwrap(err error) error {
	u, ok := err.(interface {
		Unwrap() error
	})
	if !ok {
		return nil
	}
	return u.Unwrap()
}

// Is 报告错误链中的任何错误是否与目标匹配。该链由错误本身和随后通过反复调用 Unwrap
// 的得到的错误序列组成。如果错误等于该目标或错误，或者当该错误实现了 Is(error)bool，
// 使 Is(target) 返回 true。
//
// 错误类型可以提供一个 Is 方法，从而它可以视为一个已经存在的错误。
// 例如，如果 MyError 定义为
//
//  func (m MyError) Is(target error) bool { return target == os.ErrExist }
//
// 则 Is(MyError{}, os.ErrExist) 返回 true. 见 syscall.Errno.Is 来获取一个标准库的例子。
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
		// TODO: consider supporting target.Is(err). This would allow
		// user-definable predicates, but also may allow for coping with sloppy
		// APIs, thereby making it easier to get away with them.
		if err = Unwrap(err); err == nil {
			return false
		}
	}
}

// As 寻找 err 链中与 target 匹配的第一个错误，
// 如果是，则将 target 设置为该错误值并返回 true，否则返回 false。
//
// 该链由 err 本身组成，后面是通过重复调用 Unwrap 获得的错误序列。
//
// 如果错误的具体值可分配给 target 指向的值，
// 或者错误的方法为 As(interface {}) bool 使得 As(target) 返回 true，则错误匹配目标。
// 在后一种情况下，As 方法负责设置目标。
//
// 一个错误类型可能提供一个 As 方法，从而它可以被视为一个不同的错误类型。
// 当 target 不是一个指向实现错误的类型或任何 interface 类型的非空指针，则 As 会发生 panic
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

var errorType = reflectlite.TypeOf((*error)(nil)).Elem()
