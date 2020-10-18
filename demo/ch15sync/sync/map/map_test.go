package map_test

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

type mapInterface interface {
	Load(k interface{}) (v interface{}, ok bool)
	Store(k, v interface{})
}

// MutexMap 是一个简单的 map + sync.Mutex 的并发安全散列表实现
type MutexMap struct {
	data map[interface{}]interface{}
	mu   sync.Mutex
}

func (m *MutexMap) Load(k interface{}) (v interface{}, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok = m.data[k]
	return
}

func (m *MutexMap) Store(k, v interface{}) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[k] = v
}

// RWMutexMap 是一个简单的 map + sync.RWMutex 的并发安全散列表实现
type RWMutexMap struct {
	data map[interface{}]interface{}
	mu   sync.RWMutex
}

func (m *RWMutexMap) Load(k interface{}) (v interface{}, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok = m.data[k]
	return
}

func (m *RWMutexMap) Store(k, v interface{}) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[k] = v
}

func BenchmarkLoadStoreCollision(b *testing.B) {
	ms := [...]mapInterface{
		&MutexMap{data: map[interface{}]interface{}{}},
		&RWMutexMap{data: map[interface{}]interface{}{}},
		&sync.Map{},
	}

	// 测试对于同一个 key 的 n-1 并发读和 1 并发写的性能
	for _, m := range ms {
		b.Run(fmt.Sprintf("%T", m), func(b *testing.B) {
			var i int64
			b.RunParallel(func(pb *testing.PB) {
				// 记录并发执行的 goroutine id
				gid := int(atomic.AddInt64(&i, 1) - 1)

				if gid == 0 {
					// gid 为 0 的 goroutine 负责并发写
					for i := 0; pb.Next(); i++ {
						m.Store(0, i)
					}
				} else {
					// gid 不为 0 的 goroutine 负责并发读
					for i := 0; pb.Next(); i++ {
						m.Load(0)
					}
				}
			})
		})
	}
}
