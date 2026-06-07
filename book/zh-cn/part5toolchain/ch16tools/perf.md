---
weight: 5205
title: "16.5 基准测试与性能画像"
---

# 16.5 基准测试与性能画像

优化的第一原则是**先测量，再动手**,凭直觉猜瓶颈往往猜错。Go 把测量工具做进了工具链：基准测试
量化"多快"，性能画像（profiling）定位"慢在哪、内存花在哪"。这一节讲清这两件工具，以及用好
它们的方法。

## 16.5.1 基准测试

基准测试用 `func BenchmarkXxx(b *testing.B)` 写，`go test -bench` 运行。它的机制很巧：`b.N`
不是固定的,框架会**自动反复调整 `b.N`、多跑几轮**，直到测量时间足够长、结果足够稳定，最后报告
**每次操作的耗时**（ns/op）以及（加 `-benchmem` 时）每次操作的内存分配（B/op、allocs/op）。
后者尤其有价值,allocs/op 直接暴露"这段代码每次跑分配了几个对象"，是定位 GC 压力
（[13 GC](../../part4memory/ch13gc)）与逃逸（[15.5](../ch15compile/escape.md)）问题的利器。

测量要可信，得对抗噪声与编译器优化（如把没用到的结果优化掉）。配套工具 `benchstat` 用统计方法
比较多次基准结果，判断"这次改动到底是真的快了，还是只是噪声波动",它给出差异的显著性，
避免被随机抖动误导。"用 benchstat 比较前后"是 Go 性能工作的标准做法。

## 16.5.2 pprof：四类画像

`pprof` 是 Go 的性能画像工具，采集几类**采样画像**：

- **CPU 画像**：周期性中断采样当前栈，统计"时间花在哪些函数上",找 CPU 热点。
- **堆画像**（heap）：采样内存分配，看"内存被哪些代码分配、当前被什么占用",找内存大户与泄漏。
- **阻塞画像**（block）：统计 goroutine 阻塞在同步原语上的时间,找同步瓶颈。
- **互斥画像**（mutex）：统计锁竞争,找争用热点。
- 外加 **goroutine 画像**（所有 goroutine 的当前栈，[16.1](./deadlock.md) 查局部死锁的利器）。

它们多是**采样**而非全量,以低开销换取"可在生产环境开启"。通过 `net/http/pprof`，一个线上服务
能随时被拉取画像，`go tool pprof` 再以火焰图等形式可视化。这套"采样画像 + 火焰图"已是性能
诊断的业界标准（Brendan Gregg 的火焰图思想）。

## 16.5.3 测量驱动的优化文化

基准 + 画像，构成 Go 的**测量驱动优化**闭环：用画像找到热点 → 改 → 用基准 + benchstat 验证
确实变快 → 再找下一个热点。配合 PGO（[15.3](../ch15compile/optimize.md)，把画像喂给编译器
自动优化）与执行追踪（[16.3](./trace.md)，看延迟来源），Go 提供了一整套从"发现问题"到"验证
修复"的内建工具。这背后是一种工程纪律：**不要凭感觉优化**,先测量、定位真正的瓶颈（往往不是
你以为的地方）、改完再用数据确认。Go 把这套纪律所需的工具全部内建、零门槛地交到每个程序员
手里,这本身就是对"测量驱动"文化的有力推动。性能不是猜出来的，是测出来、改出来、再测出来的。

## 延伸阅读的文献

1. The Go Authors. *Profiling Go Programs.* https://go.dev/blog/pprof ；
   *runtime/pprof、net/http/pprof.* https://pkg.go.dev/runtime/pprof
2. The Go Authors. *benchstat.* https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
3. Brendan Gregg. *Flame Graphs.* https://www.brendangregg.com/flamegraphs.html
4. 本书 [15.3 优化器（PGO）](../ch15compile/optimize.md)、[16.3 性能追踪](./trace.md)、
   [13 垃圾回收](../../part4memory/ch13gc).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
