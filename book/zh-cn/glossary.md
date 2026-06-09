---
weight: 9001
title: "附录 A：术语表"
---

# 术语表

本附录整理了书中出现的主要术语，按主题分组、英文字典序排列，并给出术语主要展开的章节，
便于读者回查。

## 并发与调度

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 回边 | [9.7](./part3concurrency/ch09sched/preemption.md) | Back Edge | |
| 协作式抢占 | [9.7](./part3concurrency/ch09sched/preemption.md) | Cooperative Preemption | |
| 顺序进程通讯 | [1.3](./part1overview/ch01intro/csp.md) | Communicating Sequential Processes | CSP |
| Goroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | Goroutine | G/g |
| 机器（线程） | [9.3](./part3concurrency/ch09sched/mpg.md) | Machine | M/m |
| 网络轮询器 | [9.9](./part3concurrency/ch09sched/poller.md) | Network Poller | netpoll |
| 非自旋 | [9.4](./part3concurrency/ch09sched/schedule.md) | Non-spinning | |
| 抢占式 | [9.7](./part3concurrency/ch09sched/preemption.md) | Preemptive | |
| 处理器 | [9.3](./part3concurrency/ch09sched/mpg.md) | Processor | P/p |
| 安全点 | [9.7](./part3concurrency/ch09sched/preemption.md) | Safepoint | |
| 调度器 | [9](./part3concurrency/ch09sched/readme.md) | Scheduler | sched |
| 自旋 | [9.4](./part3concurrency/ch09sched/schedule.md) | Spinning | |
| 系统监控 | [9.8](./part3concurrency/ch09sched/sysmon.md) | System Monitor | sysmon |
| 工作窃取 | [9.2](./part3concurrency/ch09sched/steal.md) | Work Stealing | |

## 同步与内存模型

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 原子操作 | [11.3](./part3concurrency/ch11sync/atomic.md) | Atomic Operation | |
| 比较并交换 | [11.3](./part3concurrency/ch11sync/atomic.md) | Compare-And-Swap | CAS |
| 条件变量 | [11.4](./part3concurrency/ch11sync/cond.md) | Condition Variable | |
| 数据竞争 | [11.9](./part3concurrency/ch11sync/mem.md) | Data Race | |
| 先行发生 | [11.9](./part3concurrency/ch11sync/mem.md) | Happens-Before | |
| 无锁 | [11.3](./part3concurrency/ch11sync/atomic.md) | Lock-free | LF |
| 内存屏障 | [11.9](./part3concurrency/ch11sync/mem.md) | Memory Barrier | |
| 顺序一致性 | [11.9](./part3concurrency/ch11sync/mem.md) | Sequential Consistency | SC |
| 假共享 | [12.2](./part4memory/ch12alloc/component.md) | False Sharing | |
| 真共享 | [12.2](./part4memory/ch12alloc/component.md) | True Sharing | |
| 无等待 | [11.3](./part3concurrency/ch11sync/atomic.md) | Wait-free | |

## 内存分配

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 区域 | [12.3](./part4memory/ch12alloc/init.md) | Arena | heapArena |
| 区域提示 | [12.3](./part4memory/ch12alloc/init.md) | Arena Hint | arenaHint |
| 快速路径 | [12.1](./part4memory/ch12alloc/basic.md) | Fast Path | |
| 自由表 | [12.2](./part4memory/ch12alloc/component.md) | Free List | |
| 堆 | [12](./part4memory/ch12alloc/readme.md) | Heap | |
| 大对象 | [12.4](./part4memory/ch12alloc/largealloc.md) | Large Object | |
| 页 | [12.7](./part4memory/ch12alloc/pagealloc.md) | Page | |
| 页分配器 | [12.7](./part4memory/ch12alloc/pagealloc.md) | Page Allocator | |
| 大小等级 | [12.1](./part4memory/ch12alloc/basic.md) | Size Class | |
| 小对象 | [12.5](./part4memory/ch12alloc/smallalloc.md) | Small Object | |
| 慢速路径 | [12.1](./part4memory/ch12alloc/basic.md) | Slow Path | |
| 微型分配器 | [12.6](./part4memory/ch12alloc/tinyalloc.md) | Tiny Allocator | |
| 微对象 | [12.6](./part4memory/ch12alloc/tinyalloc.md) | Tiny Object | |

## 垃圾回收

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 位图 | [13.5](./part4memory/ch13gc/sweep.md) | Bitmap | |
| 回收器 | [13.1](./part4memory/ch13gc/basic.md) | Collector | |
| 保守式 | [13.7](./part4memory/ch13gc/safe.md) | Conservative | |
| 终结器 | [13.10](./part4memory/ch13gc/finalizer.md) | Finalizer | |
| 垃圾回收 | [13](./part4memory/ch13gc/readme.md) | Garbage Collection | GC |
| 分代假设 | [13.8](./part4memory/ch13gc/generational.md) | Generational Hypothesis | |
| 混合写屏障 | [13.2](./part4memory/ch13gc/barrier.md) | Hybrid Write Barrier | |
| 存活性 | [13.1](./part4memory/ch13gc/basic.md) | Liveness | |
| 标记辅助 | [13.4](./part4memory/ch13gc/mark.md) | Mark Assist | |
| 标记清扫 | [13.1](./part4memory/ch13gc/basic.md) | Mark-Sweep | |
| 赋值器 | [13.1](./part4memory/ch13gc/basic.md) | Mutator | |
| 调步器 | [13.3](./part4memory/ch13gc/pacing.md) | Pacer | |
| 可达性 | [13.1](./part4memory/ch13gc/basic.md) | Reachability | |
| 记忆集 | [13.8](./part4memory/ch13gc/generational.md) | Remembered Set | |
| 停止一切 | [13.3](./part4memory/ch13gc/pacing.md) | Stop the World | STW |
| 三色抽象 | [13.1](./part4memory/ch13gc/basic.md) | Tricolour Abstraction | |
| 写屏障 | [13.2](./part4memory/ch13gc/barrier.md) | Write Barrier | WB/wb |

## 执行栈

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 连续栈 | [14.1](./part4memory/ch14stack/design.md) | Contiguous Stack | |
| 函数序言 | [2.2](./part1overview/ch02asm/callconv.md) | Prologue | |
| 函数收尾 | [14.3](./part4memory/ch14stack/grow.md) | Epilogue | |
| 栈 | [14](./part4memory/ch14stack/readme.md) | Stack | |
| 栈拷贝 | [14.4](./part4memory/ch14stack/copy.md) | Stack Copy | |
| 栈增长 | [14.3](./part4memory/ch14stack/grow.md) | Stack Growth | |

## 语言特性与编译器

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 调用规范 | [2.2](./part1overview/ch02asm/callconv.md) | Calling Convention / ABI | |
| 延迟比特 | [6.2](./part2lang/ch06func/defer.md) | Defer Bit | |
| 去虚化 | [15.3](./part5toolchain/ch15compile/optimize.md) | Devirtualization | |
| 逃逸分析 | [15.5](./part5toolchain/ch15compile/escape.md) | Escape Analysis | |
| GC 形状 | [8.1](./part2lang/ch08generics/history.md) | GC Shape | |
| 内联 | [15.3](./part5toolchain/ch15compile/optimize.md) | Inlining | |
| 接口表 | [4.2](./part2lang/ch04type/interface.md) | Interface Table | itab |
| 开放编码式延迟 | [6.2](./part2lang/ch06func/defer.md) | Open-coded Defer | |
| 性能制导优化 | [15.3](./part5toolchain/ch15compile/optimize.md) | Profile-Guided Optimization | PGO |
| 静态单赋值 | [15.2](./part5toolchain/ch15compile/ssa.md) | Static Single Assignment | SSA |
| 类型集 | [8.3](./part2lang/ch08generics/checker.md) | Type Set | |
| 类型描述符 | [4.1](./part2lang/ch04type/type.md) | Type Descriptor | _type |

## 模块与工具链

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 语言服务协议 | [16.7](./part5toolchain/ch16tools/gopls.md) | Language Server Protocol | LSP |
| 最小版本选择 | [17.3](./part5toolchain/ch17modules/minimum.md) | Minimal Version Selection | MVS |
| 竞争检查器 | [16.2](./part5toolchain/ch16tools/race.md) | Race Detector | |
| 语义导入版本 | [17.2](./part5toolchain/ch17modules/semantics.md) | Semantic Import Versioning | |
| 语义化版本 | [17.2](./part5toolchain/ch17modules/semantics.md) | Semantic Versioning | semver |
