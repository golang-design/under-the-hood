package main

var u uint32
var i int32
var ok bool
var eface interface{}

func assertion() {
	t := uint64(42)
	eface = t
	u = eface.(uint32)
	i, ok = eface.(int32)
}
