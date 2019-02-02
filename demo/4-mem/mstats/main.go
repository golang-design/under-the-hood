package main

import (
	"fmt"
	"runtime"
)

func main() {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	fmt.Printf("%+v\n", mem)
}
