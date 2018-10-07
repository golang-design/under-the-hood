# 5 调度器: 基本知识

在详细进入代码之前，我们了解一下调度器的设计原则及一些基本概念来建立较为宏观的认识。
运行时调度器的任务是给不同的工作线程 (worker thread) 分发 ready-to-run goroutine。

理解调度器涉及的主要概念包括以下三个：

- G: goroutine。
- M: worker thread, 或 machine。
- P: processor，是一种执行 Go 代码被要求资源。M 必须关联一个 P 才能执行 Go 代码，但它可以被阻塞或在一个系统调用中没有关联的 P。

## 工作线程的 park/unpark

调度器的设计需要在保持足够的运行 worker thread 来利用有效硬件并发资源、和 park 运行
过多的 worker thread 来节约 CPU 能耗之间进行权衡。但是这个权衡并不简单，有以下两点原因：

1. 调度器状态是有意分布的（具体而言，是一个 per-P 的 work 队列），因此在快速路径
（fast path）计算出全局断言 (global predicates) 是不可能的。
2. 为了获得最佳的线程管理，我们必须知晓未来的情况（当一个新的 goroutine 会
在不久的将来 ready，则不再 park 一个 worker thread）

以下的三种方法不被采纳：

1. 集中式管理所有调度器状态（会将限制可扩展性）
2. 直接切换 goroutine。也就是说，当我们 ready 一个新的 goroutine 时，让出一个 P，
   unpark 一个线程并切换到这个线程运行 goroutine。因为 ready 的 goroutine 线程可能
   在下一个瞬间 out of work，从而导致线程 thrashing（当计算机虚拟内存饱和时会发生
   thrashing，最终导致分页调度状态不再变化。这个状态会一直持续，知道用户关闭一些运行的
   应用或者活跃进程释放一些虚拟内存资源），因此我们需要 park 这个线程。同样，我们
   希望在相同的线程内保存维护 goroutine，这种方式还会摧毁计算的局部性原理。
3. 任何时候 ready 一个 goroutine 时也存在一个空闲的 P 时，都 unpark 一个额外的线程，
   但不进行切换。因为额外线程会在没有检查任何 work 的情况下立即 park ，最终导致大量线程的
   parking/unparking。

目前的调度器实现方式为：

如果存在一个空闲的 P 并且没有 spinning 状态的工作线程，当 ready 一个 goroutine 时，
就 unpark 一个额外的线程。如果一个工作线程的本地队列里没有 work ，且在全局运行队列或 netpoller
中也没有 work，则称一个工作线程被称之为 spinning；spinning 状态由 sched.nmspinning 中的
m.spinning 表示。

这种方式下被 unpark 的线程同样也成为 spinning，我们也不对这种线程进行 goroutine 切换，
因此这类线程最初就是 out of work。spinning 线程会在 park 前，从 per-P 中运行队列中寻找 work。
如果一个 spinning 进程发现 work，就会将自身切换出 spinning 状态，并且开始执行。

如果它没有发现 work 则会将自己带 spinning 转状态然后进行 park。

如果至少有一个 spinning 进程（sched.nmspinning>1），则 ready 一个 goroutine 时，
不会去 unpark 一个新的线程。作为补偿，如果最后一个 spinning 线程发现 work 并且停止 spinning，
则必须 unpark 一个新的 spinning 线程。这个方法消除了不合理的线程 unpark 峰值，
且同时保证最终的最大 CPU 并行度利用率。

主要的实现复杂性表现为当进行 spinning->non-spinning 线程转换时必须非常小心。这种转换在提交一个
新的 goroutine ，并且任何一个部分都需要取消另一个工作线程会发生竞争。如果双方均失败，则会以半静态
CPU 利用不足而结束。ready 一个 goroutine 的通用范式为：提交一个 goroutine 到 per-P 的局部 work 队列，
`#StoreLoad-style` 内存屏障，检查 sched.nmspinning。从 spinning->non-spinning 转换的一般模式为：
减少 nmspinning, `#StoreLoad-style` 内存屏障，在所有 per-P 工作队列检查新的 work。注意，此种复杂性
并不适用于全局工作队列，因为我们不会蠢到当给一个全局队列提交 work 时进行线程 unpark。更多细节参见
nmspinning 操作。

## 进一步阅读的参考文献

1. [Scalable Go Scheduler Design Doc](https://golang.org/s/go11sched)
2. [Go Preemptive Scheduler Design Doc](https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit#heading=h.3pilqarbrc9h)
3. [NUMA-aware scheduler for Go](https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub)
4. [Scheduling Multithreaded Computations by Work Stealing](papers/steal.pdf)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)