---
bookHidden: true
---

# 链接器：初始化

[TOC]

TODO:

```go
var firstmoduledata moduledata  // linker symbol

func moduledataverify() {
	for datap := &firstmoduledata; datap != nil; datap = datap.next {
		moduledataverify1(datap)
	}
}
```

其中模块数据类型 `moduledata` 是一个单向链表：

```go
// moduledata 记录有关可执行映像布局的信息。它由链接器编写。
// 此处的任何更改必须与 cmd/internal/ld/ symtab.go:symtab 中的代码匹配更改。
// moduledata 存储在静态分配的非指针内存中;
// 这里没有任何指针对垃圾收集器可见。
type moduledata struct {
	pclntable    []byte
	ftab         []functab
	filetab      []uint32
	findfunctab  uintptr
	minpc, maxpc uintptr

	text, etext           uintptr
	noptrdata, enoptrdata uintptr
	data, edata           uintptr
	bss, ebss             uintptr
	noptrbss, enoptrbss   uintptr
	end, gcdata, gcbss    uintptr
	types, etypes         uintptr

	textsectmap []textsect
	typelinks   []int32 // 类型偏移
	itablinks   []*itab

	ptab []ptabEntry

	pluginpath string
	pkghashes  []modulehash

	modulename   string
	modulehashes []modulehash

	hasmain uint8 // 如果模块包含 main 函数，则为1，否则为 0

	gcdatamask, gcbssmask bitvector

	typemap map[typeOff]*_type // 在前一个模块中偏移到 *_rtype

	bad bool // 如果模块加载失败，应该被忽略

	next *moduledata
}
```