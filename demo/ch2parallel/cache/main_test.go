package cache_test

import (
	"sync/atomic"
	"testing"
)

type pad struct {
	x uint64 // 8byte
	y uint64 // 8byte
	z uint64 // 8byte
}

func (s *pad) increase() {
	atomic.AddUint64(&s.x, 1)
	atomic.AddUint64(&s.y, 1)
	atomic.AddUint64(&s.z, 1)
}

func BenchmarkNoPad(b *testing.B) {
	s := pad{}
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			s.increase()
		}
	})
}

type withPad struct {
	x uint64 // 8byte
	_ [56]byte
	y uint64 // 8byte
	_ [56]byte
	z uint64 // 8byte
	_ [56]byte
}

func (s *withPad) increase() {
	atomic.AddUint64(&s.x, 1)
	atomic.AddUint64(&s.y, 1)
	atomic.AddUint64(&s.z, 1)
}

func BenchmarkWithPad(b *testing.B) {
	s := withPad{}
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			s.increase()
		}
	})
}
