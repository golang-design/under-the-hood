# 3 主 goroutine 生命周期

`runtime·schedinit` 完成初始化工作后并不会立即执行 `runtime·main`（即主 goroutine 运行的地方）。

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

这个过程中，只会将 `runtime·main` 的入口地址压入栈中，将其传递给 `newproc` 进行使用，而后 `runtime·newproc` 将执行地址出栈存放到 AX 寄存器，因此真正执行会等到 `runtime·mstart` 后才会被调度执行（之后再详细讨论）。

`runtime.main` 即为 runtime 包中的 main 函数。

```go
// The main goroutine.
func main() {
	g := getg()

	// Racectx of m0->g0 is used only as the parent of the main goroutine.
	// It must not be used for anything else.
	g.m.g0.racectx = 0

	// 执行栈最大限制：1GB（64位系统）或者 250MB（32位系统）
	// Max stack size is 1 GB on 64-bit, 250 MB on 32-bit.
	// Using decimal instead of binary GB and MB because
	// they look nicer in the stack overflow failure message.
	if sys.PtrSize == 8 {
		maxstacksize = 1000000000
	} else {
		maxstacksize = 250000000
	}

	// Allow newproc to start new Ms.
	mainStarted = true

	if GOARCH != "wasm" { // no threads on wasm yet, so no sysmon
		// 启动系统后台监控（定期垃圾回收、并发任务调度）
		systemstack(func() {
			newm(sysmon, nil)
		})
	}

	// Lock the main goroutine onto this, the main OS thread,
	// during initialization. Most programs won't care, but a few
	// do require certain calls to be made by the main thread.
	// Those can arrange for main.main to run in the main thread
	// by calling runtime.LockOSThread during initialization
	// to preserve the lock.
	lockOSThread()

	if g.m != &m0 {
		throw("runtime.main not on m0")
	}

	// 执行 runtime 包所有初始化函数 init
	runtime_init() // must be before defer
	if nanotime() == 0 {
		throw("nanotime returning zero")
	}

	// Defer unlock so that runtime.Goexit during init does the unlock too.
	needUnlock := true
	defer func() {
		if needUnlock {
			unlockOSThread()
		}
	}()

	// Record when the world started. Must be after runtime_init
	// because nanotime on some platforms depends on startNano.
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
		startTemplateThread()
		cgocall(_cgo_notify_runtime_init_done, nil)
	}

	// 执行用户 main 包中的 init 函数
	fn := main_init // make an indirect call, as the linker doesn't know the address of the main package when laying down the runtime
	fn()
	close(main_init_done)

	needUnlock = false
	unlockOSThread()

	// 如果是库则不需要执行 main 函数了
	if isarchive || islibrary {
		// A program compiled with -buildmode=c-archive or c-shared
		// has a main, but it is not executed.
		return
	}

	// 执行用户 main 包中的 main 函数
	fn = main_main // make an indirect call, as the linker doesn't know the address of the main package when laying down the runtime
	fn()
	if raceenabled {
		racefini()
	}

	// Make racy client program work: if panicking on
	// another goroutine at the same time as main returns,
	// let the other goroutine finish printing the panic trace.
	// Once it does, it will exit. See issues 3934 and 20018.
	if atomic.Load(&runningPanicDefers) != 0 {
		// Running deferred functions should not take long.
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
	// http://golang.org/ref/spec#Terminating_statements + forced crashed (nil deref) if exit isn't implemented properly.
	// https://github.com/golang/go/commit/c81a0ed3c50606d1ada0fd9b571611b3687c90e1
	for {
		var x *int32
		*x = 0
	}
}
```

整个执行过程分这样几个步骤：

1. `systemstack` 会启动后台监控
2. `lockOSThread` 初始化阶段将主 goroutine 锁定在主 OS 线程上，原因在于某些特殊的调用（例如？）需要主线程的支持。用户层可以通过 `runtime.LockOSThread` 来绑定当前的线程（由于调度器的影响，不一定会是主线程）
3. `runtime_init` 运行时初始化
4. `gcenable` 启动 GC
5. 如果是 Cgo 则还会额外启动一个模板线程，来处理 Go 代码进入 C 创建的线程这种情况
6. `cgocall` 从 Go 调用 C
7. 开始执行用户态 init 函数（所有的 main_init 均在同一个 goroutine （主）中执行）
8. 当用户态的 init 执行完毕后，`unlockOSThread` 来取消主 goroutine 与 OS 线程的绑定，从而让调度器能够灵活调度 goroutine 和 OS 线程（G 与 M）。
9. 然后可以开始执行用户态 main 函数（如果是库则不需要再执行 main 函数了）。
10. 当用户态 main 结束执行后，程序会退出。

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

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | MIT &copy; [changkun](https://changkun.de)