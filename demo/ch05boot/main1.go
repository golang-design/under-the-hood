package main

import (
	"fmt"
	_ "net/http"
)

func init() {
	println("func main.init")
}

func main() {
	fmt.Printf("hello, %s", "world!")
}
