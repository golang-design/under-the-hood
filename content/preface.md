# 引言

## 致读者

此仓库的内容可能勾起您的兴趣，如果您想要关注本仓库的更新情况，可以点击仓库的 `Watch`。
如果您喜欢本书，也可以给本书 `Star`。
甚至于您还希望参与贡献，笔者也欢迎您提交 issue 或 pull request，
具体细节请参考[如何参与贡献](../CONTRIBUTING.md)。

此外，本书要求读者已具备一定的 Go 语言使用经验。

### 为什么要研究源码？

本书的写作初衷并非是对整个 Go 语言源码进行分析，相反由于笔者的工作需要，
在本书写作之初，笔者需要迁移并使用 Go 语言重新开发一个古老的 C 语言项目，因此也就不可避免的
使用了 cgo。后来当笔者逐渐发现 cgo 带来的性能问题，如图所示：

<p align="center">
  <img src="../images/cgo-go-c.png" width="500">
</p>

_图 : 比较了 cgo/go/c 之间在 read/write 系统调用时的性能差异_

而与 C 代码结合本身是需要 Go 提供不那么方便的线程支持的，笔者并萌生出优化它的想法，从而开始编写此书。
起初只是简单的对运行时调度器的一些分析，后来随着对源码阅读的深入，这个坑被越挖越大，
索性编成了现在这样的 Go 源码分析。

### 为什么不读现有的源码分析？

确实已经有很多很多讨论 Go 源码的文章了，不读他们的文章有几个原因：
别人的是二手资料，自己的是一手资料，通过理解别人理解代码的思路来理解代码，
增加了额外的成本，不如直接理解代码来得畅快。
另一个原因是，笔者在开始自行阅读 Go 源码并查阅部分资料时，
发现已经存在的资料大多已经存在一定程度上的过时，同时在分析源码的过程中并没有
细致到介绍某段代码的来龙去脉，本质上仍然处于贴代码的状态。
而且 Go 运行时的开发是相当活跃的，因此笔者希望能够通过自己阅读源码这个过程，
在了解到最新版本的动态的同时，也能对整个 Go 源码的演进历史有一定了解。

## 关注什么？

本仓库主要关注与运行时相关的代码，例如 `runtime`/`cgo`/`sync`/`net`/`reflect`/`syscall`/`signal`/`time` 等。
在极少数的情况下，会讨论不同平台下的差异，代码实验以 darwin 为基础，linux 为辅助关注点，其他平台几乎不关注。
作为 Go 1.11 起引入的 `wasm` 特性，我们特别给 WebAssembly 平台以特别关注。此外，
还会统一的对 race/trace/pprof 等嵌入运行时的性能分析工具进行分析。
因此，诸如 `crypto/database/regexp/strings/strconv/sort/container/unicode` 等一些运行时无关的标准库
可能不在研究范围。

## 组织说明

本仓库组织了一下几部分内容：

- [`content`](../content): 源码的研究；
- [`demo`](../demo): 研究源码产生的相关的实例代码；
- [`gosrc`](../gosrc): 无修改的、正式发布的 go 源码，与最新发布的 go 版本同步，在[这里](https://github.com/changkun/go/tree/go-under-the-hood)追踪官方的更新；
- [`images`](../images): 仓库中依赖的相关图片；
- [`papers`](../papers): 学术论文


## 环境

```bash
→ go version
go version go1.11.5 darwin/amd64
→ uname -a
Darwin changkun-mini 18.2.0 Darwin Kernel Version 18.2.0: Fri Oct  5 19:41:49 PDT 2018; root:xnu-4903.221.2~2/RELEASE_X86_64 x86_64
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)