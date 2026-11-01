---
weight: 4200
title: "第 13 章 垃圾回收器"
bookCollapseSection: true
---

# 第 13 章 垃圾回收器

- [13.1 垃圾回收的基本想法](./basic.md)
- [13.2 写屏障技术](./barrier.md)
- [13.3 触发频率及其调步算法](./pacing.md)
- [13.4 扫描标记与标记辅助](./mark.md)
- [13.5 清扫与位图](./sweep.md)
- [13.6 标记终止阶段](./termination.md)
- [13.7 安全点分析](./safe.md)
- [13.8 分代假设与代际回收](./generational.md)
- [13.9 请求假设与事务制导回收](./roc.md)
- [13.10 终结器](./finalizer.md)
- [13.11 Green Tea：面向局部性的标记](./greentea.md)
- [13.12 过去、现在与未来](./history.md)
- [13.13 垃圾回收统一理论](./unifiedgc.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
什么时候最适合做垃圾回收？没有人在看的时候。用摄像头追踪眼球的运动，
受试者的目光一离开屏幕，就执行垃圾回收。
</I></br>
<I>
When is the best time to do a GC? When nobody is looking. Using camera
to track eye movement when subject looks away do a GC.
</I></br>
<div class="quote-right">
-- Rick Hudson, "Go GC: Latency Problem Solved", 2015
</div>
</div>

Hudson 在 GopherCon 2015 的演讲中，紧接着「回收延迟是首要障碍」一页提出了这个问题。玩笑之后的两页给出了
另外两种办法：一是弹出一个等待网络的图标，二是以吞吐量换取更低的回收延迟。Go 1.5 选择的正是最后一种：
回收器与程序并发运行，占用一部分 CPU 时间，以换取更短的停顿（[13.12.2](./history.md)）。
此后十年，回收器的演进大体围绕同一个问题展开：在停顿、CPU 开销与内存占用之间，怎样取得更好的平衡。

本章讨论 Go 的回收器如何实现这一取舍。[13.1](./basic.md) 介绍可达性、标记清扫与三色抽象，以及 Go
在各类回收器中的定位；[13.2](./barrier.md) 讨论并发标记所需的写屏障，以及 Go 采用的混合写屏障。[13.3](./pacing.md)
至 [13.7](./safe.md) 依次讨论一轮回收的各个环节：调步器如何依据 `GOGC`
与软内存限制决定何时启动回收，标记工作者与标记辅助如何分担标记的工作，清扫如何回收死去的对象，
标记终止阶段如何判断标记已经完成，以及回收器如何借助栈映射找到栈上的指针。[13.8](./generational.md)
与 [13.9](./roc.md) 讨论两种尝试过而未被采用的方案，即分代回收与请求制导回收；[13.10](./finalizer.md)
讨论终结器、清理函数与弱指针；[13.11](./greentea.md) 讨论 Go 1.26 起默认启用的 Green Tea。[13.12](./history.md)
按时间回顾回收器的演进，[13.13](./unifiedgc.md) 以追踪与引用计数的统一理论回看
Go 的回收器。对象如何分配见[第 12 章](../ch12alloc/readme.md)。
