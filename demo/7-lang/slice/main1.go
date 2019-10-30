package main

import "fmt"

func main() {
	var s1 []int
	s2 := []int{1, 2, 3, 4}
	s3 := new([]int)
	s4 := make([]int, 3, 4)

	fmt.Printf("%v\n", s1)
	fmt.Printf("%v\n", s2)
	fmt.Printf("%v\n", s3)
	fmt.Printf("%v\n", s4)
}
