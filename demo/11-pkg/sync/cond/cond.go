package main

import (
	"fmt"
	"sync"
)

func main() {
	cond := sync.NewCond(new(sync.Mutex))
	condition := 0

	// Consumer
	go func() {
		for {
			cond.L.Lock()
			for condition == 0 {
				cond.Wait()
			}
			condition--
			fmt.Printf("Consumer: %d\n", condition)
			cond.Signal()
			cond.L.Unlock()
		}
	}()

	// Producer
	for {
		cond.L.Lock()
		for condition == 3 {
			cond.Wait()
		}
		condition++
		fmt.Printf("Producer: %d\n", condition)
		cond.Signal()
		cond.L.Unlock()
	}
}
