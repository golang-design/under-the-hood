---
weight: 3101
title: "11.1 运行时死锁检查"
bookHidden: true
---

# 11.1 运行时死锁检查

TODO: 请不要阅读此小节，内容编排中

sched.nmidle:

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

[Go under the hood](https://github.com/golang-design/under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)



