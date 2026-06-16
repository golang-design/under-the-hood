---
weight: 2200
title: "第 5 章 数据结构"
bookCollapseSection: true
---

# 第 5 章 数据结构

- [5.1 数组与切片](./slice.md)
- [5.2 字符串与零拷贝转换](./string.md)
- [5.3 散列表：原理与安全](./map.md)
- [5.4 Swiss Table 与 Go 1.24 实现](./swisstable.md)

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
需要死记的规则，而是布局与权衡的必然推论。本章分四个主题展开：先把数组与切片的内存模型与
增长策略摆清，再单独看字符串不可变所带来的零拷贝转换与安全契约；随后讲透散列表的一般原理与
哈希洪水攻防，最后落到 Go 1.24 基于 Swiss Table 的彻底重写，看它如何在缓存、安全与渐进扩容
之间取舍。一路看 Go 如何把这些复杂藏进用户看不见的地方，只在上层留下朴素的 `s[i]` 与 `m[k]`。
