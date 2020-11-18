// Copyright 2014 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

const (
	kindBool          = 1 + iota // 0000 0010
	kindInt                      // 0000 0011
	kindInt8                     // 0000 0100
	kindInt16                    // 0000 0101
	kindInt32                    // 0000 0110
	kindInt64                    // 0000 0111
	kindUint                     // 0000 1000
	kindUint8                    // 0000 1001
	kindUint16                   // 0000 1010
	kindUint32                   // 0000 1011
	kindUint64                   // 0000 1100
	kindUintptr                  // 0000 1101
	kindFloat32                  // 0000 1110
	kindFloat64                  // 0000 1111
	kindComplex64                // 0001 0000
	kindComplex128               // 0001 0001
	kindArray                    // 0001 0010
	kindChan                     // 0001 0011
	kindFunc                     // 0001 0100
	kindInterface                // 0001 0101
	kindMap                      // 0001 0110
	kindPtr                      // 0001 0111
	kindSlice                    // 0001 1000
	kindString                   // 0001 1001
	kindStruct                   // 0001 1010
	kindUnsafePointer            // 0001 1011

	kindDirectIface = 1 << 5       // 0010 0000
	kindGCProg      = 1 << 6       // 0100 0000
	kindMask        = (1 << 5) - 1 // 0001 1111
)

// isDirectIface reports whether t is stored directly in an interface value.
// isDirectIface 报告了 t 是否直接存储在一个 interface 值中
func isDirectIface(t *_type) bool {
	return t.kind&kindDirectIface != 0
}
