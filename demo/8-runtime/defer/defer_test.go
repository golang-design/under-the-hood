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
