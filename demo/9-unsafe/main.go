package main

import "unsafe"

func main() {
	var p = 42
	pp := unsafe.Pointer(&p)
	println(pp)
}
