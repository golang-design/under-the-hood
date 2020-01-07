---
weight: 1400
title: "第 4 章 内存管理工程"
---

# 第 4 章 内存管理工程

- [4.1 内存分配器](./alloc.md)
- [4.2 标记清扫法与三色抽象](./cms.md)
- [4.3 屏障技术](./barrier.md)
    + 三色不变性原理
      + 强、弱不变性
      + 赋值器的颜色
      + 新分配对象的颜色
    + 赋值器屏障技术
      + 灰色赋值器的 Dijkstra 插入屏障
      + 黑色赋值器的 Yuasa 删除屏障
    + 进一步阅读的参考文献
- [4.4 垃圾回收统一理论](./unifiedgc.md)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
