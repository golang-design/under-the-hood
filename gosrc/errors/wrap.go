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

// Is 报告错误链中的任何错误是否与目标匹配。
// 该链由错误本身和随后通过反复调用 Unwrap 的得到的错误序列组成。
// 如果错误等于该目标或错误，或者当该错误实现了
// 方法 Is(error)bool，使 Is(target) 返回 true。
// 则认为该错误与目标匹配
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
		// TODO: consider supporing target.Is(err). This would allow
		// user-definable predicates, but also may allow for coping with sloppy
		// APIs, thereby making it easier to get away with them.
		if err = Unwrap(err); err == nil {
			return false
		}
	}
}

// As finds the first error in err's chain that matches target, and if so, sets
// target to that error value and returns true.
//
// The chain consists of err itself followed by the sequence of errors obtained by
// repeatedly calling Unwrap.
//
// An error matches target if the error's concrete value is assignable to the value
// pointed to by target, or if the error has a method As(interface{}) bool such that
// As(target) returns true. In the latter case, the As method is responsible for
// setting target.
//
// As will panic if target is not a non-nil pointer to either a type that implements
// error, or to any interface type. As returns false if err is nil.
// As 找到 err 链中与 target 匹配的第一个错误，
// 如果是，则将 target 设置为该错误值并返回 true。
//
// 该链由 err 本身组成，后面是通过重复调用 Unwrap 获得的错误序列。
//
// 如果错误的具体值可分配给 target 指向的值，
// 或者错误的方法为 As(interface {}) bool 使得 As(target) 返回 true，则错误匹配目标。
// 在后一种情况下，As 方法负责设置目标。
//
// 如果 target 不是指向实现错误的类型或任何接口类型的非零指针，则会发生混乱。
// 如果错误为 nil ，则返回 false。
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
