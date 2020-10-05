---
weight: 1508
title: "5.8 上下文"
---

# 5.8 上下文

从 Go 语言本身的设计来看，尽管我们能够轻松的创建一个 Goroutine，
但对一个已经启动的 Goroutine 做取消操作却并不容易，例如：

```go
go func() {
	// 如何从其他 Goroutine 通知并结束该 Goroutine 呢？
	// ...
}()
```

通过 Channel 与 Select 这一过程间通信原语，我们可以使用空结构信号 `struct{}` 来通知一个正在执行的 Goroutine：

```go
cancel := make(chan struct{})

go func() {
	done := make(chan struct{}, 1)
	go func() {
		defer func() {
			done <- struct{}{}
		}()
		do() // 执行需要执行的操作
	}()
	select {
	case <-cancel:
		// 如果提前被取消，则等待执行完毕
		// 并撤销已经执行的操作
		<-done
		undo()
	case <-done:
		// 如果顺利结束，则结束执行
		close(done)
	}
}

// ... 出于某些原因希望执行取消操作
cancel <- struct{}{}
```

这样的要求很常见，例如某个 Web 请求被中断，服务端正在请求的资源需要做取消操作等等。那我们能否将这一同步模式进一步抽象为接口，作为一种基于通信的同步模式呢？上下文 Context 包就提供了这样一组在 Goroutine 间进行值传播的方法。

## 上下文接口

```go
type Context interface {
	// 截止日期返回应取消代表该上下文完成的工作的时间。如果未设置截止日期，则截止日期返回ok == false。连续调用Deadline会返回相同的结果。
	Deadline() (deadline time.Time, ok bool)

	// Done 返回一个 channel，当代表该上下文完成的工作应被取消时，该通道将关闭。
	// 如果此上下文永远无法取消，则可能会返回 nil。
	// 连续调用 Done 将返回相同的值。在取消函数返回之后，完成 channel 的关闭可能会异步发生。
	Done() <-chan struct{}

	// 如果 Done 未被关闭，则 Err 返回 nil；
	// 如果 Done 已被关闭，则 Err 返回一个非空错误。
	Err() error

	// Value 返回了与当前上下文使用 key 相关联的值；
	// 没有关联的 key 时将返回 nil。
	Value(key interface{}) interface{}
}
```

type Context interface {
	Deadline() (deadline time.Time, ok bool)
	Done() <-chan struct{}
	Err() error
	Value(key interface{}) interface{}
}
var Canceled = errors.New("context canceled")
var DeadlineExceeded error = deadlineExceededError{}
type CancelFunc func()

func Background() Context
func TODO() Context
func WithCancel(parent Context) (ctx Context, cancel CancelFunc)
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc)
func WithValue(parent Context, key, val interface{}) Context

## 上下文及其衍生品

ctx := context.Background()
ctx.WithTimeout(time.Second)
ctx.WithDeadline(time.Now())
ctx.WithValue(k, v)
ctx.Cancel()

https://github.com/golang/go/issues/14660
https://github.com/atdiar/goroutine/tree/master/execution
https://groups.google.com/forum/#!searchin/golang-dev/context$20package|sort:date/golang-dev/JgnR5hrDCu0/pyqbkYfSCQAJ
https://github.com/golang/go/issues/16209
https://github.com/golang/go/issues/8082
https://dave.cheney.net/2017/08/20/context-isnt-for-cancellation
https://github.com/golang/go/issues/21355
https://github.com/golang/go/issues/29011
https://github.com/golang/go/issues/28342
https://blog.labix.org/2011/10/09/death-of-goroutines-under-control
https://godoc.org/gopkg.in/tomb.v2
https://blog.golang.org/context
https://zhuanlan.zhihu.com/p/26695984
https://www.flysnow.org/2017/05/12/go-in-action-go-context.html
https://juejin.im/post/5a6873fef265da3e317e55b6
https://cloud.tencent.com/developer/section/1140703
https://siadat.github.io/post/context
https://rakyll.org/leakingctx/
https://dreamerjonson.com/2019/05/09/golang-73-context/index.html
https://brantou.github.io/2017/05/19/go-concurrency-patterns-context/
http://p.agnihotry.com/post/understanding_the_context_package_in_golang/
https://faiface.github.io/post/context-should-go-away-go2/
https://juejin.im/post/5c1514c86fb9a049b82a5acb
https://segmentfault.com/a/1190000017394302
https://36kr.com/p/5073181
https://zhuanlan.zhihu.com/p/60180409

## 值链条
