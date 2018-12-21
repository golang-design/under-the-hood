package main

func main() {
	var x chan int
	go func() {
		x <- 1
	}()
	select {
	case v := <-x:
		println(v)
	}
}
