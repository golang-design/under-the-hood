// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package syscall 包含低级操作系统原语的接口。细节因底层系统而异，默认情况下，godoc 将显示
// 当前系统的系统调用文档。如果你希望 godoc 显示另一个系统的系统调用文档，请将 $GOOS 和
// $GOARCH 设置为所需的系统。例如，如果要在 linux/amd64 上查看 freebsd/arm 的文档，
// 请将 $GOOS 设置为 freebsd，将 $GOARCH 设置为 arm。
// syscall 的主要用途是在其他软件包中，为系统提供更便携的接口，例如 "os"，"time" 和 "net"。
// 如果可以，请使用这些包而不是这个包。有关此包中的功能和数据类型的详细信息，请参阅相应操作系统的手册。
// 这些调用返回 err == nil 表示成功；否则错误是描述失败的操作系统错误。
// 在大多数系统上，该错误的类型为 syscall.Errno。
//
// 弃用：此软件包已被锁定。调用者应该使用 golang.org/x/sys 存储库中的相应包。
// 这也是应该应用新系统或版本所需的更新的地方。有关更多信息，请参阅 https://golang.org/s/go1.4-syscall。
//
package syscall

//go:generate go run mksyscall_windows.go -systemdll -output zsyscall_windows.go syscall_windows.go security_windows.go

// StringByteSlice converts a string to a NUL-terminated []byte,
// If s contains a NUL byte this function panics instead of
// returning an error.
//
// Deprecated: Use ByteSliceFromString instead.
func StringByteSlice(s string) []byte {
	a, err := ByteSliceFromString(s)
	if err != nil {
		panic("syscall: string with NUL passed to StringByteSlice")
	}
	return a
}

// ByteSliceFromString returns a NUL-terminated slice of bytes
// containing the text of s. If s contains a NUL byte at any
// location, it returns (nil, EINVAL).
func ByteSliceFromString(s string) ([]byte, error) {
	for i := 0; i < len(s); i++ {
		if s[i] == 0 {
			return nil, EINVAL
		}
	}
	a := make([]byte, len(s)+1)
	copy(a, s)
	return a, nil
}

// StringBytePtr returns a pointer to a NUL-terminated array of bytes.
// If s contains a NUL byte this function panics instead of returning
// an error.
//
// Deprecated: Use BytePtrFromString instead.
func StringBytePtr(s string) *byte { return &StringByteSlice(s)[0] }

// BytePtrFromString returns a pointer to a NUL-terminated array of
// bytes containing the text of s. If s contains a NUL byte at any
// location, it returns (nil, EINVAL).
func BytePtrFromString(s string) (*byte, error) {
	a, err := ByteSliceFromString(s)
	if err != nil {
		return nil, err
	}
	return &a[0], nil
}

// Single-word zero for use when we need a valid pointer to 0 bytes.
// See mksyscall.pl.
var _zero uintptr

// Unix returns ts as the number of seconds and nanoseconds elapsed since the
// Unix epoch.
func (ts *Timespec) Unix() (sec int64, nsec int64) {
	return int64(ts.Sec), int64(ts.Nsec)
}

// Unix returns tv as the number of seconds and nanoseconds elapsed since the
// Unix epoch.
func (tv *Timeval) Unix() (sec int64, nsec int64) {
	return int64(tv.Sec), int64(tv.Usec) * 1000
}

// Nano returns ts as the number of nanoseconds elapsed since the Unix epoch.
func (ts *Timespec) Nano() int64 {
	return int64(ts.Sec)*1e9 + int64(ts.Nsec)
}

// Nano returns tv as the number of nanoseconds elapsed since the Unix epoch.
func (tv *Timeval) Nano() int64 {
	return int64(tv.Sec)*1e9 + int64(tv.Usec)*1000
}

// Getpagesize and Exit are provided by the runtime.

func Getpagesize() int
func Exit(code int)
