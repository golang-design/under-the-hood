---
weight: 4100
title: "第 15 章 同步模式"
---

# 第 15 章 同步模式

- [15.1 原子操作](./atomic.md)
- [15.2 互斥锁](./mutex.md)
- [15.3 条件变量](./cond.md)
- [15.4 同步组](./waitgroup.md)
- [15.5 缓存池](./pool.md)
- [15.6 并发安全散列表](./map.md)
- [15.7 上下文](./context.md)
- [15.8 内存模型](./mem.md)

> _The fact that the construction can be defined in terms of simpler underlying primitives is a useful guarantee that its inclusion is logically consistent with the remainder of the language._
>
> -- C.A.R. Hoare

在现代编程语言中，多线程间的同步通常采用互斥、信号量等传统共享内存的手段。Go 语言在
同步原语（Primitive）的选择上与大多数语言不同，基于 Channel 和 Select 消息通信式同步是该语言
本身真正意义上的同步原语。进而「传统意义」上的原子、互斥、条件变量、线程本地资源等
概念在 Go 语言中蜕变为用户态的同步模式（Pattern），形成了语言独有的特色。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
