---
weight: 1101
title: "1.1 Go 语言综述"
bookHidden: true
---

# 1.1 Go 语言综述


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
func foo(argc int, argv []string) float64 {
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

## Channel 与 Select

Channel 主要有两种形式：

1. **有缓存 Channel（buffered channel）**，使用 `make(chan T, n)` 创建
2. **无缓存 Channel（unbuffered channel）**，使用 `make(chan T)` 创建

其中 `T` 为 Channel 传递数据的类型，`n` 为缓存的大小，这两种 Channel 的读写操作都非常简单：

```go
// 创建有缓存 Channel
ch := make(chan interface{}, 10)
// 创建无缓存 Channel
ch := make(chan struct{})
// 发送
ch <- v
// 接受
v := <- ch
```

他们之间的本质区别在于其内存模型的差异，这种内存模型在 Channel 上体现为：

- 有缓存 Channel: `ch <- v` 发生在 `v <- ch` 之前
- 有缓存 Channel: `close(ch)` 发生在 `v <- ch && v == isZero(v)` 之前
- 无缓存 Channel: `v <- ch` 发生在 `ch <- v` 之前
- 无缓存 Channel: 如果 `len(ch) == C`，则从 Channel 中收到第 k 个值发生在 k+C 个值得发送完成之前

直观上我们很好理解他们之间的差异：
对于有缓存 Channel 而言，内部有一个缓冲队列，数据会优先进入缓冲队列，而后才被消费，
即向通道发送数据 `ch <- v` 发生在从通道接受数据 `v <- ch` 之前；
对于无缓存 Channel 而言，内部没有缓冲队列，即向通道发送数据 `ch <- v` 一旦出现，
通道接受数据 `v <- ch` 会立即执行，
因此从通道接受数据 `v <- ch` 发生在向通道发送数据 `ch <- v` 之前。
我们随后再根据实际实现来深入理解这一内存模型。

Go 语言还内建了 `close()` 函数来关闭一个 Channel：

```go
close(ch)
```

但语言规范规定了一些要求：

- 关闭一个已关闭的 Channel 会导致 panic
- 向已经关闭的 Channel 发送数据会导致 panic
- 向已经关闭的 Channel 读取数据不会导致 panic，但读取的值为 Channel 缓存数据的零值，可以通过接受语句第二个返回值来检查 Channel 是否关闭：
  
  ```go
  v, ok := <- ch
  if !ok {
  	... // Channel 已经关闭
  }
  ```

Select 语句伴随 Channel 一起出现，常见的用法是：

```go
select {
case ch <- v:
	...
default:
	...
}
```

或者：

```go
select {
case v := <- ch:
	...
default:
	...
}
```

用于处理多个不同类型的 `v` 的发送与接收，并提供默认处理方式。

## 错误处理

Go 语言的错误处理被设计为值类型，任何实现了 `error` 接口的类型均可以以 `error` 的类型返回：

```go
type CustomErr struct {
	err error
}
func (c CustomErr) Error() string {
	return fmt.Sprintf("err: %v", c.err)
}
```

上面的 `CustomErr` 类型实现了 `Error()` 方法，于是可以以 `error` 类型返回给上层调用：

```go
func foo() error {
	return CustomErr{errors.New("this is an error")}
}
func main() {
	err := foo()
	if err != nil { panic(err) }
}
```

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
