# 2 初始化

本节讨论程序初始化工作，即 `runtime·schedinit`。

```go
// The bootstrap sequence is:
//
//	call osinit
//	call schedinit
//	make & queue new G
//	call runtime·mstart
//
// The new G calls runtime·main.
func schedinit() {
```

共涉及的方面：

- 内存分配
- 垃圾回收
- 并发调度
