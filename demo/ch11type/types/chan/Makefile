all: clean
	go build -gcflags "-N -l" -ldflags=-compressdwarf=false -o chan.out chan.go
	go tool objdump -s "main.main" chan.out > chan.S
clean:
	rm -rf chan.out chan.S