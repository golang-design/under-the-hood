---
weight: 3304
title: "11.4 条件变量"
---

# 11.4 条件变量

条件变量解决的是「等待某个条件成立」的问题：一个 goroutine 持锁检查条件，若不满足就挂起
并**释放锁**，待别人改变了状态并通知它，再被唤醒、重新持锁检查。`sync.Cond` 提供这一机制。

```go
c := sync.NewCond(&sync.Mutex{})

// 等待方
c.L.Lock()
for !condition() {   // 必须用 for，而非 if
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

## 11.4.1 为什么 Wait 必须放在 for 里

`Wait` 唤醒后并不保证条件就一定成立：可能是 `Broadcast` 唤醒了所有人而只有部分能继续，
也可能存在虚假唤醒，更可能在你被唤醒、重新拿到锁之前，又有别人把条件改回去了。所以条件检查
必须放在循环里，醒来后再查一遍，不满足就接着等。把 `if` 写成 `for` 是条件变量的铁律，
写错了就是经典的并发 bug。

## 11.4.2 在 Go 里它常被 channel 取代

`sync.Cond` 在 Go 的并发工具里相当冷门，原因是它的大多数用途，channel 表达得更自然。
「等一个事件发生」可以用关闭 channel 来广播（`close(ch)` 会唤醒所有接收者，正对应
`Broadcast`）；「等一个值就绪」可以直接从 channel 接收。channel 自带的 happens-before 保证
（[11.9](./mem.md)）还省去了手动配锁的心智负担。因此 Go 社区的经验法则是：先想想能不能用
channel；只有在「大量 goroutine 等待同一个频繁变化的共享条件、且用 channel 反而更绕」时，
`sync.Cond` 才真正派上用场。它没有被移除，但确实是一件「备而少用」的工具。

## 延伸阅读的文献

1. The Go Authors. *sync.Cond 文档.* https://pkg.go.dev/sync#Cond
2. C. A. R. Hoare. "Monitors: An Operating System Structuring Concept."
   *Communications of the ACM*, 17(10), 1974. https://doi.org/10.1145/355620.361161
   （管程与条件变量的源头）

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
