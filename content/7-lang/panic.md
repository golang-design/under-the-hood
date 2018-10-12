# 7 关键字: panic 与 recover

panic 能中断一个程序的执行，同时也能在一定情况下进行恢复。本节我们就来看一看 panic 和 recover 这对关键字
的实现机制。

最好的方式当然是了解编译器究竟做了什么事情：

```go
package main

func main() {
	defer func() {
		recover()
	}()
	panic(nil)
}
```

其汇编的形式为：

```asm
TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/panic/main.go
  (...)
  main.go:7		0x104e05b		0f57c0			XORPS X0, X0				
  main.go:7		0x104e05e		0f110424		MOVUPS X0, 0(SP)			
  main.go:7		0x104e062		e8d935fdff		CALL runtime.gopanic(SB)		
  main.go:7		0x104e067		0f0b			UD2					
  (...)
```

可以看到 panic 这个关键词本质上只是一个 `runtime.gopanic` 调用。

而与之对应的 `recover` 则：

```asm
TEXT main.main.func1(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/panic/main.go
  (...)
  main.go:5		0x104e09d		488d442428		LEAQ 0x28(SP), AX			
  main.go:5		0x104e0a2		48890424		MOVQ AX, 0(SP)				
  main.go:5		0x104e0a6		e8153bfdff		CALL runtime.gorecover(SB)		
  (...)
```

其实也只是一个 `runtime.gorecover` 调用。

## `gopanic`

## `gorecover`

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)