---
weight: 6302
title: "20.2 分词与张量"
---

# 20.2 分词与张量

[20.1](./runtime.md) 把权重与张量的家安顿在了原生运行时一侧，Go 只在边界上递句柄、搬小数据。
这一节深入那「小数据」本身:文本怎么变成模型能吃的数字，数字又怎么变回文本。这件看似琐碎的事，
藏着一个 Go 程序员会心一笑的细节,它几乎就是第 5 章「字符串是一段不可变字节」的直接应用，
而且一旦疏忽，就会在流式输出时吐出乱码。

## 20.2.1 分词：文本与模型之间的翻译层

模型不认识文本。它的输入和输出都是**整数**,词表里的 token 编号。把人类的文本与模型的整数互相
翻译的这一层，叫**分词器**(tokenizer)。它做两件互逆的事:把输入字符串切成一串 token id（编码),
把模型生成的 token id 拼回字符串（解码)。

现代大模型几乎都用**字节对编码**(Byte-Pair Encoding, BPE)或其变体。它的思路是数据驱动的:
从最细的单位出发，统计语料里最常一起出现的相邻对，把高频对合并成一个新 token，反复合并，
最终得到一张几万项的词表，常见词是一个完整 token，生僻词则被拆成几个子词片段。这样既控制了
词表大小，又能表示任何输入，不会遇到「未登录词」。

## 20.2.2 为什么是字节，而不是字符：第 5 章的回响

这里有一个对 Go 程序员格外亲切的关键:当代主流的 BPE，是**字节级**(byte-level)的。它的最小
单位不是 Unicode 字符（码点)，而是 **UTF-8 字节**。词表里的合并，发生在字节序列上。

这正是第 5 章反复强调的那件事:[5.2](../../part2lang/ch05data/string.md) 说过，Go 的字符串
本质是一段**不可变的字节序列**,`range` 一个字符串得到的是码点（rune），而下标索引得到的是字节。
字节级 BPE 与 Go 的字符串模型严丝合缝:两者都把文本看作字节。于是把一段 Go 字符串喂给字节级
分词器，概念上不需要任何「字符」的中间层,它处理的就是字符串底层那串字节。

但字节级也埋了一个雷，而这个雷恰好踩在 Go 的痛点上:

> 一个 token 的边界，未必落在一个完整 UTF-8 字符的边界上。

一个中文字符在 UTF-8 里占 3 个字节，一个 emoji 可能占 4 个。字节级 BPE 完全可能把这 3 个字节
**拆进两个相邻的 token**。这在编码时无所谓，可在**逐 token 解码**时就出事了:当模型先吐出
半个字符的那个 token，你拿到的是一串**不完整的 UTF-8 字节**,它还不构成一个合法的码点，
要等下一个 token 到达、补齐剩下的字节，才拼得出那个字符。

第 5 章关于 `utf8.DecodeRune` 如何处理不完整序列、`[]byte` 与 `string` 如何转换的那套知识，
在这里成了正确与否的分界。流式输出时，决不能拿到一个 token 的字节就急着 `string(bytes)` 打印,
那会把半个字符变成乱码（`utf8.RuneError`,即 `�`)。正确的做法是**攒一个字节缓冲，只解码并输出
已经完整的码点，把结尾那段不完整的字节留着等下一个 token**:

```go
// 流式解码：累积字节，只吐出完整的 UTF-8 码点，残缺尾字节留到下一轮
type utf8Streamer struct{ buf []byte }

func (s *utf8Streamer) Push(tokenBytes []byte) string {
    s.buf = append(s.buf, tokenBytes...)
    var out []byte
    for len(s.buf) > 0 {
        r, size := utf8.DecodeRune(s.buf)
        if r == utf8.RuneError && size <= 1 && !utf8.FullRune(s.buf) {
            break // 尾部是半个字符，留着，等下一个 token 补齐
        }
        out = append(out, s.buf[:size]...)
        s.buf = s.buf[size:]
    }
    return string(out)
}
```

这段代码几乎是第 5 章 UTF-8 处理的直接搬运，却是每一个流式 LLM 输出都必须做对的事。Go 把字符串
定义成字节、又在标准库 `unicode/utf8` 里备好了处理不完整序列的工具,这套设计在大模型的流式解码上
正好对症。**第 5 章不是屠龙之技，它就是流式 token 解码的底层。**

## 20.2.3 张量：形状之下是一段扁平内存

token id 进了模型，就成了**张量**。张量这个词听着抽象，拆开看，它不过是三样东西:**一段扁平的
连续内存，加上一组形状(shape)，加上一个数据类型(dtype)**。一句 `[batch, seq]` 形状、`int32`
类型的输入张量，底层就是一个 `batch × seq` 长的连续 `int32` 数组,在 Go 里就是一个 `[]int32`。

```text
形状 [2, 3] 的张量，行主序(row-major)铺成一段扁平内存：

  逻辑：  | a b c |        扁平：  [ a b c d e f ]
         | d e f |                 ↑ stride=3，第 i 行起点在 i*3
```

「张量是扁平内存 + 元数据」这个朴素的认识，正是 Go 与运行时之间高效传张量的基础。把一个 Go 的
`[]int32` 输入张量交给运行时，无非是把 `&slice[0]` 这个指针、加上长度与形状递过去,
这与 [5.2](../../part2lang/ch05data/string.md) 讲的零拷贝、与 [18.3](../ch18gpu/memory.md) 讲的
指针穿过边界，是同一件事。当然，18.3 的纪律也一并适用:若运行时**异步**地持有这块 Go 内存
（比如排进一个批处理队列、稍后才读），就不能只靠隐式钉住,要么用 `runtime.Pinner` 把它钉到
运行时用完为止，要么干脆用运行时分配的原生缓冲。张量传递的高效与安全，落点还是那道边界上的内存
规则。

## 20.2.4 量化：当张量越来越不像 float

最后点一笔 dtype 的演化，因为它把这一章和前一章缝得更紧。模型权重原本是 32 位浮点(`float32`),
为了塞进更小的内存、跑得更快，推理普遍采用**量化**:把权重压成 16 位（`float16`/`bfloat16`)、
8 位整数(`int8`)，乃至 4 位。一个量化模型的张量，底层是一段紧凑的 `int8` 甚至更窄的字节，
配上反量化所需的缩放因子。

量化把张量从「浮点」拉回了「字节」,而这正好接上了 [18.4.3](../ch18gpu/model.md) 与
[19.3](../ch19graphics/software.md) 的 SIMD:`int8` 的矩阵乘是 CPU SIMD 的拿手好戏，
Go 1.27 的 `simd` 包提供的整数向量类型与融合乘加，恰好是 CPU 上做量化推理内循环的料。
于是一条线浮现出来:**字节级的分词、扁平内存的张量、量化成字节的权重，让大模型推理在数据这一层，
处处回到了「字节与向量」,而这正是第 5 章与第 18、19 章打下的地基。**

## 小结

分词器是文本与模型整数之间的翻译层，主流的字节级 BPE 工作在 UTF-8 字节上,这与第 5 章「字符串
即不可变字节」严丝合缝,但也埋了一个雷:token 边界未必对齐字符边界，逐 token 解码会拿到半个
字符的不完整 UTF-8，必须攒缓冲、只吐完整码点，否则流式输出就是乱码。第 5 章的 UTF-8 处理在这里
是正确与否的底线。张量则是「扁平内存 + 形状 + dtype」,把 Go 的 `[]int32`/`[]float32` 按 18.3 的
指针规则递过边界即可，异步持有时仍要 `Pinner` 或原生缓冲兜底。量化把张量压回字节，又把内循环
接回了第 18、19 章的 SIMD。数据的每一层，都踩在前面章节的地基上。

token 进、token 出的机制清楚了，可一个服务要同时伺候成千上万条这样的流。下一节
[20.3](./serving.md) 回到 Go 最擅长的并发,看批处理如何摊薄设备成本、token 如何流式吐回客户端、
以及慢客户端带来的背压如何用通道与 context 化解。

## 延伸阅读的文献

1. Rico Sennrich, Barry Haddow, Alexandra Birch. *Neural Machine Translation of
   Rare Words with Subword Units.* ACL, 2016. https://aclanthology.org/P16-1162/
   （BPE 用于子词切分的原始论文）
2. Alec Radford 等. *Language Models are Unsupervised Multitask Learners (GPT-2).*
   2019.（字节级 BPE 的代表性应用，词表工作在 UTF-8 字节上）
3. The Go Authors. *Package unicode/utf8.* https://pkg.go.dev/unicode/utf8
   （`DecodeRune`、`FullRune`、`RuneError`：处理不完整 UTF-8 序列）
4. Rob Pike. *Strings, bytes, runes and characters in Go.* The Go Blog, 2013.
   https://go.dev/blog/strings
   （Go 字符串即字节序列、rune 与字节的区分）
5. 本书 [5.1 数组与切片](../../part2lang/ch05data/slice.md)、
   [5.2 字符串与零拷贝转换](../../part2lang/ch05data/string.md)、
   [18.3 显存与垃圾回收的分界](../ch18gpu/memory.md)、
   [18.4 异步编程模型](../ch18gpu/model.md)、[20.3 服务、批处理与流式](./serving.md)。
