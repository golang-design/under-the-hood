---
weight: 5200
title: "第 16 章 工具与可观测性"
bookCollapseSection: true
---

# 第 16 章 工具与可观测性

- [16.1 运行时死锁检查](./deadlock.md)
- [16.2 竞争检查](./race.md)
- [16.3 性能追踪](./trace.md)
- [16.4 代码测试](./testing.md)
- [16.5 基准测试与性能剖析](./perf.md)
- [16.6 运行时统计量](./metric.md)
- [16.7 语言服务协议](./gopls.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
人人都知道，调试的难度是编写程序的两倍。那么，如果编写程序时就已用尽了聪明才智，又怎能调试它呢？
</I></br>
<I>
Everyone knows that debugging is twice as hard as writing a program in the first place. So if you're as
clever as you can be when you write it, how will you ever debug it?
</I></br>
<div class="quote-right">
-- Brian W. Kernighan and P. J. Plauger, "The Elements of Programming Style", 2nd ed., 1978
</div>
</div>

这段话出自 Kernighan 与 Plauger 合著的 *The Elements of Programming Style* 第 2 章「Expression」。
书中先给出一个用 PL/I 统计字符串中空格数的程序：它借助内置函数 `INDEX` 与 `SUBSTR`，
每次截去第一个空格及其之前的字符，写法巧妙，却要想一想才能看出用途；随后给出逐个检查字符的直白写法，
并写下了这段话。紧接着的一段讨论另一种「聪明」：程序员凭着对某个编译器的了解，只使用「已知」更高效的写法，
而书中指出，这种判断并不总是成立。前者关乎理解与调试，后者关乎对性能的直觉。本章的工具正对应这两件事：
程序出错时找到原因，觉得程序慢时先去测量。

[16.1](./deadlock.md)、[16.2](./race.md) 与 [16.4](./testing.md) 讨论程序的正确性。[16.1](./deadlock.md)
讨论运行时如何判定全局死锁，`synctest` 与 goroutine 泄漏剖面如何把检测推广到局部死锁；[16.2](./race.md)
讨论竞态检测器如何以向量时钟发现缺少同步的内存访问，以及编译器与 ThreadSanitizer 运行时的分工；
[16.4](./testing.md) 讨论 `go test` 如何把测试约定变成可执行程序，以及表驱动测试、子测试与模糊测试。
[16.3](./trace.md)、[16.5](./perf.md) 与 [16.6](./metric.md) 讨论如何观察运行中的程序：
执行追踪按时间顺序记录调度、垃圾回收与系统调用事件；基准测试、`benchstat` 与剖析回答「有多快」
「是否真的变了」与「时间花在哪里」；运行时指标以很低的开销持续报告堆、回收与调度器的状态，
供监控系统长期保存与告警。[16.7](./gopls.md) 讨论语言服务协议与 gopls，即编辑器中的语义功能如何建立在
`go/parser` 与 `go/types` 之上。这些工具多数随工具链一同发布，它们所依赖的机制见调度器
（[第 9 章](../../part3concurrency/ch09sched)）、内存统计（[12.8](../../part4memory/ch12alloc/mstats.md)）
与编译器前端（[15.1](../ch15compile/parse.md)）。
