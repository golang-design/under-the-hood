---
weight: 3402
title: "12.2 基于合约的泛型"
---

# 12.2 基于合约的泛型

> 本节内容提供一个线上演讲：[YouTube 在线](https://www.youtube.com/watch?v=E16Y6bI2S08) [Google Slides 讲稿](https://changkun.de/s/go2generics/)

TODO: 需要补充并丰富描述

## 12.2.1 泛型问题的本质

- 泛型从本质上是一个编译期特性
- 「泛型困境」其实是一个伪命题
- 牺牲运行时性能的做法显然不是我们所希望的
- 不加以限制的泛型机制将严重拖慢编译性能
- 什么时候才能决定一个泛型函数应该编译多少份不同的版本？
- 不同的生成策略会遇到什么问题？
- 加以限制的泛型机制将提高程序的可读性
- 如何妥当的描述对类型的限制？

## 12.2.2 合约函数

合约是一个描述了一组类型且不会被执行的函数体。

```go
contract Comparable(x T) {
	x > x
      x < x
      x == x
}
func Max(type T Comparable)(v0 T, vn ...T) T {
	switch l := len(vn); {
	case l == 0:
		return v0
	case l == 1:
		if v0 > vn[0] { return v0 }
		return vn[0]
	default:
		vv := Max(vn[0], vn[1:]...)
		if v0 > vv { return v0 }
		return vv
	}
}
```

关键设计

- 在合约中写 Go 语句对类型进行保障
- 甚至写出条件、循环、赋值语句

评述

- 复杂的合约写法（合约内的代码写法可以有多少种？）
- 「一个不会执行的函数体」太具迷惑性
- 实现上估计是一个比较麻烦的问题

## 12.2.3 合约条件集

合约描述了一组类型的必要条件。

关键设计

- 使用方法及穷举类型来限制并描述可能的参数类型
- comparable/arithmetic 等内建合约

评述

- 这样的代码合法吗？
  + _ = Max(1.0, 2)
- 如何写出更一般的形式？
- 可变模板参数的支持情况缺失（后面会提）
- 没有算符函数、重载

```go
contract Comparable(T) {
	T int, int8, int16, int32, int64,
	uint, uint8, uint16, uint32, uint64, uintptr,
	float32, float64,
	string
}
func Max(type T Comparable)(v0 T, vn ...T) T {
	switch l := len(vn); {
	case l == 0:
		return v0
	case l == 1:
		if v0 > vn[0] { return v0 }
		return vn[0]
	default:
		vv := Max(vn[0], vn[1:]...)
		if v0 > vv { return v0 }
		return vv
	}
}
```



类型参数可能出现的位置：

| 声明 | 写法 |
|:---:|:----:|
| 函数 | `func F(type T C)(params ...T) T { … }` |
| 结构体 | `type S(type T C) struct { … }` |
| 接口 | `type I(type T C) interface { … }` |

合约的形式，例：

```go
contract C1(T1, T2, T3) {
    C2(T1)              // 允许与合约 C2 进行组合
    T2 int, float64     // 允许对类型 T1 进行限制
    T3 Method(T1) T1    // 允许对类型 T2 进行限制
}
```

## 12.2.4 合约与参数化接口的区别

思考：

- 接口 Interface 是一组方法，描述了值
- 合约 Contract 是一组条件，描述了类型
  + 加上类型参数的接口 —— 参数化的  I(type T C) 的与合约的本质区别是什么？

基于合约的参数化函数的写法：

```go
contract Greater(T) {
   IsGreaterThan(T) bool
}
func Max(type T Greater) (a, b T) T { ... }
```

基于参数化结构的参数化函数的写法：

```go
type Greater(type T) {
   IsGreaterThan(T)
}
func Max(type T Greater(T)) (a, b T) T { ... }
```

合约 C(T) 的本质是参数化接口 I(type T C) 的语法糖，一个更复杂的例子：

```go
contract C(P1, P2) {
   P1 m1(x P1)
   P2 m2(x P1) P2
   P2 int, float64
}
func F(type P1, P2 C) (x P1, y P2) P2 { ... }
```

```go
type I1 (type P1) interface {
   m1(x P1)
}
type I2 (type P1, P2) interface {
   m2(x P1) P2
   type int, float64
}
// 在实例化的过程中保障了 I2 中的 P1 与 I1 的 P1 是同一类型
func F(type P1 I1(P1), P2 I2(P1, P2)) (x P1, y P2) P2 { ... }
```


## 12.2.5 示例程序

### 例1: 泛型式排序

```go
type wrapSort(type T) struct {
    s   []T
    cmp func(T, T) bool
}
func (s wrapSort(T)) Len() int           { return len(s.s) }
func (s wrapSort(T)) Less(i, j int) bool { return s.cmp(s.s[i], s.s[j]) }
func (s wrapSort(T)) Swap(i, j int)      { s.s[i], s.s[j] = s.s[j], s.s[i] }
func Sort(type T)(s []T, cmp func(T, T) bool) {
    sort.Sort(wrapSort(T){s, cmp})
}
```

### 例2: 泛型式 MapReduce

```go
func Map(type T1, T2)(s []T1, f func(T1) T2) []T2 {
    r := make([]T2, len(s))
    for i, v := range s {
        r[i] = f(v)
    }
    return r
}
func Reduce(type T1, T2)(s []T1, init T2, f func(T2, T1) T2) T2 {
    r := init
    for _, v := range s {
        r = f(r, v)
    }
    return r
}
```

### 例3: 泛型式栈

```go
type Stack(type E) []E
func NewStack(type E) () Stack(E) {
    return Stack(E){}
}
func (s *Stack(E)) Pop() (r E, success bool) {
    l := len(*s)
    if l == 0 { return }
    r, *s = (*s)[l - 1], (*s)[:l - 1]
    success = true
    return
}
func (s *Stack(E)) Push(e E)      { *s = append(*s, e) }
func (s *Stack(E)) IsEmpty() bool { return len(*s) == 0 }
func (s *Stack(E)) Len() int      { return len(*s) }
```

### 例4: 泛型式散列表

```go
type Pair(type T1, T2) struct {
    Key   T1
    Value T2
}
type Map(type T1, T2 contracts.Comparable(T1)) struct {
    s []Pair(T1, T2)
}
func NewMap(type T1, T2) () Map(T1, T2) {
    return Map(T1, T2){s: [](Pair(T1, T2)){}}
}
func (m *Map(T1, T2)) Set(k T1, v T2) {
    m.s = append(m.s, Pair(T1, T2){k, v})
}
func (m *Map(T1, T2)) Get(k T1) (v T2, ok bool) {
    for _, p := range m.s {
        if p.Key == k {
            return p.Value, true
        }
    }
    return
}
```

### 例4: 泛型式扇入扇出负载均衡

```go
func Fanin(type T)(ins ...<-chan T) <-chan T {
    buf := 0
    for _, ch := range ins {
        if len(ch) > buf { buf = len(ch) }
    }
    out := make(chan T, buf)
    wg := sync.WaitGroup{}
    wg.Add(len(chans))
    for _, ch := range ins {
        go func(ch <-chan T) {
            for v := range ch { out <- v }
            wg.Done()
        }(ch)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

```go
func Fanout(type T)(r func(max int) int, in <-chan T, outs ...chan T) {
    l := len(outs)
    for v := range in {
        i := r(l)
        if i < 0 || i > l { i = rand.Intn(l) }
        outs[i] <- v
    }
    for i := range outs {
        close(Outs[i])
    }
}
```

```go
func LB(type T)(randomizer func(max int) int, ins []<-chan T, outs []chan T) {
    Fanout(randomizer, Fanin(ins...), outs...)
}
```

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).