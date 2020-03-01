all: clean
	go run make-cn.go
	hugo -D --minify

s:
	hugo server -D

clean:
	rm -rf content resources public