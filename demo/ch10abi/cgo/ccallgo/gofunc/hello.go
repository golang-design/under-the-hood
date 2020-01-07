package main

import "C"
import "fmt"

//export hello
func hello() {
	fmt.Println("Call Go from C")
}

func main() {
}
