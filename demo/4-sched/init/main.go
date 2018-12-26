package main

func round2(x int32) int32 {
	s := uint(0)
	for 1<<s < x {
		s++
	}
	return 1 << s
}

func main() {
	var i int32
	for i = 0; i < 100; i++ {
		println(round2(i))
	}
}
