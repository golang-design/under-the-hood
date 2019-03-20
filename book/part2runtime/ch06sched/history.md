# 调度器: 过去、现在与未来

[TOC]

## 演进史

## 改进展望

### 非均匀访存感知的调度器设计

目前的调度器设计总是假设 M 到 P 的访问速度是一样的，即不同的 CPU 核心访问多级缓存、内存的速度一致。
但真实情况是，假设我们有一个田字形排布的四个物理核心：

```
           L2 ------------+
           |              |
        +--+--+           |
       L1     L1          |
       |       |          |
    +------+------+       |
    | CPU1 | CPU2 |       |
    +------+------+       L3
    | CPU3 | CPU4 |       |
    +------+------+       |
       |       |          |
      L1      L1          |
        +--+--+           |
           |              |
           L2-------------+
```


那么左上角 CPU1 访问 CPU 2 的 L1 缓存，要远比访问 CPU3 或 CPU 4 的 L1 缓存，**在物理上**，快得多。
这也就是我们所说的 NUMA（non-uniform memory access，非均匀访存）架构。

针对这一点，Go 官方已经提出了具体的调度器设计，但由于工作量巨大，甚至没有提上日程。

TODO: 介绍设计

## 总结

TODO:

[返回目录](./readme.md) | [上一节](./sync.md) | 下一节

## 进一步阅读的参考文献

- [VYUKOV, 2014] [Vyukov, Dmitry. NUMA-aware scheduler for Go. 2014](https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)

