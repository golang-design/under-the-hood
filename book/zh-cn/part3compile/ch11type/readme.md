---
weight: 3100
title: "第十一章 关键字与类型系统"
---

# 第十一章 关键字与类型系统

- [11.1 `go`](./go.md)
- [11.2 `defer`](./defer.md)
- [11.3 `panic` 与 `recover`](./panic.md)
    + gopanic 和 gorecover
    + 总结
- [11.4 `map`](./map.md)
- [11.5 `chan` 与 `select`](./chan.md)
    + channel 的本质
      + 基本使用
      + channel 的创生
      + 向 channel 发送数据
      + 从 channel 接收数据
      + channel 的死亡
    + select 的本质
      + 随机化分支
      + 发送数据的分支
      + 接收数据的分支
    + channel 的 lock-free 实现
    + 总结
    + 进一步阅读的参考文献
- [11.6 `interface{}`](./interface.md)
- [11.7 slice](./slice.md)
- [11.8 string](./string.md)
- [11.9 运行时类型系统与反射](./type.md)

> _The performance improvement does not materialize from the air, it 
comes with code complexity increase._
>
> -- Dmitry Vyukov

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)