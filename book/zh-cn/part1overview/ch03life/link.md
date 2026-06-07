---
weight: 1304
title: "3.4 模块链接"
---

# 3.4 模块链接

编译器（[3.2](./compile.md)）把每个包变成一个目标文件，但目标文件还不能直接运行。它们彼此
引用着对方的函数与变量，地址尚未确定，还缺运行时的支撑。把这些碎片拼成一个完整、可加载执行
的程序，是**链接器**（`cmd/link`，通常以 `go tool link` 的形式被 `go build` 调起）的活。这一节
看链接器做了哪几件事，以及 Go 在链接上的几处独特选择,它们一同解释了为什么一个 Go 程序往往是
一个「拷过去就能跑」的自包含文件。

## 3.4.1 链接器做的事

链接器的输入是一个 main 包的目标文件，加上它递归依赖的所有包（含整个运行时）的目标文件；
输出是一个可被操作系统加载执行的二进制。中间它要顺序完成几件关键工作：

- **符号解析**（symbol resolution）：把每一处对外部符号的**引用**，绑定到它在某个目标文件里的
  唯一**定义**。一个符号就是一个有名字的地址,某个函数的入口、某个全局变量的存储。A 包里写
  `fmt.Println(...)`，编译 A 时并不知道 `fmt.Println` 在哪，只留下一个待解析的引用；链接器把它
  接到 `fmt` 包目标文件里那份定义上。
- **布局**（layout）：把所有符号的机器码与数据，按种类安排进可执行文件的各个段,代码进 text、
  可读写数据进 data、只读数据（字符串字面量、类型信息）进 rodata 等。布局一旦定下，每个符号的
  最终地址也就确定了。
- **重定位**（relocation）：地址定下后，回头修正所有引用处填的临时地址。
- **死代码消除**（dead-code elimination）：从入口出发不可达的函数与变量，根本不写进最终二进制。

最后产出的，是一个静态布局完毕、地址全部填实的文件。下面三节分别细看其中最值得说的三处：
重定位（3.4.2）、死代码消除（3.4.3）、以及「运行时也被一并链接进来」这一 Go 的标志性后果
（3.4.4）。

```mermaid
flowchart LR
    OBJ["main.a + 依赖包目标文件<br/>(含整个 runtime)"] --> LOAD["装载符号<br/>loader 读入"]
    LOAD --> RESOLVE["符号解析<br/>引用 → 定义"]
    RESOLVE --> DEAD["死代码消除<br/>从 main.main 标记可达"]
    DEAD --> LAYOUT["段布局<br/>text/data/rodata"]
    LAYOUT --> RELOC["重定位<br/>填实地址"]
    RELOC --> BIN["可执行二进制"]
```

## 3.4.2 符号解析与重定位

这两步是链接的核心机制，值得稍微形式化一点。

一个**重定位项**（relocation）可以理解成一个三元组 $(o, S, a)$：在当前符号内偏移 $o$ 处有一个
待填的「洞」，它应当指向目标符号 $S$，并附带一个加数 $a$（addend）。当链接器在布局后确定了 $S$
的最终地址 $\text{addr}(S)$，它就把洞填上。最常见的两类填法是：

$$
\text{绝对引用：} \quad \text{patch}(o) = \text{addr}(S) + a
$$

$$
\text{相对引用：} \quad \text{patch}(o) = \text{addr}(S) + a - (\text{addr}(\text{self}) + o)
$$

绝对重定位把目标的真实地址直接填进去（如取一个全局变量的地址）；相对重定位填的是「目标相对
当前指令的距离」（如 x86 上 `CALL` 的 `rel32` 操作数），后者使代码可以整体平移而无需重填,这正是
位置无关代码（PIC）与现代 ASLR 的基础。Go 用一组架构无关的重定位类型（`objabi.RelocType`，如
`R_CALL`、`R_PCREL`、`R_ADDR`）描述这些洞，链接器在重定位阶段按目标架构翻译成具体的机器码补丁。

符号解析则是建立 $S$ 这个名字到一份定义的映射。同名符号可能出现在多个目标文件里（典型如内联
产生的同一个函数实例、或编译器生成的类型描述符），链接器要保证每个符号在最终二进制里**恰有
一份**定义，并让所有引用都指向它。Go 1.15 之前，这一步靠为每个符号建一个 `*sym.Symbol` 对象、
用一张全局字符串到对象的大哈希表完成；重写后改用整型符号索引（见 3.4.6），正是为了省下这张
表的内存与查表开销。

## 3.4.3 死代码消除

并非所有被链接进来的包里的代码都会进最终二进制。链接器从程序的**根**出发,主要是 `main.main`
以及各包的 `init` 函数，沿「谁引用了谁」的符号依赖图做一次可达性遍历（[reachability](https://en.wikipedia.org/wiki/Reachability)），
只有被标记为可达的符号才参与后续布局。不可达的函数、变量、类型信息会被整体丢弃。go1.26 的
实现用一个最小堆作为工作队列来跑这趟标记（`deadcodePass`，`src/cmd/link/internal/ld/deadcode.go`），
堆序遍历是为了改善访问局部性。

这件事可以直接观察。`-dumpdep` 会让链接器把它走过的符号依赖图打印出来，于是我们能看到一句
`fmt.Println` 是怎样把一长串符号「拽」进二进制的：

```shell
$ go build -a -ldflags=-dumpdep -o hello hello.go 2>&1 | grep 'main.main ->'
main.main -> main..stmp_0
main.main -> os.Stdout
main.main -> go:itab.*os.File,io.Writer
main.main -> fmt.Fprintln
```

反过来，没人引用的东西会被悄悄删掉。下面这个程序里 `unused` 从不被调用：

```go
package main

import "fmt"

//go:noinline
func used()   { fmt.Println("used") }

//go:noinline
func unused() { fmt.Println("unused") } // 无人引用

func main() { used() }
```

用 `go tool nm`（列出二进制里的符号表）一查，`main.used` 在，`main.unused` 不在,它在链接阶段
被消除了：

```shell
$ go build -o dc dc.go
$ go tool nm dc | grep 'main.used'
10009f4a0 T main.used
$ go tool nm dc | grep 'main.unused'    # 无输出：已被死代码消除
```

死代码消除对 Go 尤其重要，原因在 3.4.4：每个 Go 程序都把**整个运行时和所用标准库**链了进来，
若不剪枝，最朴素的 `hello world` 也会拖着一堆永不执行的代码。这趟标记最棘手的一处是接口与反射,
通过接口或 `reflect` 调用的方法，其调用点在静态分析里看不出具体落到哪个类型的实现，链接器必须
保守地把「可达类型的、签名匹配的方法」一并标活（`deadcodePass` 里的 `ifaceMethod`、`reflectSeen`
正为此存在）。这也是为什么大量使用反射的程序往往剪不掉多少代码。

## 3.4.4 运行时也被链接进来

最该记住的一点：**运行时是被链接进来的**。你的 `main` 包、它依赖的每一个包、以及整个 Go 运行时
（调度器、垃圾回收器、内存分配器、`netpoll` 等）都被链接器拼进同一个二进制。没有外部虚拟机，
没有解释器，运行时就静静待在可执行文件里。这正是 Go 程序「自带运行时」的由来。

它有多大一块？拿前面那个只打印一行的 `hello` 看：

```shell
$ go tool nm hello | wc -l           # 二进制里的符号总数
2598
$ go tool nm hello | grep -c 'runtime\.'   # 其中属于 runtime 的
1717
```

一个 `hello world` 里六成以上的符号来自运行时。这解释了 Go 二进制「天生就有几 MB 起步」的观感,
它装的不是你的几行代码，而是一套完整的并发运行时。与之相对，C 程序把这类支撑（线程、内存
管理）大多交给操作系统与 libc，故而可以很小。两种取舍各有去处：Go 用更大的体积换来「单文件
即整个执行环境」，下一节会看到这正是它在容器时代的杀手锏。

## 3.4.5 静态链接的取舍

Go 的另一个标志性选择是**默认静态链接**。一个纯 Go 程序编译出的，通常是不依赖外部共享库的、
自包含的可执行文件。把它拷到另一台同架构同系统的机器上就能跑，无需预装任何运行库。这与
C/C++ 程序常见的「依赖一堆 `.so`/`.dll`、换台机器就缺库」形成对比，也是 Go 在云原生时代大受
欢迎的原因之一,一个 `FROM scratch` 的空镜像里塞进一个 Go 二进制就能工作：

```dockerfile
FROM scratch
COPY hello /hello
ENTRYPOINT ["/hello"]
```

「默认静态」需要两处限定，不要把它说成绝对。其一，**cgo 会拉回动态依赖**：一旦程序经 cgo 调用
C 代码，链接器要接上系统的 libc，二进制便重新有了动态依赖。其二，**有些平台天生不全静态**:
macOS 不提供静态的系统库，纯 Go 程序也仍会动态链接 `libSystem`。这两点在实验里都看得见，
也提示我们「静态」的边界在哪：

```shell
# Linux 上关掉 cgo，得到一个完全静态的二进制
$ CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o hello_linux hello.go
$ file hello_linux
hello_linux: ELF 64-bit ... statically linked, ...

# 同一份源码在 macOS 上：仍依赖 libSystem（平台所致，非 Go 之过）
$ otool -L hello
hello:
	/usr/lib/libSystem.B.dylib ...
```

`CGO_ENABLED=0` 因此成了构建可移植静态二进制的常用开关,它顺带禁用 cgo，逼使纯 Go 实现
（如 `net` 包的纯 Go 解析器）上场，从而切断对 libc 的动态依赖。

静态链接的代价也要明说。**体积**更大，每个二进制都自带一份运行时与所用库代码（前面 `hello`
约 2.5MB）；好在死代码消除与 strip 能削掉一部分,`-ldflags="-s -w"` 去掉符号表与 DWARF 调试
信息，能把那个 `hello` 从约 2.5MB 压到约 1.7MB：

```shell
$ go build -ldflags="-s -w" -o hello_stripped hello.go   # -s 去符号表，-w 去 DWARF
```

更要紧的代价在**安全更新**：动态链接下，libc 出了漏洞，系统换掉那个 `.so`、重启进程即可；
静态链接把库的代码焊进了每个二进制，任何一个依赖的安全修复都要求**重新编译并重新分发**所有
受影响的程序。把它放进谱系看，这并非 Go 独有的难题，C 世界里用 musl 静态链接、或 Rust 默认
静态链接的人也都在这条权衡线上：可移植与部署简单在一端，体积与「集中打补丁」的能力在另一端。
Go 替它瞄准的服务端/容器场景做了选择,在那里，「一个文件就是整个交付物」省下的运维成本，通常
压过了重编译分发的代价。

## 3.4.6 链接器的演化与前沿

Go 的链接器同样源自 Plan 9 传统（[2.1](../ch02asm/asm.md)），多年来持续被改造。最值得记的一次是
Go 1.15 前后、代号 `dev.link` 的**大规模重写**。改造的核心是目标文件格式与符号的内部表示：
旧实现把每个符号都展开成一个 `*sym.Symbol` 堆对象、靠一张全局哈希表按名字索引，符号一多，
内存与 GC 压力随之上来；新实现引入新的对象文件格式，并把符号统一表示为紧凑的整型索引，由新增
的 `loader` 包（`src/cmd/link/internal/loader`）集中管理，按需才把符号「实体化」成对象。另一处
改动是把链接的内部阶段进一步并行化，例如并行地对符号施加重定位。按 Go 1.15 发布说明给出的
实测，对一组有代表性的大型 Go 程序，在 ELF 系统的 amd64 上链接平均**快约 20%、省约 30% 内存**
（其他架构与系统上提升更温和，代价是新对象文件比 1.14 的略大）。这是一个跨多个版本的「重写
链接器」工程的一部分，后续版本仍在持续改进。

这次重写呼应着 Go 对**构建速度**的一贯执念（[1.1](../ch01intro/history.md)）。链接是构建流水线
的最后一站，它快不快，直接决定每一次「改一行、重新跑」的等待时长；从编译到链接，整条流水线
的设计目标始终一致,让大规模 Go 工程的构建保持飞快。

链接仍有未尽的前沿。对极大的二进制，链接时间和峰值内存依然可能成为瓶颈，DWARF 调试信息的
生成是其中一项不小的开销（故而 CI 里常用 `-w` 关掉它换速度）；增量链接、更激进的并行化、以及
与编译器更紧的协同，都是仍在演进的方向。下一站，我们看这个链接好的二进制被操作系统加载后，
如何把自己「开机」（[3.5](./boot.md)）。

## 延伸阅读的文献

1. The Go Authors. *cmd/link 文档与源码（含 `-dumpdep`、`-s`、`-w` 等链接选项）.*
   https://pkg.go.dev/cmd/link ；https://github.com/golang/go/tree/master/src/cmd/link
2. The Go Authors. *src/cmd/link/internal/ld/deadcode.go（从 `main.main` 出发的可达性标记）、
   src/cmd/link/internal/loader（新对象文件格式与符号索引）.*
   https://github.com/golang/go/tree/master/src/cmd/link/internal
3. Austin Clements et al. *Building a better Go linker（链接器现代化设计文档，多版本工程）.*
   https://go.dev/s/better-linker
4. The Go Authors. *Go 1.15 Release Notes（链接器：新对象文件格式、并行重定位，平均快约 20%、
   省约 30% 内存）.* https://go.dev/doc/go1.15
5. Rob Pike. *Go at Google: Language Design in the Service of Software Engineering（构建速度作为
   一等设计目标）.* 2012. https://go.dev/talks/2012/splash.article
6. 本书 [2.1 Plan 9 汇编](../ch02asm/asm.md)、[3.2 编译流程](./compile.md)、
   [3.5 启动引导](./boot.md)、[1.1 历史与设计哲学](../ch01intro/history.md)、
   [17 模块与生态](../../part5toolchain/ch17modules).

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
