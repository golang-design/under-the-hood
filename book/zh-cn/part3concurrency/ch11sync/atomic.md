---
weight: 3303
title: "11.3 原子操作"
---

# 11.3 原子操作

[11.2](./mutex.md) 中互斥锁的快速路径只是一次比较并交换。本节讨论这类操作本身：`sync/atomic`
提供哪些操作，编译器如何把它们翻译成机器指令；比较并交换为什么在各种原子操作中处于中心地位；无锁算法能
提供怎样的进展保证，又要面对哪些困难；以及 Go 为什么只提供顺序一致的原子操作，并在 Go 1.19
引入了原子类型。各个接口加入的版本见 [11.1.4](./basic.md)。

## 11.3.1 不可分割的读改写

一个操作是**原子操作**（atomic operation），是指其他 goroutine 只能观察到它执行之前或执行之后的状态，
观察不到中间状态。困难通常不在单次读或写，而在「读出、计算、写回」这样的组合：两个 goroutine 同时
执行 `x++`，可能读到同一个旧值，各自加一后写回，结果只加了一次。

`sync/atomic` 由 Russ Cox 于 2011 年加入 Go [[Cox, 2011](#ref-cox-2011)]。
包文档用等价的顺序代码说明每种读改写操作的语义，整段代码作为一个不可分割的步骤执行
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
// 交换（SwapT）
old = *addr
*addr = new
return old

// 比较并交换（CompareAndSwapT）
if *addr == old {
	*addr = new
	return true
}
return false

// 加法（AddT）
*addr += delta
return *addr
```

载入与存储（`LoadT`、`StoreT`）分别是 `return *addr` 与 `*addr = val` 的原子版本。Go 1.23 加入的
`AndT` 与 `OrT` 对 `*addr` 做按位与、按位或；与 `AddT` 不同，它们返回的是旧值。

其中最通用的是**比较并交换**（compare-and-swap，CAS）。任何「根据旧值算出新值」的更新，都可以写成一个
重试循环：读出当前值，算出新值，再用 CAS 写回；如果在此期间有其他 goroutine 修改了这个变量，CAS 失败，
循环重新读取：

```go
for {
	old := atomic.LoadInt64(&x)
	if atomic.CompareAndSwapInt64(&x, old, f(old)) {
		break
	}
}
```

这个循环不会阻塞：一个 goroutine 的 CAS 失败，说明另一个 goroutine 的 CAS 刚刚成功。竞争不激烈时，
它比加锁便宜，省去了休眠与唤醒；竞争激烈时，大量 CAS 失败，变量所在的缓存行在处理器之间来回传递，
吞吐量可能还不如一把锁。此外，系统整体虽然一直在前进，某个 goroutine 却可能一再失败，迟迟完成不了
自己的更新。这是饥饿，而不是活锁：活锁是指所有参与者都在活动却没有一个取得进展（11.3.4）。

包文档开头的提醒因此值得认真对待：这些函数需要非常小心才能正确使用；除了特殊的底层应用，同步最好
使用 channel 或 `sync` 包提供的设施 [[Go Authors, 2026a](#ref-go-authors-2026a)]。

## 11.3.2 从函数到指令

`sync/atomic` 中的函数在 Go 源码里只有声明，没有函数体；`asm.s` 中的汇编桩直接跳转到运行时的
`internal/runtime/atomic` 包。不过在常规构建中，这些桩并不会被调用。编译器把 `sync/atomic` 的函数
登记为 `internal/runtime/atomic` 中对应函数的别名，而后者是编译器的内建函数（intrinsic），调用处直接
展开成指令 [[Go Authors, 2026b](#ref-go-authors-2026b)]：

```go
// cmd/compile/internal/ssagen/intrinsics.go
	/******** sync/atomic ********/

	// Note: these are disabled by flag_race in findIntrinsic below.
	alias("sync/atomic", "LoadInt32", "internal/runtime/atomic", "Load", all...)
	alias("sync/atomic", "LoadInt64", "internal/runtime/atomic", "Load64", all...)
	// ……
```

注释中的例外是竞态检测器：以 `-race` 构建时，这些调用不展开，而是进入运行时为竞态检测准备的版本，
由检测器把原子操作记为同步事件（[11.9](./mem.md)）。

用 Go 1.26 编译五个只包含单个原子操作的函数，`-gcflags=-S` 输出中的关键指令如下（`int64` 版本）：

| 操作 | amd64 | arm64（默认） |
| --- | --- | --- |
| `LoadInt64` | `MOVQ` | `LDAR` |
| `StoreInt64` | `XCHGQ` | `STLR` |
| `AddInt64` | `LOCK XADDQ` | `LDADDALD`，或 `LDAXR`/`STLXR` 循环 |
| `CompareAndSwapInt64` | `LOCK CMPXCHGQ` | `CASALD`，或 `LDAXR`/`STLXR` 循环 |
| `OrInt64` | `LOCK CMPXCHGQ` 循环 | `LDORALD`，或 `LDAXR`/`STLXR` 循环 |

amd64 一列有一处不对称：原子载入只是普通的 `MOVQ`，原子存储却用了 `XCHGQ`。x86 的内存模型只允许一种
重排，即写入暂存在存储缓冲中时，后面的读可以先完成（[11.9](./mem.md)）。原子载入因此不需要额外的指令；
原子存储则必须阻止后面的读越过它，而带内存操作数的 `XCHG` 自动具有 `LOCK` 语义，相当于一道完整的内存屏障。
`OrInt64` 用的是循环，因为 x86 的 `LOCK OR` 不返回旧值；如果调用者丢弃返回值，Go 1.24 起编译器会
改用一条 `LOCK ORQ` [[Randall, 2024](#ref-randall-2024)]。

arm64 一列取决于处理器是否支持 ARMv8.1 的大系统扩展（Large System Extensions，LSE）。ARMv8.0 只有
独占载入与独占存储这一对指令（load-linked/store-conditional，LL/SC），读改写操作要写成循环；LSE 才提供了
单条的原子加法与比较并交换。默认构建在每个调用处检查运行时变量 `arm64HasATOMICS`，两条路径都生成：

```asm
	MOVBU	runtime.arm64HasATOMICS(SB), R3
	TBZ	$0, R3, 32           // 不支持 LSE 时，跳到偏移 32 处的循环
	MOVD	R1, R27
	CASALD	R27, (R0), R2        // ARMv8.1：一条指令完成比较并交换
	CMP	R1, R27
	CSET	EQ, R3
	JMP	56
	LDAXR	(R0), R27            // ARMv8.0：独占载入
	CMP	R1, R27
	BNE	52
	STLXR	R2, (R0), R27        // 独占存储；独占载入之后若有其他核心写过该地址，则失败
	CBNZ	R27, 32              // 失败则重试
	CSET	EQ, R3
	MOVD	R3, R0
	RET
```

以 `GOARM64=v8.1` 构建时，检查与循环都被省去，只剩 `CASALD`。由此可见，原子操作并不总是一条指令：
在没有 LSE 的处理器上，它本身就是 11.3.1 那样的重试循环，只是写在了硬件指令层面。

## 11.3.3 共识层级

载入与存储也是原子的，为什么无锁算法离不开比较并交换？Herlihy 用**共识数**（consensus number）回答了
这个问题 [[Herlihy, 1991](#ref-herlihy-1991)]。

在共识问题中，$n$ 个进程各自提出一个值，最后都要决定一个值，并且满足两个条件：所有进程的决定相同
（一致性），决定的值是某个进程提出过的（有效性）。此外，协议必须是**无等待**的（wait-free）：无论其他
进程运行多快，甚至停止运行，每个进程都在自己的有限步内完成。一种共享对象能为多少个进程解决无等待共识，
其中最大的 $n$ 就是它的共识数；没有上限时，共识数为无穷。共识数刻画了一种原语的同步能力：如果 $X$ 的
共识数是 $n$，$Y$ 的共识数 $m$ 小于 $n$，那么在多于 $m$ 个进程的系统中，无法用 $Y$ 构造出 $X$ 的无等待实现
（定理 1）。

```mermaid
flowchart LR
    RW["读写寄存器<br/>共识数 1"] --> RMW["测试并设置、交换、取后加<br/>FIFO 队列、栈<br/>共识数 2"]
    RMW --> CAS["比较并交换<br/>共识数 ∞"]
```

读写寄存器的共识数是 1（定理 2），连两个进程都无法达成共识。证明从一个关键状态入手：此时两个进程
各自的下一步都会把结果确定下来，P 的一步导向决定 $x$，Q 的一步导向决定 $y$。逐一检查这两步可能是什么：
如果其中一步是读，它只改变读者自己的状态，另一个进程无从察觉，单独运行下去会得出同样的决定；如果两步
写的是不同的寄存器，先后次序不影响结果状态；如果写的是同一个寄存器，后写的覆盖了先写的，先写者留下的
痕迹被抹去。每种情况下，总有一个进程无法区分「对方先走」与「自己先走」，矛盾。

非平凡的读改写操作至少能解决两个进程的共识（定理 3）：两个进程各自先登记自己的提议，再对同一个
寄存器做一次读改写，看到初值的一方就是先到者。但测试并设置、交换与取后加止步于 2（定理 4）。这类
操作两两之间要么可交换（两次取后加的结果与次序无关），要么后者覆盖前者（两次交换）：第三个进程看到的
结果，或者不反映次序，或者只反映最后一次操作。FIFO 队列也是如此（定理 7），栈、双端队列与优先队列只需
对证明稍作改动。

比较并交换的共识数是无穷（定理 5）。协议只有一步：寄存器初始为空，每个进程尝试把空值换成自己的
提议，成功者的提议就是决定。寄存器一旦非空就不再改变，后来者的 CAS 全部失败，但不会抹去先到者留下的值。
Herlihy 指出，这个协议显然是无等待的，因为它没有循环。下面的程序就是这个协议，8 个 goroutine 重复
1000 轮：

```go {run=true}
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

// decide 是 Herlihy 的比较并交换共识协议：没有循环，每个 goroutine 都在常数步内完成。
func decide(cell *atomic.Pointer[int], proposal *int) int {
	cell.CompareAndSwap(nil, proposal) // 只有第一个成功；此后 cell 不再改变
	return *cell.Load()
}

func main() {
	const n, rounds = 8, 1000
	good := 0
	for range rounds {
		var cell atomic.Pointer[int]
		decisions := make([]int, n)
		var wg sync.WaitGroup
		for i := range n {
			wg.Go(func() {
				proposal := 100 + i // 每个 goroutine 提议一个不同的值
				decisions[i] = decide(&cell, &proposal)
			})
		}
		wg.Wait()

		agreed := true // 一致性：所有 goroutine 的决定相同
		for _, d := range decisions {
			agreed = agreed && d == decisions[0]
		}
		valid := 100 <= decisions[0] && decisions[0] < 100+n // 有效性：决定是某个提议
		if agreed && valid {
			good++
		}
	}
	fmt.Printf("%d 轮中，%d 个 goroutine 的决定一致且有效的轮数：%d\n", rounds, n, good)
}
```

运行结果如下：

```
1000 轮中，8 个 goroutine 的决定一致且有效的轮数：1000
```

Herlihy 进一步证明，共识数为 $n$ 的对象在不超过 $n$ 个进程的系统中是通用的（universal）：任何顺序
对象都能用它构造出无等待的实现。构造的思路是把对象表示为一条操作日志，各进程就「下一个操作是谁的」
反复达成共识。比较并交换因此对任意多个进程都是通用的。不过这一构造需要 $O(n^3)$ 个存储单元，是可行性
的证明，而不是实用的设计；实用的无锁数据结构仍要针对具体的数据类型逐一设计。ARM 的 LL/SC 指令对
同样能实现比较并交换，11.3.2 中的循环就是例子。

这些结论有一个前提：无等待。[11.2.1](./mutex.md) 提到，Lamport 的面包店算法只用读写就解决了互斥，
这与定理 2 并不矛盾，因为互斥允许等待：一个进程停在临界区里，其他进程就一直等下去。消息传递也是如此。
Herlihy 由定理 7 推出，只通过 FIFO 队列通信的消息传递体系结构无法解决三个进程的共识；但 Go 的 channel
会阻塞，它的实现本身也用了锁（[10.6](../ch10chan/lockfree.md)）。共识层级衡量的，是不允许等待时
一种原语能做到什么。

## 11.3.4 进展条件

**无锁**（lock-free）这个词常被用来指「不用锁」，但它的准确含义是一种进展保证。Herlihy 与 Shavit
把并发对象的进展条件分为几档 [[Herlihy and Shavit, 2008](#ref-herlihy-shavit-2008)]：

| 进展条件 | 保证 | 例子 |
| --- | --- | --- |
| 阻塞 | 一个线程在临界区内停顿，其他线程随之等待 | `sync.Mutex`、channel |
| 无阻碍（obstruction-free） | 单独运行的线程在有限步内完成 | Herlihy 等人的双端队列 |
| 无锁（lock-free） | 总有某个线程在有限步内完成 | CAS 重试循环、Treiber 栈 |
| 无等待（wait-free） | 每个线程都在有限步内完成 | 11.3.3 的共识协议 |

后三档统称非阻塞（nonblocking）：任何线程的延迟或失败都不会阻止其他线程前进。
**无阻碍**（obstruction-free）是其中最弱的一档，由 Herlihy、Luchangco 与 Moir 提出：
只要一个线程最终能单独运行（其他线程都不执行步骤），它就能取得进展
[[Herlihy et al., 2003](#ref-herlihy-et-al-2003)]。多个线程同时运行时，它们可能反复使彼此的操作失败，
这就是活锁。无锁排除了活锁，但只保证系统整体前进，不保证每个线程前进；Herlihy 等人的说法是，
饥饿在原理上可能发生，只是在实践中很少出现。无等待则连饥饿也排除了。11.3.1 的 CAS 循环是无锁的，
而不是无等待的。

进展条件是算法的性质，而不是所用指令的性质。`sync.Mutex` 建立在原子操作之上，但一个 goroutine
在持有锁时被换下，其他 goroutine 就只能等待，所以它是阻塞的。最早的无锁数据结构之一是 Treiber 栈
[[Treiber, 1986](#ref-treiber-1986)]：栈顶是一个指针，压栈与弹栈都是 11.3.1 那样的 CAS 循环（代码见
11.3.5 的例子）。Michael 与 Scott 后来给出了非阻塞与阻塞两种并发队列算法
[[Michael and Scott, 1996](#ref-michael-scott-1996)]，Java 的 `ConcurrentLinkedQueue`
就基于其中的无锁队列 [[Oracle, 2023](#ref-oracle-2023)]。

## 11.3.5 ABA 与内存回收

CAS 只比较值，不知道值在此期间经历过什么。如果一个变量从 A 变成 B，又变回 A，CAS 会认为它没有被修改过。
这就是 **ABA 问题**。下面的程序在 Treiber 栈上演示它。为了让结果确定，程序在单个 goroutine 中按顺序
执行两个线程（甲、乙）的步骤，模拟一种可能的交错：

```go {run=true}
package main

import (
	"fmt"
	"strings"
	"sync/atomic"
)

type node struct {
	name string
	next *node
}

// stack 是 Treiber 栈。
type stack struct{ top atomic.Pointer[node] }

func (s *stack) push(n *node) {
	for {
		old := s.top.Load()
		n.next = old
		if s.top.CompareAndSwap(old, n) {
			return
		}
	}
}

func (s *stack) pop() *node {
	for {
		old := s.top.Load()
		if old == nil {
			return nil
		}
		if s.top.CompareAndSwap(old, old.next) {
			return old
		}
	}
}

func (s *stack) String() string {
	var names []string
	for n := s.top.Load(); n != nil; n = n.next {
		names = append(names, n.name)
	}
	return "[" + strings.Join(names, " ") + "]"
}

func main() {
	var s stack
	s.push(&node{name: "C"})
	s.push(&node{name: "B"})
	s.push(&node{name: "A"})
	fmt.Printf("初始的栈：%s\n", s.String())

	// 甲执行 pop 的前半段：读到栈顶 A 及其后继 B，随后被挂起。
	old := s.top.Load()
	next := old.next

	// 乙在此期间弹出 A 与 B，再把同一个节点 A 压回。
	a, b := s.pop(), s.pop()
	s.push(a)
	fmt.Printf("乙弹出 %s、%s，再压回 %s：%s\n", a.name, b.name, a.name, s.String())

	// 甲恢复执行：栈顶仍是 A，比较并交换成功。
	ok := s.top.CompareAndSwap(old, next)
	fmt.Printf("甲的比较并交换成功：%v；栈：%s\n", ok, s.String())
}
```

运行结果如下：

```
初始的栈：[A B C]
乙弹出 A、B，再压回 A：[A C]
甲的比较并交换成功：true；栈：[B C]
```

甲的 CAS 把栈顶设为它早先读到的 B，而 B 已经被乙弹出：它此时既在乙的手中，又回到了栈里。

在手动管理内存的语言中，ABA 更常见的来源是内存复用：节点 A 被弹出后释放，分配器又把同一块内存分给了
一个新节点，CAS 比较地址时无法分辨新旧。Go 的垃圾回收器消除了这种情况：只要甲还持有指向 A 的指针，
A 就不会被回收，更不会被重新分配。但上面的程序说明，垃圾回收不能消除程序自己复用节点造成的 ABA。

对付 ABA 的第一类办法是给指针附加一个计数，每次修改都递增，CAS 同时比较指针与计数。运行时的无锁栈
`lfstack` 就这样做 [[Go Authors, 2026c](#ref-go-authors-2026c)]，它由 Dmitry Vyukov 在 2012 年为
并行垃圾回收编写 [[Vyukov, 2012](#ref-vyukov-2012)]：

```go
func (head *lfstack) push(node *lfnode) {
	node.pushcnt++
	new := lfstackPack(node, node.pushcnt)
	for {
		old := atomic.Load64((*uint64)(head))
		node.next = old
		if atomic.Cas64((*uint64)(head), old, new) {
			break
		}
	}
}
```

`lfstackPack` 把指针与推入计数合成一个 64 位字：在 64 位平台上，计数存放在地址用不到的高位与节点对齐所空出
的低位；在 32 位平台上，指针与计数各占一半。运行时之所以需要这个计数，是因为它放弃了垃圾回收的保护：
`lfstack` 不保留垃圾回收器可见的指针，节点必须分配在 Go 堆之外，`lfnodeValidate` 在节点来自堆时直接报错。
计数的位数有限（64 位平台上只有十几到二十几位），终究会回绕；但要让它恰好回到原值，
同一个节点必须在一次读与 CAS 之间被推入至少 $2^{16}$ 次，实践中可以忽略。

第二类办法回答一个更一般的问题：一个节点从数据结构中移除之后，何时才能安全地释放？此时可能还有线程
持有它的指针。

- **危险指针**（hazard pointer）：每个线程把自己即将访问的指针登记在一个公共位置，回收者在释放节点前
  检查这些登记，被登记的节点推迟释放 [[Michael, 2004](#ref-michael-2004)]。
- **纪元回收**（epoch-based reclamation）：维护一个全局纪元，被移除的节点按纪元放入待回收列表；当所有
  线程都观察到当前纪元时，两个纪元之前的列表就可以安全释放 [[Fraser, 2004](#ref-fraser-2004)]。
- **读-复制-更新**（read-copy-update，RCU）：读者不做任何同步，写者复制并修改数据后替换指针，旧版本推迟到
  所有线程都经过一次静止状态之后才释放 [[McKenney and Slingwine, 1998](#ref-mckenney-slingwine-1998)]。

对 Go 的用户代码而言，垃圾回收器就是这样一种回收方案。运行时自己的堆外结构则不能依赖它，
一种办法是干脆不释放：span 集合（spanSet）的索引数组从不归还，注释给出的理由正是可能还有并发的无锁访问
[[Go Authors, 2026d](#ref-go-authors-2026d)]。

Go 中的无锁结构都是实现细节，没有作为通用数据结构导出。除了 `lfstack`（用于垃圾回收的工作缓冲区等），
还有每个 P 的本地运行队列：只有所属的 P 向其中放入 G，窃取者用 CAS
从中取出（[9.2.2](../ch09sched/steal.md)）；`sync.Pool` 中的 `poolDequeue` 是固定大小、
单生产者多消费者的无锁队列（[11.6](./pool.md)）；Go 1.24 起 `sync.Map` 底层的散列字典树读路径无锁，
写路径对单个内部节点加锁（[11.7](./map.md)）。

## 11.3.6 顺序一致

原子操作除了不可分割，还关系到其他内存访问的可见性。Go 1.19 修订的内存模型规定
[[Go Authors, 2022](#ref-go-authors-2022)]：

> `sync/atomic` 包中的 API 统称为「原子操作」，可用于同步不同 goroutine 的执行。如果原子操作 A 的效果
> 被原子操作 B 观察到，那么 A 同步先于 B。程序中执行的所有原子操作，表现得如同按某种顺序一致的次序
> 执行。

由同步先于关系可以推出先行发生关系（[11.9](./mem.md)）：一个 goroutine 在原子存储之前的普通写入，
对通过原子载入观察到这次存储的 goroutine 可见。用 `atomic.Pointer` 发布一个构造好的对象，依靠的正是
这一点。后半句的顺序一致则要求所有原子操作排成一个全序，与各 goroutine 的程序次序相容。内存模型指出，
这与 C++ 的顺序一致原子操作和 Java 的 `volatile` 变量语义相同。

这条规定写进内存模型用了九年。2013 年 3 月，Cox 提出议题，指出内存模型与 `sync/atomic` 的文档都没有说明
原子操作提供什么保证，并认为这些保证「当然应该尽可能弱」[[Cox, 2013](#ref-cox-2013)]。Vyukov 随即反问
为什么要尽可能弱，因为弱原子操作很难用来编程，并在随后的评论中指出，顺序一致最容易定义，也最容易理解和解释
[[Vyukov, 2013](#ref-vyukov-2013)]。2021 年，Cox 在关于更新 Go 内存模型的文章中采纳了这一立场
[[Cox, 2021](#ref-cox-2021)]，议题于 2022 年随 Go 1.19 关闭。

文章给出了不提供获取/释放（acquire/release）语义的两个理由。其一，程序常常需要推断多个变量上原子操作的
相对次序：`sync.WaitGroup` 的旧实现用两个原子变量分别记录计数与等待者数目，运行时的信号量同样依赖
信号量的值与等待者计数两个原子变量（[11.2](./mutex.md)）。只用获取/释放语义，这样的程序即使没有数据竞争，
也不再表现为顺序一致，很难推理。其二，硬件正在缩小两者的差距：ARMv8 的 `LDAR` 与 `STLR` 既用于实现
顺序一致的原子操作，也是获取/释放语义的推荐实现（11.3.2 的 arm64 一列正是这两条指令）。如果 Go 只承诺
获取/释放语义，在 ARMv8 上写出的程序可能在不知不觉中依赖了更强的次序，换到更弱的平台上才出错。
同样的理由也使 Go 没有另外提供一套获取/释放的接口。至于不参与同步的原子操作（C++ 与 Rust 中的
relaxed），文章认为在缺乏证据时不应加入，并说明了需要的证据：在实际程序中普遍适用，且在广泛使用的
系统上带来显著的性能提升。

| 语言 | 原子操作可选的内存序 |
| --- | --- |
| C/C++11 | `relaxed`、`consume`、`acquire`、`release`、`acq_rel`、`seq_cst`，默认 `seq_cst` |
| Java 9 起 | `VarHandle` 的 Plain、Opaque、Release/Acquire、Volatile 四种模式 [[Lea, 2018](#ref-lea-2018)] |
| Rust | `Relaxed`、`Release`、`Acquire`、`AcqRel`、`SeqCst` |
| Go | 仅顺序一致 |

顺序一致的代价落在哪些指令上，取决于硬件：在 amd64 上是原子存储所用的 `XCHG`，在 arm64 上是 `LDAR`
与 `STLR`。

## 11.3.7 原子类型

函数形式的接口有一个根本的缺陷。Cox 在同一篇文章中指出，要消除对同一块内存的数据竞争，所有访问都必须
是原子的：原子写与普通读并发，或者普通写与原子读并发，仍然是数据竞争。因此，一个值是否应当以原子方式
访问，是这个值的性质，而不是某一次访问的性质 [[Cox, 2021](#ref-cox-2021)]。Java 的 `volatile int` 与
C++ 的 `atomic<int>` 都把这一信息放进类型；Go 的 `atomic.AddInt64(&x, 1)` 则不能阻止别处写 `x++`。

Cox 随后提出了原子类型的提案，随 Go 1.19 发布：`Bool`、`Int32`、`Int64`、`Uint32`、`Uint64`、`Uintptr`
与 `Pointer[T]` [[Cox, 2022a](#ref-cox-2022a)]。提案解释了为什么不用一个泛型的 `atomic.Val[T]`：
不同类型需要不同的方法集合（`Bool` 与 `Pointer[T]` 不应有 `Add`），而当时无法写出一个同时容纳指针与
各种整数的约束；即使写得出，`atomic.Val[int32]` 也不如 `atomic.Int32` 好用。以 `Int64` 为例
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
// An Int64 is an atomic int64. The zero value is zero.
//
// Int64 must not be copied after first use.
type Int64 struct {
	_ noCopy
	_ align64
	v int64
}

// Add atomically adds delta to x and returns the new value.
func (x *Int64) Add(delta int64) (new int64) { return AddInt64(&x.v, delta) }
```

三个字段各有用途。`v` 不导出，包外只能通过方法访问它，普通访问在编译期就被排除了。`noCopy` 实现了空的
`Lock` 与 `Unlock` 方法，使 `go vet` 的 copylocks 检查能发现首次使用后的复制。`align64` 解决的是
32 位平台的对齐问题：包文档的 BUG 一节写明，在 ARM、386 与 32 位 MIPS 上，
调用者必须自行保证以原子方式访问的 64 位字按 64 位对齐；可以依赖按 64 位对齐的，只有分配的结构体、
数组或切片中的第一个字，以及全局变量或局部变量中的第一个字。结构体中的 `int64` 字段是否对齐，
取决于它前面的字段，同一份代码可能在 amd64 上正常，在 32 位 ARM 上崩溃。`align64` 是一个空结构体，
编译器在计算结构体布局时识别 `sync/atomic` 与 `internal/runtime/atomic` 中这个名字，
把整个类型的对齐要求提高到 8 字节；文件中的注释特意说明，它被复制到其他包中就不会生效。
运行时自己的原子类型也在同一版本中改用了它 [[Knyszek, 2022](#ref-knyszek-2022)]。

`Pointer[T]` 的第一个字段来自 Go 1.20 的两次修改：

```go
type Pointer[T any] struct {
	// Mention *T in a field to disallow conversion between Pointer types.
	// See go.dev/issue/56603 for more details.
	// Use *T, not T, to avoid spurious recursive type definition errors.
	_ [0]*T

	_ noCopy
	v unsafe.Pointer
}
```

最初的定义中没有出现 `T`，于是 `atomic.Pointer[A]` 与 `atomic.Pointer[B]` 的底层类型相同，可以直接相互
转换，等于不经 `unsafe` 就把 `*A` 当成了 `*B`。议题 #56603 给出的程序借此写越了界，导致段错误。修复时先
加入了零长度的 `[0]T` 字段 [[Poliwczak, 2022](#ref-poliwczak-2022)]，却使 `type List struct { Next
atomic.Pointer[List] }` 这样的链表定义报告「无效的递归类型」；Cox 随后把它改成 `[0]*T`，就像字段类型写成
`*List` 时递归是合法的一样 [[Cox, 2022b](#ref-cox-2022b)]。

`atomic.Value` 早在 Go 1.4 就已加入，由 Vyukov 编写，用于写时复制的惯用法：写者构造一份新的数据，用
`Store` 整体替换；读者用 `Load` 取得某个完整的版本，不会看到修改到一半的状态
[[Vyukov, 2014](#ref-vyukov-2014)]。提交说明中的基准测试显示，读操作随处理器数增加而扩展：1、2、
4 个处理器时每次读分别为 21.7、8.63 与 4.33 ns。

`Value` 内部存放一个 `any`，即类型指针与数据指针两个字（[4.2](../../part2lang/ch04type/interface.md)），
而一次原子操作只能写一个字。首次 `Store` 需要先后写入两个字，`Value` 用一个特殊的标记处理这段过渡：

```go
func (v *Value) Store(val any) {
	// ……
	for {
		typ := LoadPointer(&vp.typ)
		if typ == nil {
			// Attempt to start first store.
			// Disable preemption so that other goroutines can use
			// active spin wait to wait for completion.
			runtime_procPin()
			if !CompareAndSwapPointer(&vp.typ, nil, unsafe.Pointer(&firstStoreInProgress)) {
				runtime_procUnpin()
				continue
			}
			// Complete first store.
			StorePointer(&vp.data, vlp.data)
			StorePointer(&vp.typ, vlp.typ)
			runtime_procUnpin()
			return
		}
		if typ == unsafe.Pointer(&firstStoreInProgress) {
			// First store in progress. Wait.
			// Since we disable preemption around the first store,
			// we can wait with active spinning.
			continue
		}
		// ……
	}
}
```

首次写入的 goroutine 用 CAS 把类型字从空设为 `firstStoreInProgress` 的地址，再依次写入数据字与类型字。
读者在 `Load` 中看到空值或这个标记时，返回 `nil`，好像还没有写入过。与之竞争的写者则自旋等待；
`runtime_procPin` 禁止首次写入者在这段时间被抢占，自旋因而很快结束。首次写入之后，类型字不再改变，
每次 `Store` 只需原子地替换数据字，类型不一致时引发 panic。Go 1.17 又为它加入了 `Swap` 与
`CompareAndSwap`。

有了 `Pointer[T]` 之后，存放指针的场合通常不再需要 `Value`：`Pointer[T]` 有静态类型，
读取时不需要类型断言。`Value` 适合值的具体类型在运行时才确定、但首次存储后保持不变的场合。

## 延伸阅读

- <a id="ref-cox-2011"></a>[Cox, 2011] Russ Cox. sync/atomic: new package. Go commit 22eab1f5c7, 2011.
  https://github.com/golang/go/commit/22eab1f5c78bb432b951426175b01c9bf97241f3
- <a id="ref-cox-2013"></a>[Cox, 2013] Russ Cox. Go issue #5045. *doc: define how sync/atomic interacts
  with memory model.* 2013. https://github.com/golang/go/issues/5045
  2022 年 7 月随 Go 1.19 的内存模型修订关闭。
- <a id="ref-cox-2021"></a>[Cox, 2021] Russ Cox. Updating the Go Memory Model (Memory Models, Part 3).
  research!rsc, 12 July 2021. https://research.swtch.com/gomm
- <a id="ref-cox-2022a"></a>[Cox, 2022a] Russ Cox. Go proposal #50860. *sync/atomic: add typed atomic
  values.* 2022. https://github.com/golang/go/issues/50860
  原子类型的动机与设计，以及不采用泛型 `atomic.Val[T]` 的理由；实现见 CL 381317，随 Go 1.19 发布。
- <a id="ref-cox-2022b"></a>[Cox, 2022b] Russ Cox. sync/atomic: allow linked list of atomic pointers
  again. Go commit b14cf3d93a, 2022. https://go.dev/cl/450655
  随 Go 1.20 发布。
- <a id="ref-fraser-2004"></a>[Fraser, 2004] Keir Fraser. *Practical Lock-Freedom.* Technical Report
  UCAM-CL-TR-579, University of Cambridge Computer Laboratory, 2004. https://doi.org/10.48456/tr-579
  5.2.3 节为纪元回收。
- <a id="ref-go-authors-2022"></a>[Go Authors, 2022] The Go Authors. *The Go Memory Model* (Version of
  June 6, 2022)：Atomic Values. https://go.dev/ref/mem
  `sync/atomic` 的顺序一致承诺。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors.
  *src/sync/atomic/doc.go、type.go、 value.go.* https://github.com/golang/go/tree/master/src/sync/atomic
  `align64`/`noCopy`/`Pointer[T]` 的实现；issue #56603 的 `[0]*T` 防转换技巧。
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors. src/cmd/compile/internal/ssagen/
  intrinsics.go. Go 1.26 源码.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/compile/internal/ssagen/intrinsics.go
- <a id="ref-go-authors-2026c"></a>[Go Authors, 2026c] The Go Authors. src/runtime/lfstack.go. Go 1.26
  源码. https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/lfstack.go
- <a id="ref-go-authors-2026d"></a>[Go Authors, 2026d] The Go Authors. src/runtime/mspanset.go. Go 1.26
  源码. https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/mspanset.go
- <a id="ref-herlihy-1991"></a>[Herlihy, 1991] Maurice Herlihy. "Wait-Free Synchronization." *ACM
  Transactions on Programming Languages and Systems*, 13(1): 124–149, 1991.
  https://doi.org/10.1145/114005.102808
  共识层级；读写寄存器的共识数为 1，比较并交换为无穷；通用构造。
- <a id="ref-herlihy-et-al-2003"></a>[Herlihy et al., 2003] Maurice Herlihy, Victor Luchangco, Mark Moir.
  "Obstruction-Free Synchronization: Double-Ended Queues as an Example." *Proceedings of the 23rd
  International Conference on Distributed Computing Systems (ICDCS)*, 522–529, 2003.
  https://doi.org/10.1109/ICDCS.2003.1203503
- <a id="ref-herlihy-shavit-2008"></a>[Herlihy and Shavit, 2008] Maurice Herlihy, Nir Shavit. *The Art of
  Multiprocessor Programming.* Morgan Kaufmann, 2008（修订版 2020）。
  无阻碍、无锁、无等待等进展条件；Treiber 栈与无锁数据结构。
- <a id="ref-knyszek-2022"></a>[Knyszek, 2022] Michael Anthony Knyszek. runtime/internal/atomic: align
  64-bit types to 8 bytes everywhere. Go commit 0f715f1ac9, 2022. https://go.dev/cl/404096
  随 Go 1.19 发布。
- <a id="ref-lea-2018"></a>[Lea, 2018] Doug Lea. Using JDK 9 Memory Order Modes. 2018.
  https://gee.cs.oswego.edu/dl/html/j9mm.html
- <a id="ref-mckenney-slingwine-1998"></a>[McKenney and Slingwine, 1998] Paul E. McKenney, John D.
  Slingwine. "Read-Copy Update: Using Execution History to Solve Concurrency Problems." *Parallel and
  Distributed Computing and Systems*, 509–518, 1998.
  http://www.rdrop.com/users/paulmck/RCU/rclockpdcsproof.pdf
- <a id="ref-michael-2004"></a>[Michael, 2004] Maged M. Michael. "Hazard Pointers: Safe Memory Reclamation
  for Lock-Free Objects." *IEEE Transactions on Parallel and Distributed Systems*, 15(6): 491–504, 2004.
  https://doi.org/10.1109/TPDS.2004.8
  ABA 与安全内存回收。
- <a id="ref-michael-scott-1996"></a>[Michael and Scott, 1996] Maged M. Michael, Michael L. Scott.
  "Simple, Fast, and Practical Non-Blocking and Blocking Concurrent Queue Algorithms." *Proceedings of the
  15th ACM Symposium on Principles of Distributed Computing (PODC)*, 267–275, 1996.
  https://doi.org/10.1145/248052.248106
  Michael-Scott 无锁队列。
- <a id="ref-oracle-2023"></a>[Oracle, 2023] Oracle. ConcurrentLinkedQueue. *Java SE 21 & JDK 21 API
  Specification*, 2023.
  https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentLinkedQueue.html
- <a id="ref-poliwczak-2022"></a>[Poliwczak, 2022] Mateusz Poliwczak. sync/atomic: disallow type
  conversions of atomic.Pointer[T]. Go commit 6bead8f77a, 2022. https://go.dev/cl/448275
  修复 issue #56603，随 Go 1.20 发布。
- <a id="ref-randall-2024"></a>[Randall, 2024] Keith Randall. cmd/compile: make sync/atomic AND/OR
  operations intrinsic on amd64. Go commit c18ff29295, 2024. https://go.dev/cl/594738
  随 Go 1.24 发布。
- <a id="ref-treiber-1986"></a>[Treiber, 1986] R. Kent Treiber. *Systems Programming: Coping with
  Parallelism.* IBM Research Report RJ 5118, 1986.
  最早的无锁栈，CAS 重试循环的原型。
- <a id="ref-vyukov-2012"></a>[Vyukov, 2012] Dmitriy Vyukov. runtime: add lock-free stack. Go commit
  a5dc7793c0, 2012. https://github.com/golang/go/commit/a5dc7793c0fba8d6c81098248a4fc2e8b0ddad34
  从并行垃圾回收的修改中拆出，随 Go 1.1 发布。
- <a id="ref-vyukov-2013"></a>[Vyukov, 2013] Dmitry Vyukov. Comment on golang/go#5045, 2013.
  https://github.com/golang/go/issues/5045#issuecomment-66076281
  2013 年 3 月 14 日至 15 日的几条评论主张原子操作采用顺序一致语义。
- <a id="ref-vyukov-2014"></a>[Vyukov, 2014] Dmitriy Vyukov. sync/atomic: add Value. Go commit 98a1e207e2,
  2014. https://github.com/golang/go/commit/98a1e207e29359dba86769877021838bb77b12c3
  随 Go 1.4 发布。
- 本书 [11.2 互斥锁](./mutex.md)、[11.9 内存一致模型](./mem.md)、
  [4.2 接口](../../part2lang/ch04type/interface.md)。
