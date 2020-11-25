---
weight: 3200
title: "第 10 章 依赖管理"
bookCollapseSection: true
---

# 第 10 章 依赖管理

- [10.1 依赖管理的难点](./challenges.md)
- [10.2 语义化版本管理](./semantics.md)
- [10.3 最小版本选择算法](./minimum.md)
- [10.4 vgo 与 dep 之争](./fight.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
怎么不看看其他语言怎么做的呢？Java 有 Maven、Node 有 NPM、Ruby 有 Bundler，而且 Rust 有 Cargo。（依赖管理）怎么就成了一个未解决的问题了呢？
</I></br>
<I>
Why not do what other languages do? Java has Maven, Node has NPM, Ruby has Bundler, Rust has Cargo. How is this not a solved problem?
</I></br>
<div class="quote-right">
-- Russ Cox
</div>
</div>

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).