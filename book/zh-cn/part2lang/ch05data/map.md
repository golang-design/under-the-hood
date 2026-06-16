---
weight: 2203
title: "5.3 散列表：原理与安全"
---

# 5.3 散列表：原理与安全

> 本节内容对标 Go 1.26。Go 的 `map` 在 2024 年随 Go 1.24 完成了一次罕见的彻底重写，
> 从沿用十四年的经典桶式散列表换成了基于 Swiss Table 的实现。本节先讲清散列表的一般原理
> 与攻防，重写的来龙去脉留到 [5.4](./swisstable.md) 专门交代。

`map` 是 Go 仅有的两种泛型容器之一（另一种是 slice）。它由运行时实现、编译器辅助布局，
本质是一张散列表。读者写下 `m[k]` 时，编译器把它翻译成对 `runtime.mapaccess`、
`runtime.mapassign` 一族函数的调用，真正的存储、查找、扩容都发生在
`internal/runtime/maps` 包里。这一节先把散列表的一般原理与攻防讲清楚，为下一节落到 Go 自己的
两代实现（1.0 至 1.23 的经典桶式设计，以及 1.24 起的 Swiss Table 设计）打底。理解了这里的取舍，
才能看清后者为何值得一次伤筋动骨的重写。

## 5.3.1 散列表的两条路线：链地址与开放定址

散列表要解决的核心矛盾，是把一个几乎无穷大的键空间压进一段有限的连续内存。哈希函数
$h$ 把键映射到 $[0, m)$ 的槽位下标，理想情况下一次访存即可定位。但映射不可能单射，
两个键算出同一下标即是「碰撞」，如何安置碰撞的键，分出了两条历史悠久的路线。

**链地址法**（chaining）让每个槽位挂一条链表，碰撞的键依次串在链上。它实现简单、删除干净、
对哈希质量不敏感，代价是每个元素多一个指针、缓存局部性差（链表节点散落在堆上）。设装填因子
$\alpha = n/m$（元素数比槽位数），在均匀哈希假设下，一次不成功查找平均要比较 $\approx \alpha$ 个
元素，成功查找 $\approx 1 + \alpha/2$ 个。链地址法允许 $\alpha > 1$，性能随 $\alpha$ 线性退化。

**开放定址法**（open addressing）反其道而行：所有元素都存在槽位数组本身，碰撞时按某种
「探测序列」去找下一个空槽。它没有指针开销，数据连续排列，缓存友好，但要求 $\alpha < 1$，
且随着 $\alpha \to 1$ 性能急剧恶化。均匀探测假设下，一次不成功查找平均探测

$$
\frac{1}{1-\alpha}
$$

次。这条曲线在 $\alpha = 0.9$ 时已是 $10$，在 $\alpha = 0.99$ 时是 $100$。开放定址法的全部
工程努力，都在对抗这条发散曲线。

探测序列的选择又分出几支。**线性探测**（linear probing）走 $h, h+1, h+2, \dots$，实现最简、
缓存命中最好，但相邻被占的槽会连成长块（primary clustering），不成功查找代价升至

$$
\frac{1}{2}\left(1 + \frac{1}{(1-\alpha)^2}\right)
$$

退化比均匀探测更快。**二次探测**（quadratic probing）走 $h, h+1, h+3, h+6, \dots$ 这类步长
递增的序列，打散聚集；**双重哈希**（double hashing）用第二个哈希函数定步长，逼近均匀探测的
理论曲线，但每次探测多一次哈希。还有 **Robin Hood 哈希**（Celis 1985）：插入时若发现自己离
理想槽位的距离已超过当前占据者，便「劫富济贫」，把对方挤走、自己入住，从而压低探测距离的
方差，使查找代价更可预测。这些技巧的共同目标，是在不放弃开放定址法连续内存优势的前提下，
把那条发散曲线压平。Swiss Table 正是这条路线上的集大成者（[5.4.1](./swisstable.md#541-swiss-table-设计abseil)）。

## 5.3.2 哈希洪水：散列表的安全面

散列表的 $O(1)$ 是平均意义上的。最坏情况下，若所有键碰撞到同一槽位，链地址法退化成一条链、
开放定址法退化成线性扫描，单次操作变成 $O(n)$，$n$ 次插入合计 $O(n^2)$。在多数算法分析里这
只是脚注，但 Crosby 与 Wallach 在 2003 年指出，它是一类可被远程触发的拒绝服务漏洞：当哈希
函数固定且公开，攻击者可离线构造出大批碰撞到同一桶的键，再把它们作为 HTTP 头、JSON 字段、
POST 参数喂给服务端。服务端把这些键塞进 `map`，本应 $O(1)$ 的插入退化成 $O(n)$，少量请求即可
耗尽 CPU。这类攻击被称为「哈希洪水」（hash-flooding）。

防御的关键，是让攻击者无法预知哈希结果，办法是给哈希函数注入一个进程私有、运行时随机生成的
**种子**（seed）。同一个键在不同进程、甚至同一程序的不同 `map` 里，哈希值都不同，离线构造
碰撞便失去了靶子。Aumasson 与 Bernstein 在 2012 年提出的 SipHash，是一个专为此设计的带密钥
短输入伪随机函数，被 Python、Rust、Ruby 等广泛采用为默认字符串哈希。

Go 走的是同一思路而选择不同。运行时启动时，`alginit` 会按 CPU 指令集挑选哈希算法：在支持
AES 指令的平台（amd64 的 `AES`/`SSSE3`/`SSE4.1`，arm64 的 `AES`）上启用基于 AES 轮函数的
`aeshash`，并从操作系统读取随机数据填充密钥；否则回退到带随机种子的非加密哈希。

```go
// runtime/alg.go：启动期按 CPU 能力选择哈希算法（速写）
func alginit() {
	if (GOARCH == "amd64" || GOARCH == "386") &&
		cpu.X86.HasAES && cpu.X86.HasSSSE3 && cpu.X86.HasSSE41 {
		initAlgAES()   // 安装 aeshash，密钥取自随机数据
		return
	}
	if GOARCH == "arm64" && cpu.ARM64.HasAES {
		initAlgAES()
		return
	}
	// 无 AES：用辅助向量 / /dev/urandom 的随机数据初始化 hashkey
	getRandomData(hashkey[:])
	hashkey[0] |= 1 // 保证为奇数，散列质量更好
}
```

随机性还不止于进程级。新版 `map` 的每个实例在创建时都会算出一个 `seed uintptr`
（[5.4.2](./swisstable.md#542-go-124-的-swiss-table-重写)），同一进程内不同 `map` 的哈希也彼此独立。这一层
随机化也正是 Go 规范不保证 `range` 遍历顺序的原因：顺序本就随种子浮动，运行时索性再叠加一个
随机起点，逼迫使用者不要依赖任何遍历次序。哈希洪水的防御与遍历顺序的不确定性，在这里是同一
枚硬币的两面。

## 延伸阅读的文献

- [Knuth, D. E. *The Art of Computer Programming, Vol. 3: Sorting and Searching*, §6.4 Hashing. 2nd ed., Addison-Wesley, 1998.](https://www-cs-faculty.stanford.edu/~knuth/taocp.html) 开放定址、链地址与装填因子代价分析的经典源头。
- [Celis, P., Larson, P.-Å., Munro, J. I. "Robin Hood Hashing." *FOCS*, 1985.](https://doi.org/10.1109/SFCS.1985.48) Robin Hood 哈希，压低探测距离方差。
- [Crosby, S. A., Wallach, D. S. "Denial of Service via Algorithmic Complexity Attacks." *USENIX Security*, 2003.](https://www.usenix.org/conference/12th-usenix-security-symposium/denial-service-algorithmic-complexity-attacks) 哈希洪水攻击的首次系统论述。
- [Aumasson, J.-P., Bernstein, D. J. "SipHash: a fast short-input PRF." *INDOCRYPT*, 2012.](https://www.aumasson.jp/siphash/siphash.pdf) 抗哈希洪水的带密钥短输入哈希。
