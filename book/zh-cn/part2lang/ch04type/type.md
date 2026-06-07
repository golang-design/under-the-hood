---
weight: 2101
title: "4.1 运行时类型系统"
---

# 4.1 运行时类型系统

Go 是静态类型语言，类型检查发生在编译期。但 Go 又保留了相当一部分**运行时类型信息**,正是它
支撑起了接口（[4.2](./interface.md)）、类型断言、反射、以及垃圾回收对指针的识别。这一节看类型
在运行时长什么样，以及这套信息撑起了哪些能力。

## 4.1.1 每个类型都有一个描述符

编译器为程序里用到的**每一个类型**生成一个**类型描述符**（运行时的 `abi.Type`，俗称 `_type`），
并把它编进只读数据段。这个描述符记录了类型的大小、对齐、**种类**（`Kind`,是 int、struct、slice
还是别的）、哈希、以及一份**GC 指针位图**（`GCData`,告诉垃圾回收器这个类型的哪些字段是指针，
[13](../../part4memory/ch13gc)）。带方法的类型还附带方法表等扩展信息。

这个描述符是把"编译期的类型"带到运行时的桥。空接口 `any`（[4.2](./interface.md)）里存的那个
`_type` 指针，就指向它;反射拿到的 `reflect.Type`，本质上也是它的封装。可以说，**类型描述符是
Go 运行时多态与自省能力的物理载体**。

## 4.1.2 反射：建立在描述符之上的自省

`reflect` 包让程序在运行时检视、操作任意类型的值,它并不是魔法，而是对类型描述符与接口表示的
直接读取。`reflect.TypeOf(x)` 把 `x` 装进一个空接口，再读出其中的 `_type` 指针;`reflect.ValueOf(x)`
则同时抓住类型与数据指针。Russ Cox 总结的反射三定律，正是这种"接口值 ⇄ 反射对象"互转关系的
提炼：反射对象可由接口值得来，也可还原回接口值，且只有可设置（addressable 且可导出）的反射
值才能被修改。理解了 [4.2](./interface.md) 的 `eface`/`iface`，反射就不再神秘,它只是把那两个字
里的类型与数据，用一套 API 暴露出来。

反射强大但有代价：它绕过编译期类型检查、慢于直接代码、且容易写错。Go 的态度是"能不用就不用"，
把它留给序列化（`encoding/json`）、ORM 等确实需要泛化处理任意类型的库。Go 1.18 的泛型
（[8 泛型](../ch08generics)）正是为了让一大类"过去只能靠反射"的泛化代码，重新获得编译期类型
安全与性能。

## 4.1.3 名义类型与类型标识

Go 的类型是**名义的**（nominal）：`type Celsius float64` 和 `type Fahrenheit float64` 虽然底层都是
`float64`，却是**两个不同的类型**，不能直接互相赋值。这与接口的**结构化**满足（[4.2](./interface.md)）
形成有趣的对比,Go 在"具体类型的标识"上用名义，在"接口的满足"上用结构，各取所长。类型标识的
精确规则（何时两个类型相同、可赋值、可转换）由语言规范定义，运行时则用描述符指针的相等性来
快速判断类型相同（同一类型在程序里通常只有一个描述符）。

## 4.1.4 跨语言对照

运行时类型信息的"含量"，各语言差异很大。**Java/C#** 携带丰富的运行时元数据，反射能力极强
（`Class`、`Type`），是其框架生态的基础，代价是元数据开销与一定的运行时成本。**C++** 走另一极端：
默认几乎不带运行时类型信息，只有开启 RTTI 后 `typeid`/`dynamic_cast` 才有限地可用,符合其
"不为不用的东西付费"哲学。**Rust** 干脆**没有**通用的运行时反射（`std::any::Any` 只能做有限的
向下转型），把泛化交给编译期的泛型与 trait,以零运行时成本为信条。

Go 处在中间偏"够用"的位置：保留足以支撑接口、类型断言、反射与精确 GC 的运行时类型信息，
但不像 Java 那样无所不包。这份取舍呼应了 Go 的一贯性格,要简单、要够用、也要为运行时的实在
能力（精确 GC、接口分发）留下必要的元数据。

## 延伸阅读的文献

1. Russ Cox. *The Laws of Reflection.* Go 博客, 2011. https://go.dev/blog/laws-of-reflection
2. The Go Authors. *internal/abi/type.go、reflect 包*（类型描述符与反射）.
   https://github.com/golang/go/blob/master/src/internal/abi/type.go
3. The Go Authors. *The Go Programming Language Specification：Types / Type identity.*
   https://go.dev/ref/spec#Types
4. Luca Cardelli, Peter Wegner. "On Understanding Types, Data Abstraction, and
   Polymorphism." *ACM Computing Surveys*, 17(4), 1985.
   https://doi.org/10.1145/6041.6042

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
