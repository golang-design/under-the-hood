---
weight: 2500
title: "第十章 兼容与契约"
---

# 第十章 兼容与契约

- [10.1 参与运行时的系统调用](./syscall.md)
    + Linux
      + 案例研究 runtime.clone
      + 运行时实现的系统调用清单
    + Darwin
      + libcCall 调用
      + 案例研究: runtime.pthread_create
      + 运行时实现的 libc 调用清单
    + 进一步阅读的参考文献
- [10.2 cgo](./cgo.md)
    + 入口
    + cgocall
      + Go 调用 C
      + 实际代码
    + cgocallbackg
      + C 调用 Go
      + 实际代码
    + 总结
    + 进一步阅读的参考文献
- [10.3 WebAssembly](./wasm.md)
- [10.4 用户态系统调用](./syscall-pkg.md)
    + 由运行时提供支持的系统调用
    + 通用型系统调用
    + `runtime.entersyscall` 和 `runtime.exitsyscall`
    + 返回的错误处理
    + 进一步阅读的参考文献

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)