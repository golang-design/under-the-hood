---
weight: 2404
title: "7.4 错误语义"
---

# 7.4 错误语义

会用 `Is`/`As`（[7.2](./inspect.md)）只是手段，真正的难题是**设计**：一个库该把错误暴露成什么
形态，调用方又该依据什么来分支处理？这一节梳理错误的几种语义形态及其耦合代价,这部分思考
很大程度上由 Dave Cheney 的系列文章塑造。

## 7.4.1 错误的三种形态

- **哨兵错误**（sentinel）：预定义的固定值，如 `io.EOF`、`sql.ErrNoRows`。调用方用
  `errors.Is(err, io.EOF)` 判断。简单直接，但它**成为你 API 的一部分**,一旦导出，调用方就会
  依赖它，你再也不能改，且它在包之间制造了耦合（调用方得 import 你的包就为比较一个值）。
- **错误类型**（custom type）：自定义的实现了 `error` 的结构体，能携带字段（出错的路径、行号、
  状态码），调用方用 `errors.As` 取出来读。比哨兵能传更多信息，但把**整个类型**暴露成了 API，
  耦合更深。
- **不透明错误**（opaque）：只返回 `error`，不导出任何具体值或类型，调用方只知道"出错了"、
  顶多读 `Error()`。耦合最低、最灵活,你可以随意改内部实现，因为调用方什么都没法依赖。

## 7.4.2 断行为，而非断类型

不透明错误看似什么都判断不了，但有一个优雅的折中：**让调用方依据"行为"而非"具体类型"分支**。
经典例子是 `net.Error`,它是一个接口，带 `Timeout() bool` 方法。调用方不去断言"这是不是
`*net.OpError`"，而是断言"这个错误**是否具备 Timeout 行为**"：

```go
var nerr interface{ Timeout() bool }
if errors.As(err, &nerr) && nerr.Timeout() {
    // 按"超时"处理，无需知道错误的具体类型
}
```

这样，库可以自由更换错误的具体类型，只要它仍实现 `Timeout()`，调用方代码就不受影响。Dave
Cheney 把这条原则概括为"**Assert errors for behaviour, not type**",它把哨兵/类型那种"对具体
身份的依赖"，松绑成"对一个小接口的依赖"，与 [4.2](../ch04type/interface.md) 推崇小接口、
结构化满足的精神完全一致。

## 7.4.3 怎么选

一条务实的排序：**默认用不透明错误**（耦合最低）;调用方确实需要区分某种特定情形时，
**优先用"断行为"**（暴露一个小接口方法）;再不够，才考虑哨兵（信息少、固定）或类型
（信息多、耦合深）。核心判断是：**你愿意把多少东西纳入 API 契约？** 暴露得越多，调用方能做的
判断越精细，你日后能改的也越少。这与本书反复出现的主题相通,API 设计的本质，是想清楚"什么
是承诺、什么是实现细节"，而错误的语义形态，正是这个抉择在错误处理上的投影。

## 延伸阅读的文献

1. Dave Cheney. *Don't just check errors, handle them gracefully.* GopherCon India, 2016.
   https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully
2. Dave Cheney. *Inspecting errors.* 2014.
   https://dave.cheney.net/2014/12/24/inspecting-errors
3. The Go Authors. *net.Error*（断行为：Timeout()）. https://pkg.go.dev/net#Error
4. The Go Authors. *Error handling and Go.* https://go.dev/blog/error-handling-and-go

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
