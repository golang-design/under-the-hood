package main

func main() {
	defer func() {
		recover()
	}()
	panic(nil)
}
