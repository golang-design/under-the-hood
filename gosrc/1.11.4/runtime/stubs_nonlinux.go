// Copyright 2017 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// +build !linux

package runtime

// sbrk0 返回了当前进场的 brk, 如果为 0 则表示未实现
func sbrk0() uintptr {
	return 0
}
