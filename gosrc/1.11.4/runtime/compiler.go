// Copyright 2012 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

// Compiler 是用于构建可运行二进制文件的编译器工具链的名字。已知的工具链有：
//
//	gc      即 cmd/compile.
//	gccgo   gccgo 前端，GCC 编译器套件的一部分
//
const Compiler = "gc"
