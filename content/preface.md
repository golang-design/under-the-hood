# 引言

## 致读者

此仓库的内容可能勾起你的兴趣，如果你想要关注本仓库的更新情况，可以点击仓库的 `Watch`。
此仓库目前还在早期更新阶段，笔者因诸事繁忙，仅刚开始尝试阅读 Go 源码，可能由于各种不可抗力或一时兴起，
本仓库的内容更新可能会很慢（也会很乱，不一定顺序更新内容，也可能大幅调整相关内容）。

如果你也希望参与贡献，欢迎提交 issue 或 pr，请参考[如何参与贡献](../CONTRIBUTING.md)。

### 为什么要研究源码？

研究 Go 源码有几个初衷：

1. 出于对技术的纯粹兴趣；
2. 工作需要，需要了解更多关于 Go 运行时 GC、cgo 等细节以优化性能。
3. For fun.

### 为什么不读现有的源码分析？

确实已经有很多很多讨论 Go 源码的文章了，不读他们的文章有几个原因：

1. 别人的是二手资料，自己的是一手资料，通过理解别人理解代码的思路来理解代码，增加了额外的成本，不如直接理解代码。
2. 已经存在的资料大多已经存在一定程度上的过时，Go 运行时的开发是相当活跃的，本仓库目前基于 1.11.4。

## 关注什么？

本仓库主要关注与运行时相关的代码，例如 `runtime`/`cgo`/`sync`/`net`/`reflect`/`syscall`/`signal`/`time` 等。
在极少数的情况下，会讨论不同平台下的差异，代码实验以 darwin 为基础，linux 为辅助关注点，其他平台几乎不关注。
作为 Go 1.11 起引入的 `wasm` 特性，我们特别给 WebAssembly 平台以特别关注。此外，
还会统一的对 race/trace/pprof 等嵌入运行时的性能分析工具进行分析。

所以，诸如 `crypto/database/regexp/strings/strconv/sort/container/unicode` 等一些运行时无关的标准库
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
go version go1.11.4 darwin/amd64
→ uname -a
Darwin changkun-mini 18.2.0 Darwin Kernel Version 18.2.0: Fri Oct  5 19:41:49 PDT 2018; root:xnu-4903.221.2~2/RELEASE_X86_64 x86_64
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)