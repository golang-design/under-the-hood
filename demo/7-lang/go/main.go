package main

func hello(msg string) {
	println(msg)
}

func main() {
	go hello("hello world")
}
