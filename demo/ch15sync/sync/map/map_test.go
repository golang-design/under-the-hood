package main_test

import (
	"fmt"
	"sync"
	"testing"
)

const maxn = 50

// write once, read multiples
func purelockmap(n int) {
	m := map[string]int{}
	mu := sync.Mutex{}
	wg := sync.WaitGroup{}

	wg.Add(n)
	for i := 0; i < n; i++ {
		// write once, read n times
		k := fmt.Sprintf("%d", i)
		mu.Lock()
		m[k] = i
		mu.Unlock()
		go func(k string) {
			var v int
			for j := 0; j < n; j++ {
				mu.Lock()
				v = m[k]
				mu.Unlock()
			}
			// only for read map purpose
			k = fmt.Sprintf("%d", v)
			wg.Done()
		}(k)
	}
	wg.Wait()
}

func purerwlockmap(n int) {
	m := map[string]int{}
	mu := sync.RWMutex{}
	wg := sync.WaitGroup{}

	wg.Add(n)
	for i := 0; i < n; i++ {
		// write once, read n times
		k := fmt.Sprintf("%d", i)
		mu.Lock()
		m[k] = i
		mu.Unlock()
		go func(k string) {
			var v int
			for j := 0; j < n; j++ {
				mu.RLock()
				v = m[k]
				mu.RUnlock()
			}
			// only for read map purpose
			k = fmt.Sprintf("%d", v)
			wg.Done()
		}(k)
	}
	wg.Wait()
}

// write once, read multiples
func syncmap(n int) {

	m := sync.Map{}
	wg := sync.WaitGroup{}

	wg.Add(n)
	for i := 0; i < n; i++ {
		// write once, read
		k := fmt.Sprintf("%d", i)
		m.Store(k, i)
		go func(k string) {
			for j := 0; j < n; j++ {
				m.Load(k)
			}
			wg.Done()
		}(k)
	}
	wg.Wait()
}

func BenchmarkMap(b *testing.B) {
	for n := 0; n < maxn; n++ {
		b.Run(fmt.Sprintf("purelockmap/n=%d", n), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				purelockmap(n)
			}
		})
		b.Run(fmt.Sprintf("purerwlockmap/n=%d", n), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				purerwlockmap(n)
			}
		})
		b.Run(fmt.Sprintf("syncmap/n=%d", n), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				syncmap(n)
			}
		})
	}
}
