---
weight: 1402
title: "4.2 标记清扫法与三色抽象"
---

# 4.2 标记清扫法与三色抽象

自动内存管理的另一个重要的组成部分便是自动回收。在自动内存回收中，
垃圾回收器扮演一个十分重要的角色。通常，
垃圾回收器的执行过程可根据代码的行为被划分为两个半独立的组件：
赋值器（Mutator）和回收器（Collector）。

赋值器一词最早由 Dijkstra 引入 [Dijkstra et al., 1978]，意指用户态代码。
因为对垃圾回收器而言，需要回收的内存是由用户态的代码产生的，
用户态代码仅仅只是在修改对象之间的引用关系（对象之间引用关系的一个有向图，即对象图）
进行操作。回收器即为程序运行时负责执行垃圾回收的代码。

## 4.2.1 串行标记清扫

原始的标记清扫方法将回收过程分为两个阶段：

1. 标记追踪：从根集合（寄存器、执行栈、全局变量）开始遍历对象图，标记遇到的每个对象；

    ```go
    func mark() {
        worklist.Init()                       // 初始化标记 work 列表
        for root := range roots {             // 从根开始扫描
            ref := *root
            if ref != nil && !isMarked(ref) { // 标记每个遇到的对象
                setMarked(ref)
                worklist.Add(ref)
                for !worklist.Empty() {
                    ref := worklist.Remove()  // ref 已经标记过
                    for fld := range Pointers(ref) {
                        child := *fld
                        if child != nil && !isMarked(child) {
                            setMarked(child)
                            worlist.Add(child)
                        }
                    }
                }
            }
        }
    }
    ```

2. 清扫回收：检查堆中每一个对象，将所有未标记的对象当做垃圾进行回收。

    ```go
    func sweep() {
        // 检查堆区间内所有的对象
        for scan := worklist.Start(); scan < worklist.End(); scan = scan.Next {
            if isMarked(scan) {
                unsetMarked(scan)
            } else {
                free(scan) // 将未标记的对象释放
            }
        }
    }
    ```

## 4.2.2 三色抽象及其不变性

原始的标记清理是一个串行的过程，这种方法能够简化回收器的实现，因为只需要让回收器开始执行时，
将并发执行的赋值器挂起。这种情况下，对用户态代码而言，回收器是一个原子操作。
那么能不能让上面描述的过程并发执行呢？也就是说当赋值器在执行时，同时执行回收器呢？
这就面临一个非常严峻的问题：程序的正确性。当我们谈论一个垃圾回收程序的正确性时，
实际上是在描述用户态代码必须保障回收器不会将存活的对象进行回收，
而回收器也必须保证赋值器能够正确的访问到已经被重新整理和移动的对象。

三色抽象只是一种描述追踪式回收器的方法，在实践中并没有实际含义，
它的重要作用在于从逻辑上严密推导标记清理这种垃圾回收方法的正确性。
也就是说，当我们谈及三色标记法时，通常指标记清扫的垃圾回收。

从垃圾回收器的视角来看，三色抽象规定了三种不同类型的对象，并用不同的颜色相称：

- 白色对象（可能死亡）：未被回收器访问到的对象。在回收开始阶段，所有对象均为白色，当回收结束后，白色对象均不可达。
- 灰色对象（波面）：已被回收器访问到的对象，但回收器需要对其中的一个或多个指针进行扫描，因为他们可能还指向白色对象。
- 黑色对象（确定存活）：已被回收器访问到的对象，其中所有字段都已被扫描，黑色对象中任何一个指针都不可能直接指向白色对象。

这样三种不变性所定义的回收过程其实是一个 **波面（Wavefront）** 不断前进的过程，
这个波面同时也是黑色对象和白色对象的边界，灰色对象就是这个波面。

当垃圾回收开始时，只有白色对象。随着标记过程开始进行时，灰色对象开始出现（着色），这时候波面便开始扩大。当一个对象的所有子节点均完成扫描时，会被着色为黑色。当整个堆遍历完成时，只剩下黑色和白色对象，这时的黑色对象为可达对象，即存活；而白色对象为不可达对象，即死亡。这个过程可以视为以灰色对象为波面，将黑色对象和白色对象分离，使波面不断向前推进，直到所有可达的灰色对象都变为黑色对象为止的过程，如图 4.2.1 所示。

<div class="img-center">
<img src="../../../assets/gc-blueprint.png"/>
<strong>图 4.2.1: 垃圾回收器中的波面抽象</strong>
</div>

对象的三种颜色可以这样来判断：

```go
func isWhite(ref interface{}) bool {
    return !isMarked(ref)
}
func isGrey(ref interface{}) bool {
    return worklist.Find(ref)
}
func isBlack(ref interface{}) bool {
    return isMarked(ref) && !isGrey(ref)
}
```

## 4.2.3 并发标记清扫

并发标记的思想可以简要描述如下：

```go
func markSome() bool {
    if worklist.empty() {       // 初始化回收过程
        scan(Roots)             // 赋值器不持有任何白色对象的引用
        if worklist.empty() {   // 此时灰色对象已经全部处理完毕
            sweep()             // 标记结束，立即清扫
            return false
        }
    }
    // 回收过程尚未完成，后续过程仍需标记
    ref = worklist.remove()
    scan(ref)
    return true
}

func scan(ref interface{}) {
    for fld := range Pointers(ref) {
        child := *fld
        if child != nil {
            shade(child)
        }
    }
}

func shade(ref interface{}) {
    if !isMarked(ref) {
        setMarked(ref)
        worklist.add(ref)
    }
}
```

在这个过程中，回收器会首先扫描 worklist，而后对根集合进行扫描并重新建立 worklist。
在根集合扫描过程中赋值器现场被挂起时，扫描完成后则不会再存在白色对象。

并发清扫的思想可以简要描述如下：

```go
func New() (interface{}, error) {
    collectEnough()
    ref := allocate()
    if ref == nil {
        return nil, errors.New("Out of memory")
    }
    return ref, nil
}

func collectEnough() {
    stopTheWorld()
    defer startTheWorld()
    
    for behind() { // behind() 控制回收工作每次的执行量
        if !markSome() {
            return
        }
    }
}
```


## 进一步阅读的参考文献

- [Dijkstra et al., 1978] Edsger W. Dijkstra, Leslie Lamport, A. J. Martin, C. S. Scholten, and E. F. M. Steffens. 1978. On-the-fly garbage collection: an exercise in cooperation. Commun. ACM 21, 11 (November 1978), 966–975. DOI:https://doi.org/10.1145/359642.359655

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
