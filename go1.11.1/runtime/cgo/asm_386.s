// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

#include "textflag.h"

// 被 C 代码调用，由 cmd/cgo 生成。
// func crosscall2(fn func(a unsafe.Pointer, n int32, ctxt uintptr), a unsafe.Pointer, n int32, ctxt uintptr)
// 保存 C 被调用方保存的寄存器, 并使用三个参数调用 fn。
TEXT crosscall2(SB),NOSPLIT,$28-16
	MOVL BP, 24(SP)
	MOVL BX, 20(SP)
	MOVL SI, 16(SP)
	MOVL DI, 12(SP)

	MOVL	ctxt+12(FP), AX
	MOVL	AX, 8(SP)
	MOVL	n+8(FP), AX
	MOVL	AX, 4(SP)
	MOVL	a+4(FP), AX
	MOVL	AX, 0(SP)
	MOVL	fn+0(FP), AX
	CALL	AX

	MOVL 12(SP), DI
	MOVL 16(SP), SI
	MOVL 20(SP), BX
	MOVL 24(SP), BP
	RET
