---
weight: 1302
title: "3.2 Go 程序编译流程"
---

# 3.2 Go 程序编译流程

`go` 命令（[3.1](./cmd.md)）为每个包调用编译器 `compile`，把 `.go` 源码变成目标文件。这一节
鸟瞰这条编译流水线的几个阶段,目的是建立全局图景，编译器各阶段的内部细节（SSA、优化、逃逸
分析等）留待 [15 编译器](../../part5toolchain/ch15compile)深入。

## 3.2.1 一条经典的编译流水线

Go 编译器（`cmd/compile`）走的是一条相当经典的多阶段流水线，把高层源码逐步降低到机器码：

```mermaid
flowchart LR
    SRC[".go 源码"] --> LEX["词法 + 语法分析<br/>→ 抽象语法树 AST"]
    LEX --> TC["类型检查<br/>types2，含泛型"]
    TC --> IR["转为编译器中间表示 IR"]
    IR --> SSA["生成 SSA 中间码<br/>大量与机器无关的优化"]
    SSA --> MC["降低到目标架构<br/>寄存器分配、生成机器码"]
    MC --> OBJ["目标文件 .o"]
```

- **词法与语法分析**：把源码切成 token、构造出抽象语法树（AST）。
- **类型检查**：用 `types2`（[8.3](../../part2lang/ch08generics/checker.md)）核对类型、解析泛型、
  做类型推断,这一步抓出绝大多数编译错误。
- **中间表示与 SSA**：转成编译器内部 IR，再降到**静态单赋值**（SSA）形式,SSA 上做大量与
  机器无关的优化（常量折叠、死代码消除、内联、逃逸分析等，见
  [15 编译器](../../part5toolchain/ch15compile)）。
- **代码生成**：把 SSA 降低到具体架构，做寄存器分配，吐出机器指令，写成目标文件。

## 3.2.2 编译速度是一等约束

这条流水线的设计处处透着 Go 对**编译速度**的执念（[1.1](../ch01intro/history.md)）。Go 的语法被
刻意设计得**易于快速解析**（无需复杂的符号表回溯）;包的依赖是**显式且无环**的，编译器只需读
依赖包的导出信息（一个紧凑的接口摘要）而非其全部源码,这避免了 C++ 头文件那种传递性重编译的
噩梦。"未使用的导入/变量即报错"也并非洁癖，而是帮助编译器与人都快速看清依赖。这些设计合起来，
让 Go 能以惊人的速度编译大型代码库,而这正是它当初要解决的痛点。

## 3.2.3 与运行时的协同

编译器并非孤立工作，它与运行时（runtime）深度协同,这是理解全书的一把钥匙。编译器在每个函数
序言插入**栈增长检查**（[2.2](../ch02asm/callconv.md)、[14 执行栈](../../part4memory/ch14stack)）;
为每个类型生成**类型描述符**与 **GC 指针位图**（[4.1](../../part2lang/ch04type/type.md)、
[13 垃圾回收](../../part4memory/ch13gc)）;在指针写入处插入**写屏障**
（[13.x](../../part4memory/ch13gc)）;把 `go f()` 翻译成 `runtime.newproc`、`<-ch` 翻译成
`runtime.chanrecv`。换言之，编译器生成的代码里，处处埋着对运行时的调用与配合。Go 的"魔法"
（goroutine、GC、channel）正是**编译器与运行时合谋**的产物,本书反复在这两者的接缝处展开。
理解了编译只是流水线的一站、且时刻在为运行时铺路，后面的章节就有了统一的视角。

## 延伸阅读的文献

1. The Go Authors. *Introduction to the Go compiler (cmd/compile/README).*
   https://github.com/golang/go/blob/master/src/cmd/compile/README.md
2. The Go Authors. *Go compiler SSA backend.* https://github.com/golang/go/tree/master/src/cmd/compile/internal/ssa
3. 本书 [15 编译器](../../part5toolchain/ch15compile)（各阶段深入）、
   [8.3 类型检查技术](../../part2lang/ch08generics/checker.md).
4. Rob Pike. *Go at Google*（编译速度作为设计目标）. https://go.dev/talks/2012/splash.article

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
