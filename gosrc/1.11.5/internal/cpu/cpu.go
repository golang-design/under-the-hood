// Copyright 2017 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package cpu implements processor feature detection
// used by the Go standard library.
package cpu

// debugOptions is set to true by the runtime if go was compiled with GOEXPERIMENT=debugcpu
// and GOOS is Linux or Darwin. This variable is linknamed in runtime/proc.go.
var debugOptions bool

var X86 x86

// x86 中的布尔值包含相应命名的 cpuid 功能位。
// 仅当操作系统支持 XMM 和 YMM 寄存器时，才设置 HasAVX 和 HasAVX2
// 除了正在设置的 cpuid 功能位，填充结构以避免 false sharing。
type x86 struct {
	_            [CacheLineSize]byte
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
	_            [CacheLineSize]byte
}

var PPC64 ppc64

// For ppc64x, it is safe to check only for ISA level starting on ISA v3.00,
// since there are no optional categories. There are some exceptions that also
// require kernel support to work (darn, scv), so there are feature bits for
// those as well. The minimum processor requirement is POWER8 (ISA 2.07), so we
// maintain some of the old feature checks for optional categories for
// safety.
// The struct is padded to avoid false sharing.
type ppc64 struct {
	_          [CacheLineSize]byte
	HasVMX     bool // Vector unit (Altivec)
	HasDFP     bool // Decimal Floating Point unit
	HasVSX     bool // Vector-scalar unit
	HasHTM     bool // Hardware Transactional Memory
	HasISEL    bool // Integer select
	HasVCRYPTO bool // Vector cryptography
	HasHTMNOSC bool // HTM: kernel-aborted transaction in syscalls
	HasDARN    bool // Hardware random number generator (requires kernel enablement)
	HasSCV     bool // Syscall vectored (requires kernel enablement)
	IsPOWER8   bool // ISA v2.07 (POWER8)
	IsPOWER9   bool // ISA v3.00 (POWER9)
	_          [CacheLineSize]byte
}

var ARM64 arm64

// The booleans in arm64 contain the correspondingly named cpu feature bit.
// The struct is padded to avoid false sharing.
type arm64 struct {
	_           [CacheLineSize]byte
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
	_           [CacheLineSize]byte
}

var S390X s390x

type s390x struct {
	_               [CacheLineSize]byte
	HasZArch        bool // z architecture mode is active [mandatory]
	HasSTFLE        bool // store facility list extended [mandatory]
	HasLDisp        bool // long (20-bit) displacements [mandatory]
	HasEImm         bool // 32-bit immediates [mandatory]
	HasDFP          bool // decimal floating point
	HasETF3Enhanced bool // ETF-3 enhanced
	HasMSA          bool // message security assist (CPACF)
	HasAES          bool // KM-AES{128,192,256} functions
	HasAESCBC       bool // KMC-AES{128,192,256} functions
	HasAESCTR       bool // KMCTR-AES{128,192,256} functions
	HasAESGCM       bool // KMA-GCM-AES{128,192,256} functions
	HasGHASH        bool // KIMD-GHASH function
	HasSHA1         bool // K{I,L}MD-SHA-1 functions
	HasSHA256       bool // K{I,L}MD-SHA-256 functions
	HasSHA512       bool // K{I,L}MD-SHA-512 functions
	HasVX           bool // vector facility. Note: the runtime sets this when it processes auxv records.
	_               [CacheLineSize]byte
}

// initialize 检查处理器并设置上面的相关变量。
// 该函数在程序初始化的早期由运行时包调用，在运行正常的 init 函数之前。
// 如果 go 是使用 GOEXPERIMENT=debugcpu 编译的，则 env 在 Linux/Darwin 上由运行时设置
func initialize(env string) {
	doinit()
	processOptions(env)
}

// options 包含可在 GODEBUGCPU 中使用的 cpu 调试选项。
// options 取决于架构，并由架构特定的 doinit 函数添加。
// 不应将特定 GOARCH 必需的功能添加到选项中（例如 amd64 上的 SSE2）。
var options []option

// Option 名称应为小写。 例如 avx 而不是 AVX。
type option struct {
	Name    string
	Feature *bool
}

// processOptions 根据解析的 env 字符串来禁用 CPU 功能值。
// env 字符串应该是 feature1=0,feature2=0... 格式
// 其中功能名称是存储在其中的体系结构特定列表之一
// cpu 包选项变量。如果 env 包含 all=0 则所有功能
// 通过 options 变量引用被禁用。其他功能默认忽略 0 以外的名称和值。
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
		i = indexByte(field, '=')
		if i < 0 {
			continue
		}
		key, value := field[:i], field[i+1:]

		// 仅允许通过指定“0”来关闭CPU功能。
		if value == "0" {
			if key == "all" {
				for _, v := range options {
					*v.Feature = false
				}
				return
			} else {
				for _, v := range options {
					if v.Name == key {
						*v.Feature = false
						continue field
					}
				}
			}
		}
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
