# 8 运行时组件: 信号量机制

TODO:

## `runtime_Semacquire` 与 `runtime_Semrelease`

我们来看一下运行时中关于 `runtime_Semacquire` 与 `runtime_Semrelease` 的实现。

```go
//go:linkname sync_runtime_Semacquire sync.runtime_Semacquire
func sync_runtime_Semacquire(addr *uint32) {
	semacquire1(addr, false, semaBlockProfile)
}
//go:linkname sync_runtime_Semrelease sync.runtime_Semrelease
func sync_runtime_Semrelease(addr *uint32, handoff bool) {
	semrelease1(addr, handoff)
}
```

可以看到他们均为运行时中的 `semacquire1` 和 `semrelease1` 函数。

先来看 `semacquire1`。

TODO:

再来看 `semrelease1`

TODO:

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
