all: clean
	go tool compile -N -l -S main4.go > main4.S
	go tool compile -N -l -S main3.go > main3.S
	go tool compile -N -l -S main2.go > main2.S
	go tool compile -N -l -S main1.go > main1.S
clean:
	rm -rf main1.o main1.S
	rm -rf main2.o main2.S
	rm -rf main3.o main3.S
	rm -rf main4.o main4.S
