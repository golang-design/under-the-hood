all: clean
	go tool compile -N -l -S main1.go > main1.S
	go tool compile -N -l -S main2.go > main2.S
	go run ssa.go > ssa.txt
clean:
	rm -rf main1.o main1.S
	rm -rf main2.o main2.S
	rm -rf ssa.txt
