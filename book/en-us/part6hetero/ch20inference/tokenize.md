---
weight: 6302
title: "20.2 Tokenization and Tensors"
---

# 20.2 Tokenization and Tensors

[20.1](./runtime.md) settled the home of weights and tensors on the native runtime side, with
Go only passing handles and moving small data on the boundary. This section steps into that
"small data" itself: how text becomes the numbers a model can eat, and how the numbers turn
back into text. This seemingly trivial thing hides a detail that will make a Go programmer
smile in recognition, for it is almost a direct application of Chapter 5's "a string is a
stretch of immutable bytes," and the moment it is neglected, it spits out garbled text in
streaming output.

## 20.2.1 Tokenization: the Translation Layer Between Text and Model

The model does not know text. Its input and output are both **integers**, the token IDs in a
vocabulary. The layer that translates between human text and the model's integers is the
**tokenizer**. It does two mutually inverse things: cut an input string into a run of token
IDs (encoding), and stitch the model's generated token IDs back into a string (decoding).

Modern large models almost all use **byte-pair encoding** (BPE) or a variant. Its idea is
data-driven: starting from the finest units, count the adjacent pairs that most often occur
together in the corpus, merge a high-frequency pair into a new token, merge repeatedly, and
in the end obtain a vocabulary of tens of thousands of entries, where a common word is one
whole token and a rare word is split into a few subword pieces. This both controls the
vocabulary size and can represent any input, never meeting an "out-of-vocabulary" word.

## 20.2.2 Why Bytes, Not Characters: an Echo of Chapter 5

Here is a point especially close to a Go programmer's heart: today's mainstream BPE is
**byte-level**. Its smallest unit is not a Unicode character (code point) but a **UTF-8
byte**. The merges in the vocabulary happen on byte sequences.

This is exactly the thing Chapter 5 kept stressing:
[5.2](../../part2lang/ch05data/string.md) said a Go string is in essence a stretch of
**immutable bytes**, that `range`ing a string yields code points (runes) while indexing
yields bytes. Byte-level BPE fits Go's string model seamlessly: both treat text as bytes. So
feeding a Go string to a byte-level tokenizer needs, conceptually, no "character"
intermediate layer; what it processes is the very run of bytes underlying the string.

But byte-level also buries a mine, and that mine lands right on Go's sore spot:

> The boundary of a token need not fall on the boundary of a complete UTF-8 character.

A Chinese character takes 3 bytes in UTF-8, an emoji may take 4. Byte-level BPE may perfectly
well split these 3 bytes **across two adjacent tokens**. This is harmless in encoding, but in
**decoding token by token** it goes wrong: when the model first spits out the token that is
half a character, what you get is a run of **incomplete UTF-8 bytes**, not yet a legal code
point, and you must wait for the next token to arrive and complete the remaining bytes before
that character can be assembled.

The knowledge from Chapter 5 of how `utf8.DecodeRune` handles an incomplete sequence and how
`[]byte` and `string` convert becomes here the line between correct and incorrect. In
streaming output, you must never grab a token's bytes and rush to `string(bytes)` and print,
which would turn half a character into garbled text (`utf8.RuneError`, the `�`). The correct
way is to **accumulate a byte buffer, decode and output only the code points already complete,
and keep the trailing run of incomplete bytes to wait for the next token**:

```go
// streaming decode: accumulate bytes, emit only complete UTF-8 code points, keep the broken tail for next round
type utf8Streamer struct{ buf []byte }

func (s *utf8Streamer) Push(tokenBytes []byte) string {
    s.buf = append(s.buf, tokenBytes...)
    var out []byte
    for len(s.buf) > 0 {
        r, size := utf8.DecodeRune(s.buf)
        if r == utf8.RuneError && size <= 1 && !utf8.FullRune(s.buf) {
            break // the tail is half a character, keep it, wait for the next token to complete it
        }
        out = append(out, s.buf[:size]...)
        s.buf = s.buf[size:]
    }
    return string(out)
}
```

This snippet is almost a direct transplant of Chapter 5's UTF-8 handling, yet it is something
every streaming LLM output must get right. Go defines a string as bytes and provides, in the
standard library `unicode/utf8`, the tools to handle an incomplete sequence; this design is
exactly the right medicine for streaming decode in large models. **Chapter 5 is no idle
skill; it is the underpinning of streaming token decode.**

## 20.2.3 Tensors: Beneath the Shape Is a Stretch of Flat Memory

Once the token IDs enter the model, they become **tensors**. The word sounds abstract, but
taken apart it is no more than three things: **a stretch of flat, contiguous memory, plus a
shape, plus a data type (dtype)**. An input tensor of shape `[batch, seq]` and type `int32`
is underneath a contiguous `int32` array of length `batch × seq`, which in Go is a `[]int32`.

```text
A tensor of shape [2, 3], laid out row-major into one flat stretch of memory:

  logical: | a b c |        flat:  [ a b c d e f ]
           | d e f |                ↑ stride=3, row i starts at i*3
```

This plain realization, "a tensor is flat memory plus metadata," is the basis for passing
tensors efficiently between Go and the runtime. Handing a Go `[]int32` input tensor to the
runtime is nothing but passing across the pointer `&slice[0]`, plus the length and shape,
which is the same thing as the zero copy of [5.2](../../part2lang/ch05data/string.md) and the
pointer crossing the boundary of [18.3](../ch18gpu/memory.md). And 18.3's discipline applies
together: if the runtime holds this Go memory **asynchronously** (queuing it for batching,
reading it only later), you cannot rely on the implicit pin alone; either use `runtime.Pinner`
to pin it until the runtime is done, or simply use a native buffer the runtime allocated. The
efficiency and safety of tensor passing land, after all, on that memory rule on the boundary.

## 20.2.4 Quantization: When Tensors Look Less and Less Like floats

A last note on the evolution of dtype, because it stitches this chapter and the last more
tightly together. Model weights were originally 32-bit floats (`float32`). To fit into less
memory and run faster, inference widely adopts **quantization**: pressing the weights into 16
bits (`float16`/`bfloat16`), 8-bit integers (`int8`), even 4 bits. A quantized model's tensors
are underneath a compact run of `int8` or narrower bytes, plus the scaling factors needed to
dequantize.

Quantization pulls a tensor back from "float" to "bytes," and this happens to connect to the
SIMD of [18.4.3](../ch18gpu/model.md) and [19.3](../ch19graphics/software.md): `int8` matrix
multiply is the forte of CPU SIMD, and the integer vector types and fused multiply-add that
Go 1.27's `simd` package provides are exactly the material for the inner loop of quantized
inference on the CPU. So a line emerges: **byte-level tokenization, flat-memory tensors, and
weights quantized into bytes make large-model inference, at the data layer, return everywhere
to "bytes and vectors," which is precisely the foundation laid by Chapter 5 and by Chapters 18
and 19.**

## Summary

The tokenizer is the translation layer between text and the model's integers, and the
mainstream byte-level BPE works on UTF-8 bytes, fitting seamlessly with Chapter 5's "a string
is immutable bytes," but it buries a mine: a token boundary need not align with a character
boundary, so decoding token by token gets half a character of incomplete UTF-8, which must be
buffered and only complete code points emitted, or the streaming output is garbled. Chapter
5's UTF-8 handling is the bottom line of correctness here. A tensor, then, is "flat memory plus
shape plus dtype," passed across the boundary as a Go `[]int32`/`[]float32` under 18.3's
pointer rules, with `Pinner` or a native buffer as a backstop when held asynchronously.
Quantization presses tensors back into bytes, and connects the inner loop back to the SIMD of
Chapters 18 and 19. Every layer of the data stands on the foundation of earlier chapters.

The mechanism of token in, token out is clear, but a service must serve thousands upon
thousands of such streams at once. The next section [20.3](./serving.md) returns to what Go
does best, concurrency, to see how batching amortizes the device cost, how tokens stream back
to the client, and how the backpressure from a slow client is dissolved with channels and
context.

## Further Reading

1. Rico Sennrich, Barry Haddow, Alexandra Birch. *Neural Machine Translation of Rare Words
   with Subword Units.* ACL, 2016. https://aclanthology.org/P16-1162/
   (the original paper on BPE for subword segmentation)
2. Alec Radford et al. *Language Models are Unsupervised Multitask Learners (GPT-2).* 2019.
   (a representative application of byte-level BPE, with the vocabulary working on UTF-8 bytes)
3. The Go Authors. *Package unicode/utf8.* https://pkg.go.dev/unicode/utf8
   (`DecodeRune`, `FullRune`, `RuneError`: handling incomplete UTF-8 sequences)
4. Rob Pike. *Strings, bytes, runes and characters in Go.* The Go Blog, 2013.
   https://go.dev/blog/strings
   (a Go string as a byte sequence, the distinction between rune and byte)
5. This book: [5.1 Arrays and Slices](../../part2lang/ch05data/slice.md),
   [5.2 Strings and Zero-Copy Conversion](../../part2lang/ch05data/string.md),
   [18.3 The Divide Between Device Memory and the Garbage Collector](../ch18gpu/memory.md),
   [18.4 The Asynchronous Programming Model](../ch18gpu/model.md),
   [20.3 Serving, Batching, and Streaming](./serving.md).
