package main

import (
	"runtime"
	"time"
)

func main() {
	runtime.GOMAXPROCS(1)

	go func() {
		for {
		}
	}()

	time.Sleep(time.Millisecond)
	println("OK")
	runtime.Gosched()
}
