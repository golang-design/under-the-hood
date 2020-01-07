package packb

import (
	_ "unsafe"
)

func packa_CallEmpty()

//go:linkname EmptyCall packa.packb_EmptyCall
func EmptyCall() {
	println("packb")
}

func CallA() {
	packa_CallEmpty()
}
