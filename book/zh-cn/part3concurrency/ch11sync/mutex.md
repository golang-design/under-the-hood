---
weight: 3302
title: "11.2 互斥锁"
---

# 11.2 互斥锁

`sync.Mutex` 是最朴素的同步原语：同一时刻只让一个 goroutine 进入临界区。朴素的接口之下，它要在
两个互相拉扯的目标间反复权衡，**吞吐**（让锁尽快被某人拿走，别让 CPU 闲着）与**公平**（别让某个
倒霉的等待者永远排不到队）。这两者无法同时拉满：把锁严格按到达次序移交，最公平，却要为每次交接
付一次上下文切换；放任刚醒来的与正在跑的自由竞争，最快，却可能让某个等待者一次次落空。这一节
先把互斥这个古老问题的理论与硬件地基铺开，再看 Go 的 mutex 如何在这条钢丝上行走。

## 11.2.1 互斥问题与它的硬件地基

互斥是并发理论最早的课题之一。Dijkstra 于 1965 年形式化了「互斥问题」，并给出第一个不借助任何
硬件特殊指令、仅凭普通读写就能让多个进程轮流进入临界区的软件解。其后 Lamport 于 1974 年的
**面包店算法**（bakery algorithm）把这条路走到了一个漂亮的终点：每个想进临界区的线程先「取号」，
再按号码从小到大依次进入，既保证互斥，又保证先到先得的公平排队，而全程只用普通读写，不需要任何
原子读改写指令。

纯软件解在理论上自足，工程上却昂贵：面包店算法要遍历所有线程的号码，开销随线程数增长，且严重
依赖顺序一致的内存模型（[11.9](./mem.md)），在现代弱序硬件上还得另加屏障。因此现代锁不再走纯软件
这条路，而是直接站在硬件提供的**原子读改写**指令之上，比较并交换（compare-and-swap, CAS）、
取后加（fetch-and-add）等（[11.3](./atomic.md)）。一条 CAS 就能原子地完成面包店算法要好几步才能
模拟的事，地基一换，上层设计随之改观。

围绕这些原语，锁长出了一个谱系，理解它有助于看清 Go 的 mutex 站在哪里。

- **自旋锁**（spin lock）最简单：用一个 CAS 反复试，抢到就进，抢不到就原地空转再试。它在低竞争
  下近乎零成本，但高竞争下是灾难：多个核心争同一个锁变量，每次 CAS 都让那条缓存行在核心之间
  来回失效、重取，称为**缓存行弹跳**（cache-line bouncing），竞争者越多越糟。
- **票号锁**（ticket lock）用 fetch-and-add 发号，再让每个线程自旋等自己的号被叫到，由此恢复了
  FIFO 公平。但所有等待者仍然自旋在同一个「当前服务号」变量上，缓存行弹跳的老问题并未根除。
- **MCS 锁**（Mellor-Crummey 与 Scott，1991）是高扩展性锁的经典之作。它让每个等待者把自己挂进
  一条**显式队列**，并各自自旋在**自己的**本地变量上，前一个持锁者释放时只去写后继者的那个本地
  变量。如此一来，无论多少竞争者，每次交接只触动一条缓存行，竞争下的缓存流量降到常数。

以上都是「忙等」一脉，等待者占着 CPU 空转。另一条线把「睡眠等待」做廉价。早年线程要阻塞只能
陷入内核，即便锁根本没有竞争也要付系统调用的代价。Linux 的 **futex**（fast userspace mutex，
Franke、Russell 与 Kirkwood，2002）解决了这个痛点：无竞争时加解锁纯在用户态用一次原子操作完成，
只有真要阻塞或唤醒等待者时，才带着那个用户态地址陷入内核去排队。几乎所有现代用户态锁，包括 Go
的 mutex，都踩在 futex（及各平台的等价物）这块「用户态快、内核态兜底」的地基上。Go 自己不直接
调 futex，而是由运行时的信号量（`runtime_SemacquireMutex` / `runtime_Semrelease`）封装各平台的
底层阻塞原语，对上层呈现统一接口。

## 11.2.2 状态字与快路径：无竞争时几乎零成本

Go 的 mutex 把一把锁压缩成两个字段：一个状态字加一个信号量。

```go
type Mutex struct {
    state int32  // 位域：bit0 已上锁, bit1 有被唤醒者, bit2 饥饿模式, 其余高位 等待者数
    sema  uint32 // 用于阻塞 / 唤醒等待者的信号量
}

const (
    mutexLocked      = 1 << iota // bit0：是否已上锁
    mutexWoken                   // bit1：是否已有一个被唤醒、正在抢锁的等待者
    mutexStarving                // bit2：是否处于饥饿模式
    mutexWaiterShift = iota      // = 3，高位 state>>3 记录等待者数量
    starvationThresholdNs = 1e6  // 1ms：切入饥饿模式的等待阈值
)
```

把多种信息塞进同一个 `int32`，是为了让一次原子操作同时读到、改到锁的全部关键状态：是否上锁、
有无被唤醒者、是否饥饿、还有几个等待者。低三位是标志位，高位是等待者计数，加减一个等待者就是给
`state` 加减 `1<<mutexWaiterShift`。这种位域编码让加锁的快路径退化成对一个整数的单次 CAS。

无人竞争时，上锁只是把 `state` 从 0（未锁、无等待者）原子地改成 `mutexLocked`：

```go
func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        return // 快路径：一次 CAS 成功，全程不进内核
    }
    m.lockSlow() // CAS 失败说明有竞争，转入慢路径
}
```

这条快路径不进内核、不睡眠，是 mutex 被高频使用却仍然轻快的关键，绝大多数加解锁到此为止。只有
CAS 失败，说明锁正被占着或已有等待者，才落入慢路径 `lockSlow`。解锁对称地走快路径：把
`mutexLocked` 位减掉，若减完 `state` 恰为 0（没有等待者、没有别的标志），则一切结束，连
`unlockSlow` 都不必进。

## 11.2.3 慢路径：先自旋，再睡眠

竞争发生时，goroutine 并不立刻去睡。睡眠和唤醒都要与运行时打交道，代价不菲；而锁常常只被短暂
持有，马上就会释放。于是 `lockSlow` 先**自旋**几轮，赌锁会很快空出来，赌赢了就省下一整轮睡眠唤醒。

自旋有严格的准入条件，不满足任何一条就放弃自旋、转去睡眠：

```go
func (m *Mutex) lockSlow() {
    var waitStartTime int64
    starving, awoke, iter := false, false, 0
    old := m.state
    for {
        // 仅在「已上锁且非饥饿模式」且 runtime 判定值得自旋时，才空转
        if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
            // 自旋前置一个 mutexWoken 标志，告诉 Unlock 不必再唤醒别人
            if !awoke && old&mutexWoken == 0 && old>>mutexWaiterShift != 0 &&
                atomic.CompareAndSwapInt32(&m.state, old, old|mutexWoken) {
                awoke = true
            }
            runtime_doSpin() // 执行若干次 PAUSE 指令
            iter++
            old = m.state
            continue
        }
        // ……自旋条件不再满足：计算新状态，CAS 入队，挂到信号量上睡去（细节见下）
    }
}
```

`runtime_canSpin` 把「值得自旋」收得很紧：必须是多核机器、自旋次数没超过上限（默认 4 次）、本地
运行队列里没有等着跑的其他 goroutine。换言之，只有在「很可能马上拿到锁、且空转不会饿死别人」时
才自旋；一旦锁处于饥饿模式，或自旋次数耗尽，就老实把自己挂到信号量 `sema` 上睡去，等持锁者解锁
时再唤醒。这种「短等自旋、长等睡眠」的混合策略并非 Go 独创，pthread 的自适应互斥锁
（`PTHREAD_MUTEX_ADAPTIVE_NP`）、Java 的偏向 / 轻量级锁、parking_lot 等都采用同一思路，区别只在
自旋多久、何时放弃的阈值。

## 11.2.4 公平：正常模式与饥饿模式

mutex 最见功力的设计，是它在 Go 1.9 引入的两种模式。它们对应 11.2.1 里那条钢丝的两端：一端追求
吞吐，一端守住公平。

```mermaid
stateDiagram-v2
    [*] --> Normal
    Normal --> Normal: 新来者与被唤醒者竞争 (barging, 吞吐优先)
    Normal --> Starving: 某等待者排队超过 1ms
    Starving --> Starving: 解锁时直接 FIFO 移交队首等待者
    Starving --> Normal: 队列排空, 或队首等待 < 1ms
```

**正常模式**追求吞吐。等待者按 FIFO 排队，但刚被唤醒的等待者并不直接拿到锁，它要和当下正在运行、
也想加锁的**新来者**竞争同一把锁。新来者有天然优势：它正跑在 CPU 上，无需经历唤醒；被唤醒者却
刚从睡眠中爬起，还没真正调度上来。于是新来者常常「插队」（barging）抢到锁。barging 减少了上下文
切换、显著提升了吞吐，代价是那个被唤醒却没抢过的等待者可能被反复挤回队首、一次次落空，陷入饥饿。

为兜住这种最坏情况的尾延迟，mutex 引入**饥饿模式**。当某个等待者从入队到拿锁的等待时间超过
**1ms**（`starvationThresholdNs`）仍未成功，它就在拿到锁的那一刻把 mutex 切入饥饿模式。此后规则
反转：解锁时不再允许任何人插队，而是**直接把锁的所有权 FIFO 移交**给队首等待者（解锁时连
`mutexLocked` 位都不置，由被移交者醒来后自己置上）；新来的 goroutine 即便看到锁「像是空的」也不
尝试获取、不自旋，老实排到队尾。等到队列排空、或队首等待者这次只等了不到 1ms，再切回正常模式。

这套机制顺带解开了一个读者常有的疑问：[既然解锁时唤醒的是 FIFO 队首者，为什么还会饿死等待者](https://github.com/golang-design/under-the-hood/issues/80)？关键在于，正常模式下「唤醒」不等于
「移交锁」。`unlockSlow` 取得「唤醒一人」的权利后，唤的确实是队首等待者，但它醒来后还得和新来者
重新竞争，被唤醒只是拿到一张参赛券，不是锁本身：

```go
func (m *Mutex) unlockSlow(new int32) {
    if new&mutexStarving == 0 {
        // 正常模式
        old := new
        for {
            // 无等待者，或已有人被唤醒 / 抢到锁 / 已是饥饿模式，则无需再唤醒任何人
            if old>>mutexWaiterShift == 0 ||
                old&(mutexLocked|mutexWoken|mutexStarving) != 0 {
                return
            }
            // 取得「唤醒一人」的权利：等待者计数减一，置 mutexWoken
            new = (old - 1<<mutexWaiterShift) | mutexWoken
            if atomic.CompareAndSwapInt32(&m.state, old, new) {
                runtime_Semrelease(&m.sema, false, 1) // 唤醒队首者，但它仍要去抢锁
                return
            }
            old = m.state
        }
    } else {
        // 饥饿模式：把所有权直接交给队首者，handoff=true 表示 FIFO 移交
        runtime_Semrelease(&m.sema, true, 1)
    }
}
```

两种模式合起来，让 mutex 绝大多数时候享受 barging 带来的高吞吐，又用 1ms 阈值为最坏情况兜底：
任何等待者最多被插队一阵子，超过 1ms 必然以 FIFO 顺序拿到锁。正常模式效率高，因为一个 goroutine
即便面前堆着一群阻塞的等待者，也能连续多次抢到同一把锁；饥饿模式则专门压制病态的尾延迟。

## 11.2.5 别家怎么做：公平性光谱

「吞吐优先、有界兜底」并非 Go 独有，而是工业界反复收敛到的折中。把各家锁按公平性排开，会得到
一条光谱，两端分别是「完全公平」（严格 FIFO 直接移交，无饥饿但吞吐低、交接开销大）与「完全不
公平」（自由 barging，吞吐高但可能饿死等待者）。

- **Java 的 `ReentrantLock`** 干脆把选择交给用户：构造时可指定公平或非公平两种锁。默认是**非公平**
  锁，理由与 Go 选 barging 一致，吞吐更高；公平锁严格按 FIFO 发放，适合对延迟敏感、不能容忍饥饿
  的场景，但吞吐明显更低。
- **Rust 的 `parking_lot`** 走「最终公平」（eventual fairness）：平时放任 barging 抢吞吐，但每隔
  一小段时间（约 1ms 量级）强制一次公平移交，确保等待者不会无限饥饿。思路与 Go 的饥饿模式异曲
  同工，只是触发条件由「时间间隔」而非「单个等待者的等待时长」决定。

Go 的 1ms 阈值，就是这条光谱上一个具体而精到的取舍点：默认吃 barging 的吞吐红利，用一个固定时间
上界把公平性兜成「有界等待」。值得一提的是，这个阈值是工程经验值而非理论最优，它在「兜底太晚
导致可感知卡顿」与「兜底太频繁拖累吞吐」之间取了个折中。

## 11.2.6 读写锁与 TryLock

`sync.RWMutex` 在互斥之上区分读者与写者：多个读者可同时持有锁，写者则独占。它适合读多写少的
场景，但要当心其中的取舍，若持续有读者到来，写者可能长期拿不到锁（写者饥饿）。Go 的实现为此让
后到的读者在已有写者等待时也阻塞，以免写者被读者无限拖延。RWMutex 的 happens-before 保证（一次
`Unlock` 同步先于其后的 `Lock`、`RUnlock` 同步先于其后的 `Lock`）见 [11.9](./mem.md)。

`TryLock`（以及 `RWMutex` 的 `TryLock` / `TryRLock`，均于 Go 1.18 加入）尝试加锁但**绝不阻塞**：
拿到返回 `true`，拿不到立即返回 `false`。它的用途很窄，官方文档专门提醒：正确使用 `TryLock` 的
场合确实存在，但很少，频繁依赖 `TryLock` 往往是某处锁用法本身有设计问题的信号。从内存模型看，
一次成功的 `TryLock` 等价于一次 `Lock`，而失败的 `TryLock` 不建立任何 synchronizes-before 关系。

> 实现位置的小注：自 Go 1.24 起，`Mutex`、`RWMutex` 等核心实现下沉到 `internal/sync` 包，标准库
> 的 `sync.Mutex` 退化为一层薄包装（内嵌一个 `internal/sync.Mutex` 与一个 `noCopy` 标记，方法直接
> 转调）。这次搬迁是为了让运行时等内部包也能复用同一份实现而不形成对 `sync` 的循环依赖，本节描述
> 的状态字、快慢路径、两种模式等机制并未改变。

## 11.2.7 工程取舍

mutex 的设计处处是权衡，而每一处都印证了那句老话：性能的提升从不白来，它总伴着复杂度的重新
安置。用状态字位域把多种信息压进一个 `int32`，省下的是加锁路径上的原子操作次数，付出的是位运算
的晦涩；用自旋赌一把短等待，赌赢省下睡眠唤醒，赌输则白白空转了几轮；用 barging 换吞吐，又不得不
再加一套饥饿模式与 1ms 阈值来为公平兜底，整个 `lockSlow` 的复杂度，多半来自这层兜底。

把 mutex 放回 Go 并发的全景里，它和 [channel](../ch10chan/) 代表了两种风格：mutex 直白地表达
「互斥」，channel 表达「通信」。Go 的格言「不要以共享内存来通信，而要以通信来共享内存」推荐后者，
但这是倾向而非禁令。该用哪个，取决于你要表达的是「保护一块共享状态」还是「在 goroutine 间传递
数据的所有权」，而非哪个「更高级」。下一节转向 mutex 脚下那块原子读改写的地基本身（[11.3](./atomic.md)）。

## 延伸阅读的文献

1. Edsger W. Dijkstra. "Solution of a Problem in Concurrent Programming Control."
   *Communications of the ACM*, 8(9), 1965. https://doi.org/10.1145/365559.365617
   （互斥问题的形式化与第一个软件解）
2. Leslie Lamport. "A New Solution of Dijkstra's Concurrent Programming Problem."
   *Communications of the ACM*, 17(8), 1974. https://doi.org/10.1145/361082.361093
   （面包店算法）
3. John M. Mellor-Crummey, Michael L. Scott. "Algorithms for Scalable Synchronization on
   Shared-Memory Multiprocessors." *ACM TOCS*, 9(1), 1991.
   https://doi.org/10.1145/103727.103729 （MCS 锁与可扩展锁的奠基）
4. Hubertus Franke, Rusty Russell, Matthew Kirkwood. "Fuss, Futexes and Furwocks:
   Fast Userlevel Locking in Linux." *Proceedings of the Ottawa Linux Symposium*, 2002.
   （futex，用户态快锁的地基）
5. Dmitry Vyukov. *sync: make Mutex more fair*（Go 1.9 饥饿模式）, 2016.
   https://go-review.googlesource.com/c/go/+/34310 ；相关讨论见 issue #13086。
6. The Go Authors. *runtime/internal 的 Mutex 实现.* `src/internal/sync/mutex.go`、
   `src/sync/mutex.go`. https://github.com/golang/go/tree/master/src/internal/sync
7. The Go Authors. *The Go Memory Model: Locks.* https://go.dev/ref/mem
8. 本书 [11.3 原子操作](./atomic.md)、[11.9 内存一致模型](./mem.md)。

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
