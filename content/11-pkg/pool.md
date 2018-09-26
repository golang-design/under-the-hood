# 11 标准库：sync.Pool

sync.Pool 是一个临时对象池。一句话来概括，sync.Pool 管理了一组临时对象，当需要时从池中获取，使用完毕后从再放回池中，以供他人使用。

使用 sync.Pool 只需要编写对象的创建方法：

```go
type Pool struct {
	noCopy noCopy // 最后来讨论这个

	local     unsafe.Pointer // local 固定大小 per-P 池, 实际类型为 [P]poolLocal
	localSize uintptr        // local array 的大小

    // New 方法在 Get 失败的情况下，选择性的创建一个值
	New func() interface{}
}
```

因此获取到的对象可能是刚被使用完毕放回池中的对象、亦或者是由 New 创建的新对象。

## 底层结构

```

```

## Get

## Put

## 运行时垃圾回收

sync.Pool 的垃圾回收发生在运行时 GC 开始之前。

```go
// src/sync/pool.go
// 将缓存清理函数注册到运行时 GC 时间段
func init() {
	runtime_registerPoolCleanup(poolCleanup)
}

// 由运行时实现
func runtime_registerPoolCleanup(cleanup func())

// src/runtime/mgc.go
var poolcleanup func()
// 利用编译器标志将 sync 包中的清理注册到运行时
//go:linkname sync_runtime_registerPoolCleanup sync.runtime_registerPoolCleanup
func sync_runtime_registerPoolCleanup(f func()) {
	poolcleanup = f
}

// 实现缓存清理
func clearpools() {
	// clear sync.Pools
	if poolcleanup != nil {
		poolcleanup()
	}
    (...)
}
```

再来看实际的清理函数：

```go
func poolCleanup() {
	// 该函数会注册到运行时 GC 阶段(前)，此时为 STW 状态，不需要加锁
	// 它必须不处理分配且不调用任何运行时函数，防御性的将一切归零，有以下两点原因:
	// 1. 防止整个 Pool 的 false retention
	// 2. 如果 GC 发生在当有 goroutine 与 l.shared 进行 Put/Get 时，它会保留整个 Pool.
	//    那么下个 GC 周期的内存消耗将会翻倍。
	// 遍历所有 Pool 实例
	for i, p := range allPools {

		// 解除引用
		allPools[i] = nil

		// 遍历 p.localSize 数组
		for i := 0; i < int(p.localSize); i++ {

			// 获取 poolLocal
			l := indexLocal(p.local, i)

			// 清理 private 和 shared 区域
			l.private = nil
			for j := range l.shared {
				l.shared[j] = nil
			}
			l.shared = nil
		}

		// 设置 p.local = nil 除解引用之外的数组空间
		// 同时 p.pinSlow 方法会将其重新添加到 allPool
		p.local = nil
		p.localSize = 0
	}

	// 重置 allPools，需要所有 p.pinSlow 重新添加
	allPools = []*Pool{}
}
```

