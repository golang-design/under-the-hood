all:
	go build -gcflags "-N -l" -ldflags=-compressdwarf=false -o main1 main1.go
	go build -gcflags "-N -l" -ldflags=-compressdwarf=false -o main2 main2.go
	go tool objdump -s "main.init" main1 > main1.S
	go tool objdump -s "main.init" main2 > main2.S
clean:
	rm -rf main1 main1.S main2 main2.S