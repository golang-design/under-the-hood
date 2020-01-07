package main

import (
	_ "net/http"

	"fmt"
)

func init() {
	println("func main.init")
}

func main() {
	fmt.Printf("hello, %s", "world!")
}
