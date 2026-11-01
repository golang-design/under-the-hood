---
weight: 1000
title: "第一部分 全景与历史"
bookCollapseSection: true
---

# 第一部分 全景与历史

- [第 1 章 设计哲学与历史](./ch01intro)
- [第 2 章 汇编与调用约定](./ch02asm)
- [第 3 章 程序的生命周期](./ch03life)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>简单性是可靠性的先决条件。</I></br>
<I>Simplicity is prerequisite for reliability.</I></br>
<div class="quote-right">
-- Edsger W. Dijkstra, "How do we tell truths that might hurt?" (EWD498)
</div>
</div>

本书后续各部分将深入讨论调度器、内存分配器、垃圾回收器与编译器。在此之前，本部分先回答三个更为基础
的问题。

第一，Go 为何形成了今天的面貌。第 1 章讨论 Go 诞生时所要解决的工程问题，它从 Unix、C 与 CSP 继承了
哪些思想，又有意舍弃了哪些。后续每一项实现上的取舍，几乎都能在这里找到动机。

第二，Go 代码在机器层面呈现为何种形态。运行时最底层的若干部分（切换 goroutine、扩展栈、原子操作）以
汇编实现。第 2 章介绍阅读这些汇编所需的基本知识：Go 自己的汇编语言，以及函数调用时参数与返回值的
存放位置。

第三，一个程序从源码到退出经历了哪些阶段。第 3 章追踪一个程序的完整过程：`go` 命令组织构建，编译器
与链接器生成可执行文件，运行时在 `main` 之前完成初始化，最后 `main` 返回、进程结束。这条线索把后续
各部分所讨论的子系统串联在一起。

读完本部分，读者应能理解 `go build -x` 输出的每一个步骤，能对照 Go 汇编读懂运行时中的一小段汇编
例程，也能说明一个 Go 程序在 `main` 之前与之后分别发生了什么。
