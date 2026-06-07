---
weight: 3304
title: "11.4 条件变量"
---

# 11.4 条件变量

条件变量解决"等待某个条件成立"的问题：一个 goroutine 持锁检查条件，若不满足就挂起并**释放锁**，
待别人改变状态并通知它，再被唤醒、重新持锁检查。`sync.Cond` 提供这一机制。它看似简单，
背后却藏着并发理论里一个经典而微妙的分歧,正是这个分歧，决定了它必须怎么用。

```go
c := sync.NewCond(&sync.Mutex{})

// 等待方
c.L.Lock()
for !condition() {   // 必须用 for，而非 if（原因见下）
    c.Wait()         // 原子地：解锁 + 挂起；被唤醒后重新加锁
}
// ... 条件已满足，处理 ...
c.L.Unlock()

// 通知方
c.L.Lock()
changeState()
c.Signal()           // 唤醒一个等待者；Broadcast() 唤醒全部
c.L.Unlock()
```

## 11.4.1 监管程与两种 signal 语义

条件变量源自**监管程**（monitor）这一并发抽象。Hoare 1974 年提出监管程时，给出的是
**signal-and-wait** 语义：通知方 `signal` 后**立即**把锁和 CPU 让给被唤醒的等待者，等待者醒来时
条件**保证**仍成立。这很优雅，但实现代价高（要在 signal 处做一次精确的控制权移交）。

几年后，Lampson 与 Redell 在 Xerox 的 **Mesa** 语言里（1980）改用了 **signal-and-continue**
语义：通知方 `signal` 后**继续**持锁运行，被唤醒的等待者只是被移到就绪队列，要稍后才能重新
抢到锁。这带来一个深远的后果:等待者真正醒来、拿回锁时，条件**可能已经又不成立了**,因为在它
"被通知"与"真正运行"之间，别的线程可能抢先改回了状态，或者 `Broadcast` 唤醒了多个等待者而只有
部分能继续，又或者发生了虚假唤醒。

**这就是为什么 `Wait` 必须放在 `for` 循环里而非 `if`**：醒来后必须再查一遍条件，不成立就接着等。
几乎所有现代条件变量,Go 的 `sync.Cond`、POSIX 的 `pthread_cond`、Java 的
`Object.wait`/`Condition`,都采用 Mesa 的 signal-and-continue 语义，所以"`Wait` 用 `for` 包起来"
是一条放之四海皆准的铁律,写成 `if` 就是经典的并发 bug。一个看似琐碎的代码风格规定，根源
竟在 1980 年的一个语义抉择，这正是理论照进实践的好例子。

## 11.4.2 在 Go 里它常被 channel 取代

`sync.Cond` 在 Go 的并发工具里相当冷门，原因是它的大多数用途，channel 表达得更自然。
"等一个事件发生"可以用关闭 channel 来广播（`close(ch)` 唤醒所有接收者，正对应 `Broadcast`）;
"等一个值就绪"可以直接从 channel 接收。channel 自带的 happens-before 保证（[11.9](./mem.md)）
还省去手动配锁的心智负担。因此 Go 社区的经验法则是：先想想能不能用 channel;只有在"大量
goroutine 等待同一个频繁变化的共享条件、且用 channel 反而更绕"时，`sync.Cond` 才真正派上用场
（标准库里 `io.Pipe` 等少数地方用到它）。它没有被移除，但确是一件"备而少用"的工具,这本身也
反映了 Go"以通信优先于共享内存"的取向。

## 延伸阅读的文献

1. C. A. R. Hoare. "Monitors: An Operating System Structuring Concept." *CACM*, 17(10),
   1974. https://doi.org/10.1145/355620.361161 （监管程与 signal-and-wait）
2. Butler W. Lampson, David D. Redell. "Experience with Processes and Monitors in Mesa."
   *CACM*, 23(2), 1980. https://doi.org/10.1145/358818.358824
   （Mesa 的 signal-and-continue 语义,for 循环规则的根源）
3. The Go Authors. *sync.Cond 文档.* https://pkg.go.dev/sync#Cond
4. The Go Authors. *The Go Memory Model.* https://go.dev/ref/mem

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
