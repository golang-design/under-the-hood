---
weight: 9001
title: "Appendix A: Glossary"
---

# Appendix A: Glossary

This appendix lists the main terms used in the book, grouped by topic and sorted alphabetically by
English term within each group. Each entry links to the section that treats the term in detail, so
that readers can look it up quickly.

## Concurrency and Scheduling

| Term | Chapter | Chinese | Abbreviation |
| --- | --- | --- | --- |
| Actor Model | [1.3](./part1overview/ch01intro/csp.md) | Actor 模型 | |
| Alternate Signal Stack | [9.6](./part3concurrency/ch09sched/signal.md) | 备用信号栈 | sigaltstack |
| Asymmetric Coroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | 非对称协程 | |
| Async-Signal-Safe | [9.6](./part3concurrency/ch09sched/signal.md) | 异步信号安全 | |
| Asynchronous Preemption | [9.7](./part3concurrency/ch09sched/preemption.md) | 异步抢占 | |
| Back Edge | [9.7](./part3concurrency/ch09sched/preemption.md) | 回边 | |
| Channel | [10.1](./part3concurrency/ch10chan/model.md) | channel | chan |
| Communicating Sequential Processes | [1.3](./part1overview/ch01intro/csp.md) | 通信顺序进程 | CSP |
| Cooperative Preemption | [9.7](./part3concurrency/ch09sched/preemption.md) | 协作式抢占 | |
| Coroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | 协程 | |
| Daemon Thread | [3.6](./part1overview/ch03life/main.md) | 守护线程 | |
| Deadlock | [1.3](./part1overview/ch01intro/csp.md) | 死锁 | |
| Direct Handoff | [10.3](./part3concurrency/ch10chan/sendrecv.md) | 直接传递 | |
| Edge-Triggered | [9.9](./part3concurrency/ch09sched/poller.md) | 边沿触发 | ET |
| Full Coroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | 完全协程 | |
| Function Coloring | [9.3](./part3concurrency/ch09sched/mpg.md) | 函数染色 | |
| goroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | goroutine | G/g |
| Goroutine Leak | [9.3](./part3concurrency/ch09sched/mpg.md) | goroutine 泄漏 | |
| Guarded Command | [1.3](./part1overview/ch01intro/csp.md) | 守卫命令 | |
| I/O Multiplexing | [9.9](./part3concurrency/ch09sched/poller.md) | I/O 多路复用 | |
| Level-Triggered | [9.9](./part3concurrency/ch09sched/poller.md) | 水平触发 | LT |
| Machine | [9.3](./part3concurrency/ch09sched/mpg.md) | 工作线程 | M/m |
| Main Goroutine | [3.6](./part1overview/ch03life/main.md) | 主 goroutine | |
| Network Poller | [9.9](./part3concurrency/ch09sched/poller.md) | 网络轮询器 | netpoll |
| Non-spinning | [9.3](./part3concurrency/ch09sched/mpg.md) | 非自旋 | |
| Non-Uniform Memory Access | [9.11](./part3concurrency/ch09sched/numa.md) | 非均匀访存 | NUMA |
| One-shot Continuation | [9.3](./part3concurrency/ch09sched/mpg.md) | 一次性续延 | |
| Polling | [9.7](./part3concurrency/ch09sched/preemption.md) | 轮询 | |
| Preemptive | [9.7](./part3concurrency/ch09sched/preemption.md) | 抢占式 | |
| Processor | [9.3](./part3concurrency/ch09sched/mpg.md) | 处理器 | P/p |
| Rendezvous | [1.3](./part1overview/ch01intro/csp.md) | 会合 | |
| Runtime | [1.2](./part1overview/ch01intro/go.md) | 运行时 | |
| Safepoint | [9.7](./part3concurrency/ch09sched/preemption.md) | 安全点 | |
| Scheduler | [9](./part3concurrency/ch09sched/readme.md) | 调度器 | sched |
| Self-Pipe Trick | [9.6](./part3concurrency/ch09sched/signal.md) | 自管道技巧 | |
| Signal Chaining | [9.6](./part3concurrency/ch09sched/signal.md) | 信号链 | |
| Spinning | [9.4](./part3concurrency/ch09sched/schedule.md) | 自旋 | |
| Stackful Coroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | 有栈协程 | |
| Stackless Coroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | 无栈协程 | |
| Structured Concurrency | [3.6](./part1overview/ch03life/main.md) | 结构化并发 | |
| Symmetric Coroutine | [9.3](./part3concurrency/ch09sched/mpg.md) | 对称协程 | |
| System Monitor | [9.8](./part3concurrency/ch09sched/sysmon.md) | 系统监控 | sysmon |
| System Stack | [9.3](./part3concurrency/ch09sched/mpg.md) | 系统栈 | g0 |
| Template Thread | [9.5](./part3concurrency/ch09sched/thread.md) | 模板线程 | |
| Thread-Local Storage | [3.5](./part1overview/ch03life/boot.md) | 线程本地存储 | TLS |
| Time to Safepoint | [9.7](./part3concurrency/ch09sched/preemption.md) | 到达安全点的时间 | TTSP |
| Timer | [9.10](./part3concurrency/ch09sched/timer.md) | 计时器 | |
| Work Stealing | [9.2](./part3concurrency/ch09sched/steal.md) | 工作窃取 | |

## Synchronization and the Memory Model

| Term | Chapter | Chinese | Abbreviation |
| --- | --- | --- | --- |
| ABA Problem | [11.3](./part3concurrency/ch11sync/atomic.md) | ABA 问题 | |
| Atomic Operation | [11.3](./part3concurrency/ch11sync/atomic.md) | 原子操作 | |
| Barging | [11.2](./part3concurrency/ch11sync/mutex.md) | 插队 | |
| Compare-And-Swap | [11.3](./part3concurrency/ch11sync/atomic.md) | 比较并交换 | CAS |
| Condition Variable | [11.4](./part3concurrency/ch11sync/cond.md) | 条件变量 | |
| Consensus Number | [11.3](./part3concurrency/ch11sync/atomic.md) | 共识数 | |
| Cooperative Cancellation | [11.8](./part3concurrency/ch11sync/context.md) | 协作式取消 | |
| Critical Section | [11.2](./part3concurrency/ch11sync/mutex.md) | 临界区 | |
| Data Race | [11.9](./part3concurrency/ch11sync/mem.md) | 数据竞争 | |
| Data-Race-Free | [11.9](./part3concurrency/ch11sync/mem.md) | 免数据竞争 | DRF |
| Epoch-Based Reclamation | [11.3](./part3concurrency/ch11sync/atomic.md) | 纪元回收 | EBR |
| False Sharing | [12.2](./part4memory/ch12alloc/component.md) | 伪共享 | |
| Happens-Before | [11.9](./part3concurrency/ch11sync/mem.md) | 先行发生 | |
| Hazard Pointer | [11.3](./part3concurrency/ch11sync/atomic.md) | 危险指针 | |
| Litmus Test | [11.9](./part3concurrency/ch11sync/mem.md) | 石蕊测试 | |
| Lock-free | [11.3](./part3concurrency/ch11sync/atomic.md) | 无锁 | LF |
| Memory Barrier | [11.9](./part3concurrency/ch11sync/mem.md) | 内存屏障 | |
| Memory Consistency Model | [11.9](./part3concurrency/ch11sync/mem.md) | 内存一致模型 | |
| Monitor | [1.3](./part1overview/ch01intro/csp.md) | 管程 | |
| Multi-Copy Atomicity | [11.9](./part3concurrency/ch11sync/mem.md) | 多副本原子性 | |
| Obstruction-free | [11.3](./part3concurrency/ch11sync/atomic.md) | 无阻碍 | |
| Out-of-Thin-Air Value | [11.9](./part3concurrency/ch11sync/mem.md) | 凭空出现的值 | OOTA |
| Read-Copy-Update | [11.3](./part3concurrency/ch11sync/atomic.md) | 读-复制-更新 | RCU |
| Semaphore | [1.3](./part1overview/ch01intro/csp.md) | 信号量 | |
| Sequenced Before | [11.9](./part3concurrency/ch11sync/mem.md) | 程序次序先于 | |
| Sequential Consistency | [11.9](./part3concurrency/ch11sync/mem.md) | 顺序一致性 | SC |
| Spurious Wakeup | [11.4](./part3concurrency/ch11sync/cond.md) | 虚假唤醒 | |
| Store Buffer | [11.9](./part3concurrency/ch11sync/mem.md) | 存储缓冲 | |
| Synchronized Before | [11.9](./part3concurrency/ch11sync/mem.md) | 同步先于 | |
| Victim Cache | [11.6](./part3concurrency/ch11sync/pool.md) | victim 缓存 | |
| Wait-free | [11.3](./part3concurrency/ch11sync/atomic.md) | 无等待 | |
| Weak Ordering | [11.9](./part3concurrency/ch11sync/mem.md) | 弱序 | |

## Memory Allocation

| Term | Chapter | Chinese | Abbreviation |
| --- | --- | --- | --- |
| Arena | [12.3](./part4memory/ch12alloc/init.md) | 区域 | heapArena |
| Arena Hint | [12.3](./part4memory/ch12alloc/init.md) | 区域提示 | arenaHint |
| Commit | [12.3](./part4memory/ch12alloc/init.md) | 提交 | |
| External Fragmentation | [12.1](./part4memory/ch12alloc/basic.md) | 外部碎片 | |
| Fast Path | [12.1](./part4memory/ch12alloc/basic.md) | 快速路径 | |
| First Fit | [12.7](./part4memory/ch12alloc/pagealloc.md) | 首次适配 | |
| Free List | [12.2](./part4memory/ch12alloc/component.md) | 自由表 | |
| Heap | [12](./part4memory/ch12alloc/readme.md) | 堆 | |
| Heap Profile | [12.8](./part4memory/ch12alloc/mstats.md) | 堆剖面 | |
| Internal Fragmentation | [12.1](./part4memory/ch12alloc/basic.md) | 内部碎片 | |
| Large Object | [12.4](./part4memory/ch12alloc/largealloc.md) | 大对象 | |
| Malloc Header | [12.1](./part4memory/ch12alloc/basic.md) | 分配头 | |
| Page | [12.7](./part4memory/ch12alloc/pagealloc.md) | 页 | |
| Page Allocator | [12.7](./part4memory/ch12alloc/pagealloc.md) | 页分配器 | |
| Poisson Process | [12.8](./part4memory/ch12alloc/mstats.md) | 泊松过程 | |
| Radix Tree | [12.7](./part4memory/ch12alloc/pagealloc.md) | 基数树 | |
| Reserve | [12.3](./part4memory/ch12alloc/init.md) | 预留 | |
| Scavenging | [12.7](./part4memory/ch12alloc/pagealloc.md) | 归还 | |
| Size Class | [12.1](./part4memory/ch12alloc/basic.md) | 尺寸类 | |
| Slow Path | [12.1](./part4memory/ch12alloc/basic.md) | 慢速路径 | |
| Small Object | [12.5](./part4memory/ch12alloc/smallalloc.md) | 小对象 | |
| Summary | [12.7](./part4memory/ch12alloc/pagealloc.md) | 摘要 | |
| Tiny Allocator | [12.6](./part4memory/ch12alloc/tinyalloc.md) | 微对象分配器 | |
| Tiny Object | [12.6](./part4memory/ch12alloc/tinyalloc.md) | 微对象 | |

## Garbage Collection

| Term | Chapter | Chinese | Abbreviation |
| --- | --- | --- | --- |
| Bitmap | [13.5](./part4memory/ch13gc/sweep.md) | 位图 | |
| Card Table | [13.8](./part4memory/ch13gc/generational.md) | 卡表 | |
| Cleanup | [13.10](./part4memory/ch13gc/finalizer.md) | 清理函数 | |
| Collector | [13.1](./part4memory/ch13gc/basic.md) | 回收器 | |
| Conservative | [13.7](./part4memory/ch13gc/safe.md) | 保守式 | |
| Finalizer | [13.10](./part4memory/ch13gc/finalizer.md) | 终结器 | |
| Garbage Collection | [13](./part4memory/ch13gc/readme.md) | 垃圾回收 | GC |
| Generational Hypothesis | [13.8](./part4memory/ch13gc/generational.md) | 分代假设 | |
| Graph Flood | [13.11](./part4memory/ch13gc/greentea.md) | 图泛洪 | |
| Heap Goal | [13.3](./part4memory/ch13gc/pacing.md) | 堆目标 | |
| Hybrid Write Barrier | [13.2](./part4memory/ch13gc/barrier.md) | 混合写屏障 | |
| Liveness | [13.1](./part4memory/ch13gc/basic.md) | 存活性 | |
| Mark Assist | [13.4](./part4memory/ch13gc/mark.md) | 标记辅助 | |
| Mark Worker | [13.4](./part4memory/ch13gc/mark.md) | 标记工作者 | |
| Mark-Sweep | [13.1](./part4memory/ch13gc/basic.md) | 标记清扫 | |
| Mutator | [13.1](./part4memory/ch13gc/basic.md) | 赋值器 | |
| Pacer | [13.3](./part4memory/ch13gc/pacing.md) | 调步器 | |
| Proportional Sweep | [13.5](./part4memory/ch13gc/sweep.md) | 比例清扫 | |
| Ragged Barrier | [13.6](./part4memory/ch13gc/termination.md) | 不规则屏障 | |
| Reachability | [13.1](./part4memory/ch13gc/basic.md) | 可达性 | |
| Reference Counting | [13.13](./part4memory/ch13gc/unifiedgc.md) | 引用计数 | RC |
| Remembered Set | [13.8](./part4memory/ch13gc/generational.md) | 记忆集 | |
| Request Hypothesis | [13.9](./part4memory/ch13gc/roc.md) | 请求假设 | |
| Resurrection | [13.10](./part4memory/ch13gc/finalizer.md) | 复活 | |
| Soft Memory Limit | [13.3](./part4memory/ch13gc/pacing.md) | 软内存限制 | |
| Span Queue | [13.11](./part4memory/ch13gc/greentea.md) | span 队列 | spanQueue |
| Special Record | [13.10](./part4memory/ch13gc/finalizer.md) | 特殊记录 | special |
| Stack Map | [13.7](./part4memory/ch13gc/safe.md) | 栈映射 | |
| Stack Object | [13.7](./part4memory/ch13gc/safe.md) | 栈对象 | |
| Stop the World | [13.1](./part4memory/ch13gc/basic.md) | 停止一切 | STW |
| Sweep | [13.5](./part4memory/ch13gc/sweep.md) | 清扫 | |
| Sweep Generation | [13.5](./part4memory/ch13gc/sweep.md) | 清扫代 | sweepgen |
| Tracing | [13.13](./part4memory/ch13gc/unifiedgc.md) | 追踪 | |
| Tricolour Abstraction | [13.1](./part4memory/ch13gc/basic.md) | 三色抽象 | |
| Tricolour Invariant | [13.1](./part4memory/ch13gc/basic.md) | 三色不变式 | |
| Weak Pointer | [13.10](./part4memory/ch13gc/finalizer.md) | 弱指针 | |
| Write Barrier | [13.2](./part4memory/ch13gc/barrier.md) | 写屏障 | WB/wb |

## Execution Stack

| Term | Chapter | Chinese | Abbreviation |
| --- | --- | --- | --- |
| Contiguous Stack | [14.1](./part4memory/ch14stack/design.md) | 连续栈 | |
| Frame Pointer | [2.2](./part1overview/ch02asm/frame.md) | 帧指针 | |
| Hot Split | [14.1](./part4memory/ch14stack/design.md) | 热分裂 | |
| Prologue | [2.4](./part1overview/ch02asm/args.md) | 函数序言 | |
| Segmented Stack | [14.1](./part4memory/ch14stack/design.md) | 分段栈 | |
| Spill Space | [2.4](./part1overview/ch02asm/args.md) | 溢出区 | |
| Stack | [14](./part4memory/ch14stack/readme.md) | 栈 | |
| Stack Copy | [14.4](./part4memory/ch14stack/copy.md) | 栈拷贝 | |
| Stack Frame | [2.2](./part1overview/ch02asm/frame.md) | 栈帧 | |
| Stack Growth | [14.3](./part4memory/ch14stack/grow.md) | 栈增长 | |
| Stack Guard | [2.4](./part1overview/ch02asm/args.md) | 警戒线 | |
| Stack Pointer | [2.1](./part1overview/ch02asm/asm.md) | 栈指针 | SP |
| Stack Shrinking | [14.5](./part4memory/ch14stack/shrink.md) | 栈收缩 | |
| Unwinder | [6.3](./part2lang/ch06func/panic.md) | 栈展开器 | |

## Language Features and the Compiler

| Term | Chapter | Chinese | Abbreviation |
| --- | --- | --- | --- |
| ABI Wrapper | [2.3](./part1overview/ch02asm/callconv.md) | ABI 包装函数 | |
| Alias Declaration | [4.3](./part2lang/ch04type/alias.md) | 别名声明 | |
| Application Binary Interface | [2.3](./part1overview/ch02asm/callconv.md) | 应用二进制接口 | ABI |
| Argument Frame | [15.6](./part5toolchain/ch15compile/cgo.md) | 参数帧 | |
| Automatic Semicolon Insertion | [15.1](./part5toolchain/ch15compile/parse.md) | 自动分号插入 | |
| Basic Block | [3.2](./part1overview/ch03life/compile.md) | 基本块 | |
| Bounds-Check Elimination | [15.3](./part5toolchain/ch15compile/optimize.md) | 边界检查消除 | BCE |
| Boxing | [4.2](./part2lang/ch04type/interface.md) | 装箱 | |
| Callee-saved Register | [2.4](./part1overview/ch02asm/args.md) | 被调方保存寄存器 | |
| Calling Convention | [2.3](./part1overview/ch02asm/callconv.md) | 调用约定 | |
| Checked Exception | [7.1](./part2lang/ch07errors/value.md) | 受检异常 | |
| Closure | [6.1](./part2lang/ch06func/func.md) | 闭包 | |
| Closure Context Register | [6.1](./part2lang/ch06func/func.md) | 闭包上下文寄存器 | |
| Constraint | [8.2](./part2lang/ch08generics/contracts.md) | 约束 | |
| Contract | [8.2](./part2lang/ch08generics/contracts.md) | 合约 | |
| Core Type | [8.3](./part2lang/ch08generics/checker.md) | 核心类型 | |
| Dead-Code Elimination | [3.4](./part1overview/ch03life/link.md) | 死代码消除 | |
| Defer Bits | [6.2](./part2lang/ch06func/defer.md) | 延迟位图 | |
| Defer Statement | [6.2](./part2lang/ch06func/defer.md) | 延迟语句 | |
| Devirtualization | [15.3](./part5toolchain/ch15compile/optimize.md) | 去虚化 | |
| Dictionary Passing | [4.2](./part2lang/ch04type/interface.md) | 字典传递 | |
| Dynamic Dispatch | [4.2](./part2lang/ch04type/interface.md) | 动态分派 | |
| Error Tree | [7.2](./part2lang/ch07errors/inspect.md) | 错误树 | |
| Escape Analysis | [15.5](./part5toolchain/ch15compile/escape.md) | 逃逸分析 | |
| Export Data | [3.2](./part1overview/ch03life/compile.md) | 导出数据 | |
| F-bounded Polymorphism | [8.4](./part2lang/ch08generics/future.md) | F-有界多态 | |
| Fatal Error | [6.3](./part2lang/ch06func/panic.md) | 致命错误 | |
| First-class Citizen | [6](./part2lang/ch06func/readme.md) | 一等公民 | |
| GC Shape | [8.1](./part2lang/ch08generics/history.md) | GC 形状 | |
| GC Shape Stenciling | [8.1](./part2lang/ch08generics/history.md) | GC 形状模板化 | |
| Generic Method | [8.4](./part2lang/ch08generics/future.md) | 泛型方法 | |
| Gradual Code Repair | [4.3](./part2lang/ch04type/alias.md) | 渐进式代码修复 | |
| Higher-kinded Type | [8.4](./part2lang/ch08generics/future.md) | 高阶类型 | |
| Inline Tree | [15.3](./part5toolchain/ch15compile/optimize.md) | 内联树 | |
| Inlining | [15.3](./part5toolchain/ch15compile/optimize.md) | 内联 | |
| Inlining Cost | [15.3](./part5toolchain/ch15compile/optimize.md) | 内联成本 | |
| Interface Table | [4.2](./part2lang/ch04type/interface.md) | 接口表 | itab |
| Intrinsic | [15.2](./part5toolchain/ch15compile/ssa.md) | 内在函数 | |
| Iterative Stability | [15.3](./part5toolchain/ch15compile/optimize.md) | 迭代稳定性 | |
| Leaf Function | [9.7](./part3concurrency/ch09sched/preemption.md) | 叶函数 | |
| Method Expression | [6.1](./part2lang/ch06func/func.md) | 方法表达式 | |
| Method Set | [4.2](./part2lang/ch04type/interface.md) | 方法集 | |
| Method Value | [6.1](./part2lang/ch06func/func.md) | 方法值 | |
| Mid-Stack Inlining | [15.3](./part5toolchain/ch15compile/optimize.md) | 中栈内联 | |
| Monomorphization | [8.1](./part2lang/ch08generics/history.md) | 单态化 | |
| Nominal Type | [4.1](./part2lang/ch04type/type.md) | 名义类型 | |
| Opaque Error | [7.4](./part2lang/ch07errors/semantics.md) | 不透明错误 | |
| Open-coded Defer | [6.2](./part2lang/ch06func/defer.md) | 开放编码式延迟 | |
| Panic | [6.3](./part2lang/ch06func/panic.md) | 恐慌 | |
| Parameter Tag | [15.5](./part5toolchain/ch15compile/escape.md) | 参数标签 | |
| Pass | [15.2](./part5toolchain/ch15compile/ssa.md) | 趟 | |
| Pinning | [15.6](./part5toolchain/ch15compile/cgo.md) | 固定 | |
| Pointer Checker | [15.4](./part5toolchain/ch15compile/unsafe.md) | 指针检查器 | checkptr |
| Preamble | [15.6](./part5toolchain/ch15compile/cgo.md) | 序言 | |
| Profile-Guided Devirtualization | [15.3](./part5toolchain/ch15compile/optimize.md) | 按剖面去虚化 | |
| Profile-Guided Optimization | [15.3](./part5toolchain/ch15compile/optimize.md) | 性能制导优化 | PGO |
| Program Counter | [2.1](./part1overview/ch02asm/asm.md) | 程序计数器 | PC |
| Pseudo-register | [2.1](./part1overview/ch02asm/asm.md) | 伪寄存器 | |
| Recursive Descent | [15.1](./part5toolchain/ch15compile/parse.md) | 递归下降 | |
| Register | [2.1](./part1overview/ch02asm/asm.md) | 寄存器 | |
| Rewrite Rule | [15.2](./part5toolchain/ch15compile/ssa.md) | 重写规则 | |
| Sentinel Error | [7.4](./part2lang/ch07errors/semantics.md) | 哨兵错误 | |
| Separate Compilation | [16.7](./part5toolchain/ch16tools/gopls.md) | 分离编译 | |
| Source Stability | [15.3](./part5toolchain/ch15compile/optimize.md) | 源码稳定性 | |
| Specialization | [8.4](./part2lang/ch08generics/future.md) | 特化 | |
| Static Single Assignment | [15.2](./part5toolchain/ch15compile/ssa.md) | 静态单赋值 | SSA |
| Structural Typing | [4.2](./part2lang/ch04type/interface.md) | 结构化类型 | |
| Stub | [15.6](./part5toolchain/ch15compile/cgo.md) | 桩函数 | |
| Syntax Tree | [3.2](./part1overview/ch03life/compile.md) | 语法树 | |
| Token | [15.1](./part5toolchain/ch15compile/parse.md) | 词法单元 | |
| Transitive Inlining | [15.3](./part5toolchain/ch15compile/optimize.md) | 传递内联 | |
| Type Definition | [4.3](./part2lang/ch04type/alias.md) | 类型定义 | |
| Type Descriptor | [4.1](./part2lang/ch04type/type.md) | 类型描述符 | _type |
| Type Erasure | [8.1](./part2lang/ch08generics/history.md) | 类型擦除 | |
| Type Inference | [8.3](./part2lang/ch08generics/checker.md) | 类型推断 | |
| Type Parameter | [8.1](./part2lang/ch08generics/history.md) | 类型参数 | |
| Type Set | [8.3](./part2lang/ch08generics/checker.md) | 类型集 | |
| Unification | [8.3](./part2lang/ch08generics/checker.md) | 合一 | |
| Unified IR | [15.2](./part5toolchain/ch15compile/ssa.md) | 统一 IR | |
| Walk | [3.2](./part1overview/ch03life/compile.md) | 降级 | |
| Wrapper Function | [6.3](./part2lang/ch06func/panic.md) | 包装函数 | |
| Wrapping | [7.2](./part2lang/ch07errors/inspect.md) | 包装 | |

## Data Structures

| Term | Chapter | Chinese | Abbreviation |
| --- | --- | --- | --- |
| Amortized Analysis | [5.1](./part2lang/ch05data/slice.md) | 摊还分析 | |
| Chaining | [5.3](./part2lang/ch05data/map.md) | 链地址法 | |
| Collision | [5.3](./part2lang/ch05data/map.md) | 冲突 | |
| Control Word | [5.4](./part2lang/ch05data/swisstable.md) | 控制字 | |
| Dynamic Array | [5.1](./part2lang/ch05data/slice.md) | 动态数组 | |
| Extendible Hashing | [5.4](./part2lang/ch05data/swisstable.md) | 可扩展哈希 | |
| Full Slice Expression | [5.1](./part2lang/ch05data/slice.md) | 完整切片表达式 | |
| Hash Flooding | [5.3](./part2lang/ch05data/map.md) | 哈希洪水 | |
| Hash Trie | [11.7](./part3concurrency/ch11sync/map.md) | 散列字典树 | |
| Interning | [5.2](./part2lang/ch05data/string.md) | 驻留 | |
| Lazy Deletion | [9.10](./part3concurrency/ch09sched/timer.md) | 惰性删除 | |
| Load Factor | [5.3](./part2lang/ch05data/map.md) | 装载因子 | |
| Lock Striping | [11.7](./part3concurrency/ch11sync/map.md) | 锁分段 | |
| Open Addressing | [5.3](./part2lang/ch05data/map.md) | 开放定址法 | |
| Probe Sequence | [5.3](./part2lang/ch05data/map.md) | 探测序列 | |
| Ring Buffer | [10.2](./part3concurrency/ch10chan/impl.md) | 环形缓冲区 | |
| Timing Wheel | [9.10](./part3concurrency/ch09sched/timer.md) | 时间轮 | |
| Tombstone | [5.4](./part2lang/ch05data/swisstable.md) | 墓碑 | |

## Modules and the Toolchain

| Term | Chapter | Chinese | Abbreviation |
| --- | --- | --- | --- |
| Action | [3.1](./part1overview/ch03life/cmd.md) | 动作 | |
| Action Graph | [3.1](./part1overview/ch03life/cmd.md) | 动作图 | |
| Auxiliary Vector | [3.5](./part1overview/ch03life/boot.md) | 辅助向量 | auxv |
| Benchmark | [16.5](./part5toolchain/ch16tools/perf.md) | 基准测试 | |
| Bootstrapping | [3.3](./part1overview/ch03life/bootstrap.md) | 自举 | |
| Bubble | [16.1](./part5toolchain/ch16tools/deadlock.md) | 气泡 | |
| Build List | [17.3](./part5toolchain/ch17modules/minimum.md) | 构建列表 | |
| Checksum Database | [17.4](./part5toolchain/ch17modules/fight.md) | 校验和数据库 | |
| Content Addressing | [3.1](./part1overview/ch03life/cmd.md) | 内容寻址 | |
| Diamond Dependency | [17.1](./part5toolchain/ch17modules/challenges.md) | 钻石依赖 | |
| Directed Acyclic Graph | [3.6](./part1overview/ch03life/main.md) | 有向无环图 | DAG |
| Diverse Double-Compiling | [3.3](./part1overview/ch03life/bootstrap.md) | 多样化双重编译 | DDC |
| Durably Blocked | [16.1](./part5toolchain/ch16tools/deadlock.md) | 持久阻塞 | |
| Dynamic Linking | [3.4](./part1overview/ch03life/link.md) | 动态链接 | |
| Early Cutoff | [3.1](./part1overview/ch03life/cmd.md) | 提前截断 | |
| Epoch | [16.2](./part5toolchain/ch16tools/race.md) | 纪元 | |
| Execution Tracer | [16.3](./part5toolchain/ch16tools/trace.md) | 执行追踪器 | |
| Fixed Point | [3.3](./part1overview/ch03life/bootstrap.md) | 不动点 | |
| Flame Graph | [16.5](./part5toolchain/ch16tools/perf.md) | 火焰图 | |
| Flight Recorder | [16.3](./part5toolchain/ch16tools/trace.md) | 飞行记录仪 | |
| Fuzzing | [16.4](./part5toolchain/ch16tools/testing.md) | 模糊测试 | |
| High Dynamic Range Histogram | [16.6](./part5toolchain/ch16tools/metric.md) | HDR 直方图 | |
| High-Fidelity Build | [17.3](./part5toolchain/ch17modules/minimum.md) | 高保真构建 | |
| Import Compatibility Rule | [17.2](./part5toolchain/ch17modules/semantics.md) | 导入兼容性规则 | |
| Language Server Protocol | [16.7](./part5toolchain/ch16tools/gopls.md) | 语言服务协议 | LSP |
| Layout | [3.4](./part1overview/ch03life/link.md) | 布局 | |
| Linker | [3.4](./part1overview/ch03life/link.md) | 链接器 | |
| Low-Fidelity Build | [17.1](./part5toolchain/ch17modules/challenges.md) | 低保真构建 | |
| Mann–Whitney U Test | [16.5](./part5toolchain/ch16tools/perf.md) | Mann–Whitney U 检验 | |
| Merkle Tree | [3.1](./part1overview/ch03life/cmd.md) | Merkle 树 | |
| Minimal Version Selection | [17.3](./part5toolchain/ch17modules/minimum.md) | 最小版本选择 | MVS |
| Module Graph Pruning | [17.3](./part5toolchain/ch17modules/minimum.md) | 模块图剪枝 | |
| Object File | [3.4](./part1overview/ch03life/link.md) | 目标文件 | |
| Partial Deadlock | [16.1](./part5toolchain/ch16tools/deadlock.md) | 局部死锁 | |
| Profile | [16.5](./part5toolchain/ch16tools/perf.md) | 剖面 | |
| Profiling | [16.5](./part5toolchain/ch16tools/perf.md) | 剖析 | |
| Pseudo-Version | [17.2](./part5toolchain/ch17modules/semantics.md) | 伪版本 | |
| Race Detector | [16.2](./part5toolchain/ch16tools/race.md) | 竞态检测器 | |
| Rebuilding | [3.1](./part1overview/ch03life/cmd.md) | 重建判定 | |
| Relocation | [3.4](./part1overview/ch03life/link.md) | 重定位项 | |
| Reproducible Build | [3.1](./part1overview/ch03life/cmd.md) | 可复现构建 | |
| Runtime Metrics | [16.6](./part5toolchain/ch16tools/metric.md) | 运行时指标 | |
| Scheduling Latency | [16.3](./part5toolchain/ch16tools/trace.md) | 调度延迟 | |
| Seed Corpus | [16.4](./part5toolchain/ch16tools/testing.md) | 种子语料 | |
| Semantic Import Versioning | [17.2](./part5toolchain/ch17modules/semantics.md) | 语义化导入版本 | |
| Semantic Versioning | [17.2](./part5toolchain/ch17modules/semantics.md) | 语义化版本 | semver |
| Shadow Memory | [16.2](./part5toolchain/ch16tools/race.md) | 影子内存 | |
| Shared Library | [3.4](./part1overview/ch03life/link.md) | 共享库 | |
| Snapshot | [16.7](./part5toolchain/ch16tools/gopls.md) | 快照 | |
| Static Linking | [3.4](./part1overview/ch03life/link.md) | 静态链接 | |
| Static Lock Ranking | [16.1](./part5toolchain/ch16tools/deadlock.md) | 静态锁排序 | |
| Subtest | [16.4](./part5toolchain/ch16tools/testing.md) | 子测试 | |
| Symbol | [3.4](./part1overview/ch03life/link.md) | 符号 | |
| Symbol Resolution | [3.4](./part1overview/ch03life/link.md) | 符号解析 | |
| Table-Driven Test | [16.4](./part5toolchain/ch16tools/testing.md) | 表驱动测试 | |
| Topological Order | [3.6](./part1overview/ch03life/main.md) | 拓扑序 | |
| Topological Sort | [3.6](./part1overview/ch03life/main.md) | 拓扑排序 | |
| Transparent Log | [17.4](./part5toolchain/ch17modules/fight.md) | 透明日志 | |
| Trust on First Use | [17.4](./part5toolchain/ch17modules/fight.md) | 首次使用时信任 | TOFU |
| User Annotation | [16.3](./part5toolchain/ch16tools/trace.md) | 用户标注 | |
| Vector Clock | [16.2](./part5toolchain/ch16tools/race.md) | 向量时钟 | |
| Wait-for Graph | [16.1](./part5toolchain/ch16tools/deadlock.md) | 等待图 | |

## Heterogeneous Computing and AI

| Term | Chapter | Chinese | Abbreviation |
| --- | --- | --- | --- |
| Arithmetic Intensity | [18.4](./part6hetero/ch18gpu/model.md) | 算术强度 | |
| Autoregressive | [20.3](./part6hetero/ch20inference/serving.md) | 自回归 | |
| Backpressure | [20.3](./part6hetero/ch20inference/serving.md) | 背压 | |
| Batching | [19.1](./part6hetero/ch19graphics/pipeline.md) | 批处理 | |
| Byte Pair Encoding | [20.2](./part6hetero/ch20inference/tokenize.md) | 字节对编码 | BPE |
| Command Buffer | [19.1](./part6hetero/ch19graphics/pipeline.md) | 命令缓冲 | |
| Continuous Batching | [20.3](./part6hetero/ch20inference/serving.md) | 连续批处理 | |
| CUDA Driver API | [18.1](./part6hetero/ch18gpu/boundary.md) | 驱动 API | |
| CUDA Runtime API | [18.1](./part6hetero/ch18gpu/boundary.md) | 运行时 API | |
| Current Context | [19.2](./part6hetero/ch19graphics/bindings.md) | 当前上下文 | |
| Decision Point | [21.2](./part6hetero/ch21agent/mcp.md) | 决策点 | |
| Decode | [20.3](./part6hetero/ch20inference/serving.md) | 解码 | |
| Draw Call | [19.1](./part6hetero/ch19graphics/pipeline.md) | 绘制调用 | |
| Embarrassingly Parallel | [19.3](./part6hetero/ch19graphics/software.md) | 易并行 | |
| Explicit API | [19.1](./part6hetero/ch19graphics/pipeline.md) | 显式 API | |
| External Synchronization | [19.1](./part6hetero/ch19graphics/pipeline.md) | 外部同步 | |
| Extra M | [18.2](./part6hetero/ch18gpu/sched.md) | extra M | |
| Fixed-Function | [19.1](./part6hetero/ch19graphics/pipeline.md) | 固定功能 | |
| Graph Capture | [18.1](./part6hetero/ch18gpu/boundary.md) | 图捕获 | |
| Harness | [21.1](./part6hetero/ch21agent/loop.md) | 运行框架 | |
| Host | [21.2](./part6hetero/ch21agent/mcp.md) | 宿主 | |
| Instancing | [19.1](./part6hetero/ch19graphics/pipeline.md) | 实例化 | |
| Iteration-Level Scheduling | [20.3](./part6hetero/ch20inference/serving.md) | 迭代级调度 | |
| KV Cache | [20.1](./part6hetero/ch20inference/runtime.md) | KV 缓存 | |
| Launch Overhead | [18.1](./part6hetero/ch18gpu/boundary.md) | 启动开销 | |
| Main Thread | [19.2](./part6hetero/ch19graphics/bindings.md) | 主线程 | |
| Model Context Protocol | [21.2](./part6hetero/ch21agent/mcp.md) | Model Context Protocol | MCP |
| Narrow Waist | [21.2](./part6hetero/ch21agent/mcp.md) | 细腰 | |
| Page-Locked Memory | [18.3](./part6hetero/ch18gpu/memory.md) | 页锁定内存 | |
| Prefill | [20.3](./part6hetero/ch20inference/serving.md) | 预填充 | |
| Premultiplied Alpha | [19.4](./part6hetero/ch19graphics/wasm.md) | 预乘 alpha | |
| Quantization | [20.2](./part6hetero/ch20inference/tokenize.md) | 量化 | |
| Render Bundle | [19.4](./part6hetero/ch19graphics/wasm.md) | 渲染包 | |
| Rendering Pipeline | [19.1](./part6hetero/ch19graphics/pipeline.md) | 渲染管线 | |
| Roofline Model | [18.4](./part6hetero/ch18gpu/model.md) | Roofline 模型 | |
| Selective Batching | [20.3](./part6hetero/ch20inference/serving.md) | 选择性批处理 | |
| Shader | [19.1](./part6hetero/ch19graphics/pipeline.md) | 着色器 | |
| Single Instruction, Multiple Threads | [18.4](./part6hetero/ch18gpu/model.md) | 单指令多线程 | SIMT |
| Software Rendering | [19.3](./part6hetero/ch19graphics/software.md) | 软件渲染 | |
| Stream | [18.1](./part6hetero/ch18gpu/boundary.md) | 流 | |
| Stride | [20.2](./part6hetero/ch20inference/tokenize.md) | 步长 | |
| Stub Model | [21.1](./part6hetero/ch21agent/loop.md) | 桩模型 | |
| Thread Affinity | [19.2](./part6hetero/ch19graphics/bindings.md) | 线程亲和 | |
| Tiling | [19.3](./part6hetero/ch19graphics/software.md) | 分块 | |
| Time to First Token | [20.3](./part6hetero/ch20inference/serving.md) | 首词元时间 | TTFT |
| Token | [20.2](./part6hetero/ch20inference/tokenize.md) | 词元 | |
| Tokenizer | [20.2](./part6hetero/ch20inference/tokenize.md) | 分词器 | |
| Unified Memory | [18.3](./part6hetero/ch18gpu/memory.md) | 统一内存 | |
| Workflow | [21.1](./part6hetero/ch21agent/loop.md) | 工作流 | |
