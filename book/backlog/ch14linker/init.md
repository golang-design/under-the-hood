---
weight: 3401
title: "14.1 初始化"
bookHidden: true
---

# 14.1 初始化


## 模块链接初始化

```go
func schedinit() {
	(...)

	// 模块数据验证
	moduledataverify()

	(...)

	// 模块加载相关的初始化
	modulesinit()   // 模块链接，提供 activeModules
	typelinksinit() // 使用 maps, activeModules
	itabsinit()     // 初始化 interface table，使用 activeModules

	(...)
}

```

Go 程序支持通过插件的方式将各个编译好的包进行链接。模块提供了这方面的支持。

在初始化的最早期阶段，通过 `moduledataverify` 来对模块的数据进行验证。
再完成内存分配器、调度器 M 、CPU 和散列算法初始化后，
通过 `modulesinit` 来正式对需要链接的模块进行链接。
再通过 `typelinksinit` 来消除类型指针的重新定义，由于这部分代码需要使用 `map` 类型，
因此此方法的调用必须在 CPU 和散列算法初始化之后调用。
并最后通过 `itabsinit` 将各模块间用于缓存运行时类型转换的接口表初始化到运行时中。

而 `itabsinit` 则会在 [关键字: interface](../../part3tools/ch11keyword/interface.md) 一节中进行讨论。

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

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).