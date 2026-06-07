---
weight: 4209
title: "13.9 请求假设与事务制导回收"
---

# 13.9 请求假设与事务制导回收

[13.8](./generational.md) 说 Go 没采用分代假设。那它有没有试过别的"对象寿命假设"？有,
**请求制导回收**（Request-Oriented Collector, ROC）。这是 Go 团队认真做过、最终放弃的一个
实验。讲它，不是因为它进了 Go，而是因为**一个被放弃的设计，往往比成功的设计更能揭示约束
所在**。

## 13.9.1 请求假设

服务端程序有一个很强的结构特征：工作以**请求**为单位。一个请求进来，分配一批对象处理它，
请求结束，这批对象绝大多数就该死了。由此提出**请求假设**：**在一个请求内分配的对象，倾向于在
该请求结束时一起死亡。** 这比分代假设（[13.8](./generational.md)）更贴合服务端,它说的不是
"年轻对象易死"，而是"同一请求的对象同生共死"。若能利用这一点，就能在请求结束时高效地整批
回收，而不必全局扫描。

## 13.9.2 ROC 的思路与困难

ROC（Austin Clements 主导的实验）想这样利用请求假设：把每个 goroutine（常对应一个请求）
分配的对象看作一个可独立回收的单元,当一个 goroutine 结束、且能证明它分配的对象没有"逃逸"到
别的 goroutine（仍被外部引用），就可以**整批回收**这些对象，无需全局 GC 参与。听起来很美,
请求一结束，它的内存就干净利落地还回去。

困难出在"证明没有逃逸"上。要判断一个对象有没有被别的 goroutine 引用，需要在**每次指针写入**
时做检查、维护额外的屏障与元数据。实验表明，这个**写屏障的常数开销太大**,它压在每一次指针
写上，拖累了所有程序的吞吐，而带来的回收收益不足以抵偿。换句话说，请求假设虽然成立，但**验证
它的成本超过了利用它的收益**。ROC 最终被放弃。

## 13.9.3 失败的价值

ROC 没进 Go，但这次失败很有价值。它确认了一条 Go GC 设计的**硬约束**：任何要靠"加重写屏障"
来换取回收效率的方案，都要先过"写屏障开销"这一关,而这一关很严苛，因为写屏障压在最高频的
操作（指针写）上。这也反过来印证了为什么 Go 现行的混合写屏障（[13.2](./barrier.md)）要那么
小心地控制自身开销。一个被放弃的实验，划定了设计空间的边界:它告诉后来者，"利用对象寿命的
结构性假设"这条路，在 Go 里会被写屏障成本卡住。ROC 的精神（利用请求/局部性结构）并未完全
消失,go1.25/1.26 的 Green Tea GC（[13.11](./history.md)）从"改善回收的内存局部性"这个相关
角度再次出发，只是不再依赖那种昂贵的逃逸验证。这正是工程演化的常态：一条路走不通，换个角度
再来。

## 延伸阅读的文献

1. Austin Clements, David Chase. *Request Oriented Collector (ROC) — design & experiment.*
   https://github.com/golang/go/issues/16843 ；设计文档：
   https://go.googlesource.com/proposal/+/master/design/16843-request-oriented-collector.md
2. Rick Hudson. *Getting to Go: The Journey of Go's GC.* https://go.dev/blog/ismmkeynote
3. 本书 [13.2 写屏障](./barrier.md)、[13.8 分代假设](./generational.md)、
   [13.11 过去现在未来](./history.md).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
