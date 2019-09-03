package main_test

import (
	"testing"
)

func BenchmarkGC(b *testing.B) {
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_ = make([]byte, 1*1024*1024*1024) // 1GB
		}
	})
}
