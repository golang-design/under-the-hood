# 垃圾回收器: 并发标记清扫

[TOC]

## 并发标记

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

## 并发清扫

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


## 并行三色标记

Go 的 GC 与 mutator 线程同时运行，并允许多个 GC 线程并行运行。
它通过写屏障来并发的标记和扫描，是非分代式、非紧凑式 GC。
使用 per-P 分配区隔离的大小来完成分配，从而最小化碎片的产生，也用于消除大部分情况下的锁。


TODO: 混合屏障栈重扫

TODO: go1.12 mark2 stw




## 进一步阅读的参考文献

1. [Getting to Go: The Journey of Go's Garbage Collector](https://blog.golang.org/ismmkeynote)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
