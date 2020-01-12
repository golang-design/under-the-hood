---
weight: 2407
title: "9.7 散列表"
---

# 9.7 散列表

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


## 运行时算法初始化

```go
// src/runtime/proc.go
func schedinit() {
  (...)
	cpuinit() // 必须在 alginit 之前运行
	alginit() // maps 不能在此调用之前使用，从 CPU 指令集初始化哈希算法
	(...)
}
```

运行时初始化过程中的，`alginit` 来根据 `cpuinit` 解析得到的 CPU 指令集的支持情况，
进而初始化合适的 hash 算法，用于对 Go 的 `map` 结构进行支持。

```go
func alginit() {
	// 如果需要的指令存在则安装 AES 哈希算法
	if (GOARCH == "386" || GOARCH == "amd64") &&
		GOOS != "nacl" &&
		cpu.X86.HasAES && // AESENC
		cpu.X86.HasSSSE3 && // PSHUFB
		cpu.X86.HasSSE41 { // PINSR{D,Q}
		initAlgAES()
		return
	}
	if GOARCH == "arm64" && cpu.ARM64.HasAES {
		initAlgAES()
		return
	}
	getRandomData((*[len(hashkey) * sys.PtrSize]byte)(unsafe.Pointer(&hashkey))[:])
	hashkey[0] |= 1 // 确保这些数字为奇数
	hashkey[1] |= 1
	hashkey[2] |= 1
	hashkey[3] |= 1
}
```

可以看到，在指令集支持良好的情况下，amd64 平台会调用 `initAlgAES` 来使用 AES 哈希算法。

```go
var useAeshash bool

func initAlgAES() {
	useAeshash = true
	algarray[alg_MEM32].hash = aeshash32
	algarray[alg_MEM64].hash = aeshash64
	algarray[alg_STRING].hash = aeshashstr
	// 使用随机数据初始化，从而使哈希碰撞攻击变得困难。
	getRandomData(aeskeysched[:])
}

// typeAlg 还用于 reflect/type.go，保持同步
type typeAlg struct {
	// 函数用于对此类型的对象求 hash，(指向对象的指针, 种子) --> hash
	hash func(unsafe.Pointer, uintptr) uintptr
	// 函数用于比较此类型的对象，(指向对象 A 的指针, 指向对象 B 的指针) --> ==?
	equal func(unsafe.Pointer, unsafe.Pointer) bool
}

// 类型算法 - 编译器知晓
const (
	alg_NOEQ = iota
	alg_MEM0
	(...)
)

var algarray = [alg_max]typeAlg{
	alg_NOEQ:     {nil, nil},
	alg_MEM0:     {memhash0, memequal0},
	(...)
}
```

其中 `algarray` 是一个用于保存 hash 函数的数组。

否则在 Linux 上，会根据程序引导一章中提到的辅助向量提供的随机数据来初始化 hashkey：

```go
func getRandomData(r []byte) {
	if startupRandomData != nil {
		n := copy(r, startupRandomData)
		extendRandom(r, n)
		return
	}
	fd := open(&urandom_dev[0], 0 /* O_RDONLY */, 0)
	n := read(fd, unsafe.Pointer(&r[0]), int32(len(r)))
	closefd(fd)
	extendRandom(r, int(n))
}
```

或在 darwin 中，通过读取 `/dev/urandom\x00` 的内容来获取随机值：

```go
var urandom_dev = []byte("/dev/urandom\x00")

//go:nosplit
func getRandomData(r []byte) {
	fd := open(&urandom_dev[0], 0 /* O_RDONLY */, 0)
	n := read(fd, unsafe.Pointer(&r[0]), int32(len(r)))
	closefd(fd)
	extendRandom(r, int(n))
}
```

这里我们粗略的看了一下运行时 map 类型使用的 hash 算法以及随机 key 的初始化，
具体的 `runtime.extendRandom`，和下列函数：

```go
func aeshash32(p unsafe.Pointer, h uintptr) uintptr
func aeshash64(p unsafe.Pointer, h uintptr) uintptr
func aeshashstr(p unsafe.Pointer, h uintptr) uintptr
```


## CPU 相关信息的初始化

初始化过程中，会根据当前运行程序的 CPU 初始化一些与 CPU 相关的值，
获取 CPU 指令集相关支持，并支持对 CPU 指令集的调试，例如禁用部分指令集。

> 位于 runtime/proc.go

```go
// cpuinit 会提取环境变量 GODEBUGCPU，如果 GOEXPERIMENT debugcpu 被设置，
// 则还会调用 internal/cpu.initialize
func cpuinit() {
	const prefix = "GODEBUG="
	var env string

	cpu.DebugOptions = true

	// 类似于 goenv_unix 但为 GODEBUG 直接提取了环境变量
	// TODO(moehrmann): remove when general goenvs() can be called before cpuinit()
	n := int32(0)
	for argv_index(argv, argc+1+n) != nil {
		n++
	}

	for i := int32(0); i < n; i++ {
		p := argv_index(argv, argc+1+i)
		s := *(*string)(unsafe.Pointer(&stringStruct{unsafe.Pointer(p), findnull(p)}))

		if hasprefix(s, prefix) {
			env = gostring(p)[len(prefix):]
			break
		}
	}

	cpu.Initialize(env)

	// 支持 CPU 特性的变量由编译器生成的代码来阻止指令的执行，从而不能假设总是支持的
	x86HasPOPCNT = cpu.X86.HasPOPCNT
	x86HasSSE41 = cpu.X86.HasSSE41
	arm64HasATOMICS = cpu.ARM64.HasATOMICS
}
```

其中，`cpu.Initialize(env)` 会调用 `internal/cpu/cpu.go` 中的函数：

```go
// Initialize 检查处理器并设置上面的相关变量。
// 该函数在程序初始化的早期由运行时包调用，在运行正常的 init 函数之前。
// 如果 go 是使用 GODEBUG 编译的，则 env 在 Linux/Darwin 上由运行时设置
func Initialize(env string) {
	doinit()
	processOptions(env)
}
```

而 `doinit` 会根据 CPU 架构的不同，存在不同的实现，在 amd64 上：

```go
// options 包含可在 GODEBUG 中使用的 cpu 调试选项。
// options 取决于架构，并由架构特定的 doinit 函数添加。
// 不应将特定 GOARCH 必需的功能添加到选项中（例如 amd64 上的 SSE2）。
var options []option

// Option 名称应为小写。 例如 avx 而不是 AVX。
type option struct {
	Name      string
	Feature   *bool
	Specified bool // whether feature value was specified in GODEBUG
	Enable    bool // whether feature should be enabled
	Required  bool // whether feature is mandatory and can not be disabled
}

const (
	// edx bits
	cpuid_SSE2 = 1 << 26

	// ecx bits
	cpuid_SSE3      = 1 << 0
	cpuid_PCLMULQDQ = 1 << 1
	(...)

	// ebx bits
	cpuid_BMI1 = 1 << 3
	(...)
)

func doinit() {
	options = []option{
		{Name: "adx", Feature: &X86.HasADX},
		{Name: "aes", Feature: &X86.HasAES},
		(...)

		// 下面这些特性必须总是在 amd64 上启用
		{Name: "sse2", Feature: &X86.HasSSE2, Required: GOARCH == "amd64"},
	}

	maxID, _, _, _ := cpuid(0, 0)

	if maxID < 1 {
		return
	}

	_, _, ecx1, edx1 := cpuid(1, 0)
	X86.HasSSE2 = isSet(edx1, cpuid_SSE2)

	X86.HasSSE3 = isSet(ecx1, cpuid_SSE3)
	(...)

	osSupportsAVX := false
	// 对于 XGETBV，OSXSAVE 位是必需且足够的。
	if X86.HasOSXSAVE {
		eax, _ := xgetbv()
		// 检查 XMM 和 YMM 寄存器是否支持。
		osSupportsAVX = isSet(eax, 1<<1) && isSet(eax, 1<<2)
	}

	X86.HasAVX = isSet(ecx1, cpuid_AVX) && osSupportsAVX

	if maxID < 7 {
		return
	}

	_, ebx7, _, _ := cpuid(7, 0)
	X86.HasBMI1 = isSet(ebx7, cpuid_BMI1)
	X86.HasAVX2 = isSet(ebx7, cpuid_AVX2) && osSupportsAVX
	(...)
}

func isSet(hwc uint32, value uint32) bool {
	return hwc&value != 0
}
```

其中 `X86` 变量为 `x86` 类型：

```go
var X86 x86

// CacheLinePad 用于填补结构体进而避免 false sharing
type CacheLinePad struct{ _ [CacheLinePadSize]byte }

// CacheLineSize 是 CPU 的假设的缓存行大小
// 当前没有对实际的缓存航大小在运行时检测，因此我们使用针对每个 GOARCH 的 CacheLinePadSize 进行估计
var CacheLineSize uintptr = CacheLinePadSize

// x86 中的布尔值包含相应命名的 cpuid 功能位。
// 仅当操作系统支持 XMM 和 YMM 寄存器时，才设置 HasAVX 和 HasAVX2
type x86 struct {
	_            CacheLinePad
	HasAES       bool
	(...)
	HasSSE42     bool
	_            CacheLinePad
}
```

而 `cpu.cpuid` 和 `cpu.xgetbv` 的实现则由汇编完成：

```go
func cpuid(eaxArg, ecxArg uint32) (eax, ebx, ecx, edx uint32)

func xgetbv() (eax, edx uint32)
```

本质上就是去调用 CPUID 和 XGETBV 这两个指令：

```c
// internal/cpu/cpu_x86.s
// func cpuid(eaxArg, ecxArg uint32) (eax, ebx, ecx, edx uint32)
TEXT ·cpuid(SB), NOSPLIT, $0-24
	MOVL eaxArg+0(FP), AX
	MOVL ecxArg+4(FP), CX
	CPUID
	MOVL AX, eax+8(FP)
	MOVL BX, ebx+12(FP)
	MOVL CX, ecx+16(FP)
	MOVL DX, edx+20(FP)
	RET

// func xgetbv() (eax, edx uint32)
TEXT ·xgetbv(SB),NOSPLIT,$0-8
#ifdef GOOS_nacl
	// nacl 不支持 XGETBV.
	MOVL $0, eax+0(FP)
	MOVL $0, edx+4(FP)
#else
	MOVL $0, CX
	XGETBV
	MOVL AX, eax+0(FP)
	MOVL DX, edx+4(FP)
#endif
	RET
```

`cpu.doinit` 结束后，会处理解析而来的 option，从而达到禁用某些 CPU 指令集的目的：

```go
// processOptions 根据解析的 env 字符串来禁用 CPU 功能值。
// env 字符串应该是 cpu.feature1=value1,cpu.feature2=value2... 格式
// 其中功能名称是存储在其中的体系结构特定列表之一 cpu 包选项变量，且这些值要么是 'on' 要么是 'off'。
// 如果 env 包含 cpu.all=off 则所有功能通过 options 变量引用被禁用。其他功能名称和值将导致警告消息。
func processOptions(env string) {
field:
	for env != "" {
		field := ""
		i := indexByte(env, ',')
		if i < 0 {
			field, env = env, ""
		} else {
			field, env = env[:i], env[i+1:]
		}
		if len(field) < 4 || field[:4] != "cpu." {
			continue
		}
		i = indexByte(field, '=')
		if i < 0 {
			print("GODEBUG: no value specified for \"", field, "\"\n")
			continue
		}
		key, value := field[4:i], field[i+1:] // e.g. "SSE2", "on"

		var enable bool
		switch value {
		case "on":
			enable = true
		case "off":
			enable = false
		default:
			print("GODEBUG: value \"", value, "\" not supported for cpu option \"", key, "\"\n")
			continue field
		}

		if key == "all" {
			for i := range options {
				options[i].Specified = true
				options[i].Enable = enable || options[i].Required
			}
			continue field
		}

		for i := range options {
			if options[i].Name == key {
				options[i].Specified = true
				options[i].Enable = enable
				continue field
			}
		}

		print("GODEBUG: unknown cpu feature \"", key, "\"\n")
	}

	for _, o := range options {
		if !o.Specified {
			continue
		}

		if o.Enable && !*o.Feature {
			print("GODEBUG: can not enable \"", o.Name, "\", missing CPU support\n")
			continue
		}

		if !o.Enable && o.Required {
			print("GODEBUG: can not disable \"", o.Name, "\", required CPU feature\n")
			continue
		}

		*o.Feature = o.Enable
	}
}
```
## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)