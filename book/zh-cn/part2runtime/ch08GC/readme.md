# 第八章 垃圾回收器

垃圾回收是一个相当困难且复杂的系统工程。

- [8.1 基本知识](./basic.md)
    + 并发三色回收一瞥
    + 内存模型
    + 编译标志 `go:nowritebarrier`、`go:nowritebarrierrec` 和 `go:yeswritebarrierrec`
    + 进一步阅读的参考文献
- [8.2 标记清扫思想](./vanilla.md)
    + 标记清扫算法
    + 进一步阅读的参考文献
- [8.3 屏障技术](./barrier.md)
    + 三色不变性原理
      + 强、弱不变性
      + 赋值器的颜色
      + 新分配对象的颜色
    + 赋值器屏障技术
      + 灰色赋值器的 Dijkstra 插入屏障
      + 黑色赋值器的 Yuasa 删除屏障
    + 混合写屏障
      + 基本思想
      + 可靠性、完备性和有界性的证明
      + 实现细节
    + 总结
    + 进一步阅读的参考文献
- [8.4 并发标记清扫](./concurrent.md)
    + 并发标记
    + 并发清扫
    + 并行三色标记
    + 进一步阅读的参考文献
- [8.5 初始化](./init.md)
- [8.6 触发机制与调步算法](./pacing.md)
- [8.6 标记过程](./mark.md)
- [8.7 清扫过程](./sweep.md)
- [8.8 存活与终结](./finalizer.md)
    + SetFinalizer
    + KeepAlive
- [8.9 过去、现在与未来](./history.md)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)