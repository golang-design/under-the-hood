# 4 内存管理: 基本知识

到目前为止，我们已经分析了 Go 程序如何启动、初始化需要进行的关键步骤、初始化结束后，
主 goroutine 的运行流程。现在我们来看 Go 中第一重要的关键组件：内存分配器。

在阅读 Go 内存管理（分配器）的代码之前，我们首先建立几个基本的思想。
在计算机领域中，无外乎时间换空间、空间换时间。如果你有自己实现过内存池，
基本上能够非常轻松理解所谓「内存管理」的概念。所谓内存管理，无非是提前分配好一大块内存，
对其进行管理、分配与回收。这样带来的好处毋庸置疑：减少了向操作系统申请内存的开销，加快了内存分配的速度。

## 编译器标志 `go:notinheap`

开始之前我们先了解一个编译器标志 `go:notinheap`。
`go:notinheap` 适用于类型声明。它表明一种不能从 GC 堆中分配的类型。具体来说，指向此类型必须让 `runtime.inheap` 检查失败。类型可能是用于全局变量，堆栈变量或用于对象非托管内存（例如使用 `sysAlloc` 分配、`persistentalloc`、`fixalloc` 或手动管理的范围）。特别的：

1. `new(T)`, `make([]T)`, `append([]T, ...)` 以及 T 的隐式堆分配是不允许的（尽管运行时中无论如何都是不允许隐式分配的）。

2. 指向常规类型（ `unsafe.Pointer` 除外）的指针不能转换为指向 `go:notinheap` 类型，即使他们有相同的基础类型。

3. 任何包含 `go:notinheap` 类型的类型本身也是
   `go:notinheap` 的。结构和数组中如果元素是 `go:notinheap` 的则自生也是。`go:notinheap` 类型的 map 和 channel 是不允许的。为使所有事情都变得显式，任何隐式 `go:notinheap` 类型的声明必须显式的声明 `go:notinheap`。

4. 指向 `go:notinheap` 类型的指针上的 write barrier 可以省略。

最后一点是 `go:notinheap` 真正的好处。运行时会使用它作为低级别内部结构使用来在内存分配器和调度器中避免 非法或简单低效的 memory barrier。这种机制相当安全且没有牺牲运行时代码的可读性。

## 虚拟内存

## 内存布局

## 逃逸分析

TODO:

## 进一步阅读的参考文献

1. [The Go Memory Model](https://golang.org/ref/mem)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)