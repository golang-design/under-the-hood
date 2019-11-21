package main

import (
	"fmt"
	"reflect"
	"strings"
)

func main() {
	var add = func(in []reflect.Value) []reflect.Value {
		if in[0].Type().Kind() == reflect.String {
			var s []string
			for _, v := range in {
				s = append(s, v.String())
			}
			return []reflect.Value{reflect.ValueOf(strings.Join(s, "-"))}
		}

		if in[0].Type().Kind() == reflect.Int {
			var s int64
			for _, v := range in {
				s += v.Int()
			}
			return []reflect.Value{reflect.ValueOf(int(s))}
		}
		return []reflect.Value{}
	}

	var makeAdd = func(fptr interface{}) {
		var value reflect.Value = reflect.ValueOf(fptr).Elem()
		var v reflect.Value = reflect.MakeFunc(value.Type(), add)
		value.Set(v)
	}
	var intAdd func(int, int) int
	var stringAdd func(string, string, string) string
	makeAdd(&intAdd)
	fmt.Println(intAdd(1, 3))
	makeAdd(&stringAdd)
	fmt.Println(stringAdd("1", "3", "5"))
}
