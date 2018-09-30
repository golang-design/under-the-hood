# 7 defer

`defer` 不是免费的午餐，任何一次的 `defer` 都存在性能问题，这样一个简单的性能对比：

```go
var lock sync.Mutex

func NoDefer() {
	lock.Lock()
	lock.Unlock()
}
func Defer() {
	lock.Lock()
	defer lock.Unlock()
}

func BenchmarkNoDefer(b *testing.B) {
	for i := 0; i < b.N; i++ {
		NoDefer()
	}
}

func BenchmarkDefer(b *testing.B) {
	for i := 0; i < b.N; i++ {
		Defer()
	}
}
```

运行结果：

```
→go test -bench=. -v
goos: darwin
goarch: amd64
BenchmarkNoDefer-8      100000000               16.4 ns/op
BenchmarkDefer-8        30000000                50.1 ns/op
PASS
ok      _/Users/changkun/dev/go-under-the-hood/demo/7-lang/defer        3.222s
```

本文来深入源码探究 `defer` 存在如此之高性能损耗的原因。

TODO:

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-ND 4.0 & MIT &copy; [changkun](https://changkun.de)