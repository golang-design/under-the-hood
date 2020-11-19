// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Malloc small size classes.
//
// See malloc.go for overview.
// See also mksizeclasses.go for how we decide what size classes to use.
// Malloc 大小较小的 class
//
// 参见 malloc.go 的综述
// 另参见 mksizeclasses.go 来了解如何根据 size 决定使用的 class

package runtime

// Returns size of the memory block that mallocgc will allocate if you ask for the size.
// 如果要求大小，则返回 mallocgc 将分配的内存块的大小。
func roundupsize(size uintptr) uintptr {
	if size < _MaxSmallSize {
		if size <= smallSizeMax-8 {
			return uintptr(class_to_size[size_to_class8[divRoundUp(size, smallSizeDiv)]])
		} else {
			return uintptr(class_to_size[size_to_class128[divRoundUp(size-smallSizeMax, largeSizeDiv)]])
		}
	}
	if size+_PageSize < size {
		return size
	}
	return alignUp(size, _PageSize)
}
