---
weight: 6302
title: "20.2 分词与张量"
---

# 20.2 分词与张量

[20.1](./runtime.md) 把权重与张量安置在原生运行时一侧，Go 只在边界上传递句柄与小数据。
本节讨论这些小数据本身：文本如何变成模型使用的整数，整数又如何还原为文本；张量在内存中是什么样子；
量化又如何改变了张量。其中最值得 Go 程序员留意的一点是，主流分词器工作在 UTF-8 字节之上，这与
[5.2](../../part2lang/ch05data/string.md) 讨论的字符串模型完全一致，而流式输出能否正确，
取决于是否处理好 UTF-8 编码的边界。

## 20.2.1 分词：文本与整数之间的翻译层

模型并不直接处理文本，它的输入与输出都是整数，即词表中的**词元**（token）编号。
在文本与这些整数之间往返转换的组件称为 **分词器**（tokenizer）。它完成两件互逆的事：
把输入字符串切分为一串词元 ID（编码），把模型生成的词元 ID 拼回字符串（解码）。

现代大模型的分词器大多基于**字节对编码**（byte pair encoding, BPE）或其变体。BPE 原本是一种数据压缩算法：
反复把序列中出现最频繁的一对字节替换为一个尚未使用的字节 [[Gage, 1994](#ref-gage-1994)]。Sennrich
等人把它改造为词的切分方法：不再合并字节对，而是合并字符或字符序列。具体做法是，先用字符表初始化符号表，
把每个词表示为字符序列并在末尾加一个词尾符号；然后反复统计所有相邻符号对，把出现最频繁的一对 (A, B)
的每次出现替换为新符号 AB。最终的符号表大小等于初始字符表的大小加上合并次数，
而合并次数是算法唯一的超参数。为了效率，统计时不考虑跨越词边界的符号对，
因此算法可以直接在按频次加权的词典上运行 [[Sennrich et al., 2016](#ref-sennrich-et-al-2016)]。

论文给出了一段十余行的 Python 实现。下面是它的 Go 版本，词典与合并次数都与论文相同：

```go {run=true}
package main

import (
	"fmt"
	"strings"
)

type pair struct{ a, b string }

func main() {
	// 论文中的示例词典：词按字符切开，</w> 标记词尾。
	words := []string{"l o w </w>", "l o w e r </w>", "n e w e s t </w>", "w i d e s t </w>"}
	freq := []int{5, 2, 6, 3}

	var merges []string
	for range 10 {
		// 统计相邻符号对的加权频次，记下首次出现的顺序以便平局时取先者。
		count := map[pair]int{}
		var order []pair
		for i, w := range words {
			s := strings.Fields(w)
			for j := 0; j+1 < len(s); j++ {
				p := pair{s[j], s[j+1]}
				if _, ok := count[p]; !ok {
					order = append(order, p)
				}
				count[p] += freq[i]
			}
		}
		best := order[0]
		for _, p := range order {
			if count[p] > count[best] {
				best = p
			}
		}
		merges = append(merges, best.a+best.b)

		// 把每个词中出现的这一对替换为合并后的新符号。
		for i, w := range words {
			s := strings.Fields(w)
			var out []string
			for j := 0; j < len(s); j++ {
				if j+1 < len(s) && s[j] == best.a && s[j+1] == best.b {
					out = append(out, best.a+best.b)
					j++
					continue
				}
				out = append(out, s[j])
			}
			words[i] = strings.Join(out, " ")
		}
	}
	fmt.Println(strings.Join(merges, "  "))
	for _, w := range words {
		fmt.Println(w)
	}
}
```

```
es  est  est</w>  lo  low  ne  new  newest</w>  low</w>  wi
low</w>
low e r </w>
newest</w>
wi d est</w>
```

第一行是十次合并依次产生的新符号，其余四行是合并之后每个词的切分。`newest` 与 `widest` 共有的后缀
`est</w>` 在前三步就成了一个符号；`low` 与 `newest` 都成了完整的符号，出现较少的 `lower` 则仍由 `low`、
`e`、`r` 与词尾符号拼成。这正是 BPE 的性质：常见的词成为一个词元，罕见的词拆成若干子词，词表大小可控，
而任何输入都能表示。合并顺序与论文中 Python 程序的输出一致。有一处细节是 Go 特有的：Python 的 `max`
在频次相同时返回字典中先出现的键，而 Go 规范明确规定 map 的迭代顺序未指定，且两次迭代之间也不保证相同，
所以程序另用切片 `order` 记录符号对首次出现的顺序，结果才是确定的。

训练得到的是一张按顺序排列的合并表。编码时，分词器把一个词拆成初始符号，
反复合并表中**排名最靠前**的相邻符号对，直到没有可合并的为止。Forma 的分词器按这一规则实现，
并在注释中说明了一个容易写错的地方：同一个符号对在相邻的重叠位置出现时（例如 `"eee"` 中的两个
`("e","e")`），必须取最左边的一处；判断条件写成 `<=` 会取到最右边的一处，看上去同样符合「取排名最低者」，
却会让大约每三十个短字符串中就有一个得到不同的 ID [[Ou, 2026](#ref-ou-2026)]。

BPE 之外，另一个常见的实现是 SentencePiece。现有的子词工具大多假定输入已经按空格切分为词，这对中文、日文、
韩文这类不以空格分词的语言并不成立；SentencePiece 直接在原始句子上训练，把空格也当作普通符号，
替换为元符号 `▁`（U+2581），从而保证切分可以无损还原。它同时实现了 BPE 与一元语言模型（unigram language
model）两种切分算法 [[Kudo and Richardson, 2018](#ref-kudo-richardson-2018)]。

## 20.2.2 为什么是字节

当代主流的 BPE 是**字节级**（byte-level）的：最小单位不是 Unicode 码点，而是 UTF-8 字节。GPT-2
的论文解释了原因。参考实现中的 BPE 名为「字节对」，实际上大多工作在 Unicode 码点上；要表示所有 Unicode
字符串，基础词表就要包含全部 Unicode 符号，在加入任何多符号词元之前就已超过 130,000 项，而 BPE
常用的词表只有 32,000 到 64,000 项。字节级的 BPE 只需要大小为 256 的基础词表。直接在字节序列上运行 BPE
会产生不理想的合并（例如 `dog.`、`dog!`、`dog?` 各占一个词元），因此 GPT-2 禁止跨越字符类别的合并，
只对空格开了例外 [[Radford et al., 2019](#ref-radford-et-al-2019)]。

GPT-2 的编码器还做了一步映射：把 256 个字节值一一映射到可打印的码点，使词表成为一组普通的字符串。
188 个本身可打印的 ASCII 与 Latin-1 字节映射到自身，其余 68 个按字节顺序映射到 U+0100 起的码点
[[OpenAI, 2019](#ref-openai-2019)]。空格 0x20 是其中第 33 个，映射为 U+0120，即 `Ġ`，
这就是许多词表中处处可见 `Ġ` 的原因。Forma 照此实现了同一张映射，并强调它是字节上的双射，
所以解码对任意字节序列都有定义，包括不合法的 UTF-8。它在把字节映射为码点时逐字节处理字符串，
注释特别说明不能经过 `[]rune` 转换，否则不合法的 UTF-8 会被替换为 U+FFFD，双射随之破坏
[[Ou, 2026](#ref-ou-2026)]。

这与第 5 章讨论的字符串模型完全一致。[5.2](../../part2lang/ch05data/string.md) 指出，Go
的字符串是一段不可变的字节序列，`range` 遍历得到码点，下标索引得到字节 [[Pike, 2013](#ref-pike-2013)]。
字节级分词器处理的正是字符串底层的那串字节，中间不需要任何「字符」的抽象。

但字节级的设计也带来一个问题：**词元的边界未必落在 UTF-8 编码的边界上。**一个汉字的 UTF-8 编码占
3 个字节，一个 emoji 通常占 4 个，字节级 BPE 完全可能把这几个字节分到相邻的两个词元中。编码时这无关紧要，
逐个词元解码时却会出错：模型先生成的那个词元只含半个字符的字节，它还不是一个完整的码点，
要等下一个词元补齐剩下的字节才能拼出完整的字符。若每收到一个词元就立刻把它的字节转换为字符串并发送，
半个字符就会显示为替换字符 U+FFFD（`�`）。正确的做法是维护一个字节缓冲，只交出已经完整的编码，
把末尾不完整的字节留给下一个词元：

```go {run=true}
package main

import (
	"fmt"
	"unicode/utf8"
)

// Decoder 累积词元的字节，只交出已经完整的 UTF-8 编码，
// 末尾不完整的字节留到下一个词元到来时再处理。
type Decoder struct{ buf []byte }

func (d *Decoder) Push(tok []byte) string {
	d.buf = append(d.buf, tok...)
	n := 0
	for n < len(d.buf) && utf8.FullRune(d.buf[n:]) {
		_, size := utf8.DecodeRune(d.buf[n:])
		n += size
	}
	out := string(d.buf[:n])
	d.buf = d.buf[:copy(d.buf, d.buf[n:])]
	return out
}

func main() {
	text := []byte("Go语言🙂")
	// 假想的切分：「语」「言」「🙂」的编码都被切在了中间。
	toks := [][]byte{text[:3], text[3:7], text[7:10], text[10:]}

	var d Decoder
	all := ""
	for _, t := range toks {
		naive := string([]rune(string(t))) // 无效字节按 range 的规则替换为 U+FFFD
		out := d.Push(t)
		all += out
		fmt.Printf("%-11s  直接转换：%s  缓冲后：%s\n", fmt.Sprintf("% x", t), naive, out)
	}
	fmt.Println("拼接结果：" + all)
}
```

```
47 6f e8     直接转换：Go�  缓冲后：Go
af ad e8 a8  直接转换：����  缓冲后：语
80 f0 9f     直接转换：���  缓冲后：言
99 82        直接转换：��  缓冲后：🙂
拼接结果：Go语言🙂
```

第一个词元以「语」的首字节 `e8` 结尾，直接转换得到 `Go�`，而缓冲之后只交出 `Go`，把 `e8` 留下；
第二个词元带来「语」的后两个字节，`Decoder` 交出完整的「语」，同时留下「言」的前两个字节。
直接转换的一列中，每个无效字节都变成了一个 U+FFFD：这是 `for range` 遇到不合法的 UTF-8 时的行为，
`[]rune` 转换遵循同样的规则。

判断的关键是 `utf8.FullRune`。它的文档写道，`FullRune` 报告 `p` 中的字节是否以一个完整的 UTF-8 编码开头，
不合法的编码也被视为完整，因为它会被转换为一个宽度为 1 的错误码点。所以它只对「合法但被截断」的编码返回
`false`：真正无效的字节会被立即交出，因为再等下去它也不会变得合法；
只有可能被下一个词元补齐的尾部才会被留下。生产代码采用的也是这一判断。Forma 的 `tokenizer.Decoder` 用
`utf8.FullRune` 计算可以交出的前缀长度，流结束时若仍有残留，就输出一个 U+FFFD，表明流在字符中间结束；
它还把这个缓冲与停止词匹配所需的缓冲分开，因为前者等待的是字节补齐，后者等待的是文本匹配，
二者共用一个缓冲会让两边都判断错误 [[Ou, 2026](#ref-ou-2026)]。Ollama 的 MLX runner 中有一个名为
`flushValidUTF8Prefix` 的函数，做的是同一件事 [[Ollama, 2026](#ref-ollama-2026)]。Go
把字符串定义为字节序列，又在 `unicode/utf8` 中提供了处理不完整编码的工具
[[Go Authors, n.d.b](#ref-go-authors-ndb)]，流式解码所需的正是这两样东西。

## 20.2.3 张量：形状之下是一段扁平内存

词元 ID 进入模型之后就成了**张量**。拆开来看，张量只是三样东西：一段扁平的连续内存、一组形状（shape）、
一个数据类型（dtype）。形状为 `[batch, seq]`、类型为 `int32` 的输入张量，底层就是一个长为 `batch × seq`
的连续 `int32` 数组，在 Go 中就是一个 `[]int32`。

```text
形状 [2, 3] 的张量，按行主序（row-major）铺成一段扁平内存：

  逻辑：  | a b c |        扁平：  [ a b c d e f ]
         | d e f |
  步长（stride）为 [3, 1]：元素 (i, j) 位于偏移 3i + j
```

每一维的步长等于其后各维长度的乘积。转置、切片这类操作往往只改变形状与步长，不移动数据，
这也是推理运行时能在同一块内存上高效变换张量的原因。

把 Go 的 `[]int32` 交给同一进程中的运行时，就是把指向首元素的指针、长度与形状一起传过去，与
[5.2](../../part2lang/ch05data/string.md) 讨论的零拷贝、[18.3](../ch18gpu/memory.md)
讨论的指针跨界是同一件事。cgo 的指针传递规则在这里同样适用（见
[15.6](../../part5toolchain/ch15compile/cgo.md)）。`cmd/cgo` 的文档写道：

```text
C code may not keep a copy of a Go pointer after the call returns,
unless the memory it points to is pinned with [runtime.Pinner] and the
Pinner is not unpinned while the Go pointer is stored in C memory.
```

即：调用返回之后，C 代码不得保留 Go 指针的副本，除非该指针指向的内存已用 `runtime.Pinner` 固定，
并且在 C 内存中仍存有该指针期间不解除固定 [[Go Authors, n.d.a](#ref-go-authors-nda)]。
传给 C 的 Go 内存只在调用期间被隐式固定；运行时若要**异步**地使用这块内存，例如把它排进批处理队列、
稍后才读取，就必须用 `runtime.Pinner` 固定到运行时用完为止，或者干脆改用运行时分配的原生缓冲。
若运行时位于另一个进程中（见 20.1.4），这些规则都不再适用，代价是词元要经过序列化才能跨越进程边界。

## 20.2.4 量化：张量回到字节

模型权重原本以 32 位浮点（`float32`）存储。为了装进更小的内存、算得更快，推理普遍采用**量化**：
把权重压缩为 16 位浮点（`float16`/`bfloat16`）、8 位整数，乃至 4 位。量化后的张量底层是一段紧凑的字节，
外加反量化所需的缩放因子。

以 GGUF 中最简单的 4 位格式 Q4_0 为例。每 32 个权重组成一块，块内共用一个 `float16` 的缩放因子 `d`，外加
16 个字节存放 32 个 4 位整数，每块 18 字节，平均每个权重 4.5 位。量化时，`d` 取块内绝对值最大的那个值除以
−8；反量化时，每个 4 位整数 `q` 还原为 $(q - 8) \times d$，每个字节的低 4 位对应块的前 16 个元素，高
4 位对应后 16 个 [[ggml-org, 2026](#ref-ggml-org-2026)]。从这个布局可以看出，张量已经不再是一个
`[]float32`，而是一段需要按块解释的字节，这也是 20.1 强调「权重留在原生一侧」的又一个理由：
只有运行时知道如何解释它。Forma 给出的估算是每个参数在 f16 下占 2 字节、int8 约 1.06 字节、int4 约
0.53 字节，超出整数位宽的部分来自按块共享的缩放因子（int8 每 32 个权重共用一个 f16 缩放因子）；它只在
int8 装不下时才自动选择 int4，而选择 int4 时嵌入表仍保留为 int8 [[Ou, 2026](#ref-ou-2026)]。

量化把内循环带回了整数运算，也就接上了 [18.4](../ch18gpu/model.md) 与 [19.3](../ch19graphics/software.md)
讨论的 SIMD。`int8` 的点积正是 CPU SIMD 擅长的计算。Go 1.26 在 `GOEXPERIMENT=simd` 下提供
`simd/archsimd` 包，暴露与架构相关的向量类型，目前只支持 AMD64，且不受 Go 1 兼容性承诺的约束；
Go 1.27 新增了可移植的 `simd` 包，为每种数值类型提供向量类型（如 `Int8s`、`Float32s`）与 `Float32s.MulAdd`
这样的三元运算，同样需要该实验开关。在 CPU 上用纯 Go 实现量化推理的内循环，这两个包提供了所需的基本构件。

## 小结

分词器是文本与模型整数之间的翻译层。BPE 源自一种数据压缩算法，Sennrich 等人把它改造为子词切分方法；
GPT-2 把它下沉到字节层面，基础词表因此只需 256 项，这与第 5 章「字符串是不可变的字节序列」完全一致。
字节级设计的代价是词元边界未必对齐 UTF-8 编码的边界，流式解码必须维护字节缓冲，借助 `utf8.FullRune`
只交出完整的编码。张量是扁平内存、形状与数据类型的组合，同一进程内传给运行时时遵循 cgo 的指针规则，
需要异步持有时用 `runtime.Pinner` 或原生缓冲。量化把张量压回按块解释的字节，也把内循环交还给 SIMD。

单个请求的数据流已经清楚，但一个服务需要同时处理成千上万条这样的流。[20.3](./serving.md) 回到 Go
擅长的并发，讨论批处理如何分摊设备成本、词元如何流式返回客户端，以及如何用通道与 context 处理背压与取消。

## 延伸阅读

- <a id="ref-gage-1994"></a>[Gage, 1994] Philip Gage. A New Algorithm for Data Compression. *C Users
  Journal*, 12(2):23–38, 1994. BPE 作为压缩算法的出处。
- <a id="ref-ggml-org-2026"></a>[ggml-org, 2026] ggml-org. *llama.cpp b11963*（提交 39febd2adb）：
  `ggml/src/ggml-common.h` 中的 `block_q4_0` 与 `ggml/src/ggml-quants.c` 中的量化、反量化函数. 2026.
  https://github.com/ggml-org/llama.cpp/blob/b11963/ggml/src/ggml-quants.c
- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *Command cgo.*
  https://pkg.go.dev/cmd/cgo
  「Passing pointers」一节：指针传递规则与 `runtime.Pinner`。
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *Package unicode/utf8.*
  https://pkg.go.dev/unicode/utf8
  `DecodeRune`、`FullRune`、`RuneError`：处理不完整的 UTF-8 序列。
- <a id="ref-kudo-richardson-2018"></a>[Kudo and Richardson, 2018] Taku Kudo, John Richardson.
  SentencePiece: A simple and language independent subword tokenizer and detokenizer for Neural Text
  Processing. *EMNLP 2018: System Demonstrations*, 2018. https://aclanthology.org/D18-2012/
- <a id="ref-ollama-2026"></a>[Ollama, 2026] Ollama. *mlxrunner/utf8_buffer.go.* v0.40.13（提交
  04088e7c9d），2026. https://github.com/ollama/ollama/blob/v0.40.13/mlxrunner/utf8_buffer.go
- <a id="ref-openai-2019"></a>[OpenAI, 2019] OpenAI. *gpt-2/src/encoder.py.* 2019.
  https://github.com/openai/gpt-2/blob/e5c5054474f583d6d9499624649353995d63c70a/src/encoder.py
  `bytes_to_unicode`：字节到可打印码点的映射。
- <a id="ref-ou-2026"></a>[Ou, 2026] Changkun Ou. *Forma: Run open-weight LLMs from Go.*
  https://github.com/latere-ai/forma, 2026.
  以提交 5af707fbe6 为准；见 `tokenizer/bpe.go`、`tokenizer/bytelevel.go`、`tokenizer/decoder.go` 与
  `docs/orientation.md`。
- <a id="ref-pike-2013"></a>[Pike, 2013] Rob Pike. *Strings, bytes, runes and characters in Go.* The Go
  Blog, 2013. https://go.dev/blog/strings
  Go 字符串即字节序列、rune 与字节的区分。
- <a id="ref-radford-et-al-2019"></a>[Radford et al., 2019] Alec Radford 等. *Language Models are
  Unsupervised Multitask Learners (GPT-2).* 2019.
  https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf
  第 2.2 节：字节级 BPE，基础词表 256 项。
- <a id="ref-sennrich-et-al-2016"></a>[Sennrich et al., 2016] Rico Sennrich, Barry Haddow, Alexandra
  Birch. *Neural Machine Translation of Rare Words with Subword Units.* ACL, 2016.
  https://aclanthology.org/P16-1162/
  BPE 用于子词切分的原始论文。
- 本书 [5.1 数组与切片](../../part2lang/ch05data/slice.md)、
  [5.2 字符串与零拷贝转换](../../part2lang/ch05data/string.md)、
  [15.6 cgo](../../part5toolchain/ch15compile/cgo.md)、
  [18.3 显存与垃圾回收的分界](../ch18gpu/memory.md)、
  [18.4 异步编程模型](../ch18gpu/model.md)、[19.3 软件渲染与并行](../ch19graphics/software.md)、
  [20.1 推理运行时与 FFI](./runtime.md)、[20.3 服务、批处理与流式](./serving.md)。
