// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package fmt

import "errors"

// Errorf 根据一个格式指示器对值和错误进行格式化并返回一个字符串
//
// 格式指示器包含一个 %w 动词和一个 error 操作对象，返回的错误实现了 Unwrap 方法并返回操作对象。
// 注意，包含多个 %w 是无效的，且其格式化结果等价于 %v
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
