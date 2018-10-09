# 7 关键字: defer

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

## 本质

我们来看一看 defer 这个关键字被翻译为了什么：

```go
package main

func main() {
	defer println("hello, world!")
}
```

```asm
TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/defer/defer.go
  defer.go:3		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  (...)
  defer.go:4		0x104e059		488d05500d0200		LEAQ go.func.*+71(SB), AX		
  defer.go:4		0x104e060		4889442408		MOVQ AX, 0x8(SP)			
  defer.go:4		0x104e065		e83629fdff		CALL runtime.deferproc(SB)		
  defer.go:4		0x104e06a		85c0			TESTL AX, AX				
  defer.go:4		0x104e06c		7512			JNE 0x104e080				
  defer.go:4		0x104e06e		eb00			JMP 0x104e070				
  defer.go:5		0x104e070		90			NOPL					
  defer.go:5		0x104e071		e8aa31fdff		CALL runtime.deferreturn(SB)		
  defer.go:5		0x104e076		488b6c2420		MOVQ 0x20(SP), BP			
  defer.go:5		0x104e07b		4883c428		ADDQ $0x28, SP				
  defer.go:5		0x104e07f		c3			RET					
  (...)
```

可以看到 defer 这个调用被编译为了 `runtime.deferproc` 调用，返回前还被插入了 `runtime.deferreturn` 调用。
下面我们就来详细看看这两个调用具体发生了什么事情。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)