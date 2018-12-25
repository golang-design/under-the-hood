// Copyright 2017 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// +build 386 amd64 amd64p32

package cpu

const CacheLineSize = 64

// cpuid 在 cpu_x86.s 中实现
func cpuid(eaxArg, ecxArg uint32) (eax, ebx, ecx, edx uint32)

// xgetbv 和 ecx = 0 在 cpu_x86.s 中实现
func xgetbv() (eax, edx uint32)

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
		{"adx", &X86.HasADX},
		{"aes", &X86.HasAES},
		{"avx", &X86.HasAVX},
		{"avx2", &X86.HasAVX2},
		{"bmi1", &X86.HasBMI1},
		{"bmi2", &X86.HasBMI2},
		{"erms", &X86.HasERMS},
		{"fma", &X86.HasFMA},
		{"pclmulqdq", &X86.HasPCLMULQDQ},
		{"popcnt", &X86.HasPOPCNT},
		{"sse3", &X86.HasSSE3},
		{"sse41", &X86.HasSSE41},
		{"sse42", &X86.HasSSE42},
		{"ssse3", &X86.HasSSSE3},

		// sse2 设置为最后一个元素，因此可以轻松地再次删除它。见下面的代码。
		{"sse2", &X86.HasSSE2},
	}

	// 从 amd64(p32) 上的选项中删除 sse2，因为 SSE2 是这些 GOARCH 的必需功能。
	if GOARCH == "amd64" || GOARCH == "amd64p32" {
		options = options[:len(options)-1]
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
