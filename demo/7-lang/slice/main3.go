package main

import "fmt"

func main() {
	s1 := []int32{1, 2, 3, 4}

	var s2 = make([]int32, 6)
	copy(s2, s1)

	s3 := s1

	fmt.Printf("slice: %v, address: %p\n", s1, &s1[0])
	fmt.Printf("slice: %v, address: %p\n", s2, &s2[0])
	fmt.Printf("slice: %v, address: %p\n", s3, &s3[0])
}
