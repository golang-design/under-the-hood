# 引言

[TOC]

## 致读者

此仓库的内容可能勾起您的兴趣，如果您想要关注本仓库的更新情况，可以点击仓库的 `Watch`。
如果您喜欢本书，也可以给本书 `Star`。
甚至于您还希望参与贡献，笔者也欢迎您提交 issue 或 pull request，
具体细节请参考[如何参与贡献](../CONTRIBUTING.md)。
此外，本书要求读者已具备一定的 Go 语言使用经验。

### 为什么要研究源码？

本书的写作初衷并非是对整个 Go 语言源码进行分析，相反由于笔者的工作需要，
在本书写作之初，笔者需要迁移并使用 Go 语言重新开发一个古老的 C 语言项目，因此也就不可避免的
使用了 cgo。后来当笔者逐渐发现 cgo 带来的性能问题，
而与 C 代码结合本身是需要 Go 提供不那么方便的线程支持的，笔者并萌生出优化它的想法，从而开始编写此书。
起初只是简单的对运行时调度器的一些分析，后来随着对源码阅读的深入，这个坑被越挖越大，
索性编成了现在这样的 Go 源码分析。

### 为什么不读现有的源码分析？

确实已经有很多很多讨论 Go 源码的文章了，不读他们的文章有几个原因：
别人的是二手资料，自己的是一手资料，通过理解别人理解代码的思路来理解代码，
增加了额外的成本，不如直接理解代码来得畅快。
另一个原因是，笔者在开始阅读 Go 源码并查阅部分资料时，
发现已经存在的资料大多已经存在一定程度上的过时，同时在分析源码的过程中并没有
细致到介绍某段代码的来龙去脉，本质上仍然处于贴代码的状态。
而且 Go 运行时的开发是相当活跃的，因此笔者希望能够通过自己阅读源码这个过程，
在了解到最新版本的动态的同时，也能对整个 Go 源码的演进历史有一定了解。

## 本书的组织结构和内容

本仓库主要关注 Go 运行时及编译器相关的代码，例如 `runtime`/`cgo`/`sync`/`net`/`reflect`/`syscall`/`signal`/`time`/`cmd/compile` 等等。
在极少数的情况下，会讨论不同平台下的差异，代码实验以 Linux/Darwin amd64 为基础，除近年来新兴的 WebAssembly 外其他平台几乎不关注。
此外，还会统一的对 `race`/`trace`/`pprof` 等嵌入运行时的性能分析工具进行分析。
因此，诸如 `crypto/database/regexp/strings/strconv/sort/container/unicode` 等一些运行时无关的标准库可能不在研究范围。

本书共分为四个部分，第一部分简要回顾了与 Go 运行时及编译器相关的基础理论，并在其最后一章中简要讨论了 Go 程序的生命周期。
第二部分着重关注 Go 的运行时机制，这包括调度器、内存分配器、垃圾回收期、调试机制以及程序的 ABI 等。
第三部分则着眼于 Go 的编译器机制，包括 Go 编译器对关键字的翻译行为，对 cgo 程序的翻译过程，以及链接器等。
最后一个部分则讨论了一些依赖运行时和编译器的标准库，本书只介绍这些标准库与运行时和编译器之间的配合，并不会完整的整个包的源码进行分析。

## 环境

```bash
→ go version
go version go1.12 darwin/amd64
→ uname -a
Darwin changkun-mini 18.2.0 Darwin Kernel Version 18.2.0: Mon Nov 12 20:24:46 PST 2018; root:xnu-4903.231.4~2/RELEASE_X86_64 x86_64
```

## Acknowledgement

The author would like to thank [@egonelbre](https://github.com/egonelbre/gophers) for his charming gopher design.

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)