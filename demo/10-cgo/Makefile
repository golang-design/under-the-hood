all:
	go build -v -o main main.go
	go tool cgo main.go
	go tool objdump -s "(main.main)|(main._Cfunc_print)" main > main.S
clean:
	rm -rf main main.S _obj