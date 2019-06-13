// Copyright 2014 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

import (
	"internal/cpu"
	"runtime/internal/sys"
	"unsafe"
)

const (
	c0 = uintptr((8-sys.PtrSize)/4*2860486313 + (sys.PtrSize-4)/4*33054211828000289)
	c1 = uintptr((8-sys.PtrSize)/4*3267000013 + (sys.PtrSize-4)/4*23344194077549503)
)

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

// typeAlg 还用于 reflect/type.go，保持同步
type typeAlg struct {
	// 函数用于对此类型的对象求 hash，(指向对象的指针, 种子) --> hash
	hash func(unsafe.Pointer, uintptr) uintptr
	// 函数用于比较此类型的对象，(指向对象 A 的指针, 指向对象 B 的指针) --> ==?
	equal func(unsafe.Pointer, unsafe.Pointer) bool
}

func memhash0(p unsafe.Pointer, h uintptr) uintptr {
	return h
}

func memhash8(p unsafe.Pointer, h uintptr) uintptr {
	return memhash(p, h, 1)
}

func memhash16(p unsafe.Pointer, h uintptr) uintptr {
	return memhash(p, h, 2)
}

func memhash128(p unsafe.Pointer, h uintptr) uintptr {
	return memhash(p, h, 16)
}

//go:nosplit
func memhash_varlen(p unsafe.Pointer, h uintptr) uintptr {
	ptr := getclosureptr()
	size := *(*uintptr)(unsafe.Pointer(ptr + unsafe.Sizeof(h)))
	return memhash(p, h, size)
}

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

var useAeshash bool

// in asm_*.s
func aeshash(p unsafe.Pointer, h, s uintptr) uintptr
func aeshash32(p unsafe.Pointer, h uintptr) uintptr
func aeshash64(p unsafe.Pointer, h uintptr) uintptr
func aeshashstr(p unsafe.Pointer, h uintptr) uintptr

func strhash(a unsafe.Pointer, h uintptr) uintptr {
	x := (*stringStruct)(a)
	return memhash(x.str, h, uintptr(x.len))
}

// 注意: 因为 NaN != NaN, 一个 map 可以用 NaNs 包含任意数量（大量无用）的条目。
// 为避免长 hash 链，我们分配一个随机数来来作为 NaN 的哈希值。

func f32hash(p unsafe.Pointer, h uintptr) uintptr {
	f := *(*float32)(p)
	switch {
	case f == 0:
		return c1 * (c0 ^ h) // +0, -0
	case f != f:
		return c1 * (c0 ^ h ^ uintptr(fastrand())) // 任意类型的 NaN
	default:
		return memhash(p, h, 4)
	}
}

func f64hash(p unsafe.Pointer, h uintptr) uintptr {
	f := *(*float64)(p)
	switch {
	case f == 0:
		return c1 * (c0 ^ h) // +0, -0
	case f != f:
		return c1 * (c0 ^ h ^ uintptr(fastrand())) // 任意类型的 NaN
	default:
		return memhash(p, h, 8)
	}
}

func c64hash(p unsafe.Pointer, h uintptr) uintptr {
	x := (*[2]float32)(p)
	return f32hash(unsafe.Pointer(&x[1]), f32hash(unsafe.Pointer(&x[0]), h))
}

func c128hash(p unsafe.Pointer, h uintptr) uintptr {
	x := (*[2]float64)(p)
	return f64hash(unsafe.Pointer(&x[1]), f64hash(unsafe.Pointer(&x[0]), h))
}

func interhash(p unsafe.Pointer, h uintptr) uintptr {
	a := (*iface)(p)
	tab := a.tab
	if tab == nil {
		return h
	}
	t := tab._type
	fn := t.alg.hash
	if fn == nil {
		panic(errorString("hash of unhashable type " + t.string()))
	}
	if isDirectIface(t) {
		return c1 * fn(unsafe.Pointer(&a.data), h^c0)
	} else {
		return c1 * fn(a.data, h^c0)
	}
}

func nilinterhash(p unsafe.Pointer, h uintptr) uintptr {
	a := (*eface)(p)
	t := a._type
	if t == nil {
		return h
	}
	fn := t.alg.hash
	if fn == nil {
		panic(errorString("hash of unhashable type " + t.string()))
	}
	if isDirectIface(t) {
		return c1 * fn(unsafe.Pointer(&a.data), h^c0)
	} else {
		return c1 * fn(a.data, h^c0)
	}
}

func memequal0(p, q unsafe.Pointer) bool {
	return true
}
func memequal8(p, q unsafe.Pointer) bool {
	return *(*int8)(p) == *(*int8)(q)
}
func memequal16(p, q unsafe.Pointer) bool {
	return *(*int16)(p) == *(*int16)(q)
}
func memequal32(p, q unsafe.Pointer) bool {
	return *(*int32)(p) == *(*int32)(q)
}
func memequal64(p, q unsafe.Pointer) bool {
	return *(*int64)(p) == *(*int64)(q)
}
func memequal128(p, q unsafe.Pointer) bool {
	return *(*[2]int64)(p) == *(*[2]int64)(q)
}
func f32equal(p, q unsafe.Pointer) bool {
	return *(*float32)(p) == *(*float32)(q)
}
func f64equal(p, q unsafe.Pointer) bool {
	return *(*float64)(p) == *(*float64)(q)
}
func c64equal(p, q unsafe.Pointer) bool {
	return *(*complex64)(p) == *(*complex64)(q)
}
func c128equal(p, q unsafe.Pointer) bool {
	return *(*complex128)(p) == *(*complex128)(q)
}
func strequal(p, q unsafe.Pointer) bool {
	return *(*string)(p) == *(*string)(q)
}
func interequal(p, q unsafe.Pointer) bool {
	x := *(*iface)(p)
	y := *(*iface)(q)
	return x.tab == y.tab && ifaceeq(x.tab, x.data, y.data)
}
func nilinterequal(p, q unsafe.Pointer) bool {
	x := *(*eface)(p)
	y := *(*eface)(q)
	return x._type == y._type && efaceeq(x._type, x.data, y.data)
}
func efaceeq(t *_type, x, y unsafe.Pointer) bool {
	if t == nil {
		return true
	}
	eq := t.alg.equal
	if eq == nil {
		panic(errorString("comparing uncomparable type " + t.string()))
	}
	if isDirectIface(t) {
		// Direct interface types are ptr, chan, map, func, and single-element structs/arrays thereof.
		// Maps and funcs are not comparable, so they can't reach here.
		// Ptrs, chans, and single-element items can be compared directly using ==.
		return x == y
	}
	return eq(x, y)
}
func ifaceeq(tab *itab, x, y unsafe.Pointer) bool {
	if tab == nil {
		return true
	}
	t := tab._type
	eq := t.alg.equal
	if eq == nil {
		panic(errorString("comparing uncomparable type " + t.string()))
	}
	if isDirectIface(t) {
		// See comment in efaceeq.
		return x == y
	}
	return eq(x, y)
}

// hash 质量测试的测试适配器（见 hash_test.go）
func stringHash(s string, seed uintptr) uintptr {
	return algarray[alg_STRING].hash(noescape(unsafe.Pointer(&s)), seed)
}

func bytesHash(b []byte, seed uintptr) uintptr {
	s := (*slice)(unsafe.Pointer(&b))
	return memhash(s.array, seed, uintptr(s.len))
}

func int32Hash(i uint32, seed uintptr) uintptr {
	return algarray[alg_MEM32].hash(noescape(unsafe.Pointer(&i)), seed)
}

func int64Hash(i uint64, seed uintptr) uintptr {
	return algarray[alg_MEM64].hash(noescape(unsafe.Pointer(&i)), seed)
}

func efaceHash(i interface{}, seed uintptr) uintptr {
	return algarray[alg_NILINTER].hash(noescape(unsafe.Pointer(&i)), seed)
}

func ifaceHash(i interface {
	F()
}, seed uintptr) uintptr {
	return algarray[alg_INTER].hash(noescape(unsafe.Pointer(&i)), seed)
}

const hashRandomBytes = sys.PtrSize / 4 * 64

// 在 asm_{386,amd64,arm64}.s 中用于初始化 hash 函数的种子
var aeskeysched [hashRandomBytes]byte

// 在 hash{32,64}.go 中用于初始化 hash 函数的种子
var hashkey [4]uintptr

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

func initAlgAES() {
	if GOOS == "aix" {
		// runtime.algarray is immutable on AIX: see cmd/link/internal/ld/xcoff.go
		return
	}
	useAeshash = true
	algarray[alg_MEM32].hash = aeshash32
	algarray[alg_MEM64].hash = aeshash64
	algarray[alg_STRING].hash = aeshashstr
	// 使用随机数据初始化，从而使哈希碰撞攻击变得困难。
	getRandomData(aeskeysched[:])
}

// Note: These routines perform the read with an native endianness.
func readUnaligned32(p unsafe.Pointer) uint32 {
	q := (*[4]byte)(p)
	if sys.BigEndian {
		return uint32(q[3]) | uint32(q[2])<<8 | uint32(q[1])<<16 | uint32(q[0])<<24
	}
	return uint32(q[0]) | uint32(q[1])<<8 | uint32(q[2])<<16 | uint32(q[3])<<24
}

func readUnaligned64(p unsafe.Pointer) uint64 {
	q := (*[8]byte)(p)
	if sys.BigEndian {
		return uint64(q[7]) | uint64(q[6])<<8 | uint64(q[5])<<16 | uint64(q[4])<<24 |
			uint64(q[3])<<32 | uint64(q[2])<<40 | uint64(q[1])<<48 | uint64(q[0])<<56
	}
	return uint64(q[0]) | uint64(q[1])<<8 | uint64(q[2])<<16 | uint64(q[3])<<24 | uint64(q[4])<<32 | uint64(q[5])<<40 | uint64(q[6])<<48 | uint64(q[7])<<56
}
