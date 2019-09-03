# 第八章 垃圾回收器

- [8.1 基本知识](./basic.md)
    + 并发三色回收一瞥
    + 原始的标记清扫算法
    + 内存模型
    + 进一步阅读的参考文献
- [8.2 混合写屏障技术](./barrier.md)
    + 基本思想
    + 可靠性、完备性和有界性的证明
    + 实现细节
    + 总结
    + 进一步阅读的参考文献
- [8.3 并发标记清扫](./concurrent.md)
    + 并发标记
    + 并发清扫
    + 并行三色标记
    + 进一步阅读的参考文献
- [8.4 初始化](./init.md)
    + 引导阶段的 GC 初始化
    + GC 的后台工作
- [8.5 触发机制与调步算法](./pacing.md)
    + GC 的调控方式
    + 调步算法的设计
    + 实现
- [8.6 GC 周期概述](./cycle.md)
    + GC 周期的不同阶段
    + STW 的启动
    + STW 的结束
    + GC 的启动
    + 标记准备阶段
- [8.7 扫描标记阶段](./mark.md)
- [8.8 标记终止阶段](./termination.md)
- [8.9 内存清扫阶段](./sweep.md)
- [9.10 内存归还阶段](./scavenge.md)
- [8.11 过去、现在与未来](./history.md)
- [8.12 用户层 APIs](./finalizer.md)
    + 存活与终结
      + SetFinalizer
      + KeepAlive

垃圾回收是一个相当困难且复杂的系统工程。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)