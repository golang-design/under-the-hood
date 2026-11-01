---
weight: 1304
title: "3.4 模块链接"
---

# 3.4 模块链接

编译器（[3.2](./compile.md)）把每个包编译成一个目标文件，但目标文件还不能直接运行：它们相互引用
对方的函数和变量，而这些符号的最终地址在编译时尚未确定。把全部目标文件连同运行时组合成一个可由
操作系统加载执行的程序，是**链接器**（linker）的工作。Go 的链接器是 `cmd/link`，由 `go build`
以 `go tool link` 的形式调用。

以一个只打印一行的程序为例：

```go
package main

import "fmt"

func main() { fmt.Println("hello") }
```

为 linux/amd64 编译该程序，并让编译器输出汇编（`go build -gcflags=-S`）。`main.main` 中调用
`fmt.Fprintln` 的位置如下（`fmt.Println` 已被内联为对 `fmt.Fprintln` 的调用，源码位置一列已删去）：

```
0x0041 00065   CALL  fmt.Fprintln(SB)
0x0040 fe e8 00 00 00 00 48 83 c4 38 5d c3 e8 00 00 00
rel 66+4 t=R_CALL fmt.Fprintln+0
```

`e8` 是 x86 的 `CALL` 指令，其后 4 个字节本应给出调用目标，此时却全部为 0。编译器每次只编译一个
包，编译 `main` 时无从得知 `fmt.Fprintln` 最终位于何处，只能先留出空位，并用最后一行加以记录：
从第 66 字节起的 4 个字节，待 `fmt.Fprintln` 的地址确定后再行填写。同一条指令在最终的可执行文件
中是：

```
$ go tool objdump -s '^main.main$' hello | grep Fprintln
  print.go:315		0x49e161		e8dab0ffff		CALL fmt.Fprintln(SB)
```

空位已被填写。另一个值得注意的现象是：`main.main` 只有 83 字节，整个文件却有 2,414,502 字节。
填写地址、并写入其余两百余万字节的，都是链接器。

## 3.4.1 链接器的工作

编译器为每个包产出的**目标文件**（object file，见 [3.2](./compile.md)）包含该包的机器码和数据，
以及两张表。一张是**符号**（symbol）表，列出本包定义的函数和全局变量，如 `fmt.Fprintln`、`os.Stdout`；
另一张是**重定位项**（relocation）表，记录代码和数据中所有待填写的地址，上例中以
`rel` 开头的一行就是一条重定位项。

链接器读入 `main` 包及其直接、间接依赖的全部包（包括运行时）的目标文件，依次完成四项工作
[[Levine, 2000](#ref-levine-2000)]：

1. **符号解析**（symbol resolution）：把每一处对外部符号的引用绑定到唯一的定义；
2. **死代码消除**（dead-code elimination）：从程序入口出发找出可达的符号，丢弃其余部分（3.4.3）；
3. **布局**（layout）：把保留下来的符号按类别安排到可执行文件的各个段中，代码、只读数据、可写数据
   各居其位，每个符号由此获得确定的地址；
4. **重定位**：依据重定位项回填所有地址（3.4.2），并按操作系统要求的格式（Linux 上为 ELF）写出
   文件。

## 3.4.2 重定位

`CALL` 指令中存放的不是 `fmt.Fprintln` 的绝对地址，而是从下一条指令到 `fmt.Fprintln` 的偏移量，CPU
执行时将二者相加得到跳转目标。因此，链接器在这里只需做一次减法：

```
$ go tool nm hello | grep ' fmt.Fprintln$'
  499240 T fmt.Fprintln
```

`fmt.Fprintln` 位于 `0x499240`。调用指令起始于 `0x49e161`，长 5 字节，下一条指令位于 `0x49e166`。`0x499240 - 0x49e166 = -0x4f26`，
按小端序写成 4 个字节即 `da b0 ff ff`，与最终文件中 `e8` 之后的
4 个字节一致。

另一类重定位填写的是目标的绝对地址，例如某张表中存放的全局变量地址。编译器以 `R_CALL`、`R_PCREL`、`R_ADDR`
等类型区分不同的填写方式，链接器在 `cmd/link/internal/ld/data.go` 中按目标体系结构逐一
处理。

相对寻址的好处在于：只要代码各部分之间的相对位置不变，已经填好的偏移量就无须修改。操作系统因而
可以在每次加载时把程序放到不同的地址，使攻击者难以预测函数的位置，即地址空间布局随机化（ASLR）。
能够加载到任意地址的可执行文件称为位置无关可执行文件（position-independent executable，PIE）。Go
1.26 在 macOS、Windows、Android 和 iOS 上默认生成 PIE（Windows 上启用竞态检测时除外）；在 Linux
上则默认加载到固定地址 `0x400000` 附近，需要时可指定 `-buildmode=pie`。

## 3.4.3 死代码消除

标准库有数百个包，而一个程序通常只用到其中一小部分。链接器从程序入口出发，沿符号之间的引用关系
遍历，标记所有可达的符号，未被标记的符号不写入最终文件。这与垃圾回收器的标记阶段是同一种算法
（[第 13 章](../../part4memory/ch13gc/readme.md)），只是后者从全局变量和栈出发，沿指针遍历对象。

`-ldflags=-dumpdep` 使链接器每标记一个符号就输出一行「引用者 -> 被引用
者」[[Go Authors, 2026b](#ref-go-authors-2026b)]。从一万余行输出中筛选出通往 `main.main` 的路径：

```
$ CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags=-dumpdep -o /dev/null . 2>&1 \
    | grep -E '^_ |-> (_rt0_amd64|runtime\.(rt0_go|mainPC|main|main_main·f)|main\.main)$'
_ -> _rt0_amd64_linux
_ -> runtime.unreachableMethod
_ -> go:main.inittasks
_rt0_amd64_linux -> _rt0_amd64
_rt0_amd64 -> runtime.rt0_go
runtime.rt0_go -> runtime.mainPC
runtime.mainPC -> runtime.main
runtime.main -> runtime.main_main·f
runtime.main_main·f -> main.main
```

`_` 表示遍历的根。真正的起点是操作系统进入程序的位置 `_rt0_amd64_linux`，`main.main` 经由运行时的
启动代码被间接引用。程序运行时沿这条路径所做的工作，见 [3.5](./boot.md)。

对普通函数而言，可达性分析是直接的，难点在于方法。直接调用的方法与普通函数无异；但对于经由接口的调用，
例如 `q.Quack()`，链接器无法知道 `q` 的动态类型，也就无法确定应当保留哪个类型的 `Quack`。Go
的链接器（`cmd/link/internal/ld/deadcode.go` [[Go Authors, 2026a](#ref-go-authors-2026a)]）采取的策略是：
记录程序中所有经由接口调用的方法（方法名加签名），对于被转换为接口的类型，凡名字和签名与之匹配的方法均予以
保留。源码注释对此的评价是「极其保守，但简单且正确」[[Go Authors, 2026a](#ref-go-authors-2026a)]。

反射使问题更加复杂。若 `reflect.Value.MethodByName(name)` 中的 `name` 在运行时才能确定，任何导出
方法都可能被调用。编译器会为这类调用加上标记，链接器一旦遍历到带标记的函数，便不再筛选：所有被
转换为接口的类型，其导出方法全部保留。若 `name` 是常量，则只保留同名方法。

下面的程序可以验证这一点（`//go:noinline` 用于阻止编译器推断出接口背后的具体类型）：

```go
type Duck struct{}

func (Duck) Quack() string { return "quack" }
func (Duck) Swim() string  { return "swim" } // 没有任何地方调用

type Quacker interface{ Quack() string }

//go:noinline
func newQuacker() Quacker { return Duck{} }

//go:noinline
func unused() { fmt.Println("unused") } // 没有任何地方调用

func main() { fmt.Println(newQuacker().Quack()) }
```

```
$ CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o duck . && go tool nm duck | grep ' main\.'
  49e1e0 T main.(*Duck).Quack
  49e120 T main.Duck.Quack
  49e160 T main.main
  49e140 T main.newQuacker
```

`unused` 与 `Swim` 均已被删除（`(*Duck).Quack` 是编译器为指针类型生成的包装方法）。再将 `main`
改为先取得 `q := newQuacker()`，并加入一处反射调用：

| `main` 中额外的代码 | `Swim` | 文件大小（字节） | 函数个数 |
| --- | --- | --- | --- |
| 无 | 删除 | 2,414,840 | 1,944 |
| `reflect.ValueOf(q).MethodByName("Swim")` | 保留 | 2,544,376 | 2,031 |
| 同上，但方法名是运行时拼接的字符串 | 保留 | 3,562,204 | 3,342 |

（linux/amd64；函数个数为 `go tool nm` 输出中类型为 `T` 或 `t` 的符号数。）第三种情况多出 1,398 个
函数和 47% 的体积，均为「可能经由反射调用」的导出方法。`text/template` 按模板中书写的名字调用方法，
而这个名字正是运行时才确定的字符串，因此使用它的程序体积会明显增大。

下面的交互图演示这一过程：可以单步观察待处理队列的变化，也可以加入一处反射调用，观察 `Swim` 如何被
保留。链接器实际处理符号的顺序与图中不同，但处理顺序不影响最终保留的符号集合。

<div class="viz" data-viz="link-deadcode"></div>

## 3.4.4 可执行文件的构成

`go tool nm -size hello` 列出每个符号的大小。`hello` 中 1,941 个函数共 612,583 字节，其中 `runtime`
包占 434,726 字节（71%），`main.main` 只有 83 字节。调度器、内存分配器和垃圾回收器都包含在内：Go
程序不依赖外部的虚拟机或运行库，运行时本身就是可执行文件的一部分。

文件中最大的部分甚至不是代码。`objdump -h hello` 显示，代码段为 643,505 字节，而名为 `.gopclntab` 的表有
681,250 字节。这张表记录了从任意指令地址到所属函数、源码行号以及栈上指针位置的映射，panic 时打印调用栈、
垃圾回收时扫描栈（[第 14 章](../../part4memory/ch14stack/readme.md)）都依赖它，因此不能删除。
可以删除的是供调试器使用的部分：`-ldflags="-s -w"` 去掉符号表（`-s`）和 DWARF 调试信息
（`-w`）[[Go Authors, 2026b](#ref-go-authors-2026b)]，`hello` 由 2,414,502 字节减小到 1,605,794 字节，panic
时仍能打印调用栈。

链接器还会写入构建信息，包括 Go 版本、所依赖的模块及其版本、构建参数等。`go version -m hello` 无须
运行程序即可读出这些信息，漏洞扫描工具 `govulncheck` 也依据它判断程序是否包含存在已知漏洞的模块
版本。程序自身可以这样读取：

```go {run=true}
package main

import (
	"fmt"
	"runtime/debug"
)

func main() {
	info, ok := debug.ReadBuildInfo() // 读链接器写进文件的构建信息
	if !ok {
		fmt.Println("没有构建信息")
		return
	}
	fmt.Println("Go 版本：" + info.GoVersion)
	fmt.Println("主包：" + info.Path)
	for _, s := range info.Settings {
		if s.Value != "" {
			fmt.Printf("  %s=%s\n", s.Key, s.Value)
		}
	}
}
```

在 darwin/arm64 上执行 `go run main.go` 的输出如下。在网站上运行时，最后几行为 `CGO_ENABLED=0`、`GOARCH=wasm`
和 `GOOS=js`；在 Git 管理的模块中构建时，还会包含 `vcs.revision` 等版本控制信息。

```
Go 版本：go1.26.10
主包：command-line-arguments
  -buildmode=exe
  -compiler=gc
  CGO_ENABLED=1
  GOARCH=arm64
  GOOS=darwin
  GOARM64=v8.0
```

## 3.4.5 静态链接与动态链接

使用外部库有两种方式。一种是把用到的代码复制进程序，称为**静态链接**（static linking）；另一种只在
程序中记录对库中符号的引用，由系统在程序启动时加载库并完成链接，称为**动态链接**（dynamic
linking）。后一种方式下的库可由多个程序共享，称为**共享库**（shared library，Linux 上为 `.so`
文件）。

早期的 Unix 只支持静态链接，几乎每个程序都带有一份 C 库，磁盘和内存中存在大量相同的副本。1980 年代后期，
共享库出现在主流 Unix 中：System V Release 3（1987 年）的共享库须加载到预先约定的固定地址；SunOS
4.0（1988 年）则实现了在程序启动时完成的动态链接 [[Gingell et al., 1987](#ref-gingell-et-al-1987)]，System
V Release 4 随后也采用了这种方式。多个进程由此共享内存中的同一份库，库升级时也无须重新编译依赖它的
程序，Linux 和各 BSD 系统沿用至今。其代价是程序每次启动都要查找并链接共享库，能否运行还取决于目标机器上所
安装的库的版本 [[Drepper, 2011](#ref-drepper-2011)]。

贝尔实验室的 Plan 9 有意不支持动态链接，所有程序均为静态链接。Go 的工具链出自 Plan 9 的作者之手
（[2.1](../ch02asm/asm.md)），也继承了这一做法：纯 Go 程序编译后是一个不依赖任何共享库的文件。

```
$ file hello
hello: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), statically linked, Go BuildID=...
```

例外有两种。其一是 cgo：程序调用 C 代码时，Go 把最后的链接交给系统的 C 链接器完成，结果通常会动态链接 C
库。标准库中的 `net` 和 `os/user` 在 cgo 可用时也会编译进调用 C 库的实现：`os/user` 默认通过 C
库查询用户；`net` 在 Unix 上默认使用纯 Go 的域名解析器，但在某些配置下（例如 `/etc/nsswitch.conf`
使用了纯 Go 解析器不支持的功能）改用 C 库的 `getaddrinfo`。因此，导入这两个包的程序在 cgo
可用时同样会动态链接 C 库。设置 `CGO_ENABLED=0`，或使用构建标签 `netgo` 与 `osusergo`，可使它们只使用纯
Go 的实现。其二是 macOS：苹果只保证经由系统库 `libSystem` 调用内核的接口长期稳定，Go 自 1.11 起在 macOS
上通过它发起系统调用 [[Go Authors, 2018](#ref-go-authors-2018)]，因此 macOS 上的 Go
程序总是动态链接这个库：

```
$ go build -o hello . && otool -L hello
hello:
	/usr/lib/libSystem.B.dylib (compatibility version 0.0.0, current version 0.0.0)
	/usr/lib/libresolv.9.dylib (compatibility version 0.0.0, current version 0.0.0)
```

两种方式的比较如下：

| | 静态链接 | 动态链接 |
| --- | --- | --- |
| 部署 | 复制单个文件即可，容器镜像可以基于空镜像（`FROM scratch`） | 目标机器上需要有版本匹配的库 |
| 启动 | 直接运行 | 需先加载共享库并完成符号解析 |
| 体积与内存 | 每个程序各带一份库代码 | 多个进程共享同一份 |
| 修复漏洞 | 所有使用该库的程序都要重新编译、重新发布 | 替换库文件并重启进程 |

Go 主要用于服务端和容器环境，这些场景下每次发布本来就要重新构建镜像，「单个文件即全部」带来的
便利更为突出。代价体现在表格的最后一行：标准库或某个依赖修复漏洞之后，所有使用它的程序都必须重新
编译。前面提到的构建信息，正是用于找出这些程序的。

## 3.4.6 链接器的重写

Go 最早的链接器是 Plan 9 的 C 语言链接器，Go 1.5 时随编译器一起被自动翻译成 Go（[3.3](./bootstrap.md)）。
翻译保留了原有的设计：每个符号都是内存中的一个对象，通过一张以名字为键的大表查找。程序规模越大，
对象和表也越大，链接逐渐成为构建过程中最慢、占用内存最多的步骤之一。而构建速度从一开始就是 Go
的首要设计目标之一 [[Pike, 2012](#ref-pike-2012)]。

2019 年起，Go 团队重写了链接器的核心 [[Clements, 2019](#ref-clements-2019)]：目标文件改用新的格式，
符号以整数编号标识，引用直接记录编号；链接器按需读取符号，不再为每个符号创建对象、按名字查表。据 Go 1.15
的发布说明，在 amd64 的 Linux 等系统上，一组有代表性的大型程序链接速度平均提高 20%，内存占用减少 30%
[[Go Authors, 2020](#ref-go-authors-2020)]；Go 1.16 在此基础上又提速 20% 至 25%，内存再减少 5% 至
15%（linux/amd64）[[Go Authors, 2021](#ref-go-authors-2021)]。

## 延伸阅读

- <a id="ref-levine-2000"></a>[Levine, 2000] John R. Levine. *Linkers and Loaders*. Morgan Kaufmann, 2000.
  链接与加载的经典教材，符号、重定位、共享库各有专章。
- <a id="ref-gingell-et-al-1987"></a>[Gingell et al., 1987] Robert A. Gingell, Meng Lee, Xuong T. Dang,
  Mary S. Weeks. "Shared Libraries in SunOS." *Proceedings of the Summer 1987 USENIX Conference*, 1987.
  Unix 共享库的早期设计，阐述了引入共享库的动机。
- <a id="ref-drepper-2011"></a>[Drepper, 2011] Ulrich Drepper. "How To Write Shared Libraries." 2011.
  https://akkadia.org/drepper/dsohowto.pdf
  动态链接在启动时间和代码生成上的具体开销。
- <a id="ref-clements-2019"></a>[Clements, 2019] Austin Clements. "Building a better Go linker." 2019.
  https://go.dev/s/better-linker
  Go 链接器重写的设计文档。
- <a id="ref-go-authors-2020"></a>[Go Authors, 2020] The Go Authors. *Go 1.15 Release Notes*, "Linker".
  https://go.dev/doc/go1.15
  重写后链接速度与内存占用的实测数据。
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.16 Release Notes*, "Linker".
  https://go.dev/doc/go1.16
  在 Go 1.15 的基础上进一步的提速与内存节省。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. `cmd/link/internal/ld/deadcode.go`（Go
  1.26）.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/link/internal/ld/deadcode.go
  https://github.com/golang/go/tree/master/src/cmd/link/internal （`ld/deadcode.go`、`loader`：新对象文件格式与符号索引）
  死代码消除的实现。函数 `deadcode` 之前的注释说明了方法的三种调用途径及各自的处理方式。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *cmd/link 文档与源码（含
  `-dumpdep`、`-s`、`-w` 等链接选项）.* https://pkg.go.dev/cmd/link
  ；https://github.com/golang/go/tree/master/src/cmd/link
- <a id="ref-pike-2012"></a>[Pike, 2012] Rob Pike. *Go at Google: Language Design in the Service of
  Software Engineering（构建速度作为一等设计目标）.* 2012. https://go.dev/talks/2012/splash.article
- <a id="ref-go-authors-2018"></a>[Go Authors, 2018] The Go Authors. *Go 1.11 Release Notes*, "Runtime".
  https://go.dev/doc/go1.11#runtime
  macOS 与 iOS 上的运行时改经 `libSystem.dylib` 发起系统调用。
- 本书 [2.1 Plan 9 汇编](../ch02asm/asm.md)、[3.2 编译流程](./compile.md)、[3.5
  启动引导](./boot.md)、[1.1 历史与设计哲学](../ch01intro/history.md)、[17
  模块与生态](../../part5toolchain/ch17modules).

