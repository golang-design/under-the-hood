package main

import "fmt"

// func panicf1() {
// 	defer func() {
// 		println("1")
// 	}()
// 	panic("panic at panicf1")
// 	defer func() {
// 		println("not reach")
// 	}()
// }

// func panicf2() {
// 	defer func() {
// 		println("3")
// 	}()
// }

// func main() {
// 	defer func() {
// 		if r := recover(); r != nil {
// 			fmt.Printf("%s\n", r)
// 		}
// 	}()
// 	panicf1()
// 	panicf2()
// }

func panicf1() {
	defer func() {
		println("1")
	}()
	panicf2()
}

func panicf2() {
	panic("panic at panicf2")
}

func main() {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("%s\n", r)
		}
	}()
	panicf1()
}
