---
weight: 4200
title: "第 13 章 垃圾回收器"
bookCollapseSection: true
---

# 第 13 章 垃圾回收器

- [13.1 垃圾回收的基本想法](./basic.md)
- [13.2 写屏障技术](./barrier.md)
- [13.3 触发频率及其调步算法](./pacing.md)
- [13.4 扫描标记与标记辅助](./mark.md)
- [13.5 清扫与位图](./sweep.md)
- [13.6 标记终止阶段](./termination.md)
- [13.7 安全点分析](./safe.md)
- [13.8 分代假设与代际回收](./generational.md)
- [13.9 请求假设与事务制导回收](./roc.md)
- [13.10 终结器](./finalizer.md)
- [13.11 过去、现在与未来](./history.md)
- [13.12 垃圾回收统一理论](./unifiedgc.md)
- [13.13 进一步阅读的参考文献](./ref.md)

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

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).