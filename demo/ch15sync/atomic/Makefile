all: clean
	go build -gcflags "-N -l" -ldflags=-compressdwarf=false -o main.out main.go
	go tool objdump -s "atomic.CompareAndSwapUintptr|atomic.Casuintptr" main.out > main.S
clean:
	rm -rf main.out main.S