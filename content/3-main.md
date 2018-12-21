# 3 主 goroutine 生命周期

本文涉及的 Go 源码包括以下文件：

```
src/runtime/proc.go
```

`runtime·schedinit` 完成初始化工作后并不会立即执行 `runtime·main`（即主 goroutine 运行的地方）。
相反，会在后续的 `runtime·mstart` 调用中被调度器调度执行。

```c
	// create a new goroutine to start program
	PUSHL	$runtime·mainPC(SB)	// entry
	PUSHL	$0	// arg size
	CALL	runtime·newproc(SB)
	POPL	AX
	POPL	AX

	// start this M
	CALL	runtime·mstart(SB)
```

这个过程中，只会将 `runtime·main` 的入口地址压栈，进而将其传递给 `newproc` 进行使用，
而后 `runtime·newproc` 完成 G 的创建保存到 G 的运行现场中，因此真正执行会
等到 `runtime·mstart` 后才会被调度执行，我们在 [5 调度器: 执行调度](5-sched/exec.md) 中讨论。

`runtime.main` 即为 runtime 包中的 main 函数。

```go
// 主 goroutine
func main() {
	g := getg()

	// race 检测有关，不关心
	g.m.g0.racectx = 0

	// 执行栈最大限制：1GB（64位系统）或者 250MB（32位系统）
	// 这里使用十进制而非二进制的 GB 和 MB 因为在栈溢出失败消息中好看一些
	if sys.PtrSize == 8 {
		maxstacksize = 1000000000
	} else {
		maxstacksize = 250000000
	}

	// 允许 newproc 启动新的 m，见 [5 调度器: 初始化]
	mainStarted = true

	if GOARCH != "wasm" { // 1.11 新引入的 web assembly, 目前 wasm 不支持线程，无系统监控

		// 启动系统后台监控（定期垃圾回收、并发任务调度）
		systemstack(func() {
			newm(sysmon, nil)
		})

	}

	// 将主 goroutine 锁在主 OS 线程下进行初始化工作
	// 大部分程序并不关心这一点，但是有一些图形库（基本上属于 cgo 调用）
	// 会要求在主线程下进行初始化工作。
	// 即便是在 main.main 下仍然可以通过公共方法 runtime.LockOSThread
	// 来强制将一些特殊的需要主 OS 线程的调用锁在主 OS 线程下执行初始化
	lockOSThread()

	if g.m != &m0 {
		throw("runtime.main not on m0")
	}

	// 执行 runtime.init
	// 实际上只做一件事情，启动 gchelper goroutine
	runtime_init() // defer 必须在此调用结束后才能使用
	if nanotime() == 0 {
		throw("nanotime returning zero")
	}

	// defer unlock，从而在 init 期间 runtime.Goexit 来 unlock
	needUnlock := true
	defer func() {
		if needUnlock {
			unlockOSThread()
		}
	}()

	// 记录程序的启动时间，必须在 runtime.init 之后调用
	// 因为 nanotime 在某些平台上依赖于 startNano。
	runtimeInitTime = nanotime()

	// 启动垃圾回收器后台操作
	gcenable()

	main_init_done = make(chan bool)
	if iscgo {
		if _cgo_thread_start == nil {
			throw("_cgo_thread_start missing")
		}
		if GOOS != "windows" {
			if _cgo_setenv == nil {
				throw("_cgo_setenv missing")
			}
			if _cgo_unsetenv == nil {
				throw("_cgo_unsetenv missing")
			}
		}
		if _cgo_notify_runtime_init_done == nil {
			throw("_cgo_notify_runtime_init_done missing")
		}
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

整个执行过程分这样几个步骤：

1. `systemstack` 会运行 `newm(sysmon, nil)` 启动后台监控，`wasm` 上不会启动
2. `lockOSThread` 初始化阶段将主 goroutine 锁定在主 OS 线程上，原因在于某些特殊的调用（尤其是一些[图形库](https://github.com/golang/go/wiki/LockOSThread)，Cocoa, OpenGL 等会使用本地线程状态）需要主线程的支持。用户层可以通过 `runtime.LockOSThread` 来绑定当前的线程（由于调度器的影响，不一定会是主线程）
3. `runtime_init` 运行时初始化，启动 gchelper goroutine
4. `gcenable` 启用 GC
5. 如果是 `cgo` 则还会额外启动一个模板线程，来处理 C 创建的线程进入 Go 的情况
6. `cgocall` 从 Go 调用 C
7. 开始执行用户态 `main.init` 函数（所有的 `main.init` 均在同一个 `goroutine` （主）中执行）
8. 当用户态的 `main.init` 执行完毕后，`unlockOSThread` 来取消主 goroutine 与 OS 线程的绑定，从而让调度器能够灵活调度 goroutine 和 OS 线程（G 与 M）。
9. 然后可以开始执行用户态 `main.main` 函数（如果是库则不需要再执行 `main.main` 函数了）。
10. 当用户态 `main.main` 结束执行后，处理其他 goroutine panic 但 `main.main` 正好同时返回会丢失回溯信息的情况，处理完毕后，程序正式退出。

值得一提的是，从主 goroutine 的实现方式中我们可以看到官方内存模型文档中宣称的 
`main.init` **happens before** `main.main` 本质上是通过 channel `main_init_done` 实现的。

那么还会有几个疑问：

1. 编译器做了什么事情？
2. 包含多个 init 的执行顺序怎样由编译器控制的？

## `xxxx.init` 调用顺序

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

## Where to go?

看到这里我们已经结束了整个 Go 程序的执行，但非常多的细节还没有被敲定，完全还没有深入
运行时的三大核心组件，总结一下这节讨论中遗留下来的问题：

1. `runtime·mstart` 会如何将主 goroutine 调度执行？
2. 系统监控做了什么事情，它的工作原理是什么？
3. `runtime.init` 的 `gchelper` 是什么？
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