# 第十六章 sync 与 atomic 包

- [16.1 `sync.Pool`](./pool.md)
    + 底层结构
    + Get
    + Put
    + 偷取细节
      + pin 和 pinSlow
      + getSlow
    + 缓存的回收
    + poolChain
      + poolChain 的 popHead, pushHead 和 popTail
      + poolDequeue 的 popHead, pushHead popTail
    + noCopy
    + 总结
    + 进一步阅读的参考文献
- [16.2 `sync.Once`](./once.md)
- [16.3 `sync.Map`](./map.md)
    + 结构
    + Store
    + Load
    + Delete
    + Range
    + LoadOrStore
    + 总结
- [16.4 `sync.WaitGroup`](./waitgroup.md)
    + 结构
    + Add/Done
    + Wait
- [16.5 `sync.Mutex`](./mutex.md)
- [16.6 `sync.Cond`](./cond.md)
    + 结构
    + copyChecker
    + Wait/Signal/Broadcast
    + notifyList
- [16.7 `sync/atomic.*`](./atomic.md)
    + 公共包方法
      + atomic.Value
      + atomic.CompareAndSwapPointer
    + 运行时实现
    + 原子操作的内存模型
    + 进一步阅读的参考文献

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
