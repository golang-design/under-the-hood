---
weight: 4106
title: "12.6 微对象分配"
---

# 12.6 微对象分配

前两节走完了分配器的两端。大对象（[12.4](./largealloc.md)）绕开缓存，直接向 mheap 按页要内存；
小对象（[12.5](./smallalloc.md)）按尺寸类从每 P 的 mcache 里摘一个等大槽位。这一节补上最后、
也是最不起眼的一类对象，**微对象**（tiny object）：小于 16 byte 且不含指针的那些。它们数量极多，
单个又极小，若也按尺寸类各占一个槽位，浪费会大得惊人。Go 为它们单设了一条路径，把多个微对象
**拼进同一个块**，用一处简单的「碰撞指针」（bump pointer）手法换来可观的内存节省。

## 12.6.1 问题：把一个 `bool` 塞进 16 byte 的槽位

回顾小对象分配的代价。尺寸类是离散的，分配 $n$ 个字节，实际占用的是「不小于 $n$ 的最近一档
尺寸类」（[12.1](./basic.md)）。最小的几档尺寸类是 8、16、24 byte。于是一个 1 byte 的 `bool`
逃逸到堆上，要占满一个 8 byte 槽位，浪费 $7/8$；一个 5 byte 的字符串片段同样占 8 byte。
对单次分配，这点内部碎片无关痛痒；可微对象在真实程序里出奇地常见：

- `[]byte`、`string` 在拼接、切分时产生的短片段；
- 逃逸到堆上的标量临时量，如 `interface{}` 装箱一个小整数；
- `for range` 取地址、闭包捕获等场合下被迫上堆的小变量。

这些对象每一个都不到 8 byte，却各占一个槽位。把它们累加起来，浪费的就不再是零头。若能把若干
微对象**并排塞进一个槽位**，让它们共享同一段内存，节省便立竿见影。这正是微对象分配器要做的事。

## 12.6.2 微对象分配器：一个块，一个偏移

手法本身朴素。mcache 里为微对象留了两个字段（[12.2](./component.md)）：当前正在填充的 16 byte
块的起址 `tiny`，以及块内已用到的偏移 `tinyoffset`。

```go
type mcache struct {
    tiny       uintptr // 当前微对象块的起址（一段 16B 内存）
    tinyoffset uintptr // 块内下一个可用位置的偏移
    // ... 其余字段见 12.2
}
```

一次微对象分配就是在当前块里**碰一下指针**：从 `tinyoffset` 处对齐、切出 `size` 字节、把偏移
向前推。若当前块装不下，再去要一个新的 16 byte 块。裁剪后的速写（`runtime/malloc.go` 的
`mallocgcTiny`）：

```go
// 微对象分配：在当前 16B 块里碰撞指针，装不下则换新块（速写）
off := c.tinyoffset
// 按所需对齐保守地对齐偏移：让块内的对象各自落在自然边界上
if size&7 == 0 {
    off = alignUp(off, 8)
} else if size&3 == 0 {
    off = alignUp(off, 4)
} else if size&1 == 0 {
    off = alignUp(off, 2)
}

if off+size <= maxTinySize && c.tiny != 0 { // maxTinySize = 16
    // 当前块装得下：切一块、推进偏移，立即返回（最快路径，无清零）
    x := unsafe.Pointer(c.tiny + off)
    c.tinyoffset = off + size
    c.tinyAllocs++
    return x
}

// 当前块装不下：向小对象机制要一个新的 16B noscan 槽位
span := c.alloc[tinySpanClass]
v := nextFreeFast(span)
if v == 0 {
    v, span, _ = c.nextFree(tinySpanClass)
}
x := unsafe.Pointer(v)
(*[2]uint64)(x)[0] = 0 // 整块一次性清零
(*[2]uint64)(x)[1] = 0
// 在新块与旧块之间，保留剩余空间更大的那个作为「当前块」
if size < c.tinyoffset || c.tiny == 0 {
    c.tiny = uintptr(x)
    c.tinyoffset = size
}
```

几处值得点出。

**对齐是保守的。** 偏移按对象大小推断的对齐量向上取整：8 的倍数对齐到 8，4 的倍数对齐到 4，
依此类推。运行时并不知道这块内存将被当成什么类型，只能按大小给出一个不会出错的对齐，让块内
每个对象都落在它的自然边界上。代价是块内可能留下几字节对齐空洞，但这正是「不知类型」时
唯一安全的选择（32 位平台上 12 byte 对象还要额外对齐到 8，以免其首个 64 位字在原子访问时触错，
见 go.dev/issue/37262）。

**新块来自小对象机制。** 换块这一步并不特殊，它就是去 `c.alloc[tinySpanClass]` 取一个尺寸类 2
（16 byte）、标记为 noscan 的槽位，先 `nextFreeFast` 做一次位扫描，落空再走 `nextFree` 的慢路径
补货。换言之，微对象分配器**架设在小对象分配器之上**：小对象机制交付一个普通的 16 byte 槽位，
微对象分配器再把它切碎复用。`tinySpanClass` 的取值也印证了这一点，它是
`tinySizeClass<<1 | 1`，即尺寸类 2 加上 noscan 标志位。

**「换块」时保留更空的那块。** 条件 `size < c.tinyoffset` 读作：新块用掉 `size`、剩
`16-size`，旧块剩 `16-tinyoffset`；当 `size < tinyoffset` 时新块剩得更多，便把它立为当前块，
否则继续用旧块。这个小启发式让后续分配总在「剩余空间较大」的块里碰撞，提高拼装成功率。
被换下的旧块并不丢失，它仍归属那个 span，只是不再是 mcache 的「当前块」。

**清零的时机变了，但语义没变。** 取到新块时，那两行 `uint64` 写入把整块 16 byte **一次性
清零**；此后块内的每次碰撞都只向前推进偏移，从不回头复用已切出的区域。因此每个微对象拿到的
都是已清零的内存，只是清零在取块时批量完成，而非逐对象进行。这与小对象分配里「按需清零」
是同一个目的，省去了每次微小分配各做一次 `memclr` 的开销。

## 12.6.3 为什么必须不含指针

微对象分配器只接收 **noscan**（不含指针）的对象，这不是优化，而是正确性的前提。

一个块里并排塞着好几个逻辑对象，但垃圾回收（[13](../ch13gc)）看到的是**整个块这一个分配单位**：
块的存活与否，取决于是否还有任何指针指向块内任意位置；只要还有一个子对象可达，整块就不会被
回收（[13.5](../ch13gc/sweep.md)）。这带来两个约束。其一，GC 的扫描以 span 槽位为粒度，
若块内某个子对象含指针，扫描器无法在「多个对象共用一槽」的布局里干净地辨认出哪几个字是指针、
该从哪里继续追踪；把微对象限制为纯标量数据，扫描器对这一槽位就可以整体跳过，GC 的逻辑得以
保持简单。其二，多个子对象共享生死，意味着只要一个还活着，其余即便已死也跟着赖在内存里。
若允许这些「搭便车」的死对象持有指针，它们指向的对象也会被连带保活，浪费会顺着指针链
不受控地放大。限定为标量数据，把浪费牢牢圈在「至多一个块」的范围内。

正因块的生死是整体的，从微对象分配器拿到的对象**不能被显式释放**，也不能直接对它设置
finalizer；运行时为可能来自微对象块的指针在 `SetFinalizer` 里留了特殊处理，允许对块内某个
字节设置 finalizer（详见 [13](../ch13gc) 与 `runtime/mfinal.go`）。

## 12.6.4 为什么是 16 byte：拼装与浪费的权衡

块的大小 `maxTinySize` 是可调的，当前定为 16 byte。这个数字背后是一组清楚的量化权衡，
也是这套设计里最值得推敲的一处。

设块大小为 $B$。最坏情形是：一个块拼进了若干子对象，随后除一个之外全部死亡，但那一个仍存活，
于是整块都无法回收。此时真正有用的内存可低至一个最小子对象，浪费逼近整块。以最小子对象趋于
$0$、子对象总和趋于 $B$ 计，相对小对象方案（每个微对象本各占一档槽位），最坏放大约为

$$
W_{\text{worst}}(B) \approx \frac{B}{B/2} = 2 \quad (B = 16)
$$

即最坏多占约一倍内存。源码把这条权衡写得很直白：$B=8$ 时几乎没有浪费，但能拼到一起的机会也少；
$B=32$ 时拼装机会更多，最坏浪费却升到约四倍；而无论块多大，**最好情形**的节省都是约 8 倍
（多个微对象本各占一槽，如今共用一块）。16 byte 是在「拼得够多」与「最坏只翻一倍」之间取的折中。

收益是实打实的。运行时注释给出一组实测：在一个 JSON 基准上，微对象分配器把分配次数减少约
$12\%$、堆体积减少约 $20\%$。考虑到它服务的只是「小于 16 byte 的无指针对象」这一窄类，
这样的整体收益恰恰说明了这类对象在真实负载里有多普遍。

## 12.6.5 三条路径：分配器的因材施教

至此，分配器对三类对象各有一条量身定制的路径，合起来正是 [12.1](./basic.md) 设计原则的落地：

```mermaid
flowchart TD
    A["申请 size 字节"] --> Q{判定}
    Q -->|"size 小于 16B 且无指针"| T["微对象：mcache.tiny 块内碰撞指针"]
    Q -->|"16B 至 32KB"| S["小对象：按尺寸类从 mcache 取槽位（12.5）"]
    Q -->|"大于 32KB"| L["大对象：直接向 mheap 要页（12.4）"]
    T -->|"块满，换新块"| S
    S -->|"本地 span 用尽"| C["mcentral / mheap 补货"]
    L --> H["mheap 页分配器"]
```

三条路径并非平列。大对象与小对象分守内存尺度的两端；微对象则**寄生在**小对象路径上，它换块时
要的就是一个普通的 16 byte noscan 槽位，只是在交付给用户之前，先由 `tiny`/`tinyoffset` 把这块
槽位切成几份复用。判定的顺序也对应着热度：绝大多数分配是小对象与微对象，走的是 mcache 的无锁
快路径；大对象稀少而昂贵，落到加锁的 mheap。把最热的微对象做成几次指针碰撞，把最冷的大对象
留给系统调用，这种「按对象的大小与生命周期分配不同手法」的因材施教，是分配器全部巧思的浓缩。

需要一提两处工程化的细节，它们不改变上述主线。其一，新版运行时在
`sizeSpecializedMallocEnabled` 下会为各尺寸生成专门化的分配函数（`mallocgcTinySC2` 等），
按大小直接派发以省去分支，逻辑与本节叙述的 `mallocgcTiny` 一致。其二，为修正一处安全问题
（go.dev/issue/76356），带有「secret」标记的分配会绕开微对象分配器、强制单独清零，避免敏感
数据与其他对象共块残留。这些都是在同一套设计上打的补丁，主干仍是「一个块、一个偏移」。

## 延伸阅读的文献

1. The Go Authors. *runtime/malloc.go*（`mallocgcTiny`、`maxTinySize`、对齐与换块逻辑、
   JSON 基准的实测数据）. https://github.com/golang/go/blob/master/src/runtime/malloc.go
2. The Go Authors. *runtime/mcache.go*（`tiny`/`tinyoffset` 字段与 `tinySpanClass`）.
   https://github.com/golang/go/blob/master/src/runtime/mcache.go
3. The Go Authors. *runtime/mheap.go*（`tinySpanClass = tinySizeClass<<1 | 1`、`makeSpanClass`）.
   https://github.com/golang/go/blob/master/src/runtime/mheap.go
4. Go issue 37262、76356（12 byte 对齐与 secret 分配绕开微对象分配器的两处修正）.
   https://go.dev/issue/37262 、https://go.dev/issue/76356
5. 本书 [12.4 大对象分配](./largealloc.md)、[12.5 小对象分配](./smallalloc.md)
   （微对象路径所寄生其上的两端）.
6. 本书 [12.2 组件](./component.md)（mcache、span、尺寸类）、
   [13 垃圾回收](../ch13gc)（块的整体存活、扫描与清扫）.

## 许可

&copy; 2018-2026 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
