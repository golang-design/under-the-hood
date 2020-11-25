---
weight: 3401
title: "12.1 泛型设计的演进"
---

# 12.1 泛型设计的演进

> 本节内容提供一个线上演讲：[YouTube 在线](https://www.youtube.com/watch?v=E16Y6bI2S08) [Google Slides 讲稿](https://changkun.de/s/go2generics/)

TODO: 需要补充并丰富描述

多态（Polymorphism）是同一形式表现出不同行为的一种特性。早期学者们对于多态的理解不如现在丰富，在编程语言理论中最早被分为两类 [Strachey and Christopher 1967]，同时也是如今被广泛实践的两类泛型的核心思想：临时性多态和参数化多态。

**临时性多态（Ad hoc Polymorphism）** 根据实参类型调用对应的版本，仅支持数量有限的调用。也被翻译为特设多态。
例如：函数重载：

```go
func Add(a, b int) int { return a+b }
func Add(a, b float64) float64 { return a+b } // 注意: Go 语言中不允许同名函数

Add(1, 2)     // 调用第一个
Add(1.0, 2.0) // 调用第二个
Add("1", "2") // 编译时不检查，运行时找不到实现，崩溃
```

**参数化多态（Parametric Polymorphism）** 根据实参类型生成不同的版本，支持任意数量的调用，即我们常说的**泛型**。

```go
func Add(a, b T) T{ return a+b }

Add(1, 2)              // 编译器生成 T = int 的 Add
Add(float64(1.0), 2.0) // 编译器生成 T = float64 的 Add
Add("1", "2")          // 编译器生成 T = string 的 Add
```

当使用 `interface{}` 时，a、b、返回值都可以在运行时表现为不同类型，取决于内部实现如何对参数进行断言：

```go
type I interface { ... }
func Max(a, b I) I { ... } // T 是接口
```

当使用泛型时，a、b、返回值必须为同一类型，类型参数施加了这一强制性保障：

```go
func Max(a, b T) T { ... } // T 是类型参数
```

泛型的总体目标就是：快且安全。在这里：

- 快：意味着静态类型
- 安全：意味着编译早期的错误甄别

## 12.1.1 从 Go 1 谈起

在 Go 语言不支持泛型之前，Go 程序员通常需要产出针对不同类型，但实现方式完全相同的代码，例如下面的 `Max` 函数：

```go
func MaxInt(a, b int) int {
    if a > b {
        return a
    }
    return b
}
func MaxFloat64(a, b float64) float64 {
    if a > b {
        return a
    }
    return b
}
func MaxUintptr(a, b uintptr) uintptr {
    if a > b {
        return a
    }
    return b
}
...
```

Max 是一个看似简单，实则复杂的例子，有这些问题可以被考虑：

- 能否将类型作为参数进行传递？
- 如何对类型参数的行为进行检查？
- 如何支持多个相同类型的参数？
- 如何支持多个不同类型的参数？

综合来说，泛型版的 `Min/Max` 函数是一个比较有代表性的例子，本章对 Go 语言泛型的介绍将全程围绕这个例子展开。

早年 Go 语言在考虑泛型设计时，以「不牺牲编译效率的情况下，提供泛型」为目标。
但在现在看来其实有些过时，因为早在 Go 1 的年代，编译速度是首要目标。
但实际上复杂的模板用例肯定会拖慢编译速度，
真正的问题是如何在语言设计（用户的使用成本）和实现（编译器的实现成本）上进行取舍和权衡。

## 12.1.2 类型函数（2010）

最早的 Go 语言泛型被称为类型函数（Type Functions）。

- 基本想法：对函数参数类型声明处进行替换
- 在标识符后使用 (t) 作为类型参数的缺省值，语法存在二义性
- 既可以表示使用类型参数 Greater(t)，也可以表示实例化一个具体类型 Greater(t)，其中 t 为推导的具体类型，如 int
- 为了解决二义性，使用 type 进行限定：Greater(t type)

    ```go
    func F(arg0, arg1 t type) t { ... }
    ```

- 使用接口 Greater(t) 对类型参数进行约束，跟在 type 后修饰
提案还包含一些其他的备选语法：

  + `generic(t) func ..`
  + 使用类型参数 `$t`
  + 实例化具体类型 `t`

```go
type Greater(t) interface {
    IsGreaterThan(t) bool
}
func Max(a, b t type Greater(t)) t {
    if a.IsGreaterThan(b) {
        return a
    }
    return b
}
```


回顾来看，类型函数确实是一个糟糕的设计。

- x := Vector(t)(v0) 这是两个函数调用吗？
- 尝试借用使用 C++ 的 Concepts 对类型参数的约束

C++ Concepts 这一特性直到 2020 年正式定稿的 C++20 标准才被最终纳入标准，
在当时比较下来，类型参数约束是个优点。

教训：直接将类型作为参数将产生二义性，对编译器和用户而言都不是一件好事，需要加以区分，例如使用额外的关键字。

## 12.1.3 泛用类型（2011）

经过一年的思考，泛型的设计被修改泛用类型（Generalized Types）。

基本想法：上一个设计中，直接替换类型所在的位置出现的局限性比较大，
于是借用 C++ 模板声明的方式 `template<T> T name(a T)`，将类型参数提前到所有声明之前，并使用了一个关键字 `gen`：

```go
gen [T] type Greater interface {
   IsGreaterThan(T) bool
}
gen [T Greater[T]] func Max(arg0, arg1 T) T {
   if arg0.IsGreaterThan(arg1) {
      return arg0
   }
   return arg1
}
```

```go
gen [T1, T2] (
   type Pair struct { first T1; second T2 }
  
   func MakePair(first T1, second T2) Pair {
       return &Pair{first, second}
   }
) // end of gen
```

关键设计

- 使用 `gen [T]` 来声明一个类型参数
使用接口对类型进行约束
- 使用 `gen [T] ( … )` 来复用类型参数的名称

评述

- 没有脱离糟糕设计的命运
- `gen [T] ( … )` 引入了作用域的概念
  + 需要缩进吗？
  + 除了注释还有更好的方式快速定位作用域的结束吗？
- 复杂的类型参数声明

教训：不那么像 Go :)

## 12.1.4 泛用类型（2013）

泛用类型在初次尝试后显然失败了，但两年后又发布了一个修订后的设计。

- 致敬：Parameterized Types for C++ 

```go
gen [T] (
   type Greater interface {
       IsGreaterThan(T) bool
   }
   func Max(arg0, arg1 T) T {
       if arg0.IsGreaterThan(arg1) { return arg0 }
       return arg1
   }
)
type Int int
func (i Int) IsGreaterThan(j Int) bool {
   return i > j
}
func F() {
   a, b := 0, Int(1)
   m := Max(a, b) // 0 先被忽略，解析 b 时确认为 Int
   if m != b { panic("wrong max") }
   ...
}
```

关键设计

- 使用 `gen [T]` 来声明一个类型参数
- 使用 `gen [T] ( … )` 来传播类型参数的名称
- 使用类型推导来进行约束

评述

- 语法相对简洁了许多
- 利用类型推导的想法看似很巧妙，但能够实现吗？
- `gen [T] ( … )` 引入了作用域的概念
- 缩进？
- 如何快速定位作用域在何时结束？
- 企图通过实例化过程中类型推导来直接进行约束，可能吗？
- 出现多个参数时，应该选取哪个参数进行约束？
- 如果一个类型不能进行 `>` 将怎么处理？
- `arg0/arg1` 同 `T` 为什么推导为不同类型？

教训：类型推导是化简泛型用法的一个重要手段

## 12.1.5 类型参数（2013）

泛用类型的设计在参数推导这个想法上突破后，进一步优化其推导规则，得出了
类型参数（Type Parameters）的设计。

```go
type [T] Greater interface {
   IsGreaterThan(T) bool
}
func [T] Max(arg0, arg1 T) T {
   if arg0.IsGreaterThan(arg1) {
       return arg0
   }
   return arg1
}
type Int int
func (i Int) IsGreaterThan(j Int) bool {
   return i > j
}
func F() {
   _ = Max(0, Int(1)) // 推导为 Int
}
```

关键设计

- 直接在类型、接口、函数名前使用 `[T]` 表示类型参数
- 进一步细化了类型推导作为约束的可能性

评述

- 目前为止最好的设计
- 无显式类型参数的类型推导非常复杂
- 常量究竟应该被推导为什么类型？
- `[T]` 的位置很诡异，声明在左，使用在右，例如：

    ```go
    type [T1, T2] Pair struct { … }
    var v Pair[T1, T2]
    ```

这个设计最终没有采纳的原因：在代码层面上实现时受阻、类型检查非常困难（复杂）等等有关语言语义表现的问题没有得到解答

教训：复杂的功能同时存在实现上的难度，需要对设计进行进一步化简。参加提案中复杂的推导规则

## 12.1.6 代码自动生成（2014）

早年的 Go 是 C 语言写成的，那个时候维护不同平台的汇编代码是一件比较痛苦的，对此 Russ Cox 做过一个分析 [Cox 2012]。
后来 Rob Pike 在没有泛型的情况下，为了解决代码复用的问题，做了一个折中的方案就是 Go Generate

```go
import "github.com/cheekybits/genny/generic"
// cat 201401.go | genny gen "T=NUMBERS" > 201401_gen.go
type T generic.Type
func MaxT(fn func(a, b T) bool, a, b T) T {
   if fn(a, b) {
       return a
   }
   return b
}
```

关键设计

- 通过 `//go:generate` 编译器指示来自动生成代码
- 利用这一特性比较优秀的实现是 cheekybits/genny

评述

- 维护成本
- 需要重新生成代码
- 没有类型检查，需要程序员自行判断

教训：至少目前来说，是成功的

## 12.1.7 类型作为一等公民（2015）

在经历过多轮设计失败后，Bryan Mills 提出将类型作为一等公民（First Class Types）的概念，引入 `gotype` 内建类型。

```go
const func Max(a, b gotype) gotype {
   switch a.(type) {
   case int, float64, uintptr:
       if a > b { return a}
       return b
   default:
       aa, ok := a.(interface{
           IsGreaterThan(gotype) bool
       })
       if !ok {
           panic("a must implements IsGreaterThan")
       }
       if aa.IsGreaterThan(b) {
           return a
       }
       return b
   }
}
```

关键设计

- 引入 `gotype` 内建类型
- 扩展 `.(type)` 的编译期特性
- `const` 前缀强化函数的编译期特性
- 灵感来源 C++ SFINAE

评述

- 设计上需要额外思考 SFINAE
- 只有泛型函数的支持，泛型结构需要通过函数来构造
- 接口二义性 `interface X { Y(Z) }`
- Z 可以是类型或常量名
- 不太可能实现可类型推导

教训：不明，可能提案在 Go 团队内部被 reject 了；大概率是不能类型推导、检查

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
