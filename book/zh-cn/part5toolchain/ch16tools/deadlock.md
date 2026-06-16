---
weight: 5201
title: "16.1 运行时死锁检查"
---

# 16.1 运行时死锁检查

`fatal error: all goroutines are asleep - deadlock!`,几乎每个 Go 程序员都见过这条错误。它来自
运行时内置的死锁检测器。这一节先讲清它怎么判定、何时被触发，再讲一件更要紧的事：它在理论上
能保证什么、又有什么是它**结构性地检测不了**的。后者是许多线上「卡死」之谜的根源，理解了它，
比记住那条错误信息更有价值。

我们先说结论，再看它如何从一段不到一百行的代码里得出。运行时的死锁检测器并不维护、也从不检查
一张「谁在等谁」的等待图（wait-for graph）。它只问两个极粗的问题：还有没有 M 在运行？将来有没有
计时器会触发？两个都答「没有」，它就宣告死锁。这种粗糙不是疏忽，它恰恰决定了检测器的能力边界,
本节后半会看到，正因为没有逐资源的等待边，它**无法**在一部分 goroutine 之间找出一个死锁环。

## 16.1.1 判据：只数运行中的 M，不看谁等谁

死锁检测逻辑藏在 `runtime/proc.go` 的 `checkdead` 里
（[9.8](../../part3concurrency/ch09sched/sysmon.md)）。它的判据可以一句话概括：**没有任何线程
还在运行，且没有任何途径能让某个 goroutine 重新变得可运行，程序就死锁了。** 落到代码，「没有
线程在运行」是一次减法,用机器线程总数减去各类空闲与系统线程：

```go
// checkdead：判定是否陷入全局死锁（裁剪后的速写）
// 调用时必须持有 sched.lock。
func checkdead() {
    // 作为 c-shared / c-archive 库被宿主程序嵌入时，没有运行中的 goroutine 是正常的,
    // 宿主仍在跑。panicking、cgo 额外 M 等情形也各自豁免（此处略）。
    if (islibrary || isarchive) && GOARCH != "wasm" {
        return
    }

    // run = 机器线程数 − 空闲 M − 持锁空闲 M − 系统 M，即「正在运行的 M」数。
    // run0 通常为 0（cgo 额外 M 存在时为 1）。只要还有 M 在运行，就不可能
    // 是全局死锁，立即返回。
    run := mcount() - sched.nmidle - sched.nmidlelocked - sched.nmsys
    if run > run0 {
        return
    }
    // ...（见下）
}
```

注意这里没有出现任何「锁」「channel」「WaitGroup」的字样。`checkdead` 不知道、也不关心每个
goroutine 究竟阻塞在哪个原语上,它只数还有几个 M 在跑。这是理解它全部行为的关键。

当 `run` 不大于零，确实没有线程在运行了，它再走一遍所有 goroutine 做两件事:一是**一致性
自检**,既然没有 M 在跑，就不该再有处于可运行 / 运行中 / 系统调用状态的 goroutine，若发现一个，
说明计数和状态自相矛盾，直接 `throw`;二是统计真正在等待的用户 goroutine 数：

```go
    grunning := 0
    forEachG(func(gp *g) {
        if isSystemGoroutine(gp, false) {
            return // 系统 goroutine（如 GC worker、sysmon 衍生）不计入
        }
        switch readgstatus(gp) &^ _Gscan {
        case _Gwaiting, _Gpreempted:
            grunning++ // 阻塞等待中：合法
        case _Grunnable, _Grunning, _Gsyscall:
            // 没有 M 在跑，却还有可运行的 g,计数不一致，运行时缺陷
            throw("checkdead: runnable g")
        }
    })
    if grunning == 0 {
        // 一个 goroutine 都没剩,通常是 main 调用了 runtime.Goexit()
        fatal("no goroutines (main called runtime.Goexit) - deadlock!")
    }
```

到这里，「所有用户 goroutine 都阻塞着」已经确认。但阻塞不等于死锁,还差最后一道闸:**计时器**。
若任何 P 的计时器堆里还有待触发的定时器，将来它会唤醒某个 goroutine，于是不算死锁：

```go
    // playground 的伪时间分支：若有 goroutine 在 Sleep，把时间快进到下一个计时器，
    // 唤醒它而非报死锁（此处略）。

    for _, pp := range allp {
        if len(pp.timers.heap) > 0 {
            return // 还有计时器会触发,未来有人会醒，不是死锁
        }
    }

    unlock(&sched.lock)
    fatal("all goroutines are asleep - deadlock!")
}
```

整个判定就是「数 M」加「扫计时器」两步。它简洁得近乎吝啬，却也正因此牢靠：能走到最后那行
`fatal` 的，必定是货真价实的全局停滞。

`checkdead` 何时被调用，也值得一提。它不是定时轮询的结果,在 sysmon 与 templateThread 启动时、
以及**每当一个 M 即将变为空闲**（`mput`）或退出（`mexit`）时都会被调用。换言之，检测发生在
「最后一个 M 准备停下」的那一刻,所以全局死锁一旦形成，几乎立即被报出，而非等某个轮询周期。

## 16.1.2 理论框架：可靠但不完备

用死锁检测的术语说，`checkdead` 是**可靠的**（sound）而**不完备的**（incomplete）。设程序的真实
死锁状态为 $D$，检测器的报告为 $R$，两者的关系是:

$$
R \Rightarrow D \quad(\text{可靠：报出必为真，无误报}), \qquad
D \not\Rightarrow R \quad(\text{不完备：真死锁未必报出，有漏报}).
$$

可靠性体现在它对每一种「看似无人运行、实则不然」的情形都设了豁免:作为 c-shared / c-archive
库被嵌入时（宿主仍在跑）、正在 panic 时、有 cgo 额外 M 时、还有计时器待触发时,都提前返回。
这些豁免存在的唯一目的，就是不冤枉一个并未死锁的程序。代价是不完备：它放过了一整类真实的
死锁，下一节就是它放过的东西。

这个取舍是 Go 有意为之。完备的死锁检测需要逐资源维护等待图并周期性查找环路，开销不小;而
全局死锁通常是程序逻辑错误，应在开发与测试期暴露。Go 选择用一个近乎零成本的全局检查覆盖最
常见、最致命的情形（整个程序卡死），把「环路检测」这件昂贵的事留给程序员与外部工具。

## 16.1.3 盲区：只认全局死锁，不认局部死锁

`checkdead` 既然只数运行中的 M，那么**只要还有一个 M 在跑，它就立即返回**。这条规则直接划出了
它的盲区:它只能发现**全局**死锁，即**所有** goroutine 都卡住的情形。一旦只是**一部分**
goroutine 相互死锁、而另一些仍在运行，`run > 0` 成立，检测器掉头就走，对那个局部死锁环视而
不见。这不是实现得不够好，而是「不看谁等谁」的判据在结构上做不到,没有等待边，就无从在子集里
找环。

最经典的局部死锁是两把锁的反序获取（AB-BA）。下面这段代码里，主循环还在欢快地派活，而某两个
worker 因加锁顺序相反相互卡死：

```go
var muA, muB sync.Mutex

func worker1() {
    muA.Lock()
    defer muA.Unlock()
    muB.Lock() // 等 worker2 释放 muB
    defer muB.Unlock()
}

func worker2() {
    muB.Lock()
    defer muB.Unlock()
    muA.Lock() // 等 worker1 释放 muA,与 worker1 互相等待，死锁
    defer muA.Unlock()
}

func main() {
    go worker1()
    go worker2()
    for { // 主循环始终可运行：有 M 在跑
        handle(<-requests)
    }
}
```

`worker1` 与 `worker2` 永久卡死，但 `main` 的 for 循环让至少一个 M 始终在运行，`checkdead`
判定 `run > 0`，一声不吭。程序看似正常,新请求照收，唯独那两个 goroutine 永不返回、它们持有的
锁与资源永久泄漏。这正是「程序没崩、但某些请求挂起」一类故障难查的根本原因：内置检测器帮不
上忙，它的设计就决定了它看不见。

还有一类常被误解的「假死锁」:**所有** goroutine 都阻塞，但其中有 goroutine 在等网络 I/O。这种
程序同样不会被报死锁，机制就在调度器的 `findRunnable` 里:当没有可运行的工作、但存在网络等待
者时，调度器会留一个 M 执行**阻塞式 `netpoll`** 等待事件就绪，而不让它作为空闲 M 停park。于是
`run > 0` 始终成立，`checkdead` 提前返回。背后的道理与计时器一致：网络事件可能在未来唤醒某人，
不能算死。所以一个纯等外部输入、而对方永不发送的程序，不会被报死锁，而是静静地永远等下去。

## 16.1.4 别家怎么做，以及该靠什么查局部死锁

把 Go 放进谱系里看会更清楚它的取舍。JVM 走另一条路:它在线程转储（`jstack` / 线程 dump）时
构建一张锁的等待图，能直接报出「线程 A 持有锁 1 等锁 2、线程 B 持有锁 2 等锁 1」的环，连
**局部**的锁死锁也指名道姓。数据库走得更远:InnoDB 与 PostgreSQL 在事务的锁等待图上检测环，
一旦发现就主动**中止一个牺牲者事务**（victim），让其余事务继续。它们都为「完备」付出了维护
等待图的运行时成本。Go 反其道而行,做最便宜的全局检查，把局部死锁的正确性责任推回给程序员
与外部工具。

既然内置检测器只管全局死锁，局部死锁就得另想办法。**goroutine 画像**（`pprof` 的 goroutine
profile，[16.5](./perf.md)）是最趁手的利器:它转储所有 goroutine 的当前栈，让你看到「哪些
goroutine 卡在哪一行、等什么」,上例里 `worker1` 与 `worker2` 双双停在 `Lock` 调用上，相互
死锁的环一目了然。执行追踪（[16.3](./trace.md)）与好的日志同样有帮助。预防上，根治之道是两条:
对同一组锁始终遵守一致的加锁顺序（[11.2](../../part3concurrency/ch11sync/mutex.md)），从源头
杜绝 AB-BA;以及用 `context` 超时（[11.8](../../part3concurrency/ch11sync/context.md)）给可能
永久阻塞的操作设上时限，让卡死的 goroutine 至少能在限期后醒来报错，而不是无声泄漏。

运行时死锁检测器是一个有用但**有明确边界**的工具。读者真正该记住的不是那条错误信息，而是它
那条边界:它只认全局死锁。看到 `deadlock` 报错，算你走运,问题被当场顶到了脸上;真正难缠的是
它**不报**的局部死锁，那才是要靠 goroutine 画像去猎捕的猎物。

## 延伸阅读的文献

1. The Go Authors. *runtime/proc.go：`checkdead`、`findRunnable`.*
   https://github.com/golang/go/blob/master/src/runtime/proc.go
2. E. G. Coffman, M. Elphick, A. Shoshani. *System Deadlocks.* ACM Computing Surveys, 3(2), 1971.
   https://dl.acm.org/doi/10.1145/356586.356588 （死锁的四个必要条件与等待图检测的经典框架）
3. The Go Authors. *Diagnostics（goroutine profile 等诊断手段）.* https://go.dev/doc/diagnostics
4. Oracle. *Java Platform: Detecting Deadlocks via Thread Dumps（`jstack` / `ThreadMXBean.findDeadlockedThreads`）.*
   https://docs.oracle.com/javase/8/docs/technotes/guides/troubleshoot/ （锁等待图式检测的对照）
5. Oracle. *MySQL Reference Manual: Deadlock Detection（InnoDB 锁等待图与牺牲者中止）.*
   https://dev.mysql.com/doc/refman/8.0/en/innodb-deadlock-detection.html
6. 本书 [9.8 系统监控](../../part3concurrency/ch09sched/sysmon.md)、
   [9.9 网络轮询器](../../part3concurrency/ch09sched/poller.md)、
   [11.2 互斥锁](../../part3concurrency/ch11sync/mutex.md)。
7. 本书 [11.8 上下文](../../part3concurrency/ch11sync/context.md)（用超时预防永久阻塞）、
   [16.3 执行追踪](./trace.md)、[16.5 性能剖析](./perf.md)（用 goroutine 画像定位局部死锁）。
