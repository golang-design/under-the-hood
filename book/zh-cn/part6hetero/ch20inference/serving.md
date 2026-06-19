---
weight: 6303
title: "20.3 服务、批处理与流式"
---

# 20.3 服务、批处理与流式

前两节把单次推理的底层铺好了:[20.1](./runtime.md) 经 cgo 接入运行时、安顿好权重与张量,
[20.2](./tokenize.md) 讲清了 token 进、token 出。可一个真实的服务，要同时伺候成千上万条这样的
请求，每条都在持续地吐 token。怎么把它们高效、稳定地组织起来，是一个彻头彻尾的**并发与调度**
问题,而这正是 Go 的主场。这一节把第 10 章的通道、第 7 章的 context，落到大模型服务上。

## 20.3.1 一个请求的一生：一条 token 流

先看清一次生成的形状。大模型是**自回归**的:它一次只生成一个 token，把这个 token 接回输入，
再算下一个，循环往复，直到生成结束符或达到长度上限。所以从时间轴上看，**一个请求不是一次
请求-响应，而是一条随时间流出的 token 流**。

这个形状和 Go 的并发模型天造地设:一个 goroutine 跑生成循环，每算出一个 token 就往一个通道里送,
下游从通道里收，正是第 10 章「用通信共享内存」的标准句式。

```go
// 一个请求 = 一个生成 goroutine，把 token 逐个送进通道
func generate(ctx context.Context, req Request, out chan<- Token) {
    defer close(out)
    for {
        tok := runtime.NextToken(req.state) // 一次 cgo 调用，算一个 token
        select {
        case out <- tok:                    // 送给下游（HTTP handler）
        case <-ctx.Done():                  // 客户端走了，立刻收手
            return
        }
        if tok.IsEOS() {
            return
        }
    }
}
```

这段骨架已经埋下了本节三个主题的种子:`out` 通道是**流式**,`ctx.Done()` 是**取消**,
而当 `out` 满、`out <- tok` 阻塞时就是**背压**。下面逐一展开。

## 20.3.2 批处理：摊薄设备成本

单条请求的生成循环虽然清晰，却浪费:GPU 一次只算一个序列的一个 token,海量的并行算力被闲置。
设备最高效的用法，是**一次喂一批**,把多条序列的当前 token 凑成一个 batch 一起前向，
[18.4](../ch18gpu/model.md) 的 SIMT 才被真正喂满。

难处在于,请求是**各自独立、随机到达**的，而且每条的长度不一、结束时间不同。把它们硬凑成固定
批次，要么干等凑满（延迟爆炸），要么频繁地等批次里最慢的那条跑完（吞吐低下）。现代推理服务的
解法叫**连续批处理**(continuous batching，又称迭代级调度):不再以「一整批从头跑到尾」为单位，
而是**每生成一步，就动态地把新到的请求加进批、把已结束的请求移出批**。批次像一个流动的水池，
随时有进有出，设备每一步都尽量满载。

这本质是一个**调度**问题，而调度正是 Go 拿手的。一个批处理 goroutine 从请求通道里收集在飞的
请求，凑成当前步的 batch，调一次运行时前向，再把这一步每条序列新生的 token 分发回各自的通道:

```go
// 批处理调度器：把多条在飞的请求凑成 batch，每步动态增删
func batchLoop(incoming <-chan *Seq) {
    batch := map[ID]*Seq{}
    for {
        drainNewArrivals(incoming, batch) // 新请求加入批（非阻塞收集）
        if len(batch) == 0 {
            seq := <-incoming             // 批空了，阻塞等第一条
            batch[seq.ID] = seq
            continue
        }
        toks := runtime.Step(batch)        // 一次前向，算出这一步每条的 token
        for id, tok := range toks {
            batch[id].out <- tok           // 分发回各请求的通道
            if tok.IsEOS() {
                delete(batch, id)          // 结束的移出批
            }
        }
    }
}
```

延迟与吞吐的取舍，在「收集新请求要不要等、等多久」这个旋钮上:等得久，批更大、吞吐更高，
但先到的请求被拖延;不等，延迟低，但批小、设备利用率低。第 10 章的 `select` 加上第 9 章那个
不绑定 P 的计时器（`time.After`），恰好是表达「最多等 N 毫秒来凑批」的工具。

## 20.3.3 流式：把 token 逐个吐回客户端

token 算出来了，要尽快送到用户眼前,没人愿意盯着空白等整段回答生成完。于是服务普遍采用**流式
传输**:用 Server-Sent Events、gRPC 流、或 HTTP chunked，把 token 边生成边推给客户端。

在 Go 里，这条链路是几个通道接力:生成 goroutine → 批处理分发 → 请求的 `out` 通道 → HTTP
handler 写进响应流。而 [20.2](./tokenize.md) 那个 `utf8Streamer` 正好嵌在 handler 这一端:
从通道收到的是 token 的字节，可能是半个字符，必须攒够完整的 UTF-8 码点再写给客户端，
否则用户就看到一个个 `�`。流式与正确解码，在这里合成一处。

## 20.3.4 背压与取消：别让一个慢客户端拖垮服务

最后是可靠性的硬骨头，也是这一节最该记牢的。

设想一个**慢客户端**:网络很差，token 收得很慢。token 却在源源不断地生成。如果生成与发送之间的
通道是**无界**的，积压的 token 会越堆越多，内存被一个慢客户端吃穿。若改成**有界**通道，
通道满时生成 goroutine 的 `out <- tok` 会阻塞,这就是**背压**,慢消费者的速度反压回了生产者。
背压本身是好的，第 10 章就讲过有界通道是天然的背压阀。可在推理这里，它有个致命的副作用:

> 生成 goroutine 一旦因背压阻塞，它**还占着这条请求的 KV cache 和批处理里的一个名额**。

[20.1](./runtime.md) 说过，KV cache 是每请求的大块原生内存。一个慢客户端把生成 goroutine 顶住，
等于把宝贵的设备资源攥在手里不放，几个慢客户端就能让设备利用率塌掉。所以推理服务的背压，
不能只是「阻塞等待」,得有更主动的策略:给发送通道留一个合理的缓冲、超时仍发不出去就判定客户端
掉队，进而**取消**这条请求、释放它的资源。

取消的机制，正是第 7 章的 `context`。最关键的一条:**当客户端断开连接，要立刻取消生成，
把 KV cache 还回去**。Go 的 HTTP 服务里，`http.Request.Context()` 会在客户端断开时自动 `Done`,
把它一路传进生成 goroutine（就是 20.3.1 那段骨架里的 `ctx.Done()`)，生成循环当即收手:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context() // 客户端断开时自动取消
    out := make(chan Token, 32) // 有界缓冲：吸收抖动，又不无限积压
    go generate(ctx, parse(r), out)

    stream := &utf8Streamer{}
    for tok := range out {
        if _, err := writeChunk(w, stream.Push(tok.Bytes)); err != nil {
            return // 写失败说明客户端走了，ctx 也会随之取消，generate 自行退出
        }
        flush(w)
    }
}
```

这段把本节四件事缝在了一起:`out` 是流式通道，`cap=32` 的缓冲提供有界的背压，`ctx` 在客户端
断开时取消生成、释放 KV cache，`utf8Streamer` 保证吐出去的永远是完整字符。一个生产级的 LLM
服务，在并发这一层要做对的，基本就是这几件,而它们无一不是第 7、9、10 章早已讲透的机制，
只是这次服务的对象，是一块被 GB 级模型占着的设备。

## 小结

一个大模型请求是一条随时间流出的 token 流，天然对应「一个 goroutine 往通道里送」的 Go 句式。
要喂满设备，得用连续批处理把多条在飞的请求每步动态地凑成 batch,这是个调度问题，`select` 加
计时器正好表达「最多等多久凑批」的延迟-吞吐取舍。token 边生成边流式吐回，handler 端用 20.2 的
`utf8Streamer` 保证不吐半个字符。而最该记牢的是背压与取消:慢客户端会让阻塞的生成 goroutine
攥着 KV cache 不放，拖垮设备利用率，所以要用有界缓冲加超时判定掉队，更要用第 7 章的 context
在客户端断开时立刻取消生成、归还资源。Go 服务这一层的可靠性，落点全在第 7、9、10 章那套并发
机制上。

第 20 章到此把「Go 服务一个模型」讲完了。但当下的系统往往更进一步:让模型自己调用工具、
连成多步的自主流程,这就是 **Agent**。下一章 [第 21 章](../ch21agent) 把模型的智能搁在一边，
只看运行时的那一面,会发现一个 Agent 在 Go 眼里，不过是又一个控制循环与并发问题。

## 延伸阅读的文献

1. Woosuk Kwon 等. *Efficient Memory Management for Large Language Model Serving
   with PagedAttention (vLLM).* SOSP, 2023. https://arxiv.org/abs/2309.06180
   （连续批处理与 KV cache 的分页管理，推理服务调度的代表作）
2. Gyeong-In Yu 等. *Orca: A Distributed Serving System for Transformer-Based
   Generative Models.* OSDI, 2022.
   （迭代级调度/连续批处理的提出）
3. The Go Authors. *Package context.* https://pkg.go.dev/context
   （取消信号沿调用链传播；`http.Request.Context` 在客户端断开时取消）
4. The Go Authors. *Server-Sent Events 与 net/http 的流式响应（Flusher）.*
   https://pkg.go.dev/net/http#Flusher
   （把 token 边生成边推送给客户端）
5. 本书 [7 错误处理与 context](../../part2lang/ch07errors)、
   [10 通道与 select](../../part3concurrency/ch10chan)、
   [18.4 异步编程模型](../ch18gpu/model.md)、
   [20.1 推理运行时与 FFI](./runtime.md)、[20.2 分词与张量](./tokenize.md)。
