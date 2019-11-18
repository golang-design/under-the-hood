package main

import (
	"fmt"
	"reflect"
	"unsafe"
)

type value struct {
	_type int
	data  unsafe.Pointer
	flag  uintptr
}

type eface struct {
	_type int
	data  unsafe.Pointer
}

/*
type mi interface {
	Echo()
}

type x struct {}

var m mi = x{}

func (i x) Echo() {
	fmt.Println("echo")
}
*/

func main() {
	var n int = 1
	var i interface{} = n
	var addr = &i

	// var addr = &m

	et := *(*eface)(unsafe.Pointer(addr))
	fmt.Println(et._type)
	fmt.Println(et.data)

	ptr := reflect.ValueOf(addr)
	iface := ptr.Elem()
	v := iface.Elem()

	fmt.Println(ptr.Kind())
	fmt.Println(iface)

	fmt.Println(iface.Kind())
	fmt.Println(v)
	fmt.Println(v.Kind())

	t := *(*value)(unsafe.Pointer(&v))
	fmt.Println(t._type)
	fmt.Println(t.data)
	fmt.Println(t.flag)
	fmt.Println(*(*int)(t.data))
}
