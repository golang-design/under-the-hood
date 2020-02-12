package main

import "sync"

func main() {
	println(foo(0))
}

func foo(x int) int {
	// fast path
	if x != 42 {
		return x
	}
	// slow path
	mu.Lock()
	defer mu.Unlock()
	seq++
	return seq
}

var (
	mu  sync.Mutex
	seq int
)
