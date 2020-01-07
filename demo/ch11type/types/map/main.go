package main

import (
	"fmt"
	"time"
)

func write() {
	var step int64 = 1000000
	var t1 time.Time
	m := map[int64]int64{}
	for i := int64(0); ; i += step {
		t1 = time.Now()
		for j := int64(0); j < step; j++ {
			m[i+j] = i + j
		}
		fmt.Printf("%d done, time: %v\n", i, time.Since(t1).Seconds())
	}
}

func main() {
	write()
}
