package main

import "fmt"

func main() {
	s := []int{1, 2, 3, 4}
	fmt.Printf("%v\n", &s[0])
	fmt.Printf("%v\n", len(s))
	fmt.Printf("%v\n", cap(s))

	s = append(s, 5)
	fmt.Printf("%v\n", &s[0])
	fmt.Printf("%v\n", len(s))
	fmt.Printf("%v\n", cap(s))

}
