---
weight: 1403
title: "4.3 错误格式与上下文"
---

# 4.3 错误格式与上下文



错误检查仅仅只提供了编码时对错误链条操作的便利性，但仍然无法从仅由字符串定义的错误值
获得错误传播链条的上下文信息，例如产生错误的文件位置、具体的行号等等。
这些信息在大型工程的调试和监控过程中对于错误的定位是相当有用的。
这也就要求我们需要进一步对错误的格式化添加上下文信息。即第二个问题：
如何增强错误发生时的上下文信息并合理格式化一个错误？

## 4.3.1 错误格式

## 4.3.2 错误堆栈

堆栈信息与 `runtime.Caller` 的性能优化

TODO: 讨论目前标准库不具备的能力以及 x/errors 为什么被拒


## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
