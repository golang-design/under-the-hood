---
weight: 3104
title: "11.4 map"
---

# 11.4 map

[TOC]

map 由运行时实现，编译器辅助进行布局，其本质为哈希表。我们可以通过图 1 展示的测试结果看出使用 map 的容量（无大量碰撞）。

![](../../../assets/map-write-performance.png)

**图1: map[int64]int64 写入性能，其中 `key==value` 且 key 从 1 开始增长。从 218000000 个 key 后开始出现比较严重的碰撞。**

我们就 int64 这种情况来看看具体 Go map 的运行时机制：

```go
func write() {
	var step int64 = 1000000
	var t1 time.Time
	m := map[int64]int64{}
	for i := int64(0); ; i += step {
		t1 = time.Now()
		for j := int64(0); j < step; j++ {
			m[i+j] = i + j
		}
		fmt.Printf("%d done, time: %v\n", i, time.Since(t1).Seconds())
	}
}
```

上面这段代码中涉及 map 的汇编结果为：

```asm
TEXT main.write(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/map/main.go
  (...)
  main.go:10		0x109386a		0f118c2450010000		MOVUPS X1, 0x150(SP)			
  main.go:11		0x1093872		0f57c9				XORPS X1, X1				
  main.go:11		0x1093875		0f118c2498010000		MOVUPS X1, 0x198(SP)			
  main.go:11		0x109387d		0f57c9				XORPS X1, X1				
  main.go:11		0x1093880		0f118c24a8010000		MOVUPS X1, 0x1a8(SP)			
  main.go:11		0x1093888		0f57c9				XORPS X1, X1				
  main.go:11		0x109388b		0f118c24b8010000		MOVUPS X1, 0x1b8(SP)			
  main.go:11		0x1093893		488d7c2478			LEAQ 0x78(SP), DI			
  main.go:11		0x1093898		0f57c0				XORPS X0, X0				
  main.go:11		0x109389b		488d7fd0			LEAQ -0x30(DI), DI			
  main.go:11		0x109389f		48896c24f0			MOVQ BP, -0x10(SP)			
  main.go:11		0x10938a4		488d6c24f0			LEAQ -0x10(SP), BP			
  main.go:11		0x10938a9		e824dffbff			CALL 0x10517d2				
  main.go:11		0x10938ae		488b6d00			MOVQ 0(BP), BP				
  main.go:11		0x10938b2		488d842498010000		LEAQ 0x198(SP), AX			
  main.go:11		0x10938ba		8400				TESTB AL, 0(AX)				
  main.go:11		0x10938bc		488d442478			LEAQ 0x78(SP), AX			
  main.go:11		0x10938c1		48898424a8010000		MOVQ AX, 0x1a8(SP)			
  main.go:11		0x10938c9		488d842498010000		LEAQ 0x198(SP), AX			
  main.go:11		0x10938d1		4889842420010000		MOVQ AX, 0x120(SP)			
  main.go:11		0x10938d9		e8e2c3faff			CALL runtime.fastrand(SB)		
  main.go:11		0x10938de		488b842420010000		MOVQ 0x120(SP), AX			
  main.go:11		0x10938e6		8400				TESTB AL, 0(AX)				
  main.go:11		0x10938e8		8b0c24				MOVL 0(SP), CX				
  main.go:11		0x10938eb		89480c				MOVL CX, 0xc(AX)			
  main.go:11		0x10938ee		488d842498010000		LEAQ 0x198(SP), AX			
  main.go:11		0x10938f6		4889842408010000		MOVQ AX, 0x108(SP)			
  main.go:12		0x10938fe		48c744245000000000		MOVQ $0x0, 0x50(SP)			
  (...)
  main.go:14		0x109394d		eb63				JMP 0x10939b2				
  main.go:15		0x109394f		488b442450			MOVQ 0x50(SP), AX			
  main.go:15		0x1093954		4803442448			ADDQ 0x48(SP), AX			
  main.go:15		0x1093959		4889442470			MOVQ AX, 0x70(SP)			
  main.go:15		0x109395e		488d05fb6d0100			LEAQ runtime.rodata+92544(SB), AX	
  main.go:15		0x1093965		48890424			MOVQ AX, 0(SP)				
  main.go:15		0x1093969		488b8c2408010000		MOVQ 0x108(SP), CX			
  main.go:15		0x1093971		48894c2408			MOVQ CX, 0x8(SP)			
  main.go:15		0x1093976		488b4c2450			MOVQ 0x50(SP), CX			
  main.go:15		0x109397b		48034c2448			ADDQ 0x48(SP), CX			
  main.go:15		0x1093980		48894c2410			MOVQ CX, 0x10(SP)			
  main.go:15		0x1093985		e846b0f7ff			CALL runtime.mapassign_fast64(SB)	
  main.go:15		0x109398a		488b442418			MOVQ 0x18(SP), AX			
  main.go:15		0x109398f		4889842418010000		MOVQ AX, 0x118(SP)			
  main.go:15		0x1093997		8400				TESTB AL, 0(AX)				
  main.go:15		0x1093999		488b4c2470			MOVQ 0x70(SP), CX			
  main.go:15		0x109399e		488908				MOVQ CX, 0(AX)				
  main.go:15		0x10939a1		eb00				JMP 0x10939a3				
  (...)
```

可以看到运行时通过 `runtime.mapassign_fast64` 来给一个 map 进行赋值。那么我们就来仔细看一看这个函数。

TODO: `runtime.extendRandom`


## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)