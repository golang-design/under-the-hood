package main

import (
	"fmt"
	"reflect"
)

func main() {
	type s1 []int
	type s2 struct{}

	var i1 interface{} = s1{1, 2, 3}
	var i2 interface{} = s2{}
	var i3 interface{} = 1

	t1 := reflect.TypeOf(i1)
	t2 := reflect.TypeOf(i2)
	t3 := reflect.TypeOf(i3)

	fmt.Println(t1.Kind().String())
	fmt.Println(t1.String())
	fmt.Println(t1.Name())
	fmt.Println(t1.Elem().Kind().String())

	fmt.Println(t2.String())

	fmt.Println(t3.String())

}
