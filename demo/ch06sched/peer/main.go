package main

import "time"

func longcall() {
	for {
		time.Sleep(time.Second)
	}
}

func main() {
	go longcall()

	for {
		time.Sleep(time.Second)
	}
}
