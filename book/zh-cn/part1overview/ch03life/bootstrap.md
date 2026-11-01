---
weight: 1303
title: "3.3 语言的自举"
---

# 3.3 语言的自举

Go 的编译器是用 Go 编写的。要编译它，必须先有一个 Go 编译器；而这个编译器又是由谁编译的？

先看一个实验。取 Go 1.26.10 的源码（删去发布包中预先编译好的程序），复制为两份，一份用已安装的
Go 1.26.0 构建，另一份用 Go 1.27.3 构建。`make.bash` 是从源码构建 Go 的脚本，环境变量
`GOROOT_BOOTSTRAP` 指定用作起点的现成 Go（darwin/arm64，路径有删节，每次约 40 秒）：

```shell
$ GOROOT_BOOTSTRAP=.../go1.27.3 bash make.bash
Building Go cmd/dist using .../go1.27.3. (go1.27.3 darwin/arm64)
Building Go toolchain1 using .../go1.27.3.
Building Go bootstrap cmd/go (go_bootstrap) using Go toolchain1.
Building Go toolchain2 using go_bootstrap and Go toolchain1.
Building Go toolchain3 using go_bootstrap and Go toolchain2.
Building packages and commands for darwin/arm64.
---
Installed Go for darwin/arm64 in .../goroot-b
```

两份构建在 `bin` 与 `pkg/tool` 下共产出 10 个程序，逐字节比较，全部相同：

```shell
$ shasum -a 256 goroot-{a,b}/bin/go goroot-{a,b}/pkg/tool/darwin_arm64/{compile,link} | cut -c1-16,65-
2ff6483c8cefb8fd  goroot-a/bin/go
2ff6483c8cefb8fd  goroot-b/bin/go
115ccaac31d7e4d4  goroot-a/pkg/tool/darwin_arm64/compile
c2deb9df764bc6dc  goroot-a/pkg/tool/darwin_arm64/link
115ccaac31d7e4d4  goroot-b/pkg/tool/darwin_arm64/compile
c2deb9df764bc6dc  goroot-b/pkg/tool/darwin_arm64/link
```

作为起点的编译器不同，产物却完全一致。本节回答三个问题：最早的 Go 编译器从何而来；上述输出中的
toolchain1、2、3 分别是什么，为何结果与起点无关；以及这一性质为何重要。

## 3.3.1 最早的编译器

一个编译器涉及三种语言：它所处理的源语言（Go）、它生成的目标语言（例如 arm64 机器码），以及它自身
的实现语言。前两者决定了编译器的功能，第三者决定了如何得到这个编译器。

Go 1.4（2014 年 12 月）及以前，编译器、汇编器和链接器都用 C 编写，源自 Plan 9 的 C 编译器
（[2.1](../ch02asm/asm.md)）。构建 Go 只需要系统中的 C 编译器，`gcc` 与 `clang` 均可。

Go 1.5（2015 年 8 月）将它们全部改用 Go 实现 [[Go Authors, 2015](#ref-go-authors-2015)]。
这次转换并非重写：Russ Cox 编写了一个把这批 C 代码自动翻译为 Go 的程序，翻译所得的代码起初保留着 C
的风格，此后再逐步改写为惯用的 Go。Cox 在 2013 年的设计文档中给出了这样做的理由：用 Go 比用 C
更容易写出正确的程序，且 Go 自带测试与性能剖析工具；运行时正在从 C 迁移到 Go，编译器同样用 Go 编写，
二者才便于协同；贡献者也只需掌握 Go 一种语言 [[Cox, 2013](#ref-cox-2013)]。

代价是，此后构建 Go 必须先有一个可用的 Go [[Cox, 2015](#ref-cox-2015)]。用一门语言自身的编译器来编译该编译
器，称为**自举**（bootstrapping），这个词源自英语成语「拉着自己的靴带把自己提起来」（pull oneself up by
one's bootstraps）。

## 3.3.2 由旧版本构建新版本

`make.bash` 的输出展示了自举的全过程。下文把用作起点的现成 Go 称为旧 Go：

1. 旧 Go 首先编译 `cmd/dist`。这是一个负责调度后续步骤的小程序，只使用旧 Go 同样支持的语言特性。
2. **toolchain1**：旧 Go 编译新版本的编译器、汇编器和链接器的源码。所得编译器的行为由新源码决定，
   但它自身的机器码由旧编译器生成。
3. **go_bootstrap**：用 toolchain1 编译出新的 `go` 命令，此后的构建由它接管。
4. **toolchain2**：用 toolchain1 把同一份源码再编译一遍。
5. **toolchain3**：用 toolchain2 再编译一遍。
6. 用 toolchain3 编译标准库和其余命令。

关键在第 4 步。一个编译器生成什么样的代码，只取决于它的源码，与它自身由哪个编译器编译无关。
toolchain1 的行为由新源码决定，因此 toolchain2 是「新编译器编译新源码」的结果，旧 Go 的影响至此
消失。

`make.bash -d` 会把每一轮的编译器另存为 `compile1`、`compile2`、`compile3`。两份构建的结果如下：

| | 以 Go 1.26.0 为起点 | 以 Go 1.27.3 为起点 |
| --- | --- | --- |
| `compile1`（由旧 Go 编译） | `f04179ffde503a8f` | `21b1c7c8410a0c79` |
| `compile2`（由 toolchain1 编译） | `f91490ecbac04f2c` | `f91490ecbac04f2c` |
| `compile3`（由 toolchain2 编译） | `115ccaac31d7e4d4` | `115ccaac31d7e4d4` |

`compile1` 随起点而不同，从 `compile2` 起便完全一致。

`compile2` 与 `compile3` 不同，原因在于编译选项。编译器的源码目录中存放着一份它自身的性能剖析数据
`default.pgo`，用于引导优化（[3.2](./compile.md)）。`cmd/dist` 构建 toolchain2 时特意关闭了这一选项，
源码注释给出的理由是 toolchain2 无须启用 PGO [[Go Authors, 2026b](#ref-go-authors-2026b)]；构建
toolchain3 时才将其打开。用最终的编译器、以相同的选项再编译它自身一次（这里的 `go` 是刚构建完成的 Go
1.26.10）：

```shell
$ CGO_ENABLED=0 GOFLAGS="-trimpath -ldflags=-w -gcflags=cmd/...=-dwarf=false" \
    go build -a -o compile4 cmd/compile
$ shasum -a 256 compile4 | cut -c1-16
115ccaac31d7e4d4
```

结果仍是它自身；关闭性能剖析数据（`-pgo=off`）后再编译，得到的正是 `compile2` 的
`f91490ecbac04f2c`。编译器编译自身的源码得到它自己，这称为**不动点**（fixed point）：再编译多少次，
结果都不会改变。如果一个编译器无法稳定地生成自身，说明它的输出依赖了不应依赖的因素，例如时间或内存
地址。GCC 从源码构建时也采用类似的三阶段过程，并比较后两个阶段的产物是否相同 [[GCC, n.d.](#ref-gcc-nd)]。

既然 toolchain2 已与旧 Go 无关，为何还需要 toolchain3？`cmd/dist` 的注释说明，原因与 [3.1](./cmd.md)
介绍的 build ID 有关 [[Go Authors, 2026b](#ref-go-authors-2026b)]。toolchain1 由旧 Go 的 `go` 命令构建，
其中不含 build ID，因此需要再构建一个带有 build ID 的 toolchain2。然而在开发版本中，工具链的 build ID
会参与计算其产物的 build ID，编译器一经更换，`go` 命令便认为此前构建的一切都已过期；
发布版本则以工具链报告的版本号代替 build ID，不会出现这种情况。为使两种情形的行为一致，`cmd/dist` 用
toolchain2 强制重新构建整套工具，得到 toolchain3，其编译器与链接器带有准确的 build ID，
可以作为缓存的依据。`make.bash` 最后还会让 `go` 命令逐一检查，确认在它看来工具链和标准库都已是最新状态，
无须重新构建。

`buildid.go` 开头的注释说明了 3.1 中这一设计的必要性：编译器由它自身编译，如果下一步的键中记录的
是编译器这一步的 action ID，那么编译器每编译一次自身，键就改变一次，永远无法收敛；记录的是编译器
内容的摘要，内容一旦收敛，键也随之收敛。

## 3.3.3 起点的最低版本

可用作起点的 Go 有一个最低版本，并随新源码所使用的语言特性和库逐步提高
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

| 要构建的版本 | 起点的最低要求 |
| --- | --- |
| Go 1.4 及以前 | C 编译器 |
| Go 1.5 至 1.19 | Go 1.4 |
| Go 1.20、1.21 | Go 1.17.13 |
| Go 1.22、1.23 | Go 1.20.6 |
| Go 1.24、1.25 | Go 1.22.6 |
| Go 1.26、1.27 | Go 1.24.6 |

Go 1.4 作为起点长达近八年。它是最后一个用 C 编写的版本，任何装有 C 编译器的机器都可以由它开始构建。
代价是编译器本身永远无法使用 Go 1.4 之后的新特性，例如泛型；Go 1.4 也不支持后来出现的一些平台，例如采用
Apple 芯片的 Mac。go.dev/issue/44505 与 54265 记录了相关的讨论 [[Cox, 2021](#ref-cox-2021)]
[[Cox, 2022](#ref-cox-2022)]。Go 1.20 把起点提高到 Go 1.17；从 Go 1.22 起，起点按一条固定的规则提高：构建
Go 1.N 需要 Go 1.M，M 为 N 减 2 后向下取偶数。Go 每年 2 月发布偶数版本、8 月发布奇数版本，
因此起点每年前移一次，并且总是至少一年前发布的版本。这条规则实现于 `cmd/dist` 的
`requiredBootstrapVersion` 中 [[Go Authors, 2026b](#ref-go-authors-2026b)]。

版本过旧时，`cmd/dist` 会尽早报错。它的源码目录中有一个文件 `notgo124.go`，仅在 Go 1.24 以前的版本下
参与编译，其包名为 `building_Go_requires_Go_1_24_6_or_later`。用过旧的 Go 编译 `cmd/dist` 时，同一
目录下出现两个不同的包名，编译失败，错误信息中恰好包含这句话。版本介于 1.24 与 1.24.6 之间的，由
`cmd/dist` 检查版本号后报错。比要求更新的 Go 均可使用，上面实验中的 Go 1.27.3 即是一例。

## 3.3.4 编译器的可信性

1983 年，Ken Thompson 在图灵奖演讲《Reflections on Trusting Trust》中描述了一种攻击
[[Thompson, 1984](#ref-thompson-1984)]。修改 C 编译器的源码，使它在编译登录程序时悄悄植入后门；
再使它在编译编译器自身时，把这段修改原样植入新的编译器。把修改后的源码编译一次，得到带有后门的编译器，
然后从源码中删去这段修改。此后源码中看不出任何异常，但用这个编译器编译干净的源码，
得到的编译器依然带有后门，并代代相传。Thompson 的结论是：不是完全由自己编写的代码，就不能完全信任，
仅审查源码是不够的。

所有自举的语言都无法回避这个问题：今天的 Go 编译器由上一个 Go 编译器编译而来，一路可以追溯到用 C 编写的
Go 1.4 以及更早的 C 编译器。2005 年，David A. Wheeler 提出了一种检验方法，称为**多样化双重编译**（diverse
double-compiling，DDC）[[Wheeler, 2005](#ref-wheeler-2005)]：另选一个独立来源的编译器，
用它编译待检验编译器的源码，再用所得的编译器把同一份源码编译一遍，与待检验的二进制逐字节比较。若二者相同，
就说明该二进制确实由这份源码生成，除非两个起点被以完全相同的方式篡改。

本节开头的实验正是这一结构：两个不同的起点，得到相同的结果。不过 Go 1.26.0 与 Go 1.27.3 出自同一个
项目，这样的检验并不独立。Go 的源码也可以用 GCC 中独立实现的 gccgo 作为起点，那才是来源真正不同的
起点 [[Go Authors, 2026a](#ref-go-authors-2026a)]。

这种检验能够进行的前提是构建可复现（[3.1](./cmd.md)）：编译过程中一旦混入时间、路径或随机数，
逐字节比较便无从谈起。据 Russ Cox 2023 年的文章，Go 从 1.21 起实现了工具链的完全可复现：
无论在哪种操作系统上构建，同一目标平台的工具链都逐字节相同；Go 团队还编写了一个工具，
从源码重新构建官方发布的工具链并与之比对 [[Cox, 2023](#ref-cox-2023)]。上面实验中的两份构建彼此相同，
却不能直接与官方下载的二进制逐字节比较：官方的 macOS 版本带有苹果的代码签名（可用 `codesign -dv` 查看），
而本地构建的二进制只有链接器添加的临时签名。

## 延伸阅读

- <a id="ref-cox-2013"></a>[Cox, 2013] Russ Cox. "Go 1.3+ Compiler Overhaul." 2013.
  https://go.dev/s/go13compiler
  https://go.googlesource.com/proposal/+/master/design/go13compiler.md
  把 C 编写的编译器自动翻译为 Go 的计划及其理由。
- <a id="ref-cox-2015"></a>[Cox, 2015] Russ Cox. "Go 1.5 Bootstrap Plan." 2015.
  https://go.dev/s/go15bootstrap
  https://go.googlesource.com/proposal/+/master/design/go15bootstrap.md
  去除 C、改以旧版 Go 为起点的方案，`make.bash` 的注释至今仍指向它。
- <a id="ref-go-authors-2015"></a>[Go Authors, 2015] The Go Authors. *Go 1.5 Release Notes*.
  https://go.dev/doc/go1.5
  编译器与运行时改用 Go 实现的版本。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. "Installing Go from source."
  https://go.dev/doc/install/source
  起点版本的规则，以及以 gccgo 为起点的方法。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. `cmd/dist/build.go`、
  `buildtool.go`、`notgo124.go`（Go 1.26）.
  https://github.com/golang/go/tree/release-branch.go1.26/src/cmd/dist
  https://github.com/golang/go/tree/master/src/cmd/dist
  toolchain1 至 3 的构建过程、`requiredBootstrapVersion` 与版本检查。
- <a id="ref-cox-2021"></a>[Cox, 2021] Russ Cox. "build: adopt Go 1.17 as bootstrap toolchain for Go
  1.20." Go issue 44505, 2021. https://go.dev/issue/44505
  `notgo124.go` 的注释所指向的 issue 之一，讨论 Go 为何不再以 Go 1.4 为起点。
- <a id="ref-cox-2022"></a>[Cox, 2022] Russ Cox. "build: adopt Go 1.20 as bootstrap toolchain for Go
  1.22." Go issue 54265, 2022. https://go.dev/issue/54265
  提出此后每年把起点前移到上一年发布的版本。
- <a id="ref-thompson-1984"></a>[Thompson, 1984] Ken Thompson. "Reflections on Trusting Trust."
  *Communications of the ACM*, 27(8): 761–763, 1984. https://doi.org/10.1145/358198.358210 （ACM
  数字图书馆：https://dl.acm.org/doi/10.1145/358198.358210）
  1983 年的图灵奖演讲，描述了能够代代相传的编译器后门。
- <a id="ref-wheeler-2005"></a>[Wheeler, 2005] David A. Wheeler. "Countering Trusting Trust through
  Diverse Double-Compiling." *Proceedings of the 21st Annual Computer Security Applications Conference
  (ACSAC)*, 2005. https://dwheeler.com/trusting-trust/
  以另一个独立的编译器检验编译器二进制的方法。
- <a id="ref-cox-2023"></a>[Cox, 2023] Russ Cox. "Perfectly Reproducible, Verified Go Toolchains." The Go
  Blog, 2023. https://go.dev/blog/rebuild
  Go 工具链如何实现逐字节可复现，以及官方发布如何被独立验证。
- <a id="ref-gcc-nd"></a>[GCC, n.d.] GCC Team. *Installing GCC: Building.*
  https://gcc.gnu.org/install/build.html
  GCC 的三阶段自举，以及对第二、三阶段编译器的比较。
