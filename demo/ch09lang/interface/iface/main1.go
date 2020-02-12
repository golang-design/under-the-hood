package main

type Person interface {
	Name() string
}

type student struct {
	name string
}

func (s student) Name() string {
	return s.name
}

func main() {
	s := student{name: "sean"}
	echoName(s)
}

func echoName(p Person) {
	println(p.Name())
}
