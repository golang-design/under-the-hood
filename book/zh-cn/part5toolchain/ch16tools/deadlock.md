---
weight: 5201
title: "16.1 运行时死锁检查"
---

# 16.1 运行时死锁检查

`fatal error: all goroutines are asleep - deadlock!`,几乎每个 Go 程序员都见过这条错误。它来自
运行时内置的**死锁检测器**。这一节讲清它怎么工作、能检测什么、又有什么它**检测不了**的盲区,
后者尤其重要，是许多线上"卡死"之谜的根源。

## 16.1.1 全局死锁的判定

运行时的死锁检测逻辑藏在调度器的 `checkdead`（[9.8](../../part3concurrency/ch09sched/sysmon.md)）
里。它的判据极其简洁：**如果没有任何 goroutine 处于可运行状态，且不存在任何能让某个 goroutine
变为可运行的途径，那么程序就死锁了。** 具体说，当所有 goroutine 都阻塞在 channel、锁、
`WaitGroup` 等同步原语上等待，而没有任何一个还在运行、也没有等待网络或计时器（那些可能在
未来唤醒某人），就再没有人能推进,运行时据此判定死锁，打印所有 goroutine 的状态并终止。

## 16.1.2 它的盲区：只认"全局"死锁

这里有一个**关键的局限**，是无数线上故障的根源：运行时只能检测**全局**死锁,即**所有**
goroutine 都卡住。它**检测不了局部死锁**。设想一个 web 服务，主循环还在欢快地接受新请求
（有可运行的 goroutine），但某两个处理请求的 goroutine 因为锁顺序问题相互死锁、永久卡住,
此时"并非所有 goroutine 都睡着"，`checkdead` 不会报警，程序看似正常运行，实则那两个请求永远
不返回、那部分资源永久泄漏。这正是为什么"程序没崩、但某些请求挂起"这类问题难查,内置检测器
帮不上忙。

还有一个常见误解：检测器**也不认"还有网络/计时器在等"的情形**。一个所有 goroutine 都阻塞、但
其中有 goroutine 在等网络 I/O（[9.9](../../part3concurrency/ch09sched/poller.md)）的程序，不算
死锁,因为网络事件可能在未来唤醒它。所以一个纯等外部输入而对方永不发送的程序，不会被报成
死锁，而是静静地永远等下去。

## 16.1.3 该靠什么查死锁

既然内置检测器只管全局死锁，局部死锁就得靠别的手段。**goroutine 画像**（`pprof` 的 goroutine
profile，[16.5](./perf.md)）是利器,它能转储所有 goroutine 的当前栈，让你看到"哪些 goroutine
卡在哪一行、等什么"，从而定位相互死锁的那几个。`GODEBUG`、执行追踪（[16.3](./trace.md)）、
以及好的日志也有帮助。预防上，遵守一致的加锁顺序（[11.2](../../part3concurrency/ch11sync/mutex.md)）、
用 `context` 超时（[11.8](../../part3concurrency/ch11sync/context.md)）给可能永久阻塞的操作加
时限，是避免死锁的根本。

运行时死锁检测器是一个有用但**有明确边界**的工具。理解"它只认全局死锁"这条边界，比记住那条
错误信息更重要,它告诉你：看到 deadlock 报错算你走运（问题暴露了），真正难缠的是那些它**不报**
的局部死锁，那才是要靠 goroutine 画像去猎捕的猎物。

## 延伸阅读的文献

1. The Go Authors. *runtime/proc.go：checkdead.*
   https://github.com/golang/go/blob/master/src/runtime/proc.go
2. The Go Authors. *Diagnostics（goroutine profile 等诊断手段）.* https://go.dev/doc/diagnostics
3. 本书 [9.8 系统监控](../../part3concurrency/ch09sched/sysmon.md)、
   [11.2 互斥锁](../../part3concurrency/ch11sync/mutex.md)、[16.5 基准测试](./perf.md).
4. 本书 [11.8 上下文](../../part3concurrency/ch11sync/context.md)（用超时预防永久阻塞）.

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
