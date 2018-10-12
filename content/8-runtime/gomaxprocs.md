# 8 runtime.GOMAXPROCS

我们已经在 [5 调度器: 初始化](../5-sched/init.md) 中讨论过 `runtime.procresize` 调用的作用了。
我们知道在大部分的时间里，P 的数量是不会被动态调整的。

但是我们已经知道 `runtime.GOMAXPROCS` 能够在运行时动态调整 P 的数量，我们就来看看
这个调用会做什么事情。

它的代码非常简单：

```go
// GOMAXPROCS 设置能够同时执行线程的最大 CPU 数，并返回原先的设定。
// 如果 n < 1，则他不会进行任何修改。
// 机器上的逻辑 CPU 的个数可以从 NumCPU 调用上获取。
// 该调用会在调度器进行改进后被移除。
func GOMAXPROCS(n int) int {
	if GOARCH == "wasm" && n > 1 {
		n = 1 // WebAssembly 还没有线程支持，只能设置一个 CPU。
	}

	// 当调整 P 的数量时，调度器会被锁住
	lock(&sched.lock)
	ret := int(gomaxprocs)
	unlock(&sched.lock)

	// 返回原有设置
	if n <= 0 || n == ret {
		return ret
	}

	// 停止一切事物，将 STW 的原因设置为 P 被调整
	stopTheWorld("GOMAXPROCS")

	// STW 后，修改 P 的数量
	newprocs = int32(n)

	// 重新恢复
	// 在这个过程中，startTheWorld 会调用 procresize 进而动态的调整 P 的数量
	startTheWorld()
	return ret
}
```

可以看到，`GOMAXPROCS` 从一出生似乎就被判了死刑，官方的注释已经明确的说明了这个调用
在后续改进调度器后会被移除。

它的过程也非常简单粗暴，调用他必须付出 STW 这种极大的代价。
当 P 被调整为小于 1 或与原有值相同时候，不会产生任何效果，例如：

```go
runtime.GOMAXPROCS(runtime.GOMAXPROCS(0))
```

我们已经在调度器和垃圾回收器中已经详细讨论过 `procresize`、 `stopTheWorld` 和 `startTheWorld` 了，这里就不再赘述了。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)