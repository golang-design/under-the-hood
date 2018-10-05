# 7 go

`go` 是 Go 语言的灵魂，我们看看这个关键字最终被编译器解释为了什么。

```go
package main

func main() {
	go println("hello world")
}
```

其汇编的形式为：

```asm
TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/go/main.go
  main.go:3		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  (...)
  main.go:4		0x104e059		488d05280d0200		LEAQ go.func.*+65(SB), AX		
  main.go:4		0x104e060		4889442408		MOVQ AX, 0x8(SP)			
  main.go:4		0x104e065		e886cefdff		CALL runtime.newproc(SB)		
  (...)
```

可以看到 go 这个关键词本质上只是一个 `runtime.newproc` 调用。而这个函数的功能我们已经在 runtime 中讨论过了。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)