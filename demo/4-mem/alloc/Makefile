all: clean
	go build -gcflags "-N -l -m" -ldflags=-compressdwarf=false -o alloc.out alloc.go
	go tool objdump -s "main.*" alloc.out > alloc.S
clean:
	rm -rf alloc.out alloc.S