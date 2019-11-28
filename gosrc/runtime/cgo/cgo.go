// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

/*
Package cgo 包含了通过 cgo 工具生成代码的运行时支持。更多细节请查看 cgo 命令。
*/
package cgo

/*

#cgo darwin,!arm,!arm64 LDFLAGS: -lpthread
#cgo darwin,arm LDFLAGS: -framework CoreFoundation
#cgo darwin,arm64 LDFLAGS: -framework CoreFoundation
#cgo dragonfly LDFLAGS: -lpthread
#cgo freebsd LDFLAGS: -lpthread
#cgo android LDFLAGS: -llog
#cgo !android,linux LDFLAGS: -lpthread
#cgo netbsd LDFLAGS: -lpthread
#cgo openbsd LDFLAGS: -lpthread
#cgo aix LDFLAGS: -Wl,-berok
#cgo solaris LDFLAGS: -lxnet

// Issue 35247.
#cgo darwin CFLAGS: -Wno-nullability-completeness
#cgo CFLAGS: -Wall -Werror

#cgo solaris CPPFLAGS: -D_POSIX_PTHREAD_SEMANTICS

*/
import "C"
