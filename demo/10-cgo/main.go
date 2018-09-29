package main

/*
#include "stdio.h"
void print() {
	printf("hellow, cgo");
}
*/
import "C"

func main() {
	C.print()
}
