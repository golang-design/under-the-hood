# 垃圾回收器：标记清扫思想

[TOC]

Go 运行时实现的是并发版本的标记清扫算法，在搞清楚它之前，我们必须从非并发版本讲起。

## 标记清扫算法

Go 的垃圾回收器基于标记清扫的思想，将回收过程分为两个阶段：

1. 追踪：从根集合（寄存器、执行栈、全局变量）开始遍历对象图，标记遇到的每个对象；
2. 清扫：检查堆中每一个对象，将所有未标记的对象当做垃圾进行回收。

标记算法：

```go
func markFromRoots() {
    worklist.Init()
    for fld := range Roots {
        ref := *fld
        if ref != nil && !isMarked(ref) {
            setMarked(ref)
            worklist.Add(ref)
            mark()
        }
    }
}
func mark() {
    for !worklist.Empty() {
        ref := worklist.Remove() // ref 已经标记过
        for fld := range Pointers(ref) {
            child := *fld
            if child != nil && !isMarked(child) {
                setMarked(child)
                worlist.Add(child)
            }
        }
    }
}
```

清扫算法：

```go
func sweep(start, end) {
    for scan := start; scan < end; scan = scan.Next {
        if isMarked(scan) {
            unsetMarked(scan)
        } else {
            free(scan)
        }
    }
}
```

## 进一步阅读的参考文献

- [Simplify mark termination and eliminate mark 2](https://github.com/golang/go/issues/26903)
- [Runtime: error message: P has cached GC work at end of mark termination](https://github.com/golang/go/issues/27993)
- [Request Oriented Collector (ROC) Algorithm](golang.org/s/gctoc)
- [Proposal: Separate soft and hard heap size goal](https://github.com/golang/proposal/blob/master/design/14951-soft-heap-limit.md)
- [Go 1.5 concurrent garbage collector pacing](https://docs.google.com/document/d/1wmjrocXIWTr1JxU-3EQBI6BK6KgtiFArkG47XK73xIQ/edit#)
- [runtime/debug: add SetMaxHeap API](https://go-review.googlesource.com/c/go/+/46751/)
- [runtime: mechanism for monitoring heap size](https://github.com/golang/go/issues/16843)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
