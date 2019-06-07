# 垃圾回收器：标记清扫与三色抽象波面

[TOC]

Go 运行时实现的是并发版本的标记清扫算法，在搞清楚它之前，我们必须从非并发版本讲起。

通常，垃圾回收器的执行过程通常被划分为两个半独立的组件：

1. 赋值器：这一名称本质上是在指代用户态的代码。因为对垃圾回收器而言，用户态的代码仅仅只是在修改对象之间的引用关系，也就是对对象图（对象之间引用关系的一个有向图）进行操作。
2. 回收器：负责执行垃圾回收的代码。

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

## 三色抽象波面

三色抽象规定了（回收器视角下的）三种不变量：

- 白色对象：未被回收器访问到，在回收开始阶段，所有对象均为白色，当回收结束后，白色对象均不可达。
- 灰色对象：已被回收器访问到，但回收器需要对其中的一个或多个指针进行扫描，因为他们可能还指向白色对象。
- 黑色对象：已被回收器访问到，其中所有字段都已扫描，黑色对象中任何一个指针都不可能直接指向白色对象。

这样三种不变量所定义的回收过程其实是一个波面（wavefront）不断前进的过程，
这个波面同时也是黑色对象和白色对象的边界，灰色对象就是这个波面。

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
