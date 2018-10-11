# 2 初始化概览

本节简单讨论程序初始化工作，即 `runtime.schedinit`。

```go
// 启动顺序
//
//	调用 osinit
//	调用 schedinit
//	make & queue new G
//	调用 runtime·mstart
//
// 创建 G 的调用 runtime·main.
func schedinit() {
	_g_ := getg()

	// 不重要，race 检查有关
	// raceinit must be the first call to race detector.
	// In particular, it must be done before mallocinit below calls racemapshadow.
	if raceenabled {
		_g_.racectx, raceprocctx0 = raceinit()
	}

	// 最大系统线程数量（即 M），参考标准库 runtime/debug.SetMaxThreads
	sched.maxmcount = 10000

	// 不重要，与 trace 有关
	tracebackinit()
	moduledataverify()

	// 栈、内存分配器、调度器相关初始化。
	// 栈初始化，复用管理链表
	stackinit()
	// 内存分配器初始化
	mallocinit()
	// 初始化当前 M
	mcommoninit(_g_.m)

	// cpu 相关的初始化
	cpuinit() // 必须在 alginit 之前运行
	alginit() // maps 不能在此调用之前使用，从 CPU 指令集初始化哈希算法

	// 模块加载相关的初始化
	modulesinit()   // 模块链接，提供 activeModules
	typelinksinit() // 使用 maps, activeModules
	itabsinit()     // 使用 activeModules

	msigsave(_g_.m)
	initSigmask = _g_.m.sigmask

	// 处理命令行参数和环境变量
	goargs()
	goenvs()

	// 处理 GODEBUG、GOTRACEBACK 调试相关的环境变量设置
	parsedebugvars()

	// 垃圾回收器初始化
	gcinit()

	sched.lastpoll = uint64(nanotime())

	// 通过 CPU 核心数和 GOMAXPROCS 环境变量确定 P 的数量
	procs := ncpu
	if n, ok := atoi32(gogetenv("GOMAXPROCS")); ok && n > 0 {
		procs = n
	}

	// 调整 P 的数量
	// 这时所有 P 均为新建的 P，因此不能返回有本地任务的 P
	if procresize(procs) != nil {
		throw("unknown runnable goroutine during bootstrap")
	}

	// 不重要，调试相关
	// For cgocheck > 1, we turn on the write barrier at all times
	// and check all pointer writes. We can't do this until after
	// procresize because the write barrier needs a P.
	if debug.cgocheck > 1 {
		writeBarrier.cgo = true
		writeBarrier.enabled = true
		for _, p := range allp {
			p.wbBuf.reset()
		}
	}

	if buildVersion == "" {
		// 该条件永远不会被触发，此处只是为了确保 buildVersion 不会被编译器优化移除掉。
		buildVersion = "unknown"
	}
}
```

我们来收紧一下这个函数中的关注点：

首先 `sched` 会获取 G，通过 `stackinit()` 初始化程序栈、`mallocinit()` 初始化
内存分配器、通过 `mcommoninit()` 对 M 进行初步的初始化（真正的初始化会在 M 开始运行时进行，在 [5 调度器：执行调度](5-sched/exec.md) 讨论）。
然后初始化一些与 CPU 相关的值，获取 CPU 指令集相关支持，然后通过 `alginit()` 来根据
所提供的 CPU 指令集，进而初始化 hash 算法，用于 map 结构。再接下来初始化一些与模块加载
相关的内容、保存 M 的 signal mask，处理入口参数和环境变量。
再初始化垃圾回收器涉及的数据。根据 CPU 的参数信息，初始化对应的 P 数，再调用 
`procresize()` 来动态的调整 P 的个数，只不过这个时候（引导阶段）所有的 P 都是新建的。

即我们感兴趣但仍为涉及的调用包括：

- 栈初始化 `stackinit()`
- 内存分配器初始化 `mallocinit()`
- M 初始化 `mcommoninit()`
- 垃圾回收器初始化 `gcinit()`
- P 初始化 `procresize()`

注意，`schedinit` 函数名表面上是调度器的初始化，但实际上它包含了所有核心组件的初始化工作。
具体内容我们留到对应组件中进行讨论，我们在下一节中着先着重讨论当一切都初始化好后，程序的正式启动过程。

## 总结

初始化工作是整个运行时最关键的基础步骤之一。在 `schedinit` 这个函数中，我们已经看到了它
将完成栈、内存分配器、调度器、垃圾回收器、模块加载、运行时算法等初始化工作。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
