package main

import (
	"fmt"
	"reflect"
)

type s struct {
	name string
	e
}

type e struct {
	age int
}

func (s) num() {

}

func main() {
	var i interface{} = s{}
	t := reflect.TypeOf(i)

	n, ok := t.FieldByName("name")
	if ok {
		fmt.Println(n)
	}

	a, ok := t.FieldByName("age")
	if ok {
		fmt.Println(a)
	}

	f, ok := t.FieldByName("num")
	if ok {
		fmt.Println(f)
	}
}
