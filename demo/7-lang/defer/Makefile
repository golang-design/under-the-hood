all: clean
	go build -gcflags "-N -l" -ldflags=-compressdwarf=false -o defer.out defer.go
	go tool objdump -s "main.main" defer.out > defer.S
clean:
	rm -rf defer.out defer.S