package main

import (
	"os"
	"runtime"
	"runtime/trace"
	"sync/atomic"
)

var stop uint64

func gcfinished() *int {
	p := 1
	runtime.SetFinalizer(&p, func(_ *int) {
		println("gc finished")
		atomic.StoreUint64(&stop, 1)
	})
	return &p
}

func allocate() {
	_ = make([]byte, int((1<<20)*0.25))
}

func main() {
	f, _ := os.Create("trace.out")
	defer f.Close()
	trace.Start(f)
	defer trace.Stop()
	gcfinished()
	for n := 1; atomic.LoadUint64(&stop) != 1; n++ {
		println("#allocate: ", n)
		allocate()
	}
	println("terminate")
}
