---
weight: 1300
title: "第 3 章 程序的生命周期"
bookCollapseSection: true
---

# 第 3 章 程序的生命周期

- [3.1 从 `go` 命令谈起](./cmd.md)
- [3.2 Go 程序编译流程](./compile.md)
- [3.3 语言的自举](./bootstrap.md)
- [3.4 模块链接](./link.md)
- [3.5 Go 程序启动引导](./boot.md)
- [3.6 主 Goroutine 的生与死](./main.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>一个完备的自举本身就是自相矛盾的。</I></br>
<I>An adequate bootstrap is a contradiction in terms.</I></br>
<div class="quote-right">
-- Alan J. Perlis, "Epigrams on Programming"
</div>
</div>

读者敲下的 `main` 函数，从来不是程序真正的起点。一行源码要成为一个跑起来的进程，先得穿过一条
很长的链：`go` 命令把构建拆成行动图并交给编译器与链接器，编译器自己又得由上一版 Go 自举而来，
链接器把整个运行时一并拼进二进制，操作系统加载后由汇编入口铺出第一个 goroutine，最终才轮到
`main.main` 执行，又在它返回的那一刻带走整个进程。本章顺着这条生命线走一遍，把「在 `main`
之前与之后究竟发生了什么」一处不漏地讲清，它既是全书后续各部分（运行时、并发、内存、工具链）
的总入口，也是理解 Go「运行时与用户代码同居一个二进制」这一根本特征的起点。
