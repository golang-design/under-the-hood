package main

func opendefer() (life int) {
	defer func() { life = 42 }()
	return
}

func main() {
	println(opendefer())
}
