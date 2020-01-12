---
weight: 1101
title: "1.1 Go 语言综述"
---

# 1.1 Go 语言综述

TODO:

Go 语言的设计哲学是简洁，在 Go 团队的一次访谈中，Rob Pike 和 Ken Thompson 均有提到
Go 在诞生之初就选择了一条与以往的编程语言所选择的不同方法，仅尝试提供编程过程中的必需品，
剔除掉纷繁复杂的语法糖和日渐增多的特性列表。

## 原始类型

原始的数值类型包括：

```go
bool, 
uint, uint8, uint16, uint32, uint64, 
int8, int16, int32, int64, 
float32, float64,
complex64, complex128
```

别名类型包括：byte rune

还有三个特定的

```go
uint
int
uintptr
```

高阶的数据结构包括

```
string
[42]byte
[]byte
struct{}{}
*int64
```

## 关键字

Go 语言本身只有 25 个关键字，涵盖了包管理、常量与变量、流程控制、函数调用、数据结构
和并发控制六个方面的语言特性。

### 函数

```go
func foo(argc int, argv ) float {

}
```

### 包管理

Go 语言以包为代码组织的最小单位，不允许产生包与包之间的循环依赖。
包管理涉及两个关键字，`package` 负责声明当前代码所在的包的包名，`import` 则负责导入
当前包所依赖的包。导入的形式包括绝对路径和相对路径，还能够在导入时候对包指定别名，甚至将别名指定为下划线，只导入所依赖包的 `init` 初始化函数。

```go
package foo
import (
    "go/types"
    "golang.org/x/syscall"
    "errors"
    xerrors "golang.org/x/errors"
    _ "os/signal"
)
```

### 常量与变量

常量 `const` 与变量 `var` 是编程语言里司空见惯的概念，Go 语言也不例外。
常量与变量的声明允许类型推导，也允许明确指定值的类型。

```go
const (
    name       = "val"
    PI float64 = 3.1415926
)
var (
    age = 18
)
```

变量除了使用 `var` 来进行声明外，还可以在函数内部通过 `:=` 进行声明。

```
package import

const var

if else break continue 
switch case default 
for range 
goto fallthrough

func return defer

type struct map interface

go chan select
```


## 内建

```go
const (
	true  = 0 == 0 
    false = 0 != 0
    iota  = 0
)
var nil T
```


```go
// 往切片末尾追加元素
func append(slice []T, elems ...T) []T
// 将 src 拷贝到 dst
func copy(dst, src []T) int
// 删除
func delete(m map[T]U, key T)
func len(v T) int
func cap(v T) int
func make(t T, size ...IntegerT) T
func new(T) *T
func complex(r, i FloatT) ComplexT
func real(c ComplexT) FloatT
func imag(c ComplexT) FloatT
func close(c chan<- T)
func panic(v interface{})
func recover() interface{}
func print(args ...T)
func println(args ...T)
type error interface {
	Error() string
}
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
