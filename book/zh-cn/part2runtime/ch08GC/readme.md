---
weight: 2300
title: "第 8 章 垃圾回收"
bookCollapseSection: true
---

# 第 8 章 垃圾回收

- [8.1 垃圾回收的基本想法](./basic.md)
- [8.2 写屏障技术](./barrier.md)
- [8.3 调步模型与强弱触发边界](./pacing.md)
- [8.4 扫描标记与标记辅助](./mark.md)
- [8.5 免清扫式位图技术](./sweep.md)
- [8.6 前进保障与终止检测](./termination.md)
- [8.7 安全点分析](./safe.md)
- [8.8 分代假设与代际回收](./generational.md)
- [8.9 请求假设与事务制导回收](./roc.md)
- [8.10 终结器](./finalizer.md)
- [8.11 过去、现在与未来](./history.md)
- [8.12 垃圾回收统一理论](./unifiedgc.md)
- [8.13 进一步阅读的参考文献](./ref.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
什么时候最适合做垃圾回收？当没有人进行观察时。用一颗摄像头对眼球进行追踪，当对象的眼睛离开屏幕时就执行垃圾回收。
</I></br>
<I>
When is the best time to do a GC? When nobody is looking. Using camera
to track eye movement when subject looks away do a GC.
</I></br>
<div class="quote-right">
-- Richard Hudson
</div>
</div>

垃圾回收是一个相当困难且复杂的系统工程。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).