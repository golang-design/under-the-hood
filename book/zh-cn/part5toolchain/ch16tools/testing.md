---
weight: 5204
title: "16.4 代码测试"
---

# 16.4 代码测试

测试在 Go 里不是外挂，而是语言工具链的一等公民。`go test` 内建，`testing` 包标准，约定
取代配置。这套设计上的选择，深刻塑造了 Go 的工程文化：在别的语言里「要不要写测试、用哪个
框架」是一道需要权衡的决策，在 Go 里它是默认动作。这一节讲清这套机制如何运转、为何如此设计，
以及它从单元测试一路长到 Go 1.18 模糊测试的谱系。

## 16.4.1 一等公民：约定取代配置

Go 的测试靠约定运转，几乎零配置。三条规则就是全部：测试文件以 `_test.go` 结尾，测试函数
形如 `func TestXxx(t *testing.T)`，与被测代码放在同一个包里。`go test` 会自动发现并运行它们，
不需要 XML 配置、不需要外部 runner、不需要注解。一个项目无论多大，`go test ./...` 一行就跑遍
全部测试：

```go
// strings_test.go，与被测包 strings 同目录、同包
package strings

import "testing"

func TestIndex(t *testing.T) {
    got := Index("chicken", "ken")
    if got != 4 {
        t.Errorf("Index = %d, want 4", got) // 报告失败，但不中断
    }
}
```

「约定优于配置」带来两层收益。其一是零门槛：写测试不需要先学一套框架，函数签名对了就能跑。
其二，也是更深远的一层，是整个生态的统一。所有 Go 项目的测试方式完全一致，于是 CI、覆盖率
工具、IDE、`go vet` 都只需面对一种约定，无需为各色框架各写一套适配。这与别家形成鲜明对照：
Java 世界有 JUnit 4 / JUnit 5 / TestNG 之分，注解与 runner 各不相同；Python 有 `unittest`、
`pytest`、`nose` 并存，发现规则与 fixture 机制互不兼容。框架的多样性把「跑某项目的测试」变成
一件需要先读文档的事。Go 用一套内建约定把这件事抹平到了零。

需要分辨的是：`go test` 是 `go` 命令的子命令，负责编译并运行测试二进制、解析 `-run`/`-bench`/
`-fuzz` 等标志；`testing` 包则是测试代码 import 的标准库，提供 `*T`、`*B`、`*F` 这些类型。
工具与库分工明确，但在用户视角下它们是一体的。

## 16.4.2 刻意极简的 testing 包

`testing` 包没有断言库。它只给你几个朴素的报告原语：`t.Error` / `t.Errorf` 记录一处失败但
继续往下跑，`t.Fatal` / `t.Fatalf` 记录失败并立刻中止当前测试（内部以 `runtime.Goexit`
实现，故只能在测试 goroutine 里调用）。没有 `assertEqual`、没有 `assertThat(x).isGreaterThan(y)`
那一整套链式断言。

这是有意为之，理由写在官方的 Go Test Comments 里。Go 团队认为，断言库会诱导人去想「这一行
该写哪个断言」，而不是去想「失败时我希望看到什么、好让我能直接定位问题」。直接用 `if` 配
`t.Errorf`，迫使作者亲手写出有信息量的失败消息：

```go
if got != want {
    t.Errorf("Sqrt(%v) = %v, want %v", in, got, want)
}
```

`got`、`want` 这对命名几乎成了 Go 测试的方言，失败输出一眼就能读懂「输入什么、得到什么、
期望什么」。代价是样板代码确实比一行断言多。社区为此长期争论，`testify` 这类第三方断言库
也确有大量使用者。但标准库这一立场体现的是 Go 一贯的偏好：显式胜于魔法，少即是多，把控制权
和表达失败的责任留给作者，而非交给一个会自作主张拼装消息的框架。

## 16.4.3 表驱动测试与子测试

Go 社区最具代表性的范式是表驱动测试：把多组「输入与期望」写成一张表（一个结构体切片），
用一个循环逐组验证。加一个用例只是往表里加一行，覆盖众多边界情形既紧凑又清晰。配合 Go 1.7
引入的子测试 `t.Run`，每组可成为一个独立命名、可单独运行（`go test -run TestSplit/empty`）、
可并行的子测试：

```go
func TestSplit(t *testing.T) {
    tests := []struct {
        name  string
        input string
        sep   string
        want  []string
    }{
        {"simple", "a,b,c", ",", []string{"a", "b", "c"}},
        {"empty", "", ",", []string{""}},
        {"no-sep", "abc", ",", []string{"abc"}},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            tt := tt            // Go 1.22 之前需此行；之后可删
            t.Parallel()        // 各子测试并行
            got := Split(tt.input, tt.sep)
            if !reflect.DeepEqual(got, tt.want) {
                t.Errorf("Split(%q, %q) = %v, want %v",
                    tt.input, tt.sep, got, tt.want)
            }
        })
    }
}
```

这里藏着一个曾经的经典陷阱。在 Go 1.22 之前，`for` 循环的迭代变量 `tt` 在整个循环中只有
一个实例，闭包捕获的是这个被不断改写的变量；当子测试因 `t.Parallel` 推迟到循环结束后才真正
执行，它们看到的 `tt` 全是最后一次迭代的值。当年的解法是循环体里写一行 `tt := tt` 把当前值
拷进一个新变量。Go 1.22 修改了语言规范，让 `for` 的每次迭代各有一份独立的迭代变量
（spec：「each iteration has its own new variables」），这个陷阱从语言层面被消除，那行
`tt := tt` 自此可以删去。这是少见的、为修正一个长期 footgun 而动语言语义的例子。

表驱动如此普遍，几乎成了 Go 测试的代名词。它再次印证 Go 的取向：用朴素的数据加循环，而非
专门的框架机制，去解决「参数化测试」这类问题。

## 16.4.4 模糊测试

Go 1.18（2022 年 3 月）把模糊测试（fuzzing）纳入了标准工具链。模糊测试的思路是：与其由人
枚举用例，不如让工具持续生成大量随机或变异的输入去轰击函数，专门寻找会触发 panic 或违反
不变式的那一个。在 Go 里，它复用同一套约定，函数形如 `func FuzzXxx(f *testing.F)`：

```go
func FuzzReverse(f *testing.F) {
    f.Add("hello")          // 播种语料：给变异引擎一个起点
    f.Add("世界")
    f.Fuzz(func(t *testing.T, s string) {
        rev := Reverse(s)
        doubleRev := Reverse(rev)
        if s != doubleRev {                 // 不变式：反转两次应还原
            t.Errorf("Reverse(Reverse(%q)) = %q", s, doubleRev)
        }
        if utf8.ValidString(s) && !utf8.ValidString(rev) {
            t.Errorf("Reverse(%q) 产生了非法 UTF-8: %q", s, rev)
        }
    })
}
```

`go test` 默认只把 `f.Add` 播下的种子和 `testdata/fuzz/FuzzReverse/` 目录里已有的语料当普通
用例跑一遍；加上 `go test -fuzz=FuzzReverse` 才进入真正的模糊模式，引擎基于覆盖率反馈不断
变异输入。一旦发现使断言失败的输入，它会把这个最小化后的反例写进 `testdata/fuzz/FuzzReverse/`，
这份语料随代码一起提交，于是 bug 被「固化」成一个永久的回归用例。上面这个例子正是官方教程里
的经典：对朴素的「按字节反转」实现，模糊引擎能迅速找到一个多字节 UTF-8 字符，证明它会破坏
编码，这类畸形输入边界几乎不可能靠手写用例想全。

把这套能力放进谱系看，它有清晰的两条源流汇合。一条是覆盖率引导的模糊测试，从 AFL 到
LLVM 的 libFuzzer，再到 Dmitry Vyukov 的 `go-fuzz`（Go 原生 fuzzing 的直接前身，验证了
这条路在 Go 上可行）。另一条是基于性质的随机测试，源头是 Claessen 与 Hughes 的 QuickCheck
（ICFP 2000），其思想是「不写具体用例，而写应当恒成立的性质，由工具随机采样去证伪」。标准库
里冻结已久的 `testing/quick` 包正是这一脉的早期遗存（其文档自陈「frozen and is not accepting
new features」）。Go 1.18 的 fuzzing 可看作两脉的合流：用 QuickCheck 式的「写不变式」做断言，
用 libFuzzer 式的「覆盖率引导变异」做输入生成。

## 16.4.5 基准测试

基准测试同样收在这套约定之下，函数形如 `func BenchmarkXxx(b *testing.B)`。Go 1.24 引入了
`b.Loop()`，取代传统的 `for i := 0; i < b.N; i++` 写法：它自动管理计时器（首次调用时重置，
退出时停表，使循环外的 setup/cleanup 不计入测量），并阻止编译器把循环体优化掉，每个基准
函数在一次测量里只运行一次：

```go
func BenchmarkIndex(b *testing.B) {
    for b.Loop() {
        Index("chicken caesar salad", "salad")
    }
}
```

至此，单元测试、表驱动、子测试、模糊测试、基准测试，全部收在同一个 `testing` 包、同一条
`go test` 命令之下。基准测试的内部机制（`b.N` 如何收敛、`b.Loop` 的编译器变换、`-benchmem`
与内存度量）放在 [16.5](./perf.md) 详述。

## 16.4.6 文化影响与取舍

把测试做成工具链的一等公民，影响是文化层面的。当 `go test` 内建、当约定统一、当门槛为零，
「写测试」就从一件需要立项的额外工作，变成了 Go 项目的默认习惯。标准库自身、几乎所有主流
开源 Go 库都带着成体系的 `_test.go`，新人照着同一套约定就能贡献测试。一门语言对测试的态度，
会通过千万次「写还是不写」的微小决策，沉淀成用它写出的软件的质量文化。这是 Go「工程友好」
哲学（[1.1](../../part1overview/ch01intro/history.md)）落地得最彻底的一处。

这套设计当然有它放弃的东西。极简的 `testing` 包把断言、mock、参数化这些便利留给了第三方
（`testify`、`gomock`）或样板代码，换来的是标准库的稳定与生态的统一。约定取代配置牺牲了
灵活性（你无法重定义测试的发现规则），换来的是零适配成本。这正是 Go 反复做出的同一种取舍：
用一套人人都懂、工具都认的朴素约定，换取整个生态在协作上的低摩擦。性能与便利从不白来，
Go 在这里选择把成本压在「少数需要花哨断言的人多写几行」，以让「所有人都能零成本地跑测试」。

## 延伸阅读的文献

1. The Go Authors. *Package testing.* https://pkg.go.dev/testing
   （`T`/`B`/`F` 的完整 API 与文档）
2. The Go Authors. *Go Fuzzing.* https://go.dev/doc/security/fuzz/ ；Go 1.18 Release Notes.
   https://go.dev/doc/go1.18#fuzzing （原生模糊测试的设计与语料目录约定）
3. The Go Authors. *Go Test Comments（wiki）.* https://go.dev/wiki/TestComments
   （`if got != want` 风格与「不提供断言库」的官方理由）
4. Dave Cheney. *Prefer table driven tests.* 2019.
   https://dave.cheney.net/2019/05/07/prefer-table-driven-tests
5. Koen Claessen, John Hughes. *QuickCheck: A Lightweight Tool for Random Testing of Haskell
   Programs.* ICFP 2000. https://doi.org/10.1145/351240.351266 （基于性质随机测试的源头）
6. The Go Authors. *Add a test / Fuzzing（教程）.* https://go.dev/doc/tutorial/add-a-test ；
   https://go.dev/doc/tutorial/fuzz
7. 本书 [16.5 性能测试](./perf.md)（`b.Loop`、`b.N` 收敛与内存度量的机制）。
