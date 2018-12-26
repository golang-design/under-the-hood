package main

import "fmt"

// ...
const (
	PtrSize     = 4 << (^uintptr(0) >> 63)
	uintptrMask = 1<<(8*PtrSize) - 1
)

func main() {
	var p uintptr
	for i := 0x7f; i >= 0; i-- {
		p = uintptr(i)<<40 | uintptrMask&(0x00c0<<32)
		fmt.Printf("addr: %x\n", p)
	}
}
