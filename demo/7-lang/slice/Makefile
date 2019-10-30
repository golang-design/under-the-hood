all: clean
	go tool compile -N -l -S main1.go > main1.S
	go tool compile -N -l -S main2.go > main2.S
	go tool compile -N -l -S main3.go > main3_1.S
	go tool compile -race -N -l -S main3.go > main3_2.S
	go tool compile -N -l -S main4.go > main4.S
clean:
	rm -rf main1.o main1.S
	rm -rf main2.o main2.S
	rm -rf main3.o main3_1.S main3_2.S
	rm -rf main4.o main4.S
