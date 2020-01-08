---
weight: 2300
title: "第 8 章 垃圾回收器"
---

# 第 8 章 垃圾回收器

- [8.1 基本知识](./basic.md)
- [8.2 混合写屏障技术](./barrier.md)
- [8.3 并发标记清扫](./concurrent.md)
- [8.4 初始化](./init.md)
- [8.5 触发机制与调步算法](./pacing.md)
- [8.6 GC 周期概述](./cycle.md)
- [8.7 扫描标记与标记辅助](./mark.md)
- [8.8 标记终止阶段](./termination.md)
- [8.9 内存清扫阶段](./sweep.md)
- [8.10 用户层 APIs](./finalizer.md)
- [8.11 过去、现在与未来](./history.md)

垃圾回收是一个相当困难且复杂的系统工程。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)