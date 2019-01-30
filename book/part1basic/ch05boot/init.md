# 2 初始化概览

本节简单讨论程序初始化工作，即 `runtime.schedinit`。

## 概览

> 位于 runtime/proc.go

```go
// 启动顺序
//
//	调用 osinit
//	调用 schedinit
//	make & queue new G
//	调用 runtime·mstart
//
// 创建 G 的调用 runtime·main.
func schedinit() {
	_g_ := getg()

	// race 检查有关
	// raceinit 必须受限调用竞争检查器 race detector
	// 特别的，它必须在 mallocinit 下面的 racemapshadow 之前完成。
	if raceenabled {
		_g_.racectx, raceprocctx0 = raceinit()
	}

	// 最大系统线程数量（即 M），参考标准库 runtime/debug.SetMaxThreads
	sched.maxmcount = 10000

	// 与 trace 有关
	tracebackinit()

	// 模块数据验证
	moduledataverify()

	// 栈、内存分配器、调度器相关初始化。
	// 栈初始化，复用管理链表
	stackinit()
	// 内存分配器初始化
	mallocinit()
	// 初始化当前 M
	mcommoninit(_g_.m)

	// cpu 相关的初始化
	cpuinit() // 必须在 alginit 之前运行
	alginit() // maps 不能在此调用之前使用，从 CPU 指令集初始化哈希算法

	// 模块加载相关的初始化
	modulesinit()   // 模块链接，提供 activeModules
	typelinksinit() // 使用 maps, activeModules
	itabsinit()     // 初始化 interface table，使用 activeModules

	msigsave(_g_.m)
	initSigmask = _g_.m.sigmask

	// 处理y命令行用户参数和环境变量
	goargs()
	goenvs()

	// 处理 GODEBUG、GOTRACEBACK 调试相关的环境变量设置
	parsedebugvars()

	// 垃圾回收器初始化
	gcinit()

	// 网络的上次轮询时间
	sched.lastpoll = uint64(nanotime())

	// 通过 CPU 核心数和 GOMAXPROCS 环境变量确定 P 的数量
	procs := ncpu
	if n, ok := atoi32(gogetenv("GOMAXPROCS")); ok && n > 0 {
		procs = n
	}

	// 调整 P 的数量
	// 这时所有 P 均为新建的 P，因此不能返回有本地任务的 P
	if procresize(procs) != nil {
		throw("unknown runnable goroutine during bootstrap")
	}

	// 不重要，调试相关
	// For cgocheck > 1, we turn on the write barrier at all times
	// and check all pointer writes. We can't do this until after
	// procresize because the write barrier needs a P.
	if debug.cgocheck > 1 {
		writeBarrier.cgo = true
		writeBarrier.enabled = true
		for _, p := range allp {
			p.wbBuf.reset()
		}
	}

	if buildVersion == "" {
		// 该条件永远不会被触发，此处只是为了防止 buildVersion 被编译器优化移除掉。
		buildVersion = "unknown"
	}
}
```

我们在下面的小节中一一讨论整个过程。

### CPU 相关信息的初始化

初始化过程中，会根据当前运行程序的 CPU 初始化一些与 CPU 相关的值，
获取 CPU 指令集相关支持，并支持对 CPU 指令集的调试，例如禁用部分指令集。

> 位于 runtime/proc.go

```go
// cpuinit 提取环境变量 GODEBUGCPU，如果 GOEXPERIMENT debugcpu 被设置，
// 则还会调用 internal/cpu.initialize
func cpuinit() {
	const prefix = "GODEBUG="
	var env string

	switch GOOS {
	case "aix", "darwin", "dragonfly", "freebsd", "netbsd", "openbsd", "solaris", "linux":
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
	cpuid_SSSE3     = 1 << 9
	cpuid_FMA       = 1 << 12
	cpuid_SSE41     = 1 << 19
	cpuid_SSE42     = 1 << 20
	cpuid_POPCNT    = 1 << 23
	cpuid_AES       = 1 << 25
	cpuid_OSXSAVE   = 1 << 27
	cpuid_AVX       = 1 << 28

	// ebx bits
	cpuid_BMI1 = 1 << 3
	cpuid_AVX2 = 1 << 5
	cpuid_BMI2 = 1 << 8
	cpuid_ERMS = 1 << 9
	cpuid_ADX  = 1 << 19
)

func doinit() {
	options = []option{
		{Name: "adx", Feature: &X86.HasADX},
		{Name: "aes", Feature: &X86.HasAES},
		{Name: "avx", Feature: &X86.HasAVX},
		{Name: "avx2", Feature: &X86.HasAVX2},
		{Name: "bmi1", Feature: &X86.HasBMI1},
		{Name: "bmi2", Feature: &X86.HasBMI2},
		{Name: "erms", Feature: &X86.HasERMS},
		{Name: "fma", Feature: &X86.HasFMA},
		{Name: "pclmulqdq", Feature: &X86.HasPCLMULQDQ},
		{Name: "popcnt", Feature: &X86.HasPOPCNT},
		{Name: "sse3", Feature: &X86.HasSSE3},
		{Name: "sse41", Feature: &X86.HasSSE41},
		{Name: "sse41", Feature: &X86.HasSSE41},
		{Name: "ssse3", Feature: &X86.HasSSSE3},

		// 下面这些特性必须总是在 amd64(p32) 上启用
		{Name: "sse2", Feature: &X86.HasSSE2, Required: GOARCH == "amd64" || GOARCH == "amd64p32"},
	}

	maxID, _, _, _ := cpuid(0, 0)

	if maxID < 1 {
		return
	}

	_, _, ecx1, edx1 := cpuid(1, 0)
	X86.HasSSE2 = isSet(edx1, cpuid_SSE2)

	X86.HasSSE3 = isSet(ecx1, cpuid_SSE3)
	X86.HasPCLMULQDQ = isSet(ecx1, cpuid_PCLMULQDQ)
	X86.HasSSSE3 = isSet(ecx1, cpuid_SSSE3)
	X86.HasFMA = isSet(ecx1, cpuid_FMA)
	X86.HasSSE41 = isSet(ecx1, cpuid_SSE41)
	X86.HasSSE42 = isSet(ecx1, cpuid_SSE42)
	X86.HasPOPCNT = isSet(ecx1, cpuid_POPCNT)
	X86.HasAES = isSet(ecx1, cpuid_AES)
	X86.HasOSXSAVE = isSet(ecx1, cpuid_OSXSAVE)

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
	X86.HasBMI2 = isSet(ebx7, cpuid_BMI2)
	X86.HasERMS = isSet(ebx7, cpuid_ERMS)
	X86.HasADX = isSet(ebx7, cpuid_ADX)
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
// 除了正在设置的 cpuid 功能位，填充结构以避免 false sharing。
type x86 struct {
	_            CacheLinePad
	HasAES       bool
	HasADX       bool
	HasAVX       bool
	HasAVX2      bool
	HasBMI1      bool
	HasBMI2      bool
	HasERMS      bool
	HasFMA       bool
	HasOSXSAVE   bool
	HasPCLMULQDQ bool
	HasPOPCNT    bool
	HasSSE2      bool
	HasSSE3      bool
	HasSSSE3     bool
	HasSSE41     bool
	HasSSE42     bool
	_            CacheLinePad
}
```

而 `cpu.cpuid` 和 `cpu.xgetbv` 的实现则由汇编完成：

```go
// cpuid 在 cpu_x86.s 中实现
func cpuid(eaxArg, ecxArg uint32) (eax, ebx, ecx, edx uint32)

func xgetbv() (eax, edx uint32)
```

本质上就是去调用 CPUID 和 XGETBV 这两个指令：

> 位于 `internal/cpu/cpu_x86.s`

```c
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

### 运行时算法初始化

初始化过程中的，`alginit` 来根据 `cpuinit` 解析得到的 CPU 指令集的支持情况，
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
	alg_MEM8
	alg_MEM16
	alg_MEM32
	alg_MEM64
	alg_MEM128
	alg_STRING
	alg_INTER
	alg_NILINTER
	alg_FLOAT32
	alg_FLOAT64
	alg_CPLX64
	alg_CPLX128
	alg_max
)

var algarray = [alg_max]typeAlg{
	alg_NOEQ:     {nil, nil},
	alg_MEM0:     {memhash0, memequal0},
	alg_MEM8:     {memhash8, memequal8},
	alg_MEM16:    {memhash16, memequal16},
	alg_MEM32:    {memhash32, memequal32},
	alg_MEM64:    {memhash64, memequal64},
	alg_MEM128:   {memhash128, memequal128},
	alg_STRING:   {strhash, strequal},
	alg_INTER:    {interhash, interequal},
	alg_NILINTER: {nilinterhash, nilinterequal},
	alg_FLOAT32:  {f32hash, f32equal},
	alg_FLOAT64:  {f64hash, f64equal},
	alg_CPLX64:   {c64hash, c64equal},
	alg_CPLX128:  {c128hash, c128equal},
}
```

其中 `algarray` 是一个用于保存 hash 函数的数组。

否则在 Linux 上，会根据 [1 程序引导](./1-init.md) 一节中提到的辅助向量提供的随机数据来初始化 hashkey：

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

我们留到 [7 关键字：map](./7-lang/map.md) 一节中进行讨论。

### 模块链接初始化

Go 程序支持通过插件的方式将各个编译好的包进行链接。模块提供了这方面的支持。

在初始化的最早期阶段，通过 `moduledataverify` 来对模块的数据进行验证。
再完成内存分配器、调度器 M 、CPU 和哈希算法初始化后，
通过 `modulesinit` 来正式对需要链接的模块进行链接。
再通过 `typelinksinit` 来消除类型指针的重新定义，由于这部分代码需要使用 `map` 类型，
因此此方法的调用必须在 CPU 和哈希算法初始化之后调用。
并最后通过 `itabsinit` 将各模块间用于缓存运行时类型转换的接口表初始化到运行时中。

这部分机制相对本文篇幅而言相对复杂，我们在 [15 链接器](./15-linker) 一章中详细对 Go 的模块链接与插件机制进行讨论。
而 `itabsinit` 则会在 [7 关键字: interface](./7-lang/interface.md) 一节中进行讨论。

### 信号处理的初始化

我们知道，Go 程序会将一段代码（goroutine）在不同的线程上进行调度，那么传统的 `pthread_sigmask` 机制
（每个线程具有不同的信号掩码）便不再适用于 Go 程序的运行时，因此 Go 运行时还实现了自己的信号处理机制。

在初始化的阶段，在 g0 所指向的 m0 上保存信号掩码 `sigmask`：

```go
const _SIG_SETMASK = 3

// msigsave 将当前线程的 signal mask 保存到 mp.sigmask。
// 当一个非 Go 线程调用 Go 函数时，用于保留非 Go signal mask。
// 这个函数是 nosplit 和 nowritebarrierrec 的，因为它由 needm 调用，即
// 在一个非 Go 线程上调用时候，没有 G。
//go:nosplit
//go:nowritebarrierrec
func msigsave(mp *m) {
	sigprocmask(_SIG_SETMASK, nil, &mp.sigmask)
}

//go:nosplit
//go:nowritebarrierrec
func sigprocmask(how int32, new, old *sigset) {
	rtsigprocmask(how, new, old, int32(unsafe.Sizeof(*new)))
}

//go:noescape
func rtsigprocmask(how int32, new, old *sigset, size int32)
```

`rtsigprocmask` 在 Linux 上由汇编直接封装 `rt_sigprocmask` 系统调用 [1]：

```c
TEXT runtime·rtsigprocmask(SB),NOSPLIT,$0-28
	MOVL	how+0(FP), DI
	MOVQ	new+8(FP), SI
	MOVQ	old+16(FP), DX
	MOVL	size+24(FP), R10
	MOVL	$SYS_rt_sigprocmask, AX
	SYSCALL
	CMPQ	AX, $0xfffffffffffff001
	JLS	2(PC)
	MOVL	$0xf1, 0xf1  // crash
	RET
```

注意，`rt_sigprocmask` 只适用于单个线程的调用，多线程上的调用时未定义行为，好在初始化阶段
的此时还未创建其他线程，因此此调用时安全的。

在 Darwin 上则是通过 `pthread_sigmask` [2] 来完成：

```go
//go:nosplit
//go:cgo_unsafe_args
func sigprocmask(how uint32, new *sigset, old *sigset) {
	libcCall(unsafe.Pointer(funcPC(sigprocmask_trampoline)), unsafe.Pointer(&how))
}
func sigprocmask_trampoline()
```

```c
TEXT runtime·sigprocmask_trampoline(SB),NOSPLIT,$0
	PUSHQ	BP
	MOVQ	SP, BP
	MOVQ	8(DI), SI	// arg 2 new
	MOVQ	16(DI), DX	// arg 3 old
	MOVL	0(DI), DI	// arg 1 how
	CALL	libc_pthread_sigmask(SB)
	TESTL	AX, AX
	JEQ	2(PC)
	MOVL	$0xf1, 0xf1  // crash
	POPQ	BP
	RET
```

最后保存到 `initSigmask` 这一全局变量中：

```go
// 用于新创建的 M 的信号掩码 signal mask 的值。
var initSigmask sigset

initSigmask = _g_.m.sigmask
```

用于当新创建 m 时（`runtime.newm`），将 m 的 sigmask 进行设置。

对于具体的运行时信号处理机制，我们在 [8 运行时组件: runtime.signal](./8-runtime/signal.md) 中讨论。

### 内存分配器的初始化

首先 `sched` 会获取 G，通过 `stackinit` 初始化程序栈、`mallocinit` 初始化
内存分配器。这部分内容我们在 [5 内存分配器: 初始化](./5-mem/init.md) 中讨论。

### 垃圾回收期的初始化

再通过 `gcinit` 初始化垃圾回收器涉及的数据。我们在 [6 垃圾回收期：初始化](./6-GC/init.md) 中详细讨论。

### 调度器 M、P 与网络轮询器的初始化

通过 `mcommoninit` 对 M 进行初步的初始化（真正的初始化会在 M 开始运行时进行，
在 [4 调度器：初始化](4-sched/init.md) 讨论）。

调度器除了负责 goroutine 的调度，还会负责网络的轮询，轮训器会根据上次轮询的时间来判断是否应该再次进行轮询。
在初始化的阶段初始化了假想的上次轮询的时间：

```go
sched.lastpoll = uint64(nanotime())
```

根据 CPU 的参数信息，初始化对应的 P 数，再调用 
`procresize` 来动态的调整 P 的个数，只不过这个时候（引导阶段）所有的 P 都是新建的。
我们在 [4 调度器: 初始化](./4-sched/init.md) 中详细讨论。

## 总结

我们最感兴趣的三大运行时组件调用包括：

- 栈初始化 `stackinit()`
- 内存分配器初始化 `mallocinit()`
- M 初始化 `mcommoninit()`
- 垃圾回收器初始化 `gcinit()`
- P 初始化 `procresize()`

`schedinit` 函数名表面上是调度器的初始化，但实际上它包含了所有核心组件的初始化工作。

具体内容我们留到对应组件中进行讨论，我们在下一节中着先着重讨论当一切都初始化好后，程序的正式启动过程。

初始化工作是整个运行时最关键的基础步骤之一。在 `schedinit` 这个函数中，我们已经看到了它
将完成栈、内存分配器、调度器、垃圾回收器、链接模块加载、运行时哈希算法等初始化工作。

## 进一步阅读的参考文献

1. [sigprocmask - Linux man page](https://linux.die.net/man/2/rt_sigprocmask)
2. [pthread_sigmask - Linux man page](https://linux.die.net/man/3/pthread_sigmask)
3. [Unix 信号](https://en.wikipedia.org/wiki/Signal_(IPC))

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)