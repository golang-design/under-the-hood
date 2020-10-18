package main

import (
	"fmt"
	"unsafe"
)

func main() {
	var expunged = unsafe.Pointer(new(interface{}))
	fmt.Printf("%v", expunged)

	fmt.Printf("%v", unsafe.Pointer(^uintptr(0)))
}
