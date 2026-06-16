---
weight: 3000
title: "第三部分 并发"
bookCollapseSection: true
---

# 第三部分 并发

- [第 9 章 goroutine 调度器](./ch09sched)
- [第 10 章 通道与 select](./ch10chan)
- [第 11 章 同步原语与模式](./ch11sync)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>不要通过共享内存来通信，而要通过通信来共享内存。</I></br>
<I>Don't communicate by sharing memory, share memory by communicating.</I></br>
<div class="quote-right">
-- Rob Pike, "Go Proverbs"
</div>
</div>

并发是 Go 最鲜明的标识，也是它最容易被误用的部分。
这句广为流传的箴言点明了 Go 的取向：把同步的重担从程序员手中转移到由语言运行时托管的通道之上，
让数据的所有权随消息流动，而非散落在被锁守护的共享状态里。
本部分自底向上展开这一图景：先剖析 goroutine 调度器如何在少量系统线程上复用海量协程，
再深入通道与 select 的实现，看 CSP 模型如何落到具体的发送、接收与多路选择，
最后回到 sync 包提供的传统同步原语与常见并发模式。
唯有同时理解这两条路径，才能在真实工程里判断何时该用通信、何时仍需共享。
