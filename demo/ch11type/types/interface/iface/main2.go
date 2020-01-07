package main

type Person interface {
	Name() string
	Age() int
}

type student struct {
	name string
	age  int
}

func (s student) Name() string {
	return s.name
}

func (s student) Age() int {
	return s.age
}

func main() {
	s := student{name: "sean", age: 20}
	echoPerson(s)
}

func echoPerson(p Person) {
	p.Name()
	p.Age()
}
