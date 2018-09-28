# 10 cgo

「cgo 不是银弹」，cgo 是连接 Go 与 C （乃至其他任何语言）之间的桥梁。
cgo 性能远不及原生 Go 程序的性能，执行一个 cgo 调用的代价很大。
下图展示了 cgo, go, c 之间的性能差异（网络 I/O 场景）：

![](../images/cgo-go-c.png)

**图1: cgo v.s. Co v.s. C，图取自 [changkun/cgo-benchmarks](https://github.com/changkun/cgo-benchmarks)**

本文则具体研究 cgo 在运行时中的实现方式。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | MIT &copy; [changkun](https://changkun.de)