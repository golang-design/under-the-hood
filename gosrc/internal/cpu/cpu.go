// Copyright 2017 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package cpu implements processor feature detection
// used by the Go standard library.
package cpu

// DebugOptions 会当如果操作系统在运行时启动时读取到 GODEBUG 时将其设置为 true
// 初始化后不应该被修改
var DebugOptions bool

// CacheLinePad 用于填补结构体进而避免 false sharing
type CacheLinePad struct{ _ [CacheLinePadSize]byte }

// CacheLineSize 是 CPU 的假设的缓存行大小
// 当前没有对实际的缓存航大小在运行时检测，因此我们使用针对每个 GOARCH 的 CacheLinePadSize 进行估计
var CacheLineSize uintptr = CacheLinePadSize

var X86 x86

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

var PPC64 ppc64

// For ppc64(le), it is safe to check only for ISA level starting on ISA v3.00,
// since there are no optional categories. There are some exceptions that also
// require kernel support to work (darn, scv), so there are feature bits for
// those as well. The minimum processor requirement is POWER8 (ISA 2.07).
// The struct is padded to avoid false sharing.
type ppc64 struct {
	_        CacheLinePad
	HasDARN  bool // Hardware random number generator (requires kernel enablement)
	HasSCV   bool // Syscall vectored (requires kernel enablement)
	IsPOWER8 bool // ISA v2.07 (POWER8)
	IsPOWER9 bool // ISA v3.00 (POWER9)
	_        CacheLinePad
}

var ARM arm

// The booleans in arm contain the correspondingly named cpu feature bit.
// The struct is padded to avoid false sharing.
type arm struct {
	_        CacheLinePad
	HasVFPv4 bool
	HasIDIVA bool
	_        CacheLinePad
}

var ARM64 arm64

// The booleans in arm64 contain the correspondingly named cpu feature bit.
// The struct is padded to avoid false sharing.
type arm64 struct {
	_           CacheLinePad
	HasFP       bool
	HasASIMD    bool
	HasEVTSTRM  bool
	HasAES      bool
	HasPMULL    bool
	HasSHA1     bool
	HasSHA2     bool
	HasCRC32    bool
	HasATOMICS  bool
	HasFPHP     bool
	HasASIMDHP  bool
	HasCPUID    bool
	HasASIMDRDM bool
	HasJSCVT    bool
	HasFCMA     bool
	HasLRCPC    bool
	HasDCPOP    bool
	HasSHA3     bool
	HasSM3      bool
	HasSM4      bool
	HasASIMDDP  bool
	HasSHA512   bool
	HasSVE      bool
	HasASIMDFHM bool
	_           CacheLinePad
}

var S390X s390x

type s390x struct {
	_         CacheLinePad
	HasZARCH  bool // z architecture mode is active [mandatory]
	HasSTFLE  bool // store facility list extended [mandatory]
	HasLDISP  bool // long (20-bit) displacements [mandatory]
	HasEIMM   bool // 32-bit immediates [mandatory]
	HasDFP    bool // decimal floating point
	HasETF3EH bool // ETF-3 enhanced
	HasMSA    bool // message security assist (CPACF)
	HasAES    bool // KM-AES{128,192,256} functions
	HasAESCBC bool // KMC-AES{128,192,256} functions
	HasAESCTR bool // KMCTR-AES{128,192,256} functions
	HasAESGCM bool // KMA-GCM-AES{128,192,256} functions
	HasGHASH  bool // KIMD-GHASH function
	HasSHA1   bool // K{I,L}MD-SHA-1 functions
	HasSHA256 bool // K{I,L}MD-SHA-256 functions
	HasSHA512 bool // K{I,L}MD-SHA-512 functions
	HasSHA3   bool // K{I,L}MD-SHA3-{224,256,384,512} and K{I,L}MD-SHAKE-{128,256} functions
	HasVX     bool // vector facility. Note: the runtime sets this when it processes auxv records.
	HasVXE    bool // vector-enhancements facility 1
	HasKDSA   bool // elliptic curve functions
	HasECDSA  bool // NIST curves
	HasEDDSA  bool // Edwards curves
	_         CacheLinePad
}

// Initialize 检查处理器并设置上面的相关变量。
// 该函数在程序初始化的早期由运行时包调用，在运行正常的 init 函数之前。
// 如果 go 是使用 GODEBUG 编译的，则 env 在 Linux/Darwin 上由运行时设置
func Initialize(env string) {
	doinit()
	processOptions(env)
}

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

// indexByte returns the index of the first instance of c in s,
// or -1 if c is not present in s.
func indexByte(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}
