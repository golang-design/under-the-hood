---
weight: 9001
title: "附录 A：术语表"
---

# 术语表

本附录整理了书中出现的主要术语，按主题分组，组内按英文名的字母顺序排列，并给出详细讲解该术语的
章节，便于读者回查。

## 并发与调度

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| Actor 模型 | [1.3](./part1overview/ch01intro/csp.md) | Actor Model | |
| 备用信号栈 | [9.6](./part3concurrency/ch09sched/signal.md) | Alternate Signal Stack | sigaltstack |
| 非对称协程 | [9.3](./part3concurrency/ch09sched/mpg.md) | Asymmetric Coroutine | |
| 异步信号安全 | [9.6](./part3concurrency/ch09sched/signal.md) | Async-Signal-Safe | |
| 异步抢占 | [9.7](./part3concurrency/ch09sched/preemption.md) | Asynchronous Preemption | |
| 回边 | [9.7](./part3concurrency/ch09sched/preemption.md) | Back Edge | |
| channel | [10.1](./part3concurrency/ch10chan/model.md) | Channel | chan |
| 通信顺序进程 | [1.3](./part1overview/ch01intro/csp.md) | Communicating Sequential Processes | CSP |
| 协作式抢占 | [9.7](./part3concurrency/ch09sched/preemption.md) | Cooperative Preemption | |
| 协程 | [9.3](./part3concurrency/ch09sched/mpg.md) | Coroutine | |
| 守护线程 | [3.6](./part1overview/ch03life/main.md) | Daemon Thread | |
| 死锁 | [1.3](./part1overview/ch01intro/csp.md) | Deadlock | |
| 直接传递 | [10.3](./part3concurrency/ch10chan/sendrecv.md) | Direct Handoff | |
| 边沿触发 | [9.9](./part3concurrency/ch09sched/poller.md) | Edge-Triggered | ET |
| 完全协程 | [9.3](./part3concurrency/ch09sched/mpg.md) | Full Coroutine | |
| 函数染色 | [9.3](./part3concurrency/ch09sched/mpg.md) | Function Coloring | |
| goroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | goroutine | G/g |
| goroutine 泄漏 | [9.3](./part3concurrency/ch09sched/mpg.md) | Goroutine Leak | |
| 守卫命令 | [1.3](./part1overview/ch01intro/csp.md) | Guarded Command | |
| I/O 多路复用 | [9.9](./part3concurrency/ch09sched/poller.md) | I/O Multiplexing | |
| 水平触发 | [9.9](./part3concurrency/ch09sched/poller.md) | Level-Triggered | LT |
| 机器（线程） | [9.3](./part3concurrency/ch09sched/mpg.md) | Machine | M/m |
| 主 goroutine | [3.6](./part1overview/ch03life/main.md) | Main Goroutine | |
| 网络轮询器 | [9.9](./part3concurrency/ch09sched/poller.md) | Network Poller | netpoll |
| 非自旋 | [9.4](./part3concurrency/ch09sched/schedule.md) | Non-spinning | |
| 非均匀访存 | [9.11](./part3concurrency/ch09sched/numa.md) | Non-Uniform Memory Access | NUMA |
| 一次性续延 | [9.3](./part3concurrency/ch09sched/mpg.md) | One-shot Continuation | |
| 轮询 | [9.7](./part3concurrency/ch09sched/preemption.md) | Polling | |
| 抢占式 | [9.7](./part3concurrency/ch09sched/preemption.md) | Preemptive | |
| 处理器 | [9.3](./part3concurrency/ch09sched/mpg.md) | Processor | P/p |
| 会合 | [1.3](./part1overview/ch01intro/csp.md) | Rendezvous | |
| 运行时 | [1.2](./part1overview/ch01intro/go.md) | Runtime | |
| 安全点 | [9.7](./part3concurrency/ch09sched/preemption.md) | Safepoint | |
| 调度器 | [9](./part3concurrency/ch09sched/readme.md) | Scheduler | sched |
| 自管道技巧 | [9.6](./part3concurrency/ch09sched/signal.md) | Self-Pipe Trick | |
| 信号链 | [9.6](./part3concurrency/ch09sched/signal.md) | Signal Chaining | |
| 自旋 | [9.4](./part3concurrency/ch09sched/schedule.md) | Spinning | |
| 有栈协程 | [9.3](./part3concurrency/ch09sched/mpg.md) | Stackful Coroutine | |
| 无栈协程 | [9.3](./part3concurrency/ch09sched/mpg.md) | Stackless Coroutine | |
| 结构化并发 | [3.6](./part1overview/ch03life/main.md) | Structured Concurrency | |
| 对称协程 | [9.3](./part3concurrency/ch09sched/mpg.md) | Symmetric Coroutine | |
| 系统监控 | [9.8](./part3concurrency/ch09sched/sysmon.md) | System Monitor | sysmon |
| 系统栈 | [9.3](./part3concurrency/ch09sched/mpg.md) | System Stack | g0 |
| 模板线程 | [9.5](./part3concurrency/ch09sched/thread.md) | Template Thread | |
| 线程本地存储 | [3.5](./part1overview/ch03life/boot.md) | Thread-Local Storage | TLS |
| 到达安全点的时间 | [9.7](./part3concurrency/ch09sched/preemption.md) | Time to Safepoint | TTSP |
| 计时器 | [9.10](./part3concurrency/ch09sched/timer.md) | Timer | |
| 工作窃取 | [9.2](./part3concurrency/ch09sched/steal.md) | Work Stealing | |

## 同步与内存模型

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| ABA 问题 | [11.3](./part3concurrency/ch11sync/atomic.md) | ABA Problem | |
| 原子操作 | [11.3](./part3concurrency/ch11sync/atomic.md) | Atomic Operation | |
| 插队 | [11.2](./part3concurrency/ch11sync/mutex.md) | Barging | |
| 比较并交换 | [11.3](./part3concurrency/ch11sync/atomic.md) | Compare-And-Swap | CAS |
| 条件变量 | [11.4](./part3concurrency/ch11sync/cond.md) | Condition Variable | |
| 共识数 | [11.3](./part3concurrency/ch11sync/atomic.md) | Consensus Number | |
| 协作式取消 | [11.8](./part3concurrency/ch11sync/context.md) | Cooperative Cancellation | |
| 临界区 | [11.2](./part3concurrency/ch11sync/mutex.md) | Critical Section | |
| 数据竞争 | [11.9](./part3concurrency/ch11sync/mem.md) | Data Race | |
| 免数据竞争 | [11.9](./part3concurrency/ch11sync/mem.md) | Data-Race-Free | DRF |
| 纪元回收 | [11.3](./part3concurrency/ch11sync/atomic.md) | Epoch-Based Reclamation | EBR |
| 假共享 | [12.2](./part4memory/ch12alloc/component.md) | False Sharing | |
| 先行发生 | [11.9](./part3concurrency/ch11sync/mem.md) | Happens-Before | |
| 危险指针 | [11.3](./part3concurrency/ch11sync/atomic.md) | Hazard Pointer | |
| 石蕊测试 | [11.9](./part3concurrency/ch11sync/mem.md) | Litmus Test | |
| 无锁 | [11.3](./part3concurrency/ch11sync/atomic.md) | Lock-free | LF |
| 内存屏障 | [11.9](./part3concurrency/ch11sync/mem.md) | Memory Barrier | |
| 内存一致模型 | [11.9](./part3concurrency/ch11sync/mem.md) | Memory Consistency Model | |
| 管程 | [1.3](./part1overview/ch01intro/csp.md) | Monitor | |
| 多副本原子性 | [11.9](./part3concurrency/ch11sync/mem.md) | Multi-Copy Atomicity | |
| 无阻碍 | [11.3](./part3concurrency/ch11sync/atomic.md) | Obstruction-free | |
| 凭空出现的值 | [11.9](./part3concurrency/ch11sync/mem.md) | Out-of-Thin-Air Value | OOTA |
| 读-复制-更新 | [11.3](./part3concurrency/ch11sync/atomic.md) | Read-Copy-Update | RCU |
| 信号量 | [1.3](./part1overview/ch01intro/csp.md) | Semaphore | |
| 程序次序先于 | [11.9](./part3concurrency/ch11sync/mem.md) | Sequenced Before | |
| 顺序一致性 | [11.9](./part3concurrency/ch11sync/mem.md) | Sequential Consistency | SC |
| 虚假唤醒 | [11.4](./part3concurrency/ch11sync/cond.md) | Spurious Wakeup | |
| 存储缓冲 | [11.9](./part3concurrency/ch11sync/mem.md) | Store Buffer | |
| 同步先于 | [11.9](./part3concurrency/ch11sync/mem.md) | Synchronized Before | |
| 真共享 | [12.2](./part4memory/ch12alloc/component.md) | True Sharing | |
| victim 缓存 | [11.6](./part3concurrency/ch11sync/pool.md) | Victim Cache | |
| 无等待 | [11.3](./part3concurrency/ch11sync/atomic.md) | Wait-free | |
| 弱序 | [11.9](./part3concurrency/ch11sync/mem.md) | Weak Ordering | |

## 内存分配

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 区域 | [12.3](./part4memory/ch12alloc/init.md) | Arena | heapArena |
| 区域提示 | [12.3](./part4memory/ch12alloc/init.md) | Arena Hint | arenaHint |
| 提交 | [12.3](./part4memory/ch12alloc/init.md) | Commit | |
| 外部碎片 | [12.1](./part4memory/ch12alloc/basic.md) | External Fragmentation | |
| 快速路径 | [12.1](./part4memory/ch12alloc/basic.md) | Fast Path | |
| 首次适配 | [12.7](./part4memory/ch12alloc/pagealloc.md) | First Fit | |
| 自由表 | [12.2](./part4memory/ch12alloc/component.md) | Free List | |
| 堆 | [12](./part4memory/ch12alloc/readme.md) | Heap | |
| 堆剖面 | [12.8](./part4memory/ch12alloc/mstats.md) | Heap Profile | |

| 内部碎片 | [12.1](./part4memory/ch12alloc/basic.md) | Internal Fragmentation | |
| 大对象 | [12.4](./part4memory/ch12alloc/largealloc.md) | Large Object | |
| 分配头 | [12.1](./part4memory/ch12alloc/basic.md) | Malloc Header | |
| 页 | [12.7](./part4memory/ch12alloc/pagealloc.md) | Page | |
| 页分配器 | [12.7](./part4memory/ch12alloc/pagealloc.md) | Page Allocator | |
| 泊松过程 | [12.8](./part4memory/ch12alloc/mstats.md) | Poisson Process | |

| 基数树 | [12.7](./part4memory/ch12alloc/pagealloc.md) | Radix Tree | |
| 预留 | [12.3](./part4memory/ch12alloc/init.md) | Reserve | |
| 归还 | [12.7](./part4memory/ch12alloc/pagealloc.md) | Scavenging | |
| 尺寸类 | [12.1](./part4memory/ch12alloc/basic.md) | Size Class | |
| 小对象 | [12.5](./part4memory/ch12alloc/smallalloc.md) | Small Object | |
| 慢速路径 | [12.1](./part4memory/ch12alloc/basic.md) | Slow Path | |
| 摘要 | [12.7](./part4memory/ch12alloc/pagealloc.md) | Summary | |
| 微型分配器 | [12.6](./part4memory/ch12alloc/tinyalloc.md) | Tiny Allocator | |
| 微对象 | [12.6](./part4memory/ch12alloc/tinyalloc.md) | Tiny Object | |

## 垃圾回收

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 位图 | [13.5](./part4memory/ch13gc/sweep.md) | Bitmap | |
| 卡表 | [13.8](./part4memory/ch13gc/generational.md) | Card Table | |
| 清理函数 | [13.10](./part4memory/ch13gc/finalizer.md) | Cleanup | |
| 回收器 | [13.1](./part4memory/ch13gc/basic.md) | Collector | |
| 保守式 | [13.7](./part4memory/ch13gc/safe.md) | Conservative | |
| 终结器 | [13.10](./part4memory/ch13gc/finalizer.md) | Finalizer | |
| 垃圾回收 | [13](./part4memory/ch13gc/readme.md) | Garbage Collection | GC |
| 分代假设 | [13.8](./part4memory/ch13gc/generational.md) | Generational Hypothesis | |
| 图泛洪 | [13.11](./part4memory/ch13gc/greentea.md) | Graph Flood | |
| 堆目标 | [13.3](./part4memory/ch13gc/pacing.md) | Heap Goal | |
| 混合写屏障 | [13.2](./part4memory/ch13gc/barrier.md) | Hybrid Write Barrier | |
| 存活性 | [13.1](./part4memory/ch13gc/basic.md) | Liveness | |
| 标记辅助 | [13.4](./part4memory/ch13gc/mark.md) | Mark Assist | |
| 标记工作者 | [13.4](./part4memory/ch13gc/mark.md) | Mark Worker | |
| 标记清扫 | [13.1](./part4memory/ch13gc/basic.md) | Mark-Sweep | |
| 赋值器 | [13.1](./part4memory/ch13gc/basic.md) | Mutator | |
| 调步器 | [13.3](./part4memory/ch13gc/pacing.md) | Pacer | |
| 比例清扫 | [13.5](./part4memory/ch13gc/sweep.md) | Proportional Sweep | |
| 不规则屏障 | [13.6](./part4memory/ch13gc/termination.md) | Ragged Barrier | |
| 可达性 | [13.1](./part4memory/ch13gc/basic.md) | Reachability | |
| 引用计数 | [13.13](./part4memory/ch13gc/unifiedgc.md) | Reference Counting | RC |
| 记忆集 | [13.8](./part4memory/ch13gc/generational.md) | Remembered Set | |
| 请求假设 | [13.9](./part4memory/ch13gc/roc.md) | Request Hypothesis | |
| 复活 | [13.10](./part4memory/ch13gc/finalizer.md) | Resurrection | |
| 软内存限制 | [13.3](./part4memory/ch13gc/pacing.md) | Soft Memory Limit | |
| span 队列 | [13.11](./part4memory/ch13gc/greentea.md) | Span Queue | spanQueue |
| 特殊记录 | [13.10](./part4memory/ch13gc/finalizer.md) | Special Record | special |
| 栈映射 | [13.7](./part4memory/ch13gc/safe.md) | Stack Map | |
| 栈对象 | [13.7](./part4memory/ch13gc/safe.md) | Stack Object | |
| 停止一切 | [13.1](./part4memory/ch13gc/basic.md) | Stop the World | STW |
| 追踪 | [13.13](./part4memory/ch13gc/unifiedgc.md) | Tracing | |
| 清扫 | [13.5](./part4memory/ch13gc/sweep.md) | Sweep | |
| 清扫代 | [13.5](./part4memory/ch13gc/sweep.md) | Sweep Generation | sweepgen |
| 三色抽象 | [13.1](./part4memory/ch13gc/basic.md) | Tricolour Abstraction | |
| 三色不变式 | [13.1](./part4memory/ch13gc/basic.md) | Tricolour Invariant | |
| 弱指针 | [13.10](./part4memory/ch13gc/finalizer.md) | Weak Pointer | |
| 写屏障 | [13.2](./part4memory/ch13gc/barrier.md) | Write Barrier | WB/wb |

## 执行栈

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 连续栈 | [14.1](./part4memory/ch14stack/design.md) | Contiguous Stack | |
| 函数收尾 | [14.3](./part4memory/ch14stack/grow.md) | Epilogue | |
| 帧指针 | [2.2](./part1overview/ch02asm/frame.md) | Frame Pointer | |
| 热分裂 | [14.1](./part4memory/ch14stack/design.md) | Hot Split | |
| 函数序言 | [2.4](./part1overview/ch02asm/args.md) | Prologue | |
| 分段栈 | [14.1](./part4memory/ch14stack/design.md) | Segmented Stack | |
| 溢出区 | [2.4](./part1overview/ch02asm/args.md) | Spill Space | |
| 栈 | [14](./part4memory/ch14stack/readme.md) | Stack | |
| 栈拷贝 | [14.4](./part4memory/ch14stack/copy.md) | Stack Copy | |
| 栈帧 | [2.2](./part1overview/ch02asm/frame.md) | Stack Frame | |
| 栈增长 | [14.3](./part4memory/ch14stack/grow.md) | Stack Growth | |
| 警戒线 | [2.4](./part1overview/ch02asm/args.md) | Stack Guard | |
| 栈指针 | [2.1](./part1overview/ch02asm/asm.md) | Stack Pointer | SP |
| 栈收缩 | [14.5](./part4memory/ch14stack/shrink.md) | Stack Shrinking | |
| 栈展开器 | [6.3](./part2lang/ch06func/panic.md) | Unwinder | |

## 语言特性与编译器

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| ABI 包装函数 | [2.3](./part1overview/ch02asm/callconv.md) | ABI Wrapper | |
| 别名声明 | [4.3](./part2lang/ch04type/alias.md) | Alias Declaration | |
| 应用二进制接口 | [2.3](./part1overview/ch02asm/callconv.md) | Application Binary Interface | ABI |
| 基本块 | [3.2](./part1overview/ch03life/compile.md) | Basic Block | |
| 装箱 | [4.2](./part2lang/ch04type/interface.md) | Boxing | |
| 被调方保存寄存器 | [2.4](./part1overview/ch02asm/args.md) | Callee-saved Register | |
| 调用约定 | [2.3](./part1overview/ch02asm/callconv.md) | Calling Convention | |
| 受检异常 | [7.1](./part2lang/ch07errors/value.md) | Checked Exception | |
| 闭包 | [6.1](./part2lang/ch06func/func.md) | Closure | |
| 闭包上下文寄存器 | [6.1](./part2lang/ch06func/func.md) | Closure Context Register | |
| 约束 | [8.2](./part2lang/ch08generics/contracts.md) | Constraint | |
| 合约 | [8.2](./part2lang/ch08generics/contracts.md) | Contract | |
| 核心类型 | [8.3](./part2lang/ch08generics/checker.md) | Core Type | |
| 死代码消除 | [3.4](./part1overview/ch03life/link.md) | Dead-Code Elimination | |
| 延迟位图 | [6.2](./part2lang/ch06func/defer.md) | Defer Bits | |
| 延迟语句 | [6.2](./part2lang/ch06func/defer.md) | Defer Statement | |
| 去虚化 | [15.3](./part5toolchain/ch15compile/optimize.md) | Devirtualization | |
| 字典传递 | [4.2](./part2lang/ch04type/interface.md) | Dictionary Passing | |
| 动态分派 | [4.2](./part2lang/ch04type/interface.md) | Dynamic Dispatch | |
| 错误树 | [7.2](./part2lang/ch07errors/inspect.md) | Error Tree | |
| 逃逸分析 | [15.5](./part5toolchain/ch15compile/escape.md) | Escape Analysis | |
| 导出数据 | [3.2](./part1overview/ch03life/compile.md) | Export Data | |
| 致命错误 | [6.3](./part2lang/ch06func/panic.md) | Fatal Error | |
| F-有界多态 | [8.4](./part2lang/ch08generics/future.md) | F-bounded Polymorphism | |
| 一等公民 | [6](./part2lang/ch06func/readme.md) | First-class Citizen | |
| GC 形状 | [8.1](./part2lang/ch08generics/history.md) | GC Shape | |
| GC 形状模板化 | [8.1](./part2lang/ch08generics/history.md) | GC Shape Stenciling | |
| 泛型方法 | [8.4](./part2lang/ch08generics/future.md) | Generic Method | |
| 渐进式代码修复 | [4.3](./part2lang/ch04type/alias.md) | Gradual Code Repair | |
| 高阶类型 | [8.4](./part2lang/ch08generics/future.md) | Higher-kinded Type | |
| 内联 | [15.3](./part5toolchain/ch15compile/optimize.md) | Inlining | |
| 接口表 | [4.2](./part2lang/ch04type/interface.md) | Interface Table | itab |
| 叶函数 | [9.7](./part3concurrency/ch09sched/preemption.md) | Leaf Function | |
| 方法表达式 | [6.1](./part2lang/ch06func/func.md) | Method Expression | |
| 方法集 | [4.2](./part2lang/ch04type/interface.md) | Method Set | |
| 方法值 | [6.1](./part2lang/ch06func/func.md) | Method Value | |
| 单态化 | [8.1](./part2lang/ch08generics/history.md) | Monomorphization | |
| 名义类型 | [4.1](./part2lang/ch04type/type.md) | Nominal Type | |
| 不透明错误 | [7.4](./part2lang/ch07errors/semantics.md) | Opaque Error | |
| 开放编码式延迟 | [6.2](./part2lang/ch06func/defer.md) | Open-coded Defer | |
| 恐慌 | [6.3](./part2lang/ch06func/panic.md) | Panic | |
| 性能制导优化 | [15.3](./part5toolchain/ch15compile/optimize.md) | Profile-Guided Optimization | PGO |
| 程序计数器 | [2.1](./part1overview/ch02asm/asm.md) | Program Counter | PC |
| 伪寄存器 | [2.1](./part1overview/ch02asm/asm.md) | Pseudo-register | |
| 寄存器 | [2.1](./part1overview/ch02asm/asm.md) | Register | |
| 哨兵错误 | [7.4](./part2lang/ch07errors/semantics.md) | Sentinel Error | |
| 特化 | [8.4](./part2lang/ch08generics/future.md) | Specialization | |
| 静态单赋值 | [15.2](./part5toolchain/ch15compile/ssa.md) | Static Single Assignment | SSA |
| 结构化类型 | [4.2](./part2lang/ch04type/interface.md) | Structural Typing | |
| 语法树 | [3.2](./part1overview/ch03life/compile.md) | Syntax Tree | |
| 类型定义 | [4.3](./part2lang/ch04type/alias.md) | Type Definition | |
| 类型描述符 | [4.1](./part2lang/ch04type/type.md) | Type Descriptor | _type |
| 类型擦除 | [8.1](./part2lang/ch08generics/history.md) | Type Erasure | |
| 类型推断 | [8.3](./part2lang/ch08generics/checker.md) | Type Inference | |
| 类型参数 | [8.1](./part2lang/ch08generics/history.md) | Type Parameter | |
| 类型集 | [8.3](./part2lang/ch08generics/checker.md) | Type Set | |
| 合一 | [8.3](./part2lang/ch08generics/checker.md) | Unification | |
| 降级 | [3.2](./part1overview/ch03life/compile.md) | Walk | |
| 包装函数 | [6.3](./part2lang/ch06func/panic.md) | Wrapper Function | |
| 包装 | [7.2](./part2lang/ch07errors/inspect.md) | Wrapping | |

## 数据结构

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 摊还分析 | [5.1](./part2lang/ch05data/slice.md) | Amortized Analysis | |
| 链地址法 | [5.3](./part2lang/ch05data/map.md) | Chaining | |
| 冲突 | [5.3](./part2lang/ch05data/map.md) | Collision | |
| 控制字 | [5.4](./part2lang/ch05data/swisstable.md) | Control Word | |
| 动态数组 | [5.1](./part2lang/ch05data/slice.md) | Dynamic Array | |
| 可扩展哈希 | [5.4](./part2lang/ch05data/swisstable.md) | Extendible Hashing | |
| 完整切片表达式 | [5.1](./part2lang/ch05data/slice.md) | Full Slice Expression | |
| 哈希洪水 | [5.3](./part2lang/ch05data/map.md) | Hash Flooding | |
| 散列字典树 | [11.7](./part3concurrency/ch11sync/map.md) | Hash Trie | |
| 驻留 | [5.2](./part2lang/ch05data/string.md) | Interning | |
| 惰性删除 | [9.10](./part3concurrency/ch09sched/timer.md) | Lazy Deletion | |
| 装载因子 | [5.3](./part2lang/ch05data/map.md) | Load Factor | |
| 锁分段 | [11.7](./part3concurrency/ch11sync/map.md) | Lock Striping | |
| 开放定址法 | [5.3](./part2lang/ch05data/map.md) | Open Addressing | |
| 探测序列 | [5.3](./part2lang/ch05data/map.md) | Probe Sequence | |
| 环形缓冲区 | [10.2](./part3concurrency/ch10chan/impl.md) | Ring Buffer | |
| 时间轮 | [9.10](./part3concurrency/ch09sched/timer.md) | Timing Wheel | |
| 墓碑 | [5.4](./part2lang/ch05data/swisstable.md) | Tombstone | |

## 模块与工具链

| 术语 | 章节 | English | 缩写 |
| --- | --- | --- | --- |
| 动作 | [3.1](./part1overview/ch03life/cmd.md) | Action | |
| 动作图 | [3.1](./part1overview/ch03life/cmd.md) | Action Graph | |
| 辅助向量 | [3.5](./part1overview/ch03life/boot.md) | Auxiliary Vector | auxv |
| 自举 | [3.3](./part1overview/ch03life/bootstrap.md) | Bootstrapping | |
| 内容寻址 | [3.1](./part1overview/ch03life/cmd.md) | Content Addressing | |
| 有向无环图 | [3.6](./part1overview/ch03life/main.md) | Directed Acyclic Graph | DAG |
| 多样化双重编译 | [3.3](./part1overview/ch03life/bootstrap.md) | Diverse Double-Compiling | DDC |
| 动态链接 | [3.4](./part1overview/ch03life/link.md) | Dynamic Linking | |
| 提前截断 | [3.1](./part1overview/ch03life/cmd.md) | Early Cutoff | |
| 不动点 | [3.3](./part1overview/ch03life/bootstrap.md) | Fixed Point | |
| 语言服务协议 | [16.7](./part5toolchain/ch16tools/gopls.md) | Language Server Protocol | LSP |
| 布局 | [3.4](./part1overview/ch03life/link.md) | Layout | |
| 链接器 | [3.4](./part1overview/ch03life/link.md) | Linker | |
| Merkle 树 | [3.1](./part1overview/ch03life/cmd.md) | Merkle Tree | |
| 最小版本选择 | [17.3](./part5toolchain/ch17modules/minimum.md) | Minimal Version Selection | MVS |
| 目标文件 | [3.4](./part1overview/ch03life/link.md) | Object File | |
| 竞争检查器 | [16.2](./part5toolchain/ch16tools/race.md) | Race Detector | |
| 重建判定 | [3.1](./part1overview/ch03life/cmd.md) | Rebuilding | |
| 重定位项 | [3.4](./part1overview/ch03life/link.md) | Relocation | |
| 可复现构建 | [3.1](./part1overview/ch03life/cmd.md) | Reproducible Build | |
| 语义导入版本 | [17.2](./part5toolchain/ch17modules/semantics.md) | Semantic Import Versioning | |
| 语义化版本 | [17.2](./part5toolchain/ch17modules/semantics.md) | Semantic Versioning | semver |
| 共享库 | [3.4](./part1overview/ch03life/link.md) | Shared Library | |
| 静态链接 | [3.4](./part1overview/ch03life/link.md) | Static Linking | |
| 符号 | [3.4](./part1overview/ch03life/link.md) | Symbol | |
| 符号解析 | [3.4](./part1overview/ch03life/link.md) | Symbol Resolution | |
| 拓扑序 | [3.6](./part1overview/ch03life/main.md) | Topological Order | |
| 拓扑排序 | [3.6](./part1overview/ch03life/main.md) | Topological Sort | |
