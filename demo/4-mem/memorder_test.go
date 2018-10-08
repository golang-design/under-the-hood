package main_test

import "testing"

func TestMemOrder(t *testing.T) {
	var a, b int

	f := func() {
		a = 1
		b = 2
	}

	g := func() {
		println(b)
		println(a)
	}

	go f()
	g()
}
