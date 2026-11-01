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
- [3.6 主 goroutine 的生与死](./main.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>充分的自举，本身就是一种自相矛盾的说法。</I></br>
<I>An adequate bootstrap is a contradiction in terms.</I></br>
<div class="quote-right">
-- Alan J. Perlis, "Epigrams on Programming"
</div>
</div>

用户编写的 `main` 函数并不是程序真正的起点，它的返回也不仅仅意味着一个函数的结束。本章沿着一个 Go
程序的完整生命周期展开：

1. `go` 命令把一次构建分解为许多步骤，并借助缓存跳过未发生变化的部分（3.1）；
2. 编译器把每个包的源码翻译为机器码，并在其中插入大量对运行时的调用（3.2）；
3. 编译器本身也由 Go 编写，需要由更早版本的 Go 编译而来（3.3）；
4. 链接器把所有包连同整个运行时组合为一个可执行文件（3.4）；
5. 操作系统启动该文件后，运行时先完成自身的初始化，再创建第一个 goroutine（3.5）；
6. 这个 goroutine 按依赖次序初始化所有包，调用 `main.main`，并在其返回时结束进程（3.6）。

这条线索贯穿全书。后续章节讨论的调度器、内存分配器和垃圾回收器，都在第 5 步中完成初始化，在第 6 步
开始为用户代码服务。由此也可以看出 Go 的一个基本特点：运行时与用户代码链接在同一个二进制文件中，在
同一个进程里一同启动、一同结束。
