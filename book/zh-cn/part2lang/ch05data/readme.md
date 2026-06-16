---
weight: 2200
title: "第 5 章 数据结构"
bookCollapseSection: true
---

# 第 5 章 数据结构

- [5.1 数组、切片与字符串](./slice.md)
- [5.2 散列表](./map.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>数据为王。选对了数据结构、组织得当，算法往往便不言自明。</I></br>
<I>Data dominates. If you've chosen the right data structures and organized things well, the algorithms will almost always be self-evident.</I></br>
<div class="quote-right">
-- Rob Pike, "Notes on Programming in C"
</div>
</div>

切片与散列表是 Go 仅有的两种泛型容器，也是日常代码里出现得最频繁的两种数据结构。它们把
「一段连续内存如何被描述、被共享、被增长」这一组看似朴素的问题，落成了具体的运行时布局与
增长策略，于是 `append` 的种种「惊喜」、切片别名的陷阱、`map` 的随机遍历与并发即崩，都不再是
需要死记的规则，而是布局与权衡的必然推论。本章先把三种序列类型的内存模型摆清，再深入散列表
在缓存、安全与渐进扩容之间的取舍，看 Go 如何把这些复杂藏进用户看不见的地方，只在上层留下朴素
的 `s[i]` 与 `m[k]`。
