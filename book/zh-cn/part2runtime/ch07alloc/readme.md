# 第七章 内存分配器

- [7.1 基本知识](./basic.md)
    + 主要结构
    + Arena
      + heapArena
      + arenaHint
    + mspan
    + mcache
    + mcentral
    + mheap
    + 分配概览
    + 分配入口
      + 小对象分配
      + 微对象分配
      + 大对象分配
    + 总结
    + 进一步阅读的参考文献
- [7.2 组件](./component.md)
    + fixalloc
      + 结构
      + 初始化
      + 分配
      + 回收
    + linearAlloc
    + mcache
      + 分配
      + 释放
      + per-P? per-M?
    + 其他
      + memclrNoHeapPointers
    + 系统级内存管理调用
- [7.3 初始化](./init.md)
- [7.4 大对象分配](./largealloc.md)
    + 从堆上分配
    + 从操作系统申请
- [7.5 小对象分配](./smallalloc.md)
    + 从 mcache 获取
    + 从 mecentral 获取
    + 从 mheap 获取
- [7.6 微对象分配](./tinyalloc.md)
- [7.7 内存统计](./mstats.md)
- [7.8 过去、现在与未来](./history.md)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
