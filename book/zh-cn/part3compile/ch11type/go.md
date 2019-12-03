---
weight: 3101
title: "11.1 go"
---

# 11.1 go

[TOC]

`go` 是 Go 语言的灵魂，我们看看这个关键字如何被编译器解释。

```go
package main

func hello(msg string) {
	println(msg)
}

func main() {
	go hello("hello world")
}
```

其汇编的形式为：

```asm
TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/go/main.go
  main.go:7		0x104df70		65488b0c2530000000	MOVQ GS:0x30, CX			
  (...)
  main.go:8		0x104df8d		488d055ed10100		LEAQ go.string.*+1874(SB), AX		
  main.go:8		0x104df94		4889442410		MOVQ AX, 0x10(SP)			
  main.go:8		0x104df99		48c74424180b000000	MOVQ $0xb, 0x18(SP)			
  main.go:8		0x104dfa2		c7042410000000		MOVL $0x10, 0(SP)			
  main.go:8		0x104dfa9		488d05b80c0200		LEAQ go.func.*+67(SB), AX		
  main.go:8		0x104dfb0		4889442408		MOVQ AX, 0x8(SP)			
  main.go:8		0x104dfb5		e876cefdff		CALL runtime.newproc(SB)		
  (...)
```

可以看到 go 这个关键词本质上只是一个 `runtime.newproc` 调用。我们来看一下具体的传参过程：


```asm
LEAQ go.string.*+1874(SB), AX // 将 "hello world" 的地址给 AX
MOVQ AX, 0x10(SP)             // 将 AX 的值放到 0x10
MOVL $0x10, 0(SP)             // 将最后一个参数的位置存到栈顶 0x00
LEAQ go.func.*+67(SB), AX     // 将 go 语句调用的函数入口地址给 AX
MOVQ AX, 0x8(SP)              // 将 AX 存入 0x08
CALL runtime.newproc(SB)      // 调用 newproc
```

这个过程里我们基本上可以看到栈是这样排布的：

```
             栈布局
      |                 |       高地址
      |                 |
      +-----------------+ 
      | &"hello world"  |
0x10  +-----------------+ <--- fn + sys.PtrSize
      |      hello      |
0x08  +-----------------+ <--- fn
      |       siz       |
0x00  +-----------------+ SP
      |    newproc PC   |  
      +-----------------+ callerpc: 要运行的 goroutine 的 PC
      |                 |
      |                 |       低地址
```

从而当 `newproc` 开始运行时，先获得 siz 作为第一个参数，再获得 fn 作为第二个参数，
然后通过 `add` 计算出 `fn` 参数开始的位置。

```go
// 创建一个 G 运行函数 fn，参数大小为 biz 字节
// 将其放至 G 队列等待运行
// 编译器会将 go 语句转化为该调用。
// 这时不能将栈进行分段，因为它假设了参数在 &fn 之后顺序有效；如果栈进行了分段
// 则他们不无法被拷贝
//go:nosplit
func newproc(siz int32, fn *funcval) {
	// 从 fn 的地址增加一个指针的长度，从而获取第一参数地址
	argp := add(unsafe.Pointer(&fn), sys.PtrSize)
	gp := getg()
	// 获取调用方 PC/IP 寄存器值
	pc := getcallerpc()

  // 用 g0 系统栈创建 goroutine 对象
  // 传递的参数包括 fn 函数入口地址, argp 参数起始地址, siz 参数长度, gp（g0），调用方 pc（goroutine）
	systemstack(func() {
		newproc1(fn, (*uint8)(argp), siz, gp, pc)
	})
}

type funcval struct {
	fn uintptr
	// 变长大小，fn 的数据在应在 fn 之后
}

//go:nosplit
func add(p unsafe.Pointer, x uintptr) unsafe.Pointer {
	return unsafe.Pointer(uintptr(p) + x)
}

// getcallerpc 返回它调用方的调用方程序计数器 PC program conter
//go:noescape
func getcallerpc() uintptr
```

而这个 `newproc1` 函数的功能我们已经在 [4 调度器：初始化](../../part2runtime/ch06sched/init.md) 中讨论过了。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)