package main

import (
	"fmt"
	"unsafe"
)

type waitgroup struct {
	state [3]uint32
}

func main() {
	var a uint32 = 1
	println("uint32: ", unsafe.Sizeof(a))
	wg := waitgroup{}
	println("[3]uint32: ", unsafe.Sizeof(wg))
	fmt.Printf("%d\n", uintptr(unsafe.Pointer(&wg.state))%8)
}
