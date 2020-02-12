package main_test

import (
	"sync"
	"testing"
)

var lock sync.Mutex

func NoDefer() {
	lock.Lock()
	lock.Unlock()
}
func Defer() {
	lock.Lock()
	defer lock.Unlock()
}

func BenchmarkNoDefer(b *testing.B) {
	for i := 0; i < b.N; i++ {
		NoDefer()
	}
}

func BenchmarkDefer(b *testing.B) {
	for i := 0; i < b.N; i++ {
		Defer()
	}
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

func BenchmarkFastpathDefer(b *testing.B) {
	for i := 0; i < b.N; i++ {
		foo(0)
	}
}
