---
weight: 4211
title: "13.11 过去、现在与未来"
---

# 13.11 过去、现在与未来

Go 的垃圾回收器，是这门语言里被打磨得最久、进步最显著的子系统之一。从早期动辄数百毫秒的停顿，
到今天稳定的亚毫秒，这条演进线是一部"为低延迟不懈努力"的工程史。这一节把它串起来,理解了
来路，才看得清去向。

## 13.11.1 过去：从数百毫秒到亚毫秒

- **Go 1.0–1.4**：朴素的**stop-the-world 标记清扫**。每次 GC 暂停整个程序，停顿随堆增大而增大，
  动辄数十到数百毫秒,对延迟敏感的服务是硬伤。
- **Go 1.5（2015）**：里程碑。引入**并发标记清扫**（[13.1](./basic.md)），标记与清扫大部分与用户
  程序并发，停顿目标降到约 10ms。这是 Go GC 转向低延迟的起点（Rick Hudson 的工作）。
- **Go 1.6–1.7**：持续优化，停顿进一步降到毫秒级。
- **Go 1.8（2017）**：**混合写屏障**（[13.2](./barrier.md)），消除了标记末尾的 STW 重扫栈，停顿
  跌到**亚毫秒**,这是又一关键跃迁。
- **Go 1.18（2022）**：**调步器重写**（[13.3](./pacing.md)），让 GC 触发更稳健、对各种负载更鲁棒。
- **Go 1.19（2022）**：**软内存上限 `GOMEMLIMIT`**（[12.7](../ch12alloc/pagealloc.md)），让 GC
  能配合固定内存配额工作，解决容器场景的 OOM 痛点。

短短几年，停顿从数百毫秒降到亚毫秒、降幅逾百倍,且这一切对用户代码**完全透明**，重新编译即享。

## 13.11.2 现在与未来：Green Tea GC

最新的方向是 go1.25/1.26 引入的 **Green Tea GC**(以 `GOEXPERIMENT=greenteagc` 形式推出、
逐步走向默认)。它的着眼点是**内存局部性**：传统标记按对象图的指针四处跳，缓存命中差;Green Tea
改为以 **span / 页为粒度**组织扫描,把同一块内存里的对象成批处理，让标记的内存访问更顺序、更
缓存友好，从而在多核与大堆上提升回收效率。它呼应了 ROC（[13.9](./roc.md)）与分代讨论
（[13.8](./generational.md)）里"利用结构与局部性"的思路，但绕开了那些方案的高昂写屏障代价,
转而从扫描的内存访问模式上做文章。Green Tea 也与分配器（[12.9](../ch12alloc/history.md)）协同
演进，因为"成块扫描"要求对象以利于此的方式被分配。

## 13.11.3 一条不变的主线

回看整条演进线，会发现 Go GC 的每一步都服务于同一个目标：**在不牺牲正确性、不打扰用户代码的
前提下，把停顿压得更低、把效率提得更高**。并发化降停顿、混合屏障消重扫、调步器稳节奏、软上限
控内存、Green Tea 改局部性,手段在变，目标始终是那个"低延迟优先"的初心
（[13.1](./basic.md)）。这条线也展示了 Go 团队的工作方式：**以真实负载为度量、以透明升级为
准则、敢于推倒重写（屏障、调步器）、也敢于放弃走不通的实验（ROC）**。垃圾回收远未"完成",
但它已经从 Go 早期的短板，变成了今天的招牌。这部仍在书写的演进史，本身就是观察系统软件如何
在约束中持续进化的最佳教材。

## 延伸阅读的文献

1. Rick Hudson. *Getting to Go: The Journey of Go's Garbage Collector.* ISMM 2018.
   https://go.dev/blog/ismmkeynote
2. The Go Authors. *A Guide to the Go Garbage Collector.* https://go.dev/doc/gc-guide
3. Austin Clements. *Go 1.5 concurrent GC* / *Go 1.8 hybrid barrier* 设计文档.
   https://go.dev/issue/17503
4. The Go Team. *Green Tea GC 设计与讨论*（go1.25/1.26）.
   https://github.com/golang/go/issues/73581

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
