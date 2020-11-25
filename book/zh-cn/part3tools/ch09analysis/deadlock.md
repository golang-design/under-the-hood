---
weight: 3101
title: "9.1 运行时死锁检查"
---

# 9.1 运行时死锁检查



原理：

$$
m - midle - miclelocked - msys > 0
$$

只检查是否所有的工作线程都已休眠

缺点：

当存在可运行的 goroutine 时，系统监控死锁检测不会认为发生阻塞
运行时只检查 goroutine 是否在 Go 并发原语中被阻止，不考虑等待其他系统资源的 goroutine。


```go
//go:nowritebarrierrec
func mput(mp *m) {
	mp.schedlink = sched.midle
	sched.midle.set(mp)
	sched.nmidle++
	checkdead()
}
//go:nowritebarrierrec
func mget() *m {
	mp := sched.midle.ptr()
	if mp != nil {
		sched.midle = mp.schedlink
		sched.nmidle--
	}
	return mp
}
```

sched.nmidlelocked:

```go
func incidlelocked(v int32) {
	lock(&sched.lock)
	sched.nmidlelocked += v
	if v > 0 {
		checkdead()
	}
	unlock(&sched.lock)
}
```

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).



