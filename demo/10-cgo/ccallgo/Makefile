all:
	go build -x -o gofunc/hello.so -buildmode=c-shared gofunc/hello.go
	gcc main.c -o main gofunc/hello.so
clean:
	rm -rf main gofunc/hello.h gofunc/hello.so