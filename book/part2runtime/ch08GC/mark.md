# 垃圾回收器：三色标记

Go 运行时实现的是并发版本的标记清扫算法，在搞清楚它之前，我们必须从非并发版本讲起。

## 标记清扫算法

Go 的垃圾回收器基于标记清扫的思想，将回收过程分为两个阶段：

1. 追踪：从根集合（寄存器、执行栈、全局变量）开始遍历对象图，标记遇到的每个对象；
2. 清扫：检查堆中每一个对象，将所有未标记的对象当做垃圾进行回收。

标记算法：

```go
func markFromRoots() {
    worklist.init()
    for fld := range Roots {
        ref := *fld
        if ref != nil && !isMarked(ref) {
            setMarked(ref)
            worklist.add(ref)
            mark()
        }
    }
}
func mark() {
    for !worklist.empty() {
        ref := worklist.remove() // ref 已经标记过
        for fld := range Pointers(ref) {
            child := *fld
            if child != nil && !isMarked(child) {
                setMarked(child)
                worlist.add(child)
            }
        }
    }
}
```

清扫算法：

```go
func sweep(start, end) {
    
    for scan := start; scan < end; scan = scan.next {
        if isMarked(scan) {
            unsetMarked(scan)
        } else {
            free(scan)
        }
    }
}
```

## 三色抽象

## 并行三色标记

Go 的 GC 与 mutator 线程同时运行，并允许多个 GC 线程并行运行。
它通过写屏障来并发的标记和扫描，是非分代式、非紧凑式 GC。
使用 per-P 分配区隔离的大小来完成分配，从而最小化碎片的产生，也用于消除大部分情况下的锁。

下图展示了 Go 1.5 时的 GC 各阶段：

```
|  GC 尚未启动  | GC 被禁用，指针写仅为内存写：*slot = ptr
                ---
|  执行栈扫描   | 内存 STW；在抢占点，从全局变量和 goroutine 执行栈扫描 
|  标记        | 屏障    ；标记对象以及后继指针，直到指针队列为空；mutator 写屏障追踪指针变化
|  标记终止阶段 | 启用 STW； 重新扫描全局变化的栈、完成标记，收缩栈，...
                ---
|  清扫阶段     | 归还未标记的对象，调整 GC 下个周期的步调
| GC 尚未启动   | 
```

TODO:

## 进一步阅读的参考文献

- [Simplify mark termination and eliminate mark 2](https://github.com/golang/go/issues/26903)
- [Runtime: error message: P has cached GC work at end of mark termination](https://github.com/golang/go/issues/27993)
- [Request Oriented Collector (ROC) Algorithm](golang.org/s/gctoc)
- [Proposal: Separate soft and hard heap size goal](https://github.com/golang/proposal/blob/master/design/14951-soft-heap-limit.md)
- [Go 1.5 concurrent garbage collector pacing](https://docs.google.com/document/d/1wmjrocXIWTr1JxU-3EQBI6BK6KgtiFArkG47XK73xIQ/edit#)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)