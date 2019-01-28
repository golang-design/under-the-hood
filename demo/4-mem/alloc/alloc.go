package main

type smallobj struct {
	arr [1 << 10]byte
}

type largeobj struct {
	arr [1 << 26]byte
}

func f1() int {
	x := 1
	return x
}

func f2() *int {
	y := 2
	return &y
}

func f3() {
	large := largeobj{}
	println(&large)
}

func f4() {
	small := smallobj{}
	print(&small)
}

func main() {
	x := f1()
	y := f2()
	f3()
	f4()
	println(x, y)
}
