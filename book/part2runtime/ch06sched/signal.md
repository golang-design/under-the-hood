# 信号处理

我们已经知道了 Go 运行时调度已 goroutine 的方式调度了所有用户态代码。
每个 goroutine 都有可能在不同的线程上重新被执行。那么如果用户态的某个
goroutine 需要接收系统信号，如何才能确保某个线程的信号能够正确的发送到
可能在其他线程上执行的监听信号的 goroutine 呢？

本节我们讨论调度器里涉及的 signal 信号处理机制。

### Signal G

TODO: 解释 signal mask

```go
// 初始化一个新的 m （包括引导阶段的 m）
// 在一个新的线程上调用，不分配内存
func minit() {
	// The alternate signal stack is buggy on arm and arm64.
	// The signal handler handles it directly.
	if GOARCH != "arm" && GOARCH != "arm64" {
		minitSignalStack()
	}
	minitSignalMask()
}
```

### Extra M

TODO: 解释 extra m

```go
// mstartm0 实现了一部分 mstart1，只运行在 m0 上
//
// 允许 write barrier，因为我们知道 GC 此时还不能运行，因此他们没有 op。
//
//go:yeswritebarrierrec
func mstartm0() {
	// 创建一个额外的 M 服务 non-Go 线程（cgo 调用中产生的线程）的回调，并且只创建一个
	// windows 上也需要额外 M 来服务 syscall.NewCallback 产生的回调，见 issue #6751
	if (iscgo || GOOS == "windows") && !cgoHasExtraM {
		cgoHasExtraM = true
		newextram()
	}
	initsig(false)
}
// newextram 分配一个 m 并将其放入 extra 列表中
// 它会被工作中的本地 m 调用，因此它能够做一些调用 schedlock 和 allocate 类似的事情。
func newextram() {
	c := atomic.Xchg(&extraMWaiters, 0)
	if c > 0 {
		for i := uint32(0); i < c; i++ {
			oneNewExtraM()
		}
	} else {
		// 确保至少有一个额外的 M
		mp := lockextra(true)
		unlockextra(mp)
		if mp == nil {
			oneNewExtraM()
		}
	}
}
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)