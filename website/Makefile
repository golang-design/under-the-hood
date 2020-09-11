all: clean
	go run make-cn.go
	hugo -D --minify

s: all
	hugo server -D

clean:
	rm -rf content resources public