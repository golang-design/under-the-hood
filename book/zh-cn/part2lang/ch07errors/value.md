---
weight: 2401
title: "7.1 问题的演化"
---

# 7.1 问题的演化

在 [6.3](../ch06func/panic.md) 里我们已经把那道分水岭画了出来：如何处理错误，是语言设计的
一处根本抉择。异常派（C++、Java、Python）用 `try/catch` 把错误路径从正常逻辑里抽走，主干
干净，代价是错误路径变得隐式，可能从任意调用点抛出；值派（Go、Rust、以及 C 的返回码传统）
把错误当作普通返回值显式传递，啰嗦，但每一条错误路径都白纸黑字、无处可藏。Go 选了值派，
只为「真正异常」保留一个轻量的 `panic`/`recover`。这一节要讲的，是这个选择落地之后，
「错误作为值」这一主张本身又经历了怎样的演化：从一个只能打印的字符串，长成一棵可以被程序
逐层追问「你到底是不是那个错误」的树。

## 7.1.1 错误即值

Go 把错误定义成一个内建接口，全部的约定只有一个方法：

```go
// src/builtin/builtin.go
type error interface {
	Error() string
}
```

任何实现了 `Error() string` 的类型，都可以当作 `error` 传递。它不是一种特殊的语言构造，
而是一个再普通不过的接口值，能赋值、能比较、能放进切片、能作为字段、能跨 channel 传递。
这正是 Rob Pike 在《Errors are values》里反复强调的一句话：错误是值，而值可以被编程。
程序员不是被动地「捕获」一个从天而降的异常，而是主动地拿一个值去做判断、包装、传播或吞下。

这个主张在函数签名上有一处固定的体现：错误总是作为最后一个返回值显式交还给调用方。

```go
f, err := os.Open(name)
if err != nil {
	return err
}
defer f.Close()
// 使用 f
```

满屏的 `if err != nil` 常被诟病啰嗦，但它恰是值派的代价与收益的同一面：错误既然是值，
就必须像别的值一样被显式接住，编译器不会替你把它偷偷送到别处。这与 [6.3](../ch06func/panic.md)
里 Go 的整体气质一脉相承，显式优于隐式。把错误降格为一个一方法接口，换来的是最大的自由：
标准库不需要预先规定一套错误等级体系，任何人都能用最贴合自己场景的类型去实现 `error`，
从一个字符串常量，到一个携带行号、文件名、底层系统调用号的结构体。代价是这份自由把责任
也一并交还给了用户，怎样定义错误、怎样让调用方能可靠地辨认它，都得自己安排。这一节余下的
篇幅，讲的就是 Go 社区与标准库为这份责任摸索出的答案。

## 7.1.2 从字符串错误到可检查的错误

最朴素的错误就是一句话。`errors.New` 与 `fmt.Errorf` 各造一个只携带字符串的错误值：

```go
err := errors.New("connection refused")
err := fmt.Errorf("read %s: %v", name, cause)
```

`errors.New` 返回的 `*errorString` 内部只有一个字段，`Error()` 把它原样吐出。对「报告一次
失败、打印给人看」这一最低需求，这已经够用。麻烦出在下一步：程序常常不只想打印错误，
还想根据错误是什么来决定怎么办。文件不存在就创建，连接被拒就重试，读到流末尾就正常收尾。
这就要求调用方能可靠地问出一句：这个错误，是不是某个特定的错误？

标准库给出的第一种答案是哨兵错误（sentinel error），用一个导出的变量充当某类失败的唯一标记，
最著名的就是 `io.EOF`：

```go
package io
var EOF = errors.New("EOF")

// 调用方用 == 比较
for {
	n, err := r.Read(buf)
	// ... 处理 buf[:n]
	if err == io.EOF {
		break
	}
	if err != nil {
		return err
	}
}
```

哨兵的好处是检查干脆，一次 `==` 即可。但它脆弱。其一，`io.EOF` 是一个变量而非常量，
任何拿到这个包的代码都能改写它：

```go
import "io"
func init() { io.EOF = nil } // 合法，且足以让别处的 == 判断永远落空
```

在庞大的依赖图里，谁也无法担保没有一处恶意或失手的赋值把这样的哨兵改掉，这甚至构成一类安全
隐患（设想 `rsa.ErrVerification = nil`）。规避之道是把哨兵做成不可变的常量错误，让字符串
类型自己实现 `Error()`：

```go
type ioError string
func (e ioError) Error() string { return string(e) }
const EOF = ioError("EOF") // 常量，无法被改写
```

其二，也是更要命的一点，`==` 只在错误未经任何包装时才成立。一旦中间某层为了补充上下文,
把原始错误重新格式化进一句新话里，`==` 立刻失效:

```go
func readConfig(path string) error {
	if err := open(path); err != nil {
		return fmt.Errorf("read config %s: %v", path, err) // 用 %v，原始错误被「拍平」成字符串
	}
	// ...
	return nil
}
```

此时上层若还想知道「根因是不是 `io.EOF`」，`==` 已经无能为力，因为返回的是一个全新的字符串
错误，原来的 `io.EOF` 身份在格式化的那一刻就丢了。退而求其次的做法是去 `Error()` 的字符串里
做子串匹配,`strings.Contains(err.Error(), "not found")`,这把检查建立在错误的人类可读文本上，
文案一改、本地化一换就崩，是最不该依赖的写法。

第二种答案是自定义错误类型，用类型断言来检查:

```go
type PathError struct {
	Op   string
	Path string
	Err  error
}
func (e *PathError) Error() string {
	return e.Op + " " + e.Path + ": " + e.Err.Error()
}

// 调用方用类型断言检查
if pe, ok := err.(*PathError); ok {
	log.Printf("操作 %s 失败于 %s", pe.Op, pe.Path)
}
```

自定义类型能携带结构化的上下文，比一句字符串信息丰富得多。但它和哨兵共享同一个致命弱点：
类型断言 `err.(*PathError)` 同样只对未经包装的错误成立。只要中间层用 `fmt.Errorf("...: %v", err)`
把它套进一句新话，断言就再也命中不了。

于是「错误即值」的第一阶段留下了一个清晰的紧张关系：调用方既想为错误补充传播路径上的上下文,
又想在顶层仍能可靠地辨认根因。用 `%v` 包装会丢失身份，不包装又会丢失上下文，二者不可得兼。
Go 1.13 的包装机制，正是为化解这个紧张关系而来。

## 7.1.3 Go 1.13：包装、Unwrap 与 Is / As

Go 1.13（2019）给 `fmt.Errorf` 添了一个动词 `%w`，并在 `errors` 包里立了三个配套函数。
核心想法是：包装时不再把内层错误「拍平」成字符串，而是把它原样保留为一条可被回溯的链。

```go
// 用 %w 包装，内层错误被保留，而非格式化成字符串
err := fmt.Errorf("read config %s: %w", path, io.EOF)
```

`%w` 与 `%v` 唯一的区别在于：带 `%w` 的 `Errorf` 返回的错误会额外实现一个 `Unwrap() error`
方法，吐出被包装的那个内层错误。`%v` 制造的是一段无法回溯的文字，`%w` 制造的是一个还连着
根的节点。有了 `Unwrap`，「这条链上有没有某个错误」就成了一次沿链行走，标准库把它封进
`errors.Is` 与 `errors.As`:

```go
// Is：链上有没有等于 target 的错误（取代裸 ==）
if errors.Is(err, io.EOF) { ... }

// As：链上有没有某个类型的错误，找到就填进 target（取代裸类型断言）
var pe *PathError
if errors.As(err, &pe) {
	log.Printf("失败于 %s", pe.Path)
}
```

`errors.Is` 从 `err` 出发，反复 `Unwrap`，沿途与 `target` 比较，任意一环相等即命中；它还允许
错误类型自定义一个 `Is(error) bool` 方法，声明「我等价于某个哨兵」。`errors.As` 同理沿链行走，
但比的是类型是否可赋值给 `target` 指向的变量，命中即填值。两者把 7.1.2 里那个「包装就丢身份」
的死结彻底解开:中间层尽管用 `%w` 层层叠加上下文，顶层依旧能用 `Is`/`As` 穿过所有包装认出根因。
自此，调用方检查错误的正确姿势从 `==` 与类型断言，整体迁移到了 `Is` 与 `As`。这一机制的细节、
以及后来新增的泛型版 `errors.AsType[E error](err) (E, bool)`（免去传指针、直接返回匹配值），
留到 [7.2](./inspect.md) 详谈，这里只需记住一个转折：错误从此是一棵可被追问的树，
而不再是一句话。

## 7.1.4 Go 1.20：errors.Join 与多重包装

到 Go 1.20（2023），这棵树从单链长成了真正的多叉。现实里一次操作可能同时撞上多个错误，
关闭若干资源时每个 `Close` 都可能失败，一次校验里多条规则同时不满足。此前只能把它们拼成一句
字符串，拼完便无法再分开检查。`errors.Join` 把多个错误聚成一个，且保留各自的身份:

```go
err := errors.Join(err1, err2, err3) // nil 会被丢弃；全 nil 则返回 nil
```

`Join` 返回的错误实现的是 `Unwrap() []error`，一次吐出一组而非一个。与之对称，`fmt.Errorf`
也允许一句话里出现多个 `%w`，同样得到一个 `Unwrap() []error` 的多重包装错误。`errors.Is`
与 `errors.As` 早已按这两种 `Unwrap` 形态做了深度优先遍历，因此对多叉树同样适用:

```go
err := fmt.Errorf("两路都失败：%w；%w", io.EOF, os.ErrNotExist)
errors.Is(err, os.ErrNotExist) // true：遍历会走到第二个分支
```

至此，「错误即值」长出了它当下的完整形态:一个值、一条 `Unwrap` 链或一棵 `Unwrap` 树、
一对沿树行走的 `Is`/`As`。值得一提的是，这一路演化没有动过 `error` 接口本身那一个方法，
全部新能力都建立在「错误值可以再实现一个 `Unwrap`」这一可选约定之上。接口不变、约定渐增，
这正是把错误做成普通值所换来的扩展余地。

## 7.1.5 被否决的语法：check / handle 与撤回的 try

值派最常被攻击的，始终是那满屏的 `if err != nil`。Go 团队也不是没想过给它瘦身，但每一次尝试
最终都被否决了，这些否决本身比任何宣言都更能说明 Go 的取向。

2018 年的 Go 2 错误处理草案提出过一对 `check`/`handle` 关键字：`check` 自动检查紧随其后的
表达式的错误并在出错时跳转，`handle` 块统一兜底。它引入了一种新的、隐式的控制流跳转，
与 Go「控制流应当一眼看清」的气质相抵，争议巨大，未被采纳。

2019 年，团队把方案收窄成一个不需要新关键字的内建函数 `try`（提案 golang/go#32437）。
设想中 `x := try(f())` 在 `f()` 返回非 nil 错误时，让当前函数直接带着该错误返回:

```go
// try 提案设想的写法（最终未进入语言）
func read(name string) ([]byte, error) {
	f := try(os.Open(name))   // 出错则当前函数直接 return ..., err
	defer f.Close()
	return io.ReadAll(f)
}
```

提案引发了 Go 历史上规模最大的讨论之一，反对意见集中在两点:其一，`try` 是一个会让函数提前
返回的「函数」，把一处控制流跳转藏进了看似普通的表达式里，破坏了「返回点显式可见」；其二,
它与调试、与 `defer` 中改写返回错误的惯用法配合别扭。提案在同年被官方撤回（withdrawn），
理由写得很直白:社区分歧过大，且它解决的问题不值得引入这种隐式性。

把这几次否决连起来看，会得到一条清楚的设计底线:Go 宁愿忍受 `if err != nil` 的冗长，
也不肯用隐式的控制流跳转去换简短。简短不是不重要，但在 Go 的价值排序里，它排在「显式」
之后。错误处理的语法之争尚未结束（社区仍不时有新提案），这部分的来龙去脉与最新动向，
[7.5](./future.md) 会接着讲。

## 7.1.6 值派内部：Go 站在最简的一端

把镜头拉远，值派内部其实也有疏密之分。同样是「错误即值」，别家给了它多少语法糖、
多强的类型约束，差别不小。把它们排在一起，Go 的位置就清楚了。

```mermaid
flowchart LR
	GO["Go：error 接口 + 显式 if，无语法糖"] --> RUST["Rust：Result 枚举 + ? 运算符，类型强制穷尽处理"]
	RUST --> SWIFT["Swift：throws / try / catch，类型标注的受检错误"]
	SWIFT --> HASKELL["Haskell：Either / Maybe 单子，do 记法串联"]
```

Rust 用枚举 `Result<T, E>` 把成功与失败编进类型，调用方若不处理，编译器就报错，错误处理
是强制穷尽的；`?` 运算符则是它的语法糖，`let f = File::open(name)?;` 在出错时让当前函数提前
返回错误，效果正是被 Go 否决的那个 `try`。Swift 走受检异常的路子，函数用 `throws` 在签名里
声明自己可能抛错，调用处必须以 `try` 标注、用 `do`/`catch` 兜住，错误是值（遵循 `Error`
协议），但传播靠的是一套类异常的语法。Haskell 更纯粹，用 `Either e a` 或 `Maybe a` 这样的
代数数据类型表达可能失败的计算，再借单子（monad）的 `>>=` 与 `do` 记法把一串可能失败的步骤
串起来，任一步失败则整条短路。

四者都把错误当值，分野在于「语言替你做多少」。Rust 用类型系统逼你处理、用 `?` 替你传播；
Swift 用 `throws` 标注、用 `try`/`catch` 传播；Haskell 用单子替你串联与短路。Go 是其中
机制最少的一端：没有 `?`，没有 `throws`，没有单子，错误就是返回值，检查就是 `if`，传播就是
`return err`。这份刻意的克制，与 [11.9](../../part3concurrency/ch11sync/mem.md) 里 Go 只暴露
顺序一致原子、不给弱序档位的取向同出一辙，宁可让用户多写几行显式代码，也不愿在语言里堆
机制。这套取舍没有绝对的优劣，它换来的是任何人读任何一段 Go 代码，都能从 `if err != nil`
一眼看出错误在哪里被检查、又流向何方。带着这条主线,下面三节就分别落到本章开头提出的三个
问题上：错误值如何检查（[7.2](./inspect.md)）、上下文如何附加（[7.3](./context.md)）、
处理语义如何安排（[7.4](./semantics.md)）。

## 延伸阅读的文献

1. Rob Pike. *Errors are values.* The Go Blog, 2015.
   https://go.dev/blog/errors-are-values
2. Andrew Gerrand. *Error handling and Go.* The Go Blog, 2011.
   https://go.dev/blog/error-handling-and-go
3. The Go Authors. *Working with Errors in Go 1.13.* The Go Blog, 2019.
   https://go.dev/blog/go1.13-errors （`%w`、`Unwrap`、`Is`、`As`）
4. The Go Authors. *Go 1.20 Release Notes: errors.* 2023.
   https://go.dev/doc/go1.20#errors （`errors.Join` 与多 `%w`）
5. Marcel van Lohuizen 等. *proposal: Go 2: error handling: try builtin (golang/go#32437).* 2019.
   https://github.com/golang/go/issues/32437 （撤回的 `try` 提案）；
   *Error Handling, Draft Design (check/handle).*
   https://go.googlesource.com/proposal/+/master/design/go2draft-error-handling.md
6. The Go Authors. *Go programming language specification: Errors* 与 *src/errors/*、
   *src/fmt/errors.go.* https://go.dev/ref/spec ；
   https://github.com/golang/go/tree/master/src/errors
7. 本书 [6.3 恐慌与恢复](../ch06func/panic.md)、[7.2 错误值检查](./inspect.md)、
   [7.5 错误处理的未来](./future.md)。
