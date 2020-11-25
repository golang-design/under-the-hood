---
weight: 3306
title: "13.6 语言的自举"
---

# 13.6 语言的自举



<!-- 
golang.org/s/go13linker
golang.org/s/go13compiler
golang.org/s/go15bootstrap -->

## 前期准备

1. 从 Go 源代码树中删除所有 C 程序：删除 C 编译器（5c，6c，8c，9c）。
2. 将 C 程序将转换为 Go，包括：
    + Go 编译器
    + 汇编器
    + 链接器
    + `cmd/dist`

如果这些程序是用 Go 编写的，则在完全从源代码构建时会引入引导问题：
因此需要一个有效的 Go 工具链才能构建 Go 工具链。

## 自举流程

要构建 x ≥ 5 的 Go 1.x，必须在 `$GOROOT_BOOTSTRAP` 中已经安装 Go 1.4（或更高版本）。
`$GOROOT_BOOTSTRAP` 的默认值为 `$HOME/go1.4`。
Go 1.4 将尽可能长地继续使用，并作为自举的基础版本。
适当的工具链（编译器，汇编器，链接器）将需要使用 Go 1.4 进行构建，
无论是通过将其功能限制在 Go 1.4 中还是通过使用构建标签来构建。

为了与后续内容进行比较，Go 1.4的旧构建过程为：

1. 用 `gcc`（或 `clang`）构建 `cmd/dist`。
2. 使用 `dist`，用 `gcc`（或 `clang`）构建编译器工具链
3. NOP
4. 使用 `dist`，使用编译器工具链构建 `cmd/go`（作为 `go_bootstrap`）。
5. 使用 `go_bootstrap` 构建其余的标准库和命令。

Go 1.x（x ≥ 5）的新构建过程将是：

1. 使用 Go 1.4 构建 `cmd/dist`。
2. 使用 `dist`，通过 Go 1.4 构建 Go 1.x 编译器工具链。
3. 使用 `dist` 自身重建 Go 1.x 编译器工具链。
4. 使用 `dist`，使用 Go 1.x 编译器工具链构建 Go 1.x `cmd/go`（作为 `go_bootstrap`）。
5. 使用 `go_bootstrap` 构建其余的 Go 1.x 标准库和命令。

在自举前后的构建过程包含两个变化：

1. 第一个变化是用 Go 1.4 替换了 gcc（或clang）。
2. 第二个变化是引入了第 3 步，该步骤用其自身重建了 Go 1.x 编译器工具链。
第 2 步中构建的 6g 是使用 Go 1.4 库和编译器构建的 Go 1.x 编译器。
第 3 步中构建的 6g 与 Go 1.x 编译器相同，但使用 Go 1.x 库和编译器构建。
如果 Go 1.x 更改了调试信息的格式或二进制文件的某些其他详细信息，
则 6g 是 Go 1.4 二进制文件还是 Go 1.x 二进制文件对工具可能很重要。
如果 Go 1.x 在库中引入了任何性能或稳定性方面的改进，
则第 3 步中的编译器将比第2步中的编译器更快或更稳定。
当然，如果 Go 1.x 存在问题，则第 3 步中 6g 的构建也会遇到问题，
因此可以禁用第 3 步进行调试。

```
all.bash
 ↳ make.bash
   ↳ check ld
      ↳ check dyanmic ld.so
         ↳ cldear runtime/runtime_defs.go
            ↳ go build -o cmd/dist/dist ./cmd/dist
               ↳ dist bootstrap
                  ↳ run.bash --no-rebuild
                     ↳ go tool dist test
```

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).