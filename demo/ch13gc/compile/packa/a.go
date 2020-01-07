package packa

import (
	_ "unsafe"
)

func packb_EmptyCall()

func CallB() {
	packb_EmptyCall()
}

//go:linkname EmptyCall packb.packa_EmptyCall
func EmptyCall() {
	println("packa")
}
