# 11 标准库：sync.Cond

sync.Cond 在生产者消费者模型中非常典型，带有互斥锁的队列当元素满时，
如果生产在向队列插入元素时将队列锁住，会产生既不能读，也不能写的情况。
sync.Cond 就解决了这个问题。

```go
package main

import (
    "fmt"
    "sync"
    "time"
)


func main() {
    cond := sync.NewCond(new(sync.Mutex))
    condition := 0

    // 消费者
    go func() {
        for {
            // 消费者开始消费时，锁住
            cond.L.Lock()
            // 如果没有可消费的值，则等待
            for condition == 0 {
                cond.Wait()
            }
            // 消费
            condition--
            fmt.Printf("Consumer: %d\n", condition)

            // 唤醒一个生产者
            cond.Signal()
            // 解锁
            cond.L.Unlock()
        }
    }()

    // 生产者
    for {
        // 生产者开始生产
        cond.L.Lock()

        // 当生产太多时，等待消费者消费
        for condition == 100 {
            cond.Wait()
        }
        // 生产
        condition++
        fmt.Printf("Producer: %d\n", condition)

        // 通知消费者可以开始消费了
        cond.Signal()
        // 解锁
        cond.L.Unlock()
    }
}
```

我们来看一看内部的实现原理。

## 结构

sync.Cond 的内部结构包含一个锁 L、通知列表以及一个复制检查器 copyChecker。

```go
type Locker interface {
	Lock()
	Unlock()
}
type Cond struct {
	noCopy noCopy

	L Locker

	notify  notifyList
	checker copyChecker
}
func NewCond(l Locker) *Cond {
	return &Cond{L: l}
}
// 与 runtime/sema.go 中的 notifyList 的相同，大小和对齐必须一致。
type notifyList struct {
	wait   uint32
	notify uint32
	lock   uintptr
	head   unsafe.Pointer
	tail   unsafe.Pointer
}
```

L 的类型为 Locker 因此可以包含任何实现了 Lock 和 Unlock 的锁，这包括 Mutex 和 RWMutex。

当新建 Cond 时，向 Cond 提供互斥锁 l 非常简单。而 notifyList 与非常相似。

TODO:

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)