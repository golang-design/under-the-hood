---
weight: 2203
title: "5.3 散列表：原理与安全"
---

# 5.3 散列表：原理与安全

`map` 是 Go 内置的散列表。它由运行时实现，编译器负责把 `m[k]` 之类的操作翻译为对 `runtime.mapaccess1`、`runtime.mapassign`
等函数的调用，实际的存储、查找与扩容都在 `internal/runtime/maps` 包中完成。Go 的 `map`
先后有过三种实现：Go 1.0 使用一种多级子表的设计；Go 1.1 起改为每桶 8 个槽位、以溢出桶相连的桶式设计；Go
1.24 起则换成了基于 Swiss Table 的开放定址实现。本节讨论散列表的一般原理，以及散列表作为攻击面的安全
问题；Go 的两代主要实现留待 [5.4](./swisstable.md) 讨论。

## 5.3.1 散列表的两条路线：链地址与开放定址

散列表要解决的基本问题，是把一个几乎无限大的键空间映射到一段有限的连续内存上。哈希函数 $h$ 把键映射为
$[0, m)$ 中的槽位下标，理想情况下只需一次访存即可定位。但这一映射不可能是单射，两个不同的键得到同一个
下标即称为**冲突**（collision）。如何安置冲突的键，形成了两条历史悠久的路线。

**链地址法**（chaining）在每个槽位上挂一条链表，冲突的键依次链接在表上。它实现简单，删除操作直接，
对哈希函数的质量也不太敏感；代价是每个元素多占一个指针，并且链表节点分散在堆上，缓存局部性较差。
记**装载因子**（load factor）$\alpha = n/m$，即元素数与槽位数之比。在简单均匀散列的假设下，
一次不成功查找平均需要比较约 $\alpha$ 个元素，一次成功查找约 $1 + \alpha/2$ 个。链地址法允许 $\alpha >
1$，性能随 $\alpha$ 线性下降 [[Knuth, 1998](#ref-knuth-1998)]。

**开放定址法**（open addressing）则把所有元素直接存放在槽位数组中，发生冲突时按某种**探测序列**（probe
sequence）寻找下一个空槽。它没有指针开销，数据连续存放，对缓存友好；但要求 $\alpha < 1$，且当 $\alpha$
趋近于 1 时性能急剧恶化。在均匀散列的假设下，一次不成功查找的平均探测次数为

$$
\frac{1}{1-\alpha}
$$

当 $\alpha = 0.9$ 时为 10，当 $\alpha = 0.99$ 时为 100。开放定址法的各种改进，都是为了抑制这条曲线的增长。

探测序列又有多种选择。**线性探测**（linear probing）依次检查 $h, h+1, h+2, \dots$，实现最简单，缓存命中率
最高，但相邻的已占用槽位会连成长段，即**一次聚集**（primary clustering），使不成功查找的平均代价升至

$$
\frac{1}{2}\left(1 + \frac{1}{(1-\alpha)^2}\right)
$$

比均匀散列下的增长更快 [[Knuth, 1998](#ref-knuth-1998)]。**二次探测**（quadratic probing）
使用步长递增的序列，例如 $h, h+1, h+3, h+6, \dots$（相邻两项之差依次为 1、2、3……），以打散聚集。**双
重散列**（double hashing）用第二个哈希函数决定步长，其表现接近均匀散列的理论曲线，
但每次查找要多计算一次哈希。**Robin Hood 散列** [[Celis et al., 1985](#ref-celis-et-al-1985)]在插入时比较
新键与现有占据者各自离理想槽位的距离：若新键的距离更大，便取代现有占据者，再为被取代者继续寻找位置，
从而减小探测距离的方差，使查找代价更可预测。这些方法的共同目标，是在保留开放定址法连续存储优势的同时抑制性
能随装载因子的恶化。Swiss Table 是这条路线上的一项重要成果（[5.4.1](./swisstable.md)）。

## 5.3.2 哈希洪水：散列表的安全问题

散列表的 $O(1)$ 是平均意义上的。在最坏情况下，若所有键都冲突到同一槽位，链地址法退化为一条链表，
开放定址法退化为线性扫描，单次操作的代价变为 $O(n)$，$n$ 次插入合计 $O(n^2)$。在多数算法分析中，
这只是一个注脚；但 Crosby 与 Wallach 在 2003 年指出，它构成一类可以被远程触发的拒绝服务漏洞
[[Crosby and Wallach, 2003](#ref-crosby-wallach-2003)]：若哈希函数固定且公开，攻击者可以离线构造大量冲突到
同一位置的键，再把它们作为 HTTP 头、JSON 字段或 POST 参数发送给服务器。服务器把这些键插入散列表时，
每次插入的代价都变为 $O(n)$，少量请求即可耗尽 CPU。这类攻击称为**哈希洪水**（hash flooding）。2011 年
12 月，Alexander Klink 与 Julian Wälde 在第 28 届混沌通信大会（28C3）上演示了这种攻击对 PHP、Java、Python、Ruby
等主流 Web 平台的影响，促使各语言相继修改了其散列表的实现
[[Klink and Wälde, 2011](#ref-klink-walde-2011)]。

防御的关键在于使攻击者无法预知哈希结果，办法是在哈希函数中加入一个由运行时随机生成、攻击者无从得知的
**种子**（seed）。不同进程中，乃至同一进程的不同散列表中，同一个键的哈希值都不相同，
离线构造冲突便失去了目标。Aumasson 与 Bernstein 在 2012 年提出的 SipHash 是专为这一用途设计的带密钥伪随机
函数，针对短输入作了优化 [[Aumasson and Bernstein, 2012](#ref-aumasson-bernstein-2012)]；Python（自 3.4
起，PEP 456 [[Heimes, 2013](#ref-heimes-2013)]）与 Rust 的标准库都以 SipHash 的变体作为默认的字符串哈希函
数。

Go 采用了同样的思路，但没有使用 SipHash。Go 1.0 的 `map` 已经为每个散列表生成一个随机种子；Go 1.1 中，Keith
Randall 引入了基于 AES 指令的哈希函数 `aeshash`，其提交说明写道，它包含一个随机密钥，
以阻止哈希冲突拒绝服务攻击 [[Randall, 2013](#ref-randall-2013)]。在 Go 1.26 中，运行时启动时由 `alginit`
根据 CPU 的能力选择哈希算法（`runtime/alg.go` [[Go Authors, 2026](#ref-go-authors-2026)]）：

```go
func alginit() {
	// 若具备所需的指令，则使用 AES 哈希算法。
	if (GOARCH == "386" || GOARCH == "amd64") &&
		cpu.X86.HasAES && // AESENC
		cpu.X86.HasSSSE3 && // PSHUFB
		cpu.X86.HasSSE41 { // PINSR{D,Q}
		initAlgAES()
		return
	}
	if GOARCH == "arm64" && cpu.ARM64.HasAES {
		initAlgAES()
		return
	}
	for i := range hashkey {
		hashkey[i] = uintptr(bootstrapRand())
	}
}
```

具备 AES 指令时，`initAlgAES` 用随机数据初始化 AES 的轮密钥，以使冲突难以被人为构造；
否则使用一个非加密哈希函数（在 64 位平台上，自 Go 1.17 起借鉴了 wyhash 的设计），并以随机的 `hashkey`
作为密钥。

除进程级的密钥之外，每个 `map` 在创建时还会生成自己的种子（`internal/runtime/maps` 中 `Map` 结构体的
`seed` 字段），同一进程中不同 `map` 的哈希值相互独立。当一个 `map` 中的元素被全部删除时，
运行时还会为它更换种子 [[Bleecher Snyder, 2018](#ref-bleecher-snyder-2018)]，使攻击者难以在同一个 `map`
上反复制造冲突。标准库的 `hash/maphash` 包对外提供了同一套哈希函数，可以直接观察种子的作用：

```go {run=true}
package main

import (
	"fmt"
	"hash/maphash"
)

func main() {
	s1, s2 := maphash.MakeSeed(), maphash.MakeSeed()
	fmt.Println(maphash.String(s1, "golang") == maphash.String(s1, "golang")) // 同一种子
	fmt.Println(maphash.String(s1, "golang") == maphash.String(s2, "golang")) // 不同种子
}
```

```
true
false
```

## 5.3.3 遍历顺序的随机化

与哈希种子相关的另一项设计，是 `map` 遍历顺序的随机化。Go 1 的发布说明写道，旧的语言规范没有规定 `map`
的遍历顺序，实际顺序在不同的硬件平台上各不相同，以致依赖遍历顺序的测试可能在一台机器上总能通过，
在另一台机器上却失败；Go 1 因此规定，即使对同一个 `map` 多次执行同样的 `for range` 循环，
元素的访问顺序也是不可预测的 [[Go Authors, 2012](#ref-go-authors-2012)]。这样一来，
依赖遍历顺序的代码会尽早出错，从而在问题扩散之前得到修正。

哈希种子本身已使顺序随进程和 `map` 而变化，运行时在每次遍历开始时还会随机选择起始位置（Go 1.26 中迭代器的
`entryOffset` 与 `dirOffset` 均取自随机数）。因此，即使在同一个进程中反复遍历同一个 `map`，顺序也会不同：

```go {run=true}
package main

import (
	"fmt"
	"strings"
)

func main() {
	m := map[int]bool{}
	for i := range 8 {
		m[i] = true
	}

	orders := map[string]bool{}
	for range 100 {
		var b strings.Builder
		for k := range m {
			fmt.Fprint(&b, k)
		}
		orders[b.String()] = true
	}
	fmt.Println(len(orders) > 1) // 同一个 map，遍历顺序不止一种
	fmt.Println(m)               // fmt 按键排序输出
}
```

```
true
map[0:true 1:true 2:true 3:true 4:true 5:true 6:true 7:true]
```

第二行输出总是有序的：自 Go 1.12 起，`fmt` 打印 `map` 时会先按键排序，以便输出可以重复
[[Go Authors, 2019](#ref-go-authors-2019)]。需要按确定顺序处理 `map` 的程序，也应当先取出键并排序，
例如使用 `slices.Sorted(maps.Keys(m))`。

哈希洪水的防御与遍历顺序的不确定性由此联系在一起：二者都要求哈希值不可预测，而 Go 进一步把这种不可预测性
作为语言规则固定下来，使程序无法依赖任何特定的顺序。

## 延伸阅读

- <a id="ref-knuth-1998"></a>[Knuth, 1998] Donald E. Knuth. *The Art of Computer Programming, Vol. 3:
  Sorting and Searching*, 2nd ed. Addison-Wesley, 1998. §6.4 "Hashing".
  https://www-cs-faculty.stanford.edu/~knuth/taocp.html
  开放定址、链地址以及装载因子与查找代价关系的经典分析。
- <a id="ref-celis-et-al-1985"></a>[Celis et al., 1985] Pedro Celis, Per-Åke Larson, J. Ian Munro. "Robin
  Hood Hashing." *26th Annual Symposium on Foundations of Computer Science (FOCS)*, 281–288, 1985.
  https://doi.org/10.1109/SFCS.1985.48
  Robin Hood 散列的原始论文。
- <a id="ref-crosby-wallach-2003"></a>[Crosby and Wallach, 2003] Scott A. Crosby, Dan S. Wallach. "Denial
  of Service via Algorithmic Complexity Attacks." *12th USENIX Security Symposium*, 2003.
  https://www.usenix.org/conference/12th-usenix-security-symposium/denial-service-algorithmic-complexity-attacks
  对散列表最坏情况被用作攻击手段的首次系统论述。
- <a id="ref-klink-walde-2011"></a>[Klink and Wälde, 2011] Alexander Klink, Julian Wälde. "Effective
  Denial of Service attacks against web application platforms." 28th Chaos Communication Congress, 2011.
  https://fahrplan.events.ccc.de/congress/2011/Fahrplan/events/4680.en.html
  促使各主流语言修改散列表实现的哈希洪水演示。
- <a id="ref-aumasson-bernstein-2012"></a>[Aumasson and Bernstein, 2012] Jean-Philippe Aumasson, Daniel J.
  Bernstein. "SipHash: a fast short-input PRF." *INDOCRYPT*, 2012.
  https://www.aumasson.jp/siphash/siphash.pdf
  专为抵御哈希洪水设计的带密钥哈希函数。
- <a id="ref-go-authors-2012"></a>[Go Authors, 2012] The Go Authors. Go 1 Release Notes, "Iterating in
  maps." https://go.dev/doc/go1
  遍历顺序随机化的缘由。
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. `runtime/alg.go` 与
  `internal/runtime/maps/map.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/alg.go
  哈希算法的选择、每个 `map` 的种子以及遍历起点的随机化。
- <a id="ref-randall-2013"></a>[Randall, 2013] Keith Randall. "runtime: faster & safer hash function." Go
  commit a5d4024139, 2013. https://go.googlesource.com/go/+/a5d4024139
  Go 1.1 引入以 AES 指令实现、带随机密钥的哈希函数。
- <a id="ref-bleecher-snyder-2018"></a>[Bleecher Snyder, 2018] Josh Bleecher Snyder. "runtime:
  opportunistically rotate map key seed." Go issue 25237, 2018. https://go.dev/issue/25237
  `map` 被清空时更换种子的讨论。
- <a id="ref-heimes-2013"></a>[Heimes, 2013] Christian Heimes. "PEP 456 – Secure and interchangeable hash
  algorithm." 2013. https://peps.python.org/pep-0456/
  Python 3.4 改以 SipHash 作为字符串与字节串的默认哈希函数。
- <a id="ref-go-authors-2019"></a>[Go Authors, 2019] The Go Authors. *Go 1.12 Release Notes*, "fmt".
  https://go.dev/doc/go1.12#fmtpkgfmt
  `fmt` 改为按键排序打印 `map`。

