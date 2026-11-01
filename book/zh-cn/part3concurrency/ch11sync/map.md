---
weight: 3307
title: "11.7 并发安全散列表"
---

# 11.7 并发安全散列表

语言内建的 `map` 不是并发安全的。多个 goroutine 在没有同步的情况下读写同一个 `map`，运行时会尽力检测，
一旦发现就以 `fatal error: concurrent map writes` 或 `concurrent map read and map write` 终止程序，
`recover` 无法截获（[5.4.4](../../part2lang/ch05data/swisstable.md)）。多个 goroutine 共享一张表时，
最直接的做法是给普通的 `map` 配一把锁：

```go
type RWMutexMap struct {
	mu   sync.RWMutex
	data map[string]int
}

func (m *RWMutexMap) Load(k string) (v int, ok bool) {
	m.mu.RLock()
	v, ok = m.data[k]
	m.mu.RUnlock()
	return
}

func (m *RWMutexMap) Store(k string, v int) {
	m.mu.Lock()
	m.data[k] = v
	m.mu.Unlock()
}
```

这种写法简单，键与值的类型由使用者决定，多数场景下也足够快。它的瓶颈在读锁本身：`RLock` 与 `RUnlock`
各要对 `readerCount` 做一次原子加（[11.2.6](./mutex.md)），所有读者都在修改同一条缓存行。2016 年，Bryan
C. Mills 报告，在多核机器上仅仅反复加读锁、解读锁，随着 `GOMAXPROCS` 增大，每次操作的耗时会增加到
8 倍左右 [[Mills, 2016a](#ref-mills-2016a)]。`sync.Map` 针对的就是这种读多到连读锁都嫌贵的场景。
它至今有过两代实现：Go 1.9 引入的双表设计，以及 Go 1.24 起默认采用的并发散列字典树。

## 11.7.1 并发散列表的谱系

让散列表支持并发，大致有以下几条路线。

**一把全局锁。** 上面的 `RWMutexMap` 即是。正确而简单，但所有写操作都串行化在一把锁上，
读操作也要修改锁的状态。

**锁分段**（lock striping）。把表分成若干段，每段一把锁，键按散列值落入某一段，操作只锁所在的段。Doug Lea
为 Java 设计的 `ConcurrentHashMap` 是经典的例子 [[Lea, n.d.](#ref-lea-nd)]。Java 7 的文档写明，
表在内部分区，以容许构造参数 `concurrencyLevel`（默认 16）所指示数目的并发更新
[[Oracle, 2011](#ref-oracle-2011)]；Java 8 的文档则改称这个参数只是一个容量上的提示
[[Oracle, 2014](#ref-oracle-2014)]。

**无锁散列表。** 2007 年，Cliff Click 介绍了一个无等待的并发散列表（摘要写作「wait-free (lock-free)」），
声称单线程性能优于多数散列表，多线程性能则优于所有比较过的实现，即使修改频繁也能扩展到 768 个 CPU；
正确性的论证也另辟蹊径，不用通常的先行发生、内存序与内存屏障的思路，算法不需要内存屏障、双字比较并交换，
也没有比较并交换的自旋循环 [[Click, 2007](#ref-click-2007)]。

**散列字典树。** 2001 年，Phil Bagwell 以数组映射字典树（Array Mapped Trie）
为基础提出**散列字典树**（HAMT）：把键的散列值按固定的位数切段，每一段在一层中选择一个分支，
节点用位图记录哪些分支存在，从而只为存在的分支分配空间；它不需要预先分配根散列表，插入、
查找与删除的时间与键集的大小无关 [[Bagwell, 2001](#ref-bagwell-2001)]。HAMT 后来成为 Scala、Clojure
等语言不可变映射的基础。2012 年，Aleksandar Prokopec 等人在此基础上提出并发字典树 CTrie，它是无锁的，
并支持高效的非阻塞快照 [[Prokopec et al., 2012](#ref-prokopec-et-al-2012)]。

`sync.Map` 的第一代实现不在这几条路线上，它是针对读多写少负载的一种特化；第二代实现属于散列字典树一族，
但在关键处与 HAMT 和 CTrie 都不相同，11.7.4 节会具体说明。

## 11.7.2 第一代：读写分离的双表

Mills 在报告读写锁问题的同时提出 issue #18177：对读写比很高的表，用小心维护的 `atomic.Value`
往往比修好读写锁更好，标准库中就有很多这样的表，尤其在 `reflect` 包里；
但这样的表要正确而高效地实现并不容易，标准库应当提供一个 [[Mills, 2016b](#ref-mills-2016b)]。实现先作为
`golang.org/x/sync/syncmap` 发布，2017 年 2 月移入标准库，随 Go 1.9 发布
[[Mills, 2017](#ref-mills-2017)]。

最初的文档只有寥寥数语。Rob Pike 在 issue #21587 中批评它「正确但没有帮助」：它与 `map` 有何不同，
何时该用，何时不该用，性能特征如何，新手读了都不会明白。Russ Cox 随后改写了文档
[[Cox, 2017](#ref-cox-2017)]，改写后的说明沿用至今 [[Go Authors, 2026a](#ref-go-authors-2026a)]：`Map`
是一种特化的类型，多数代码应当使用普通的 `map` 加上单独的锁或协调，以获得更好的类型安全，
也更容易与表的内容一起维护其他不变量；`Map` 针对两种常见用法做了优化：其一，一个键只写入一次、
却被读取多次，例如只增不减的缓存；其二，多个 goroutine 读、写、覆盖互不相交的键集。

这两种用法的共同点是：稳定之后，绝大多数操作命中的键早已存在。第一代实现据此把表分成两张，
一张可以无锁读取，一张受互斥锁保护。Go 1.23 中的定义如下，注释有删节：

```go
type Map struct {
	mu Mutex

	// read contains the portion of the map's contents that are safe for
	// concurrent access (with or without mu held).
	// ……
	read atomic.Pointer[readOnly]

	// dirty contains the portion of the map's contents that require mu to be
	// held. To ensure that the dirty map can be promoted to the read map quickly,
	// it also includes all of the non-expunged entries in the read map.
	// ……
	dirty map[any]*entry

	// misses counts the number of loads since the read map was last updated that
	// needed to lock mu to determine whether the key was present.
	// ……
	misses int
}

// readOnly is an immutable struct stored atomically in the Map.read field.
type readOnly struct {
	m       map[any]*entry
	amended bool // true if the dirty map contains some key not in m.
}
```

`read` 指向一个不可变的 `readOnly`，其中的 `map` 一经发布就不再修改，任何 goroutine 都可以不加锁地读它。
`dirty` 包含 `read` 中所有未被清除的键，再加上新写入的键，只能在持有 `mu` 时访问。两张表中存放的都是
`*entry`，同一个键在两张表中指向同一个 `entry`。值存放在 `entry` 内的原子指针 `p` 中，
因此更新一个已有的键只需对 `p` 做一次原子操作，两张表同时看到新值，不必加锁。

读操作先查 `read`。命中就直接返回；未命中且 `amended` 为真，说明 `dirty` 中有 `read` 没有的键，才加锁去查
`dirty`，并记一次未命中。未命中的次数累计到 `dirty` 的大小时，`dirty` 整体提升为新的 `read`：

```go
func (m *Map) missLocked() {
	m.misses++
	if m.misses < len(m.dirty) {
		return
	}
	m.read.Store(&readOnly{m: m.dirty})
	m.dirty = nil
	m.misses = 0
}
```

注释给出了阈值的理由：未命中的次数足以抵偿复制 `dirty` 的代价时，才值得提升。提升之后 `dirty` 为空；
下一次写入新键时，`dirtyLocked` 把 `read` 浅复制一份作为新的 `dirty`。新写入的键起初只在 `dirty` 中，
读它要加锁；经过一次提升，它才进入 `read`，此后的读取都不加锁。

删除也尽量不加锁。键若在 `read` 中，删除只是把它的 `entry.p` 原子地置为 nil，键仍留在 `read` 里；键若只在
`dirty` 中，则加锁直接从 `dirty` 删除。`entry.p` 因此有三种状态：

- 正常的指针：键有效，记录在 `read` 中，`dirty` 非空时也在 `dirty` 中；
- nil：键已删除，此时 `dirty` 为空，或者 `dirty` 中仍有这个 `entry`；
- `expunged`：键已删除，`dirty` 非空，且 `dirty` 中没有这个 `entry`。

`dirtyLocked` 复制 `read` 时，把值为 nil 的 `entry` 用比较并交换改为 `expunged`，不复制进新的 `dirty`。
等这个 `dirty` 下一次被提升为 `read`，这些键才真正从 `read` 中消失。在此之前若又有人写入一个已是
`expunged` 的键，必须先在锁内把它改回 nil 并加入 `dirty`，否则通过 `dirty` 查找的读者会找不到它。nil 与
`expunged` 的区分，正是为了记住 `dirty` 中是否还有这个 `entry`。

这套设计的代价也写在其中。新键要等一次提升才进入无锁路径；每次提升之后写入第一个新键，都要把整张 `read`
复制一遍，键集不断变化时，这样的复制会反复发生；锁仍然只有一把，写操作一多，所有慢速路径又挤回 `mu` 上。
指针也很多，Mills 在 issue #21031 中指出，这种实现浪费了跟随指针的 CPU 时间，
稳态下每个键至少多占一个指针的内存 [[Mills, 2017b](#ref-mills-2017b)]。

## 11.7.3 接口与同步保证

`sync.Map` 的接口在第一代实现期间逐步扩充：

| 版本 | 新增的方法 | issue |
| --- | --- | --- |
| Go 1.9 | `Load`、`Store`、`LoadOrStore`、`Delete`、`Range` | #18177 |
| Go 1.15 | `LoadAndDelete` | #33762 |
| Go 1.20 | `Swap`、`CompareAndSwap`、`CompareAndDelete` | #51972 |
| Go 1.23 | `Clear` | #61696 |

`LoadAndDelete` 以及 `Swap`、`CompareAndSwap`、`CompareAndDelete` 由 Changkun Ou 实现
[[Ou, 2019](#ref-ou-2019)] [[Ou, 2022a](#ref-ou-2022a)]。

文档用内存模型的术语给出保证：写操作同步先于观察到其效果的读操作。哪些调用算读、哪些算写，文档逐一列明：
`Load`、`LoadAndDelete`、`LoadOrStore`、`Swap`、`CompareAndSwap` 与 `CompareAndDelete` 是读操作；
`Delete`、`LoadAndDelete`、`Store` 与 `Swap` 是写操作；`LoadOrStore` 在返回 `loaded` 为假时是写操作，
`CompareAndSwap` 与 `CompareAndDelete` 在成功时是写操作 [[Go Authors, 2026a](#ref-go-authors-2026a)]。
这段说明由 Cox 在 2022 年写入，随 Go 1.19 发布 [[Cox, 2022](#ref-cox-2022)]；Go 1.20 新增的三个方法，
其分类是 Changkun Ou 随后补上的 [[Ou, 2022b](#ref-ou-2022b)]。

`LoadOrStore` 的语义值得多看一眼：键不存在时写入给定的值，存在时返回已有的值，
二者在一次不可分割的操作中完成。每个 goroutine 都以自己的提议调用它，写入成功的只有一个，
所有调用者得到的都是同一个值。这正是 11.3.3 节所说的共识，`LoadOrStore` 与比较并交换一样，能为任意多个
goroutine 解决共识（[11.3.3](./atomic.md)）：

```go {run=true}
package main

import (
	"fmt"
	"sync"
)

func main() {
	type result struct {
		actual any
		loaded bool
	}
	var m sync.Map
	var results [8]result
	var wg sync.WaitGroup
	for id := range results {
		wg.Go(func() {
			actual, loaded := m.LoadOrStore("key", id) // 各自提议自己的编号
			results[id] = result{actual, loaded}
		})
	}
	wg.Wait()

	stored, agree := 0, true
	for _, r := range results {
		if !r.loaded {
			stored++ // loaded 为假：这次调用写入了值
		}
		agree = agree && r.actual == results[0].actual
	}
	fmt.Println("写入成功的调用：", stored)
	fmt.Println("所有调用得到同一个值：", agree)
}
```

运行结果如下：

```
写入成功的调用： 1
所有调用得到同一个值： true
```

## 11.7.4 第二代：HashTrieMap

第二代实现并非为 `sync.Map` 而写。2024 年，Michael Knyszek 为即将加入的 `unique` 包（Go 1.23）
在新的内部包 `internal/concurrent` 中加入了一个并发散列字典树 `HashTrieMap`
[[Knyszek, 2024a](#ref-knyszek-2024a)]。提交说明写道，它专为频繁成功的查找、相对少见的插入与删除而构建；
单线程下 `LoadOrStore` 的性能与加锁的 `map` 相当，`Load` 在作者机器的 24 个核上完美扩展。随后它被移到
`internal/sync`，补齐了 `sync.Map` 的全部操作。Knyszek 发现，几乎在每一项基准测试中，
`HashTrieMap[any, any]` 都比 `sync.Map` 快，于是在 Go 1.24 中把它作为 `sync.Map` 的默认实现
[[Knyszek, 2024b](#ref-knyszek-2024b)] [[Knyszek, 2024c](#ref-knyszek-2024c)]。issue #70683
列出的微基准测试中，查找多数不命中的情形快了约 27%，针对旧实现弱点构造的反复分配与反复删除的情形分别快了约
67% 与 78%；查找多数命中的情形则慢了约 7%。Go 1.24 的发布说明写道，新实现尤其改善了修改操作：
大型表上对互不相交的键集的修改不太可能再相互争用，查找也不再需要预热才能做到低争用；
遇到问题可以在构建时设置 `GOEXPERIMENT=nosynchashtriemap` 切回旧实现
[[Go Authors, 2025](#ref-go-authors-2025)]。这一开关默认开启了整整一个发布周期之后，Knyszek 在 Go 1.26
中删除了旧实现 [[Knyszek, 2025](#ref-knyszek-2025)]。

今天的 `sync.Map` 只是一层包装，每个方法都转交给 `HashTrieMap`：

```go
type Map struct {
	_ noCopy

	m isync.HashTrieMap[any, any]
}

func (m *Map) Load(key any) (value any, ok bool) {
	return m.m.Load(key)
}
```

字典树有两种节点 [[Go Authors, 2026b](#ref-go-authors-2026b)]：

```go
const (
	// 16 children. This seems to be the sweet spot for
	// load performance: any smaller and we lose out on
	// 50% or more in CPU performance. Any larger and the
	// returns are minuscule (~1% improvement for 32 children).
	nChildrenLog2 = 4
	nChildren     = 1 << nChildrenLog2
	nChildrenMask = nChildren - 1
)

// indirect is an internal node in the hash-trie.
type indirect[K comparable, V any] struct {
	node[K, V]
	dead     atomic.Bool
	mu       Mutex // Protects mutation to children and any children that are entry nodes.
	parent   *indirect[K, V]
	children [nChildren]atomic.Pointer[node[K, V]]
}

// entry is a leaf node in the hash-trie.
type entry[K comparable, V any] struct {
	node[K, V]
	overflow atomic.Pointer[entry[K, V]] // Overflow for hash collisions.
	key      K
	value    V
}
```

内部节点 `indirect` 有 16 个孩子槽，每个槽都是原子指针；叶子 `entry` 保存键和值，散列值完全相同的键用
`overflow` 串成链表。键的散列值在 64 位平台上有 64 位，每层用其中 4 位选择孩子，至多 16 层。
散列函数取自对应 `map` 类型的散列函数，每张表在初始化时还取一个随机种子，同一个键在不同的表中散列值不同，
这与内建 `map` 抵御哈希洪水的办法相同（[5.3.2](../../part2lang/ch05data/map.md)）。

查找只有原子加载：

```go
func (ht *HashTrieMap[K, V]) Load(key K) (value V, ok bool) {
	ht.init()
	hash := ht.keyHash(abi.NoEscape(unsafe.Pointer(&key)), ht.seed)

	i := ht.root.Load()
	hashShift := 8 * goarch.PtrSize
	for hashShift != 0 {
		hashShift -= nChildrenLog2

		n := i.children[(hash>>hashShift)&nChildrenMask].Load()
		if n == nil {
			return *new(V), false
		}
		if n.isEntry {
			return n.entry().lookup(key)
		}
		i = n.indirect()
	}
	panic("internal/sync.HashTrieMap: ran out of hash bits while iterating")
}
```

从根开始，每层取 4 位散列值，原子地加载对应的孩子槽：槽为空，键不存在；是叶子，就在溢出链上比较键；
是内部节点，就下降一层。读叶子的 `key` 与 `value` 不需要原子操作，因为叶子一经发布就不再修改：`Swap` 与
`CompareAndSwap` 修改一个键的值时，在锁内新建一个叶子替换旧的，而不是改写旧叶子。这与第一代不同，
所有键都走同一条无锁路径，没有「先加锁、提升之后才无锁」的预热。

写操作先用同样的方式无锁地找到位置，再锁住该位置所在的内部节点，在锁内重新检查：
槽的内容是否仍是刚才看到的，节点是否已被标记为 `dead`。检查不通过就释放锁，从根重来。以 `LoadOrStore`
插入新键为例，若目标槽为空，直接存入新叶子；若槽中已有一个别的叶子，就要向下扩展出一层或几层内部节点，
直到两个键的散列值在某一层分开。扩展出的子树先在私下建好，最后才用一次原子存储挂到槽上，注释写道：
最后发布，读者就不会看到旧叶子不在树中的中间状态。锁的范围是单个内部节点，不同子树上的写操作可以并行，
这相当于一种随着树的形状自然生长的锁分段。

删除使一个内部节点变空时，删除者在仍持有该节点锁的情况下锁住父节点，把该节点标记为 `dead`，
从父节点中摘除，再继续向上检查，使树保持紧凑。加锁的次序总是先子后父，插入等其他操作只锁一个节点，
因此不会死锁。被标记为 `dead` 的节点可能仍被并发的写者找到，所以写者在锁内检查 `dead`，发现后从根重来；
读者不检查 `dead`：被摘除的节点已经为空，读者在其中只会得到「键不存在」，与删除之后的状态一致。

与 11.7.1 节的两种字典树相比，`HashTrieMap` 沿用了 HAMT 按散列值逐段索引字典树的思路，
但每个内部节点固定有 16 个槽，不做 HAMT 的位图压缩；它的读路径无锁，写路径却对单个节点加锁，不像 CTrie
那样完全无锁；它也不提供快照，`Range` 与 `All` 的文档明确说明，遍历不一定对应表的任何一个一致快照。
这些取舍都偏向简单与读的速度。

## 11.7.5 何时使用

两代实现换了内部，文档的指引不变：多数代码应当使用普通的 `map` 加一把锁，`sync.Map`
只在它声明的两种用法下，且锁争用经测量确为瓶颈时才值得使用。新实现消除了旧实现的一些退化，
例如键集频繁变化时的整表复制与新键的预热，但它的接口仍以 `any` 为键和值，这带来两项代价。

其一是类型安全。键和值的类型无法由编译器检查，取出的值还要做类型断言。其二是分配。非指针类型的值转换为
`any` 时通常需要在堆上分配，以 `string` 为键的表，每次写入都要多一次分配；`HashTrieMap` 本身是泛型的，
`sync.Map` 却只能使用 `HashTrieMap[any, any]`。由于兼容性的约束，`sync.Map` 不能改为泛型类型。Ian Lance
Taylor 在 2025 年提出新的 `sync/v2` 包，用泛型的 `Map` 与 `Pool` 替代现有的两个类型，截至 Go 1.26
这一提案仍在讨论之中 [[Taylor, 2025](#ref-taylor-2025)]。

## 延伸阅读

- <a id="ref-bagwell-2001"></a>[Bagwell, 2001] Phil Bagwell. *Ideal Hash Trees.* EPFL Technical Report,
  2001. https://infoscience.epfl.ch/record/64398
  HAMT，散列字典树的源头。
- <a id="ref-click-2007"></a>[Click, 2007] Cliff Click. *A Fast Wait-Free HashTable.* Stanford EE380
  Computer Systems Colloquium, February 21, 2007.
  https://web.stanford.edu/class/ee380/Abstracts/070221.html
- <a id="ref-cox-2017"></a>[Cox, 2017] Russ Cox. sync: document when and when not to use Map. Go commit
  3f150934e2, 2017. https://go.dev/cl/83796
  修复 issue #21587，随 Go 1.10 发布。
- <a id="ref-cox-2022"></a>[Cox, 2022] Russ Cox. runtime, sync, sync/atomic: document happens-before
  guarantees. Go commit a71ca3dfbd, 2022. https://go.dev/cl/381316
  随 Go 1.19 发布。
- <a id="ref-go-authors-2025"></a>[Go Authors, 2025] The Go Authors. *Go 1.24 Release Notes.*
  https://go.dev/doc/go1.24
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors. *sync.Map documentation.*
  https://pkg.go.dev/sync#Map
  两类适用场景与内存模型保证的官方说明。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. *internal/sync/hashtriemap.go.* Go
  源码树。 https://github.com/golang/go/blob/master/src/internal/sync/hashtriemap.go
  本节摘录取自 Go 1.26。
- <a id="ref-knyszek-2024a"></a>[Knyszek, 2024a] Michael Anthony Knyszek. internal/concurrent: add
  HashTrieMap. Go commit fa470f6245, 2024. https://go.dev/cl/573956
  随 Go 1.23 发布。
- <a id="ref-knyszek-2024b"></a>[Knyszek, 2024b] Michael Anthony Knyszek. sync: make HashTrieMap[any, any]
  the default implementation of Map. Go commit aecb8faa91, 2024. https://go.dev/cl/608335
  随 Go 1.24 发布。
- <a id="ref-knyszek-2024c"></a>[Knyszek, 2024c] Michael Anthony Knyszek. Go issue #70683. *sync: replace
  Map implementation with HashTrieMap.* 2024. https://github.com/golang/go/issues/70683
  记录 Go 1.24 的替换及其微基准测试。
- <a id="ref-knyszek-2025"></a>[Knyszek, 2025] Michael Anthony Knyszek. sync: remove synchashtriemap
  GOEXPERIMENT. Go commit e15a14c4dd, 2025. https://go.dev/cl/690395
  随 Go 1.26 发布。
- <a id="ref-lea-nd"></a>[Lea, n.d.] Doug Lea. *Overview of package util.concurrent (ConcurrentHashMap).*
  及 JSR-166。 http://gee.cs.oswego.edu/dl/classes/EDU/oswego/cs/dl/util/concurrent/intro.html
  锁分段并发散列表的经典实现。
- <a id="ref-mills-2016a"></a>[Mills, 2016a] Bryan C. Mills. Go issue #17973. *sync: RWMutex scales poorly
  with CPU count.* 2016. https://github.com/golang/go/issues/17973
- <a id="ref-mills-2016b"></a>[Mills, 2016b] Bryan C. Mills. Go issue #18177. *sync: add a Map to replace
  RWLock+map usage.* 2016. https://github.com/golang/go/issues/18177
- <a id="ref-mills-2017"></a>[Mills, 2017] Bryan C. Mills. sync: import Map from x/sync/syncmap. Go commit
  959025c0ac, 2017. https://go.dev/cl/36617
  随 Go 1.9 发布。
- <a id="ref-mills-2017b"></a>[Mills, 2017b] Bryan C. Mills. Go issue #21031. *sync: reduce pointer
  overhead in Map.* 2017. https://github.com/golang/go/issues/21031
- <a id="ref-oracle-2011"></a>[Oracle, 2011] Oracle. ConcurrentHashMap. *Java Platform, Standard Edition 7
  API Specification*, 2011.
  https://docs.oracle.com/javase/7/docs/api/java/util/concurrent/ConcurrentHashMap.html
- <a id="ref-oracle-2014"></a>[Oracle, 2014] Oracle. ConcurrentHashMap. *Java Platform, Standard Edition 8
  API Specification*, 2014.
  https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ConcurrentHashMap.html
- <a id="ref-ou-2019"></a>[Ou, 2019] Changkun Ou. sync: add new Map method LoadAndDelete. Go commit
  2e8dbae85c, 2019. https://go.dev/cl/205899
  修复 issue #33762，随 Go 1.15 发布。
- <a id="ref-ou-2022a"></a>[Ou, 2022a] Changkun Ou. sync: add new Map method Swap, CompareAndSwap,
  CompareAndDelete. Go commit 395323c4d0, 2022. https://go.dev/cl/399094
  修复 issue #51972，随 Go 1.20 发布。
- <a id="ref-ou-2022b"></a>[Ou, 2022b] Changkun Ou. sync: document memory model for
  Swap/CompareAnd{Swap,Delete} in Map. Go commit f07910bd57, 2022. https://go.dev/cl/459715
  随 Go 1.21 发布。
- <a id="ref-prokopec-et-al-2012"></a>[Prokopec et al., 2012] Aleksandar Prokopec, Nathan G. Bronson, Phil
  Bagwell, Martin Odersky. "Concurrent Tries with Efficient Non-Blocking Snapshots." *PPoPP 2012*,
  151–160, 2012. https://doi.org/10.1145/2145816.2145836
  CTrie。
- <a id="ref-taylor-2025"></a>[Taylor, 2025] Ian Lance Taylor. Go issue #71076. *proposal: sync/v2: new
  package.* 2025. https://github.com/golang/go/issues/71076
- 本书 [5.3 散列表](../../part2lang/ch05data/map.md)、
  [5.4 Swiss Table](../../part2lang/ch05data/swisstable.md)、[11.2 互斥锁](./mutex.md)、
  [12.2 分配器组件](../../part4memory/ch12alloc/component.md)（mcentral 的「为并发而重构数据结构」
  是同一类演进）。
