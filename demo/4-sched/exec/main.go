package main

import "fmt"

const RegSize = 4 << (^uint32(0) >> 63)

func main() {
	var controlWord64 uint16 = 0x3f + 2<<8 + 0<<10
	fmt.Printf("%x\n", controlWord64)

	var siz int32 = 0
	siz = (siz + 7) &^ 7
	fmt.Printf("%d\n", siz)

	totalSize := 4*RegSize + uintptr(siz)
	totalSize += -totalSize & 0
	fmt.Printf("%d\n", RegSize)
	fmt.Printf("%d\n", totalSize)
}
