# 第六章 调度器

- [6.1 基本结构](./basic.md)
- [6.2 调度器初始化](./init.md)
- [6.3 调度循环](./exec.md)
- [6.4 系统监控](./sysmon.md)
- [6.5 线程管理](./thread.md)
- [6.6 信号处理机制](./signal.md)
- [6.7 执行栈管理](./stack.md)
- [6.8 协作与抢占](./preemptive.md)
- [6.9 同步机制](./sync.md)
- [6.10 过去、现在与未来](./history.md)

> _Simplicity is complicated._ 
>
> -- Rob Pike

Go 语言的调度器是笔者眼中整个运行时最迷人的组件了。
它的设计和实现直接牵动了整个 Go 运行时的其他组件，是与用户态代码直接打交道的部分。
为了保证高性能，调度器必须有效的利用计算的并行性和局部性原理；为了保证用户态的简洁，
调度器必须高效的对调度用户态不可见的网络轮训器、垃圾回收器进行调度；为了保证代码
执行的正确性，还必须严格的的实现用户态代码的内存顺序等等。
总而言之，调度器的设计直接决定了 Go 运行时源码的表现形式。

[返回目录](../../../readme.md) | [阅读本章](./basic.md)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
