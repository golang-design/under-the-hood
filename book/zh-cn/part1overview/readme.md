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

要理解一门语言的实现，先要理解它为何被设计成今天的样子。Go 并非凭空诞生，
它的每一处取舍都背负着 Unix、C 与 CSP 的传统，也背负着设计者对大规模工程中复杂度失控的长期忧虑。
本部分从设计哲学与历史脉络出发，先勾勒出语言的全景：它想解决什么问题，又刻意放弃了什么。
随后我们下沉到汇编与调用约定这一最贴近机器的层面，弄清函数、参数与栈帧在真实硬件上如何落地，
最后沿着一个程序从启动到退出的完整生命周期，把运行时的各个子系统串联成一条可被追踪的主线。
读懂这一部分，后续章节里那些看似零散的实现细节，才会回归到统一的设计意图之中。
