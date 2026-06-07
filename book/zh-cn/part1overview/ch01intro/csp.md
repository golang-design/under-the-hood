---
weight: 1103
title: "1.3 顺序进程通讯"
---

# 1.3 顺序进程通讯

> 本节内容提供一个线上演讲：[YouTube 在线](https://www.youtube.com/watch?v=Z8ZpWVuEx8c)，[Google Slides 讲稿](https://changkun.de/s/csp/)。



早在上个世纪七十年代，多核处理器还是一个科研主题，并没有进入普通程序员的视野。
Tony Hoare 于 1977 年提出通信顺序进程（CSP）理论，遥遥领先与他所在的时代。

CSP 的模型由并发执行的实体（线程或者进程）所组成，实体之间通过发送消息进行通信，
这里发送消息时使用的就是通道（channel）。也就是我们常说的
『 Don't communicate by sharing memory; share memory by communicating 』。

多核处理器编程通常与操作系统研究、中断处理、I/O 系统、消息传递息息相关

当时涌现了很多不同的想法：

- 信号量 semaphore [Dijkstra, 1965]
- 监控 monitors [Hoare, 1974]
- 锁与互斥 locks/mutexes
- 消息传递

研究证明了消息传递与如今的线程与锁是等价的 [Lauer and Needham 1979]。

## 1.3.1 产生背景

传统程序设计中三种常见的构造结构：重复构造（for）、条件构造（if）、顺序组合（;）

除此之外，其他的一些结构：

- Fortran: Subroutine
- Algol 60: Procedure
- PL/I: Entry
- UNIX: Coroutine
- SIMULA 64: Class
- Concurrent Pascal: Process and monitor
- CLU: Cluster
- ALPHARD: Form
- Hewitt: Actor

程序的演进史：https://spf13.com/presentation/the-legacy-of-go/

并行性的引入：

- 硬件：CDC 6600 并行单元
- 软件：I/O 控制包、多编程操作系统

处理器技术在多核处理器上提出一组自洽的处理器可以更加高效、可靠
但为了使用机器的效能，必须在处理器之间进行通信与同步。为此也提出了很多方法

- 公共存储的检查与更新：Algol 68, PL/I, 各种不同的机器码（开销较大）
- semaphore
- events: PL/I
- 条件临界区
- monitors and queues: Concurrent Pascal
- path expression

这么多方法并没有一个统一的选择标准。

C.A.R Hoare 1978 的萌芽论文，认为输入输出在一种模型编程语言中是基本要素。通信顺序过程的并行组成。通信是 I/O。
**简洁设计、解决所有问题**

- Dijkstra's guarded command
  + 条件分支
  + 主要区别：若多个条件为真，则随机选择一个分支执行

- Dijkstra's parbegin parallel command
  + 启动并发过程

- input and output command
  + 过程间通信手段
  + 通信值存在复制
  + 没有缓存
  + 指令推迟到其他过程能够处理该消息

- input + guarded command
  + 等价于 Go 的 select 语句，条件分支仅当 input 源 ready 时开始执行
  + 多个 input guards 同时就绪，只随机选择一个执行，其他 guards 没有影响

- repetitive command
  + 循环
  + 终止性取决于其所有 guards 是否已终止

- pattern-matching

## 1.3.2 设计细节

CSP 语言的结构非常简单，极度的数学形式化、简洁与优雅。
将 Dijkstra 守护指令、`!` 发送 与 `?` 接受消息进行一般性的推广：

- `p!value`: 向过程 `p` 发送一个消息
- `p?var`: 从 `p` 接受一个值并存储到 `var`
- `[A;B]`: A 运行后顺序的运行 B
- `[A||B]`: A 与 B 并行运行（组合）
- `*[A]`: 循环运行 A
- `[a -> A [] b -> B]`: 守护指令（如果 `a` 则 `A`，否则如果 `b` 则 `B`，但彼此并行）

在这个语言中，通信是一种同步。每个命令可以成功或者失败。整个语言包含：

- 顺序算符 `;`
- 并行算符 `||`
- 赋值算符 `:=`
- 输入算符 `?` （发送）
- 输出算符 `!` （接受）
- 选择算符 `□`
- 守卫算符 `→`
- 重复算符 `*`

### 程序结构

```go
<cmd>            ::= <simple cmd> | <structured cmd>
<simple cmd>     ::= <assignment cmd> | <input cmd> | <output cmd>
<structured cmd> ::= <alternative cmd> | <repetitive cmd> | <parallel cmd>
<null cmd>       ::= skip
<cmd list>       ::= {<declaration>; | <cmd>; } <cmd>
```

### 并行指令

```go
<parallel cmd>     ::= [<proc>{||<proc>}]
<proc>             ::= <proc label> <cmd list>
<proc label>       ::= <empty> | <identifier> :: | <identifier>(<label subscript>{,<label subscript>}) ::
<label subscript>  ::= <integer const> | <range>
<integer constant> ::= <numeral> | <bound var>
<bound var>        ::= <identifier>
<range>            ::= <bound variable>:<lower bound>..<upper bound>
<lower bound>      ::= <integer const>
<upper bound>      ::= <integer const>
```

举例：

```go
    X           (i     :    1     ..     n)   ::    CL
    ↑            ↑          ↑            ↑          ↑
identifier  bound var  lower bound  upper bound  cmd list

⇒

X(1) :: CL1 || X(2) :: CL2 || … || X(n) :: CLn
```

```go
<parallel cmd>     ::= [<proc>{||<proc>}]
<proc>             ::= <proc label> <cmd list>
<proc label>       ::= <empty> | <identifier> :: | <identifier>(<label subscript>{,<label subscript>}) ::
<label subscript>  ::= <integer const> | <range>
<integer constant> ::= <numeral> | <bound var>
<bound var>        ::= <identifier>
<range>            ::= <bound variable>:<lower bound>..<upper bound>
<lower bound>      ::= <integer const>
<upper bound>      ::= <integer const>
```

更多举例：

- `[cardreader ? cardimage || lineprinter ! lineimage]`
  + 两个并行过程
- `[west::DISASSEMBLE || X::SQUASH || east::ASSEMBLE]`
  + 三个并行过程
- `[room::ROOM || fork(i:0..4)::FORK || phil(i:0..4)::PHIL]`
  + 十一个个并行过程，其中第二个和第三个并行过程分别包含五个并行的子过程

### 赋值指令

```go
<assignment cmd>    ::= <target var> := <expr>
<expr>              ::= <simple expr> | <structured expr>
<structured expr>   ::= <constructor> ( <expr list> )
<constructor>       ::= <identifier> | <empty>
<expr list>         ::= <empty> | <expr> {, <expr> }
<target var>        ::= <simple var> | <structured target>
<structured target> ::= <constructor> ( <target var list> )
<target var list>   ::= <empty> | <target var> {, <target var> }
```

举例：

```go
x := x + 1                  // 普通的赋值
(x, y) := (y, x)            // 普通的赋值
x := cons(left, right)      // 结构体赋值
cons(left, right) := x      // 如果 x 是一个结构体 cons(y, z)，则赋值成功 left:=y, right:=z，否则失败
insert(n) := insert(2*x+1)  // 等价于 n := 2*x + 1
c := P()                    // 空结构体, 或称‘信号’
P() := c                    // 如果 c 同为信号，则无实际效果，否则失败
insert(n) := has(n)         // 不允许不匹配的结构体之间进行赋值
```

### 输入输出指令

```go
<input cmd>   ::= <source> ? <target var>
<output cmd>  ::= <destination> ! <expr>
<source>      ::= <proc name>
<destination> ::= <proc name>
<proc name>   ::= <identifier> | <identifier> ( <subscripts> )
<subscripts>  ::= <integer expr> {, <integer expr> }
```

举例：

```go
cardreader?cardimage      // 类似于 cardimage <- cardreader
lineprinter!lineimage     // 类似于 lineprinter := <- lineimage
X?(x,y)                   // 从过程 X 接受两个值，并赋值给 x 和 y
DIV!(3*a + b, 13)         // 向过程 DIV 发送两个值，分别为 3*a+b 和 13  
console(i)?c              // 向第 i 个 console 发送值 c
console(j-1)!"A"          // 向第 j-1 个 console 发送字符 "A"
X(i)?V()                  // 从第 i 个 X 接受一个信号 V
sem!P()                   // 向 sem 发送一个信号 P
```

思考：根据例子 (3) 和 (4)，以下语句

```
[X :: DIV!(3*a+b, 13) || DIV :: X?(x,y)]
```

本质上是什么意思？

### 选择与重复指令

```go
<repetitive cmd>  ::= * <alternative cmd>
<alternative cmd> ::= [<guarded cmd> { □ <guarded cmd> }]
<guarded cmd>     ::= <guard> → <cmd list> | ( <range> {, <range> }) <guard> → <cmd list>
<guard>           ::= <guard list> | <guard list>;<input cmd> | <input cmd>
<guard list>      ::= <guard elem> {; <guard elem> }
<guard elem>      ::= <boolean expr> | <declaration>
```

举例：

```go
// 如果某个条件成立，则执行 → 后的语句；若均成立则随机选择一个执行
[x ≥ y → m := x □ y ≥ x → m := y] 
// 依次检查 content 中的值是否与 n 相同
i := 0; *[i < size; content(i) ≠ n → i := i+1] 
// 从 west 复制一个字符串并输出到 east 中
*[c:character; west?c → east!c] 
```

```go
<repetitive cmd>  ::= * <alternative cmd>
<alternative cmd> ::= [<guarded cmd> { □ <guarded cmd> }]
<guarded cmd>     ::= <guard> → <cmd list> | ( <range> {, <range> }) <guard> → <cmd list>
<guard>           ::= <guard list> | <guard list>;<input cmd> | <input cmd>
<guard list>      ::= <guard elem> {; <guard elem> }
<guard elem>      ::= <boolean expr> | <declaration>
```

更多举例：

```go
// 监听来自 10 个 console 的值，并将其发送给 X，当收到 sign off 时终止监听
*[(i:1..10)continue(i); console(i)?c → X!(i,c); console(i)!ack(); continue(i) := (c ≠ sign off)]
// insert 操作: 执行 INSERT
// has 操作: 执行 SEARCH，并当 i < size 时，向 X 发送 true，否则发送 false
*[n:integer; X?insert(n) → INSERT □ n:integer; X?has(n) → SEARCH; X!(i<size)]
// V 操作: val++
// P 操作: val > 0 时, val--，否则失败
*[X?V() → val := val+1 □ val > 0; Y?P() → val := val-1]
```

## 1.3.3 协程

### S31 COPY

编写一个过程 X，复制从 west 过程输出的字符到 east 过程

```
COPY :: *[c:character; west?c → east!c]
```

```go
func S31_COPY(west, east chan rune) {
    for c := range west {
        east <- c
    }
    close(east)
}
```

### S32 SQUASH

调整前面的程序，替换成对出现的「**」为「↑」，假设最后一个字符不是「*」。                       

 SQUASH :: *[c:character; west?c → 
   [ c != asterisk → east!c
    □ c = asterisk → west?c;
          [ c != asterisk → east!asterisk; east!c
           □ c = asterisk → east!upward arrow
   ] ]    ]

练习：调整上面的程序，处理最后以奇数个「*」结尾的输入数据。

```
 SQUASH_EX :: *[c:character; west?c → 
   [ c != asterisk → east!c
    □ c = asterisk → west?c;
          [ c != asterisk → east!asterisk; east!c
           □ c = asterisk → east!upward arrow
+         ] □ east!asterisk
   ]    ]
```

```go
func S32_SQUASH_EX(west, east chan rune) {
    for {
        c, ok := <-west
        if !ok {
            break
        }
        if c != '*' {
            east <- c
        }
        if c == '*' {
            c, ok = <-west
            if !ok {
+               east <- '*'
                break
            }
            if c != '*' {
                east <- '*'
                east <- c
            }
            if c == '*' {
                east <- '↑'
            }
        }
    }
    close(east)
}
```

### S33 DISASSEMBLE

从卡片盒中读取卡片上的内容，并以流的形式将它们输出到过程 X ，并在每个卡片的最后插入一个空格。

```
DISASSEMBLE::
*[cardimage:(1..80)characters; cardfile?cardimage →
    i:integer; i := 1;
    *[i <= 80 → X!cardimage(i); i := i+1 ]
    X!space
]
```

```go
func S33_DISASSEMBLE(cardfile chan []rune, X chan rune) {
    cardimage := make([]rune, 0, 80)
    for tmp := range cardfile {
        if len(tmp) > 80 {
            cardimage = append(cardimage, tmp[:80]...)
        } else {
            cardimage = append(cardimage, tmp[:len(tmp)]...)
        }
        for i := 0; i < len(cardimage); i++ {
            X <- cardimage[i]
        }
        X <- ' '
        cardimage = cardimage[:0]
    }
    close(X)
}
```

### S34 ASSEMBLE

将一串流式字符串从过程 X 打印到每行 125 个字符的 
lineprinter 上。必要时将最后一行用空格填满。

```
ASSEMBLE::
lineimage:(1..125)character;
i:integer, i:=1;
*[c:character; X?c →
    lineimage(i) := c;
    [i <= 124 → i := i+1
    □ i = 125 → lineprinter!lineimage; i:=1
]   ];
[ i = 1 → skip
□ i > 1 → *[i <= 125 → lineimage(i) := space; i := i+1];
  lineprinter!lineimage
]
```

```go
func S34_ASSEMBLE(X chan rune, lineprinter chan string) {
    lineimage := make([]rune, 125)

    i := 0
    for c := range X {
        lineimage[i] = c
        if i <= 124 {
            i++
        }
        if i == 125 {
            lineimage[i-1] = c
            lineprinter <- string(lineimage)
            i = 0
        }
    }
    if i > 0 {
        for i <= 124 {
            lineimage[i] = ' '
            i++
        }
        lineprinter <- string(lineimage)
    }

    close(lineprinter)
    return
}
```

### S35 Reformat

从长度为 80 的卡片上进行读取，并打印到长度为 125 个字符的 lineprinter 上。每个卡片必须跟随一个额外的空格，最后一行
须使用空格进行填充。

```
REFORMAT::
[west::DISASSEMBLE || X::COPY || east::ASSEMBLE]
```

```go
func S35_Reformat(cardfile chan []rune, lineprinter chan string) {
    west, east := make(chan rune), make(chan rune)
    go S33_DISASSEMBLE(cardfile, west)
    go S31_COPY(west, east)
    S34_ASSEMBLE(east, lineprinter)
}
```

### S36 Conway's Problem

调整前面的程序，使用「↑」替换每个成对出现的「*」。

```
CONWAY::
[west::DISASSEMBLE || X::SQUASH || east::ASSEMBLE]
```

```go
func S35_ConwayProblem(cardfile chan []rune, lineprinter chan string) {
    west, east := make(chan rune), make(chan rune)
    go S33_DISASSEMBLE(cardfile, west)
    go S32_SQUASH_EX(west, east)
    S34_ASSEMBLE(east, lineprinter)
}
```


## 1.3.4 子程、数据表示与递归

子程是一个与用户过程并发执行的子过程：

```
[subr:SUBROUTINE || X::USER]
SUBROUTINE::[X?(value params) → …; X!(result params)]
USER::[ …; subr!(arguments); …; subr?(results)]
```

数据表示可以视为一个具有多入口的子过程，根据 guarded command 进行分支选择：

```
*[X? method1(value params) → … 
□ X? method2(value params) → … ]
```

递归可以通过一个子程数组进行模拟，用户过程（零号子程）向一号子程发送必要的参数，再从起接受递归后的结果：

```
[recsub(0)::USER || recsub(i:1..reclimit):: RECSUB]
USER::recsub(1)!(arguments); … ; recsub(1)?(results);
```

### S41 带余除法

编写一个类型子程，接受一个正除数与被除数，返回其商和余数。

```
[DIV::*[x,y:integer; X?(x,y)->
      quot,rem:integer; quot := 0; rem := x;
      *[rem >= y -> rem := rem - y; quot := quot + 1;]
      X!(quot,rem)
      ]
||X::USER]
```

```go
func S41_DivisionWithRemainder(in chan S41_In, out chan S41_Out) {
    v := <-in
    x, y := v.X, v.Y

    quot, rem := 0, x
    for rem >= y {
        rem -= y
        quot++
    }
    out <- S41_Out{quot, rem}
}
```

### S42 阶乘

给定一个上限，计算其阶乘。

```
[fac(i:1..limit)::
*[n:integer;fac(i-1)?n ->
  [n=0 -> fac(i-1)!1
  □ n>0 -> fac(i+1)!n-1;
    r:integer; fac(i+1)?r; fac(i-1)!(n*r)
]] || fac(0)::USER ]
```

```go
func S42_Factorial(fac []chan int, limit int) {
    for i := 1; i <= limit; i++ {
        go func(i int) {
            n := <-fac[i-1]
            if n == 0 {
                fac[i-1] <- 1
            } else if n > 0 {
                // 注意，这里需要检查 i 的上限
                // 原始解法没有对其进行检查，如果用户输入等于或超过则无法终止程序
                if i == limit {
                    fac[i-1] <- n
                } else {
                    fac[i] <- n - 1
                    r := <-fac[i]
                    fac[i-1] <- n * r
                }
            }
        }(i)
    }
}
```

### S43 S44 S45 S46 集合

实现一个集合的 insert 与 has 方法

```
S::
content(0..99)integer; size:integer; size := 0;
*[n:integer; X?has(n) -> SEARCH; X!(i<size)
□ n:integer; X?insert(n) -> SEARCH;
    [i<size -> skip
    □i = size; size<100 ->
        content(size) := n; size := size+1
]]

SEARCH::
i:integer; i := 0;
*[i<size; content(i) != n -> i:=i+1]
```

Go 实现：https://github.com/changkun/gobase/blob/f787593b4467793f8ee0b07583ea9ffde5adf2be/csp/csp.go#L392 

## 1.3.5 监控与调度

监控可以被视为与多个用户过程通信的单一过程，且总是能跟用户过程进行通信。

例如：

```
*[(i:1..100)X(i)?(value param) → …; X(i)!(results)]
```

当两个用户过程同时选择一个 X(i) 时，guarded cmd 保护了监控结果不会被错误的发送到错误的用户过程中。

### S51 Buffered Channel

构造一个带缓冲的过程 X，用于平滑输出的速度（即 buffered channel）。

```
X::
buffer:(0..9)portion;
in,out:integer; in:=0; out := 0;
comment 0 <= out <= in <= out+10;
  *[in < out + 10; producer?buffer(in mod 10) -> in := in + 1
  □ out < in; consumer?more() -> consumer!buffer(out mod 10); out := out + 1 ]
```

Go 实现：https://github.com/changkun/gobase/blob/f787593b4467793f8ee0b07583ea9ffde5adf2be/csp/csp.go#L609 


### S52 信号量

实现证书信号量 S，在 100 个子过程间进行共享，每个过程可以通过 V 操作在信号量非正的情况下增加信号量。

```
S::val:integer; val:=0;
*[(i:1..100)X(i)?V()->val:=val+1
□ (i:1..100)val>0;X(i)?P()->val:=val-1]
```

Go 实现：https://github.com/changkun/gobase/blob/f787593b4467793f8ee0b07583ea9ffde5adf2be/csp/csp.go#L649 

### S53 哲学家进餐问题

实现哲学家进餐问题。

```
PHIL = *[...during i-th lifetime ... ->
         THINK;
         room!enter();
         fork(i)!pickup();fork((i+1)mod5)!pickup();
         EAT;
         fork(i)!putdown();fork((i+1)mod5)!putdown();
         room!next()]

FORK = *[phil(i)?pickup()->phil(i)?putdown()
       □ phil((i-1)mod5)?pickup()->phil((i-1)mod5)?putdown()]

ROOM = occupancy:integer; occupancy := 0;
       *[(i:0..4)phil(i)?enter()->occupancy:=occupancy+1
       □ (i:0..4)phil(i)?exit()->occupancy:=occupancy-1]

[room::ROOM||fork(i:0..4)::FORK||phil(i:0..4)::PHIL]
```

Go 实现：https://github.com/changkun/gobase/blob/f787593b4467793f8ee0b07583ea9ffde5adf2be/csp/csp.go#L746 

## 1.3.6 算法

### S61 Eratosthenes 素数筛法

实现 Eratosthenes 素数筛法。

```
[SIEVE(i:1..100)::
 p,mp:integer;
 SIEVE(i-1)?p;
 print!p;
 mp:=p; comment mp is a multiple of p;
*[m:integer; SIEVE(i-1)?m->
   *[m>mp->mp:=mp+p];
    [m=mp->skip □ m<mp->SIEVE(i+1)!m ]
 ]
|| SIEVE(0)::print!2; n:integer; n:=3;
      *[n<10000->SIEVE(1)!n;n:=n+2]
|| SIEVE(101)::*[n:integer;SIEVE(100)?n->print!n]
|| print::*[(i:0..101)n:integer;SIEVE(i)?n->...]
]
```

Go 实现：https://github.com/changkun/gobase/blob/f787593b4467793f8ee0b07583ea9ffde5adf2be/csp/csp.go#L833 


### S62 矩阵乘法

实现 3x3 矩阵乘法。

```
[M(i:1..3,0)::WEST
||M(0,j:1..3)::NORTH
||M(i:1..3,4)::EAST
||M(4,j:1..3)::SOUTH
||M(i:1..3,j:1..3)::CENTER]

NORTH = *[true -> M(1,j)!0]
EAST = *[x:real; M(i,3)?x->skip]
CENTER = *[x:real;M(i,j-1)?x->
          M(i,j+1)!x;sum:real;
          M(i-1,j)?sum;M(i+1,j)!(A(i,j)*x+sum)]
```

Go 实现：https://github.com/changkun/gobase/blob/f787593b4467793f8ee0b07583ea9ffde5adf2be/csp/csp.go#L923 

## 1.3.7 总结

CSP 设计是 Tony Hoare 的早期提出的设计，与随后将理论完整化后的 CSP（1985）存在两大差异：

缺陷1: 未对 channel 命名

并行过程的构造具有唯一的名词，并以一对冒号作为前缀：[a::P || b::Q || … || c::R]

在过程 P 中，命令 b!v 将 v 输出到名为 b 的过程。该值由在过程 Q 中出现的命令 a?x 输入。
过程名称对于引入它们的并行命令是局部的，并且组件过程间的通信是隐藏的。
虽然其优点是不需要在语言中引入任何 channel 或者 channel 声明的概念。

缺点：
1. 子过程需要知道其使用过程的名称，使得难以构建封装性较好的子过程库
2. 并行过程组合本质上是具有可变数量参数的运算，不能进行简化（见 CSP 1985）

缺陷2: 重复指令的终止性模糊

重复指令默认当每个 guard 均已终止则指令中终止，这一假设过强。具体而言，对于 *[a?x → P □ b?x → Q □ ...]
要求当且仅当输入的所有过程 a,b,… 均终止时整个过程才自动终止。

缺点：

1. 定义和实现起来很复杂
2. 证明程序正确性的方法似乎比没有简单。

一种可能的弱化条件为：直接假设子过程一定会终止。

综合来说，CSP 1978 中描述的编程语言（与 Go 所构建的基于通道的 channel/select 同步机制进行对比）：

1. channel 没有被显式命名
2. channel 没有缓冲，对应 Go 中 unbuffered channel
3. buffered channel 不是一种基本的编程源语，并展示了一个使用 unbuffered channel 实现其作用的例子
4. guarded command 等价于 if 与 select 语句的组合，分支的随机触发性是为了提供公平性保障
5. guarded command 没有对确定性分支选择与非确定性（即多个分支有效时随机选择）分支选择进行区分
6. repetitive command 的本质是一个无条件的 for 循环，但终止性所要求的条件太苛刻，不利于理论的进一步形式化
7. CSP 1978 中描述的编程语言对程序终止性的讨论几乎为零
8. 此时与 Actor 模型进行比较，CSP 与 Actor 均在实体间直接通信，区别在于 Actor 支持异步消息通信，而 CSP 1978 是同步通信

## 进一步阅读的参考文献

- [Hoare 78] Hoare, C. A. R. (1978). Communicating sequential processes. Communications of the ACM, 21(8), 666–677.
- [Brookes 84] S. D. Brookes, C. A. R. Hoare, and A. W. Roscoe. 1984. A Theory of Communicating Sequential Processes. J. ACM 31, 3 (June 1984), 560-599.
- [Hoare 85] C. A. R. Hoare. 1985. Communicating Sequential Processes. Prentice-Hall, Inc., Upper Saddle River, NJ, USA.
- [Milner 82] R. Milner. 1982. A Calculus of Communicating Systems. Springer-Verlag, Berlin, Heidelberg.
- [Fidge 94] Fidge, C., 1994. A comparative introduction to CSP, CCS and LOTOS. Software Verification Research Centre, University of Queensland, Tech. Rep, pp.93-24.
- [Lauer and Needham 1979] Hugh C. Lauer and Roger M. Needham. 1979. On the duality of operating system structures. SIGOPS Oper. Syst. Rev. 13, 2 (April 1979), 3-19.

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).

<!-- 
[Processes] may not communicate with each other by
updating global variables.
In parallel programming coroutines appear as a more
fundamental program structure than subroutines, which can be
regarded as a special case.
[A coroutine] may use input commands to achieve the effect of
"multiple entry points" ... [and be] used like a SIMULA class
instance as a concrete representation for abstract data.

## Occam

## Erlang

## Newsqueak/Limbo/Go

### Squeak

Squeak (Cardelli and Pike (1985)) was a toy language used
to demonstrate the use of concurrency to manage the input
streams to a user interface.

Unrelated to the much later Squeak Smalltalk implementation

```
proc Mouse = DN? . M?p . moveTo!p . UP? . Mouse
proc Kbd(s) = K?c .
 if c==NewLine then typed!s . Kbd(emptyString)
 else Kbd(append(s, c))
 fi
proc Text(p) =
 < moveTo?p . Text(p)
 :: typed?s . {drawString(s, p)? . Text(p) >
type = Mouse & Kbd(emptyString) & Text(nullPt)
```

### Newsqueak

Newsqueak (1989) looked syntactically like C but was
applicative and concurrent. Idea: a research language to
make the concurrency ideas of Squeak practical.

Had lambdas called `progs`, a select statement
corresponding to the CSP alternation, but guards must be
communication only (sends work).

Long-lived syntactic inventions:

Communication operator is left arrow `<-`. Information flows
in direction of arrow. Also `<-c` (receive) is an expression.
Introduces `:=` for "declare and initialize":

```
x: int = 1
x := 1
```

### Alef

Early 1990s: Alef (Phil Winterbottom) grafted the concurrency
and communications model of Newsqueak onto a more
traditional compiled C-like language.

Problem: with C's memory model in a concurrent world, hard
to know when to free items.

All the other languages in this talk are garbage-collected,
which is essential to easy concurrent programming.

### Limbo

Limbo (Dorward, Pike, Winterbottom 1996) was a VM
language (contemporaneous with Java) that was closer to
Newsqueak in overall design.

Used as an embedded language in communication products.

As in Newsqueak and Alef, the key idea is that channels are
first-class.
-->