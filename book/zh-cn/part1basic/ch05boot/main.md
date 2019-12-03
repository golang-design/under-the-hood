---
weight: 1502
title: "5.3 主 goroutine"
---

# 5.3 主 goroutine

[TOC]

`runtime·schedinit` 完成初始化工作后并不会立即执行 `runtime·main`（即主 goroutine 运行的地方）。
相反，会在后续的 `runtime·mstart` 调用中被调度器调度执行。

```c
	// 创建一个新的 goroutine 来运行程序。
	PUSHL	$runtime·mainPC(SB)	// entry
	PUSHL	$0	// arg size
	CALL	runtime·newproc(SB)
	POPL	AX
	POPL	AX

	// 启动这个 M
	CALL	runtime·mstart(SB)
```

这个过程中，只会将 `runtime·main` 的入口地址压栈，进而将其传递给 `newproc` 进行使用，
而后 `runtime·newproc` 完成 G 的创建保存到 G 的运行现场中，因此真正执行会
等到 `runtime·mstart` 后才会被调度执行，我们在 [4 调度器: 执行调度](4-sched/exec.md) 中讨论。

## 概览

`runtime.main` 即为 runtime 包中的 main 函数。

```go
// 主 goroutine
func main() {
	g := getg()

	(...)

	// 执行栈最大限制：1GB（64位系统）或者 250MB（32位系统）
	if sys.PtrSize == 8 {
		maxstacksize = 1000000000
	} else {
		maxstacksize = 250000000
	}

	// 允许 newproc 启动新的 m，见 [4 调度器: 初始化]
	mainStarted = true

	// 启动系统后台监控（定期垃圾回收、并发任务调度）
	systemstack(func() {
		newm(sysmon, nil)
	})

	// 将主 goroutine 锁在主 OS 线程下进行初始化工作
	// 大部分程序并不关心这一点，但是有一些图形库（基本上属于 cgo 调用）
	// 会要求在主线程下进行初始化工作。
	// 即便是在 main.main 下仍然可以通过公共方法 runtime.LockOSThread
	// 来强制将一些特殊的需要主 OS 线程的调用锁在主 OS 线程下执行初始化
	lockOSThread()
	(...)

	// 执行 runtime.init
	// 运行时包中有多个 init 函数，编译器会将他们链接起来。
	runtime_init() // defer 必须在此调用结束后才能使用
	(...)

	// defer unlock，从而在 init 期间 runtime.Goexit 来 unlock
	needUnlock := true
	defer func() {
		if needUnlock {
			unlockOSThread()
		}
	}()

	// 记录程序的启动时间
	runtimeInitTime = nanotime()

	// 启动垃圾回收器后台操作
	gcenable()

	main_init_done = make(chan bool)
	if iscgo {
		(...)
		// Start the template thread in case we enter Go from
		// a C-created thread and need to create a new thread.
		// 启动模板线程来处理从 C 创建的线程进入 Go 时需要创建一个新的线程。
		startTemplateThread()
		cgocall(_cgo_notify_runtime_init_done, nil)
	}

	// 执行用户 main 包中的 init 函数
	// 处理为非间接调用，因为链接器在设定运行时不知道 main 包的地址
	fn := main_init
	fn()
	close(main_init_done) // main.init 执行完毕

	needUnlock = false
	unlockOSThread()

	// 如果是基础库则不需要执行 main 函数了
	if isarchive || islibrary {
		// 由 -buildmode=c-archive 或 c-shared 但不会执行的程序
		return
	}

	// 执行用户 main 包中的 main 函数
	// 处理为非间接调用，因为链接器在设定运行时不知道 main 包的地址
	fn = main_main
	fn()

	// race 相关
	if raceenabled {
		racefini()
	}

	// 使客户端程序可行：如果在其他 goroutine 上 panic 、与此同时
	// main 返回，也让其他 goroutine 能够完成 panic trace 的打印。
	// 打印完成后，立即退出。见 issue 3934 和 20018
	if atomic.Load(&runningPanicDefers) != 0 {
		// 运行包含 defer 的函数不会花太长时间
		for c := 0; c < 1000; c++ {
			if atomic.Load(&runningPanicDefers) == 0 {
				break
			}
			Gosched()
		}
	}
	if atomic.Load(&panicking) != 0 {
		gopark(nil, nil, waitReasonPanicWait, traceEvGoStop, 1)
	}

	// 退出执行，返回退出状态码
	exit(0)

	// 如果 exit 没有被正确实现，则下面的代码能够强制退出程序，因为 *nil (nil deref) 会崩溃。
	// http://golang.org/ref/spec#Terminating_statements
	// https://github.com/golang/go/commit/c81a0ed3c50606d1ada0fd9b571611b3687c90e1
	for {
		var x *int32
		*x = 0
	}
}
```

整个执行过程有这样几个关键步骤：

1. `systemstack` 会运行 `newm(sysmon, nil)` 启动后台监控，`wasm` 上不会启动
2. `lockOSThread` 初始化阶段将主 goroutine 锁定在主 OS 线程上，原因在于某些特殊的调用（尤其是一些[图形库](https://github.com/golang/go/wiki/LockOSThread)，Cocoa, OpenGL 等会使用本地线程状态）需要主线程的支持。用户层可以通过 `runtime.LockOSThread` 来绑定当前的线程（由于调度器的影响，不一定会是主线程）
3. `runtime_init` 运行时初始化。
4. `gcenable` 启用 GC
5. 如果是 `cgo` 则还会额外启动一个模板线程，来处理 C 创建的线程进入 Go 的情况
6. `cgocall` 从 Go 调用 C
7. 开始执行用户态 `main.init` 函数（所有的 `main.init` 均在同一个 `goroutine` （主）中执行）
8. 当用户态的 `main.init` 执行完毕后，`unlockOSThread` 来取消主 goroutine 与 OS 线程的绑定，从而让调度器能够灵活调度 goroutine 和 OS 线程（G 与 M）。
9. 然后可以开始执行用户态 `main.main` 函数（如果是库则不需要再执行 `main.main` 函数了）。
10. 当用户态 `main.main` 结束执行后，处理其他 goroutine panic 但 `main.main` 正好同时返回会丢失回溯信息的情况，处理完毕后，程序正式退出。

## `pkg.init` 顺序

从主 goroutine 的实现方式中我们可以看到官方内存模型文档中宣称的 
`main.init` **happens before** `main.main` 本质上是通过 channel `main_init_done` 实现的。

而运行时的 `runtime_init` 则由编译器将多个 `runtime.init` 进行链接：

```go
//go:linkname runtime_init runtime.init
func runtime_init()
```

运行时存在多个 init 函数，其中包括：

1. CPU AVXmemmove 的支持情况，不过这部分代码已经准备弃用了。

	```go
	// runtime/runtime2.go

	var (
		// 有关可用的 cpu 功能的信息。
		// 在 runtime.cpuinit 中启动时设置。
		// 运行时之外的包不应使用这些包因为它们不是外部 api。
		// 启动时在 asm_{386,amd64,amd64p32}.s 中设置
		processorVersionInfo uint32
		isIntel              bool
		lfenceBeforeRdtsc    bool
	)

	// runtime/cpuflags_amd64.go
	var useAVXmemmove bool

	func init() {
		// Let's remove stepping and reserved fields
		processor := processorVersionInfo & 0x0FFF3FF0

		isIntelBridgeFamily := isIntel &&
			processor == 0x206A0 ||
			processor == 0x206D0 ||
			processor == 0x306A0 ||
			processor == 0x306E0

		useAVXmemmove = cpu.X86.HasAVX && !isIntelBridgeFamily
	}
	```

2. GC work 参数检查：

	```go
	// runtime/mgcwork.go

	const (
		_WorkbufSize = 2048 // 单位为字节; 值越大，争用越少

		// workbufAlloc 是一次为新的 workbuf 分配的字节数。
		// 必须是 pageSize 的倍数，并且应该是 _WorkbufSize 的倍数。
		//
		// 较大的值会减少 workbuf 分配开销。较小的值可减少堆碎片。
		workbufAlloc = 32 << 10
	)

	func init() {
		if workbufAlloc%pageSize != 0 || workbufAlloc%_WorkbufSize != 0 {
			throw("bad workbufAlloc")
		}
	}
	```

	以及启用强制 GC：

	```go
	// 启动 forcegc helper goroutine
	func init() {
		go forcegchelper()
	}
	```


3. 内存统计功能的参数验证：

   ```go
	// runtime/mstats.go

	var sizeof_C_MStats = unsafe.Offsetof(memstats.by_size) + 61*unsafe.Sizeof(memstats.by_size[0])

	func init() {
		var memStats MemStats
		if sizeof_C_MStats != unsafe.Sizeof(memStats) {
			println(sizeof_C_MStats, unsafe.Sizeof(memStats))
			throw("MStats vs MemStatsType size mismatch")
		}
	
		if unsafe.Offsetof(memstats.heap_live)%8 != 0 {
			println(unsafe.Offsetof(memstats.heap_live))
			throw("memstats.heap_live not aligned to 8 bytes")
		}
	}
   ```

4. 确定 `defer` 类型：

   ```go
	// runtime/panic.go

	var deferType *_type // _defer 结构的类型
	
	func init() {
		var x interface{}
		x = (*_defer)(nil)
		deferType = (*(**ptrtype)(unsafe.Pointer(&x))).elem
	}
   ```

本节中我们不对这些方法做详细分析，等到他们各自的章节中再做详谈。

那么还会有几个疑问：

1. 编译器做了什么事情？
2. 包含多个 init 的执行顺序怎样由编译器控制的？

我们可以验证下面这两个不同的程序：

```go
package main

import (
	"fmt"
	_ "net/http"
)

func main() {
	fmt.Printf("hello, %s", "world!")
}
```

```go
package main

import (
	_ "net/http"
	"fmt"
)

func main() {
	fmt.Printf("hello, %s", "world!")
}
```

他们的唯一区别就是导入包的顺序不同，通过 `go tool objdump -s "main.init"` 可以获得 init 函数的实际汇编代码：

```asm
TEXT main.init.0(SB) /Users/changkun/dev/go-under-the-hood/demo/3-main/main1.go
  main1.go:8		0x11f0f40		65488b0c2530000000	MOVQ GS:0x30, CX
  (...)		
  main1.go:9		0x11f0f76		e8a5b8e3ff		CALL runtime.printstring(SB)
  (...)

TEXT main.init(SB) <autogenerated>
  (...)	
  <autogenerated>:1	0x11f10a8		e8e3b0ebff		CALL fmt.init(SB)
  <autogenerated>:1	0x11f10ad		e88e5affff		CALL net/http.init(SB)
  <autogenerated>:1	0x11f10b2		e889feffff		CALL main.init.0(SB)
  (...)
```

```asm
TEXT main.init.0(SB) /Users/changkun/dev/go-under-the-hood/demo/3-main/main2.go
  (...)
  main2.go:10		0x11f0f76		e8a5b8e3ff		CALL runtime.printstring(SB)
  (...)

TEXT main.init(SB) <autogenerated>
  <autogenerated>:1	0x11f1060		65488b0c2530000000	MOVQ GS:0x30, CX
  (...)
  <autogenerated>:1	0x11f10a8		e8935affff		CALL net/http.init(SB)
  <autogenerated>:1	0x11f10ad		e81e40ecff		CALL fmt.init(SB)
  <autogenerated>:1	0x11f10b2		e889feffff		CALL main.init.0(SB)
  (...)
```

从实际的汇编代码可以看到，init 的顺序由实际包调用顺序给出，所有引入的外部包的 init 均会被
编译器安插在当前包的 `main.init.0` 之前执行，而外部包的顺序与引入包的顺序有关。

那么某个包内的多个 init 函数是否有顺序可言？从目前版本的源码来看是没有的。
我们简单看一看编译器关于 init 函数的实现：

```go
// cmd/compile/internal/gc/init.go

// 命名为 init 的函数是一个特殊情况
// 它由 main 函数运行前的初始化阶段完成调用。
// 为了使它在一个包内变得唯一，且不能被调用，将其名字 `pkg.init` 重命名为 `pkg.init.0`
var renameinitgen int

func renameinit() *types.Sym {
	s := lookupN("init.", renameinitgen)
	renameinitgen++
	return s
}
```

`renameinit` 这个函数中实现了对 init 函数的重命名，并通过 `renameinitgen` 在全局记录了 init 的索引后缀。
`renameinit` 会在处理函数声明时被调用：

```go
// cmd/compile/internal/gc/noder.go

func (p *noder) funcDecl(fun *syntax.FuncDecl) *Node {
	name := p.name(fun.Name)
	t := p.signature(fun.Recv, fun.Type)
	f := p.nod(fun, ODCLFUNC, nil, nil)

	// 函数没有 reciver
	if fun.Recv == nil {
		// 且名字叫做 init
		if name.Name == "init" {
			name = renameinit() // 对其进行重命名
			(...)
		}
	(...)
	}
	(...)
}
```

而 `funcDecl` 则会在 AST 的 `noder` 结构的方法 `decls` 中被调用：

```go
func (p *noder) decls(decls []syntax.Decl) (l []*Node) {
	var cs constState

	for _, decl := range decls {
		p.lineno(decl)
		switch decl := decl.(type) {

		(...)

		case *syntax.FuncDecl:
			l = append(l, p.funcDecl(decl))

		default:
			panic("unhandled Decl")
		}
	}

	return
}
```

可以看到，`noder.funcDecl` 的调用通过 `for range` 语句来完成，这是没有顺序保证的。
换句话说，不同的包之间的 init 调用顺序是依靠包的导入顺序，但一个包内的 init 函数的调用顺序
并没有确定的顺序的保障。

## 何去何从？

看到这里我们已经结束了整个 Go 程序的执行，但仍有海量的细节还没有被敲定，完全还没有深入
运行时的三大核心组件，运行时各类机制也都还没有接触。总结一下这节讨论中遗留下来的问题：

1. `runtime·mstart` 会如何将主 goroutine 调度执行？
2. 系统监控做了什么事情，它的工作原理是什么？
3. `runtime.init` 的 `gchelper` 是什么？`gcenable` 又做了什么？
4. `lockOSThread/unlockOSThread` 具体做了什么事情？他们到底有多重要？
5. `cgo` 中如果是 C 调用 Go 代码，会发生什么事情？为什么需要模板线程？
6. `cgo` 中如果是 Go 调用 C 代码，那么 `cgocall` 究竟在做什么？

我们在随后的章节中一一研究。

## 进一步阅读的参考文献

1. [Command compile](https://golang.org/cmd/compile/)
2. [The Go Memory Model](https://golang.org/ref/mem)
3. [`main_init_done` can be implemented more efficiently](https://github.com/golang/go/issues/15943)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)