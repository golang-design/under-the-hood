# 8 runtime.LockOSThread

我们已经知道了 `runtime.lockOSThread` 会将当前 goroutine 锁在主 OS 线程上。
运行时导出了这个方法，允许用户态也能调用 `runtime.LockOSThread`。但导出的方法与运行时自用方法略有不同，
本节一起来研究一下。

## 公开方法 `runtime.LockOSThread/UnlockOSThread`

TODO:

## 私有方法 `runtime.lockOSThread/unlockOSThread`

TODO:

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)