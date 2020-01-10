// Copyright 2016 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

// 编码的数字基础
const (
	runeError = '\uFFFD'     // the "error" Rune or "Unicode replacement character"
	runeSelf  = 0x80         // characters below runeSelf are represented as themselves in a single byte.
	maxRune   = '\U0010FFFF' // Maximum valid Unicode code point.
)

// surrogate 范围内的代码点对 UTF-8 无效。
const (
	surrogateMin = 0xD800
	surrogateMax = 0xDFFF
)

const (
	t1 = 0x00 // 0000 0000
	tx = 0x80 // 1000 0000
	t2 = 0xC0 // 1100 0000
	t3 = 0xE0 // 1110 0000
	t4 = 0xF0 // 1111 0000
	t5 = 0xF8 // 1111 1000

	maskx = 0x3F // 0011 1111
	mask2 = 0x1F // 0001 1111
	mask3 = 0x0F // 0000 1111
	mask4 = 0x07 // 0000 0111

	rune1Max = 1<<7 - 1
	rune2Max = 1<<11 - 1
	rune3Max = 1<<16 - 1

	// 默认的最低和最高连续字节
	locb = 0x80 // 1000 0000
	hicb = 0xBF // 1011 1111
)

// countrunes 返回了 s 中 rune 的个数，即 rune 关键字
func countrunes(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}

// decoderune 返回 s[k:] 开头的非 ASCII rune 和 s 中 rune 起后面的索引。
//
// decoderune 假设调用者已经检查过要解码的符文是非 ASCII rune。
//
// 如果字符串看起来不完整或遇到解码问题，会返回 (runeerror，k + 1)，进而确保在使用 decodeune 迭代字符串时的进度。
func decoderune(s string, k int) (r rune, pos int) {
	pos = k

	if k >= len(s) {
		return runeError, k + 1
	}

	s = s[k:]

	switch {
	case t2 <= s[0] && s[0] < t3:
		// 0080-07FF 双字节序列
		if len(s) > 1 && (locb <= s[1] && s[1] <= hicb) {
			r = rune(s[0]&mask2)<<6 | rune(s[1]&maskx)
			pos += 2
			if rune1Max < r {
				return
			}
		}
	case t3 <= s[0] && s[0] < t4:
		// 0800-FFFF 三字节序列
		if len(s) > 2 && (locb <= s[1] && s[1] <= hicb) && (locb <= s[2] && s[2] <= hicb) {
			r = rune(s[0]&mask3)<<12 | rune(s[1]&maskx)<<6 | rune(s[2]&maskx)
			pos += 3
			if rune2Max < r && !(surrogateMin <= r && r <= surrogateMax) {
				return
			}
		}
	case t4 <= s[0] && s[0] < t5:
		// 10000-1FFFFF 四字节序列
		if len(s) > 3 && (locb <= s[1] && s[1] <= hicb) && (locb <= s[2] && s[2] <= hicb) && (locb <= s[3] && s[3] <= hicb) {
			r = rune(s[0]&mask4)<<18 | rune(s[1]&maskx)<<12 | rune(s[2]&maskx)<<6 | rune(s[3]&maskx)
			pos += 4
			if rune3Max < r && r <= maxRune {
				return
			}
		}
	}

	return runeError, k + 1
}

// encoderune 将 rune 的 UTF-8 编码写入 p （必须足够大）。
// 它返回写入的字节数。
func encoderune(p []byte, r rune) int {
	// 负值是错误的。将其转为无符号则解决此问题。
	switch i := uint32(r); {
	case i <= rune1Max:
		p[0] = byte(r)
		return 1
	case i <= rune2Max:
		_ = p[1] // 消除边界检查
		p[0] = t2 | byte(r>>6)
		p[1] = tx | byte(r)&maskx
		return 2
	case i > maxRune, surrogateMin <= i && i <= surrogateMax:
		r = runeError
		fallthrough
	case i <= rune3Max:
		_ = p[2] // 消除边界检查
		p[0] = t3 | byte(r>>12)
		p[1] = tx | byte(r>>6)&maskx
		p[2] = tx | byte(r)&maskx
		return 3
	default:
		_ = p[3] // 消除边界检查
		p[0] = t4 | byte(r>>18)
		p[1] = tx | byte(r>>12)&maskx
		p[2] = tx | byte(r>>6)&maskx
		p[3] = tx | byte(r)&maskx
		return 4
	}
}
