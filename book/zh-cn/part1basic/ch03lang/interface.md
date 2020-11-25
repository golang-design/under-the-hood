---
weight: 1307
title: "3.7 接口"
---

# 3.7 接口

接口 `interface{}` 作为 Go 语言类型系统中重要的一员，从语义上规定了一组方法集合，
只要某个类型实现了这一组方法，则这些类型都可以视为同一类型参数进行传递。
尽管这个理念与鸭子类型（Duck typing）所定义的类似，一个常见的错误观点便是 Go 
是一种支持鸭子类型的语言。事实上，鸭子类型强调的是类型的运行时特性而非编译期特性。
不巧，Go 语言中的 `interface{}` 恰好只是一种编译期特性，所以 Go 的类型系统
应该被严谨的描述为**结构化类型系统**（Structural Type System）。

TODO:


## 进一步阅读的参考文献

- [Cox, 2009] Russ Cox. Go Data Structures: Interfaces. December 2009. https://research.swtch.com/interfaces

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
