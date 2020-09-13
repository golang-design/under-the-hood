---
weight: 1206
title: "2.6 顺序进程通讯 CSP"
---

> 本节内容提供一个线上演讲：[YouTube 在线](https://www.youtube.com/watch?v=Z8ZpWVuEx8c)，[Google Slides 讲稿](https://docs.google.com/presentation/d/1N5skL6vR9Wxk-I82AYs3dlsOsJkUAGJCsb5NGpXWpqo/edit?usp=sharing)。


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

## 顺序进程间通信 CSP

C.A.R Hoare 1978 的萌芽论文，认为输入输出在一种模型编程语言中是基本要素。通信顺序过程的并行组成。通信是 I/O。

<!-- 


并行组合是多处理。
这就是您所需要的！
与您发表的其他10篇优秀论文相比，本文的想法更多
有可能找到

### 语言结构

CSP 语言的结构非常简单，极度的数学形式化、简洁与优雅。
将 Dijkstra 守护指令、`!` 发送 与 `?` 接受消息进行一般性的推广：

- `p!value`: 向过程 `p` 发送一个消息
- `p?var`: 从 `p` 接受一个值并存储到 `var`
- `[A;B]`: A 运行后顺序的运行 B
- `[A||B]`: A 与 B 并行运行（组合）
- `*[A]`: 循环运行 A
- `[a -> A [] b -> B]`: 守护指令（如果 `a` 则 `A`，否则如果 `b` 则 `B`，但彼此并行）

在这个语言中，通信是一种同步。每个命令可以成功或者失败。

### Coroutines

```
COPY:: *[c:character; west?c -> east!c]

DISASSEMBLE:: *[cardimage:(1..80)characters; cardfile?cardimage ->
    i:integer; i := 1;
    *[i <= 80 -> X!cardimage(i); i := i+1 ]
    X!space
]

ASSEMBLE:: lineimage:(1..125)character;
i:integer, i:=1;
*[c:character; X?c ->
    lineimage(i) := c;
    [i <= 124 -> i := i+1
    □ i = 125 -> lineprinter!lineimage; i:=1
]   ];
[ i = 1 -> skip
□ i > 1 -> *[i <= 125 -> lineimage(i) := space; i := i+1];
  lineprinter!lineimage
]

[west::DISASSEMBLE||X:COPY||east::ASSEMBLE]
```

```go
copy := func(west, east chan byte) { for { east <- <-west } }
assemble := func(X chan byte, printer chan []byte) {
    lineimage := make([]byte, 125)
    for i := 0;; {
        lineimage[i] = <-X
        if i < 124 { i++ } else { printer <- lineimage; i = 0 }
    }
}
disassemble := func(cardfile chan []byte, X chan byte) {
    for {
        cardimage := <-cardfile
        i := 0
        for i < len(cardimage) { X <- cardimage[i]; i++ }
        for i < 80 { X <- ' '; i++ }
    }
}

cardreader  := ...
lineprinter := ...
chars1 := make(chan byte)
chars2 := make(chan byte)

go disassemble(cardreader, chars1)
go copy(chars1, chars2)
go assemble(chars2, lineprinter)
```

### 端口与模式

通信中使用的“端口”仅是单个连接到预定义的流程-名称是流程名称。

可以写一个1000个素数的素数筛子，但不能写N个素数； 一种
3x3的矩阵乘法器，但NxN则不是，等等。流程进行记账。）

模式匹配以分析/解包消息：

```
[ c?(x, y) ! A ]
```

更一般的条件：

```
[ i>=100; c?(x, y) ! A ]
```

无法将发送用作防护。

### 总结


独立流程的并行组成
通讯同步
不共享内存
不是线程，也不是互斥体！
现在我们来上路了

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

### 素数筛法

```go
counter := prog(c:chan of int) {
    i:int; for(i = 2;;) c<-=i++;
};
filter := prog(prime:int, listen,send:chan of int) {
    i:int; for(i=0 ;;) if((i=<-listen)%prime) send<-=i;
};
sieve := prog() of chan of int {
    c := mk(chan of int);
    begin counter(c);
    prime := mk(chan of int);
    begin prog(){
        p: int;
        newc: chan of int;
        for(;;){
            prime<- = p = <-c;
            newc = mk();
            begin filter(p, c, newc);
            c = newc;
        }
    }();
    become prime;
};
```

### channel 作为一等值

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

## 总结

Go (Griesemer, Pike, Thompson 2009) is a compiled, objectoriented language with a concurrent runtime.

Makes it easy to use the tools of CSP efficiently, in concert
with regular systems code. Channels are first class! (So are
functions, which can run in parallel.)

Compilation makes execution efficient (e.g., cryptographic
calculations are quick).

The runtime makes concurrency easy (stacks,
communication, scheduling, etc. are all automatic).

Garbage-collected, naturally.

Best of all worlds!

Go's concurrency structures have a long history dating back
to a branch in the CSP family tree in the 1980s. Multiple real
languages have built on CSP's ideas.

Channels as first-class values are the distinguishing feature
of the Go branch.

Go pulls together elements from several predecessors,
coupling high-level concurrency operations with a compiled
object-oriented language.

To use concurrency gracefully, language must have garbage
collection and automatic stack management. -->


## 进一步阅读的参考文献

- [Lauer and Needham 1979] Hugh C. Lauer and Roger M. Needham. 1979. On the duality of operating system structures. SIGOPS Oper. Syst. Rev. 13, 2 (April 1979), 3-19.