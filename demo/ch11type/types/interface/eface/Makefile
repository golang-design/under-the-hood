all: clean
	go tool compile -N -l -S main1.go > main1.S
	go tool compile -N -l -S main2.go > main2.S
clean:
	rm -rf main1.o main1.S
	rm -rf main2.o main2.S
