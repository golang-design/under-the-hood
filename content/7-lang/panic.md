# 7 panic

```go
package main

func main() {
	panic(nil)
}
```

其汇编的形式为：

```asm
TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/panic/main.go
  main.go:3		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  (...)
  main.go:4		0x104e03d		0f57c0			XORPS X0, X0				
  main.go:4		0x104e040		0f110424		MOVUPS X0, 0(SP)			
  main.go:4		0x104e044		e8f735fdff		CALL runtime.gopanic(SB)		
  main.go:4		0x104e049		0f0b			UD2					
  (...)
```

可以看到 panic 这个关键词本质上只是一个 `runtime.gopanic` 调用。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)