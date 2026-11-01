---
weight: 6303
title: "20.3 服务、批处理与流式"
---

# 20.3 服务、批处理与流式

前两节讨论了单次推理的底层：[20.1](./runtime.md) 讨论如何接入运行时、如何安置权重与张量，
[20.2](./tokenize.md) 讨论词元如何进出模型。一个真实的服务要同时处理成千上万个请求，
每个请求都在持续地生成词元。如何把它们高效而稳定地组织起来，是一个并发与调度问题。本节把
[第 10 章](../../part3concurrency/ch10chan/readme.md) 的通道与
[11.8](../../part3concurrency/ch11sync/context.md) 的 context 落实到大模型服务上。

## 20.3.1 一个请求的一生

大模型是**自回归**的：每次只生成一个词元，把它接回输入，再计算下一个，直到生成结束符或达到长度上限。
一次请求因此分为两个阶段。**预填充**（prefill）一次处理完整的提示，计算后续生成所需的键与值；
**解码**（decode）在此基础上每一步生成一个词元，并复用已缓存的键与值。Orca 的论文描述了这一特点：
处理一个推理请求需要多次运行模型，每次迭代为该请求生成一个输出词元
[[Yu et al., 2022](#ref-yu-et-al-2022)]。从时间轴上看，一个请求不是一次「请求–响应」，
而是一条随时间流出的词元流。用户感受到的延迟也随之分为两部分：首词元时间（time to first token, TTFT）
主要由预填充决定，此后每个词元的间隔由解码决定。

这种形状与 Go 的并发模型十分契合：一个 goroutine 运行生成循环，每算出一个词元就送入一个通道，
下游从通道中接收。下面是一个示意的骨架，`engine` 代表 20.1 讨论的推理运行时：

```go
// 一个请求对应一个生成 goroutine，把词元逐个送入通道
func generate(ctx context.Context, req Request, out chan<- Token) {
	defer close(out)
	for {
		tok := engine.Next(req.state) // 一次跨界调用，生成一个词元
		select {
		case out <- tok: // 交给下游（HTTP handler）
		case <-ctx.Done(): // 客户端已离开，停止生成
			return
		}
		if tok.IsEOS() {
			return
		}
	}
}
```

这个骨架已经包含本节的三个主题：`out` 通道对应**流式**，`ctx.Done()` 对应**取消**，
而 `out` 已满、`out <- tok` 阻塞时，就出现了**背压**。但它还缺少最重要的一环：一个请求独占一次前向计算，
设备的算力大部分被闲置。

## 20.3.2 批处理

解码阶段每生成一个词元，都要把全部权重读一遍。Forma 在批处理的实现中给出了一笔账：两个序列一起解码时，
权重只读一次，却产生两个词元；批大小为 $B$ 时，一步的开销约为 $(W + B \cdot A)/\beta$，其中 $W$
是权重的字节数，$A$ 是每个序列自身的访存量，$\beta$ 是带宽。在 $B \cdot A$ 接近 $W$ 之前，吞吐量几乎随
$B$ 线性增长 [[Ou, 2026](#ref-ou-2026)]。解码是受内存带宽限制的计算，批处理的意义正在于此。

难点在于请求各自独立、随机到达，长度不一，结束的时间也不同。以请求为单位组批，就会出现 Orca 指出的问题：
批中先完成的请求无法立即返回给客户端，新到达的请求必须等待当前批次全部完成。Orca
提出**迭代级调度**（iteration-level scheduling）：以模型的一次迭代而不是一个请求为调度粒度，
调度器每次只让执行引擎在当前批上运行一次迭代，于是每一步都可以加入新请求、移出已完成的请求。
由于各请求的注意力计算形状不同，Orca 还提出**选择性批处理**（selective batching），只对部分算子做批处理。
在 GPT-3 175B 上，Orca 在相同延迟下的吞吐量是 NVIDIA FasterTransformer 的 36.9 倍
[[Yu et al., 2022](#ref-yu-et-al-2022)]。这一思路如今通常称为**连续批处理**（continuous batching）。
llama.cpp 的服务器默认启用它，选项说明写作「continuous batching (a.k.a dynamic batching)」，
并行处理的请求数由 `-np` 指定的槽位数决定 [[ggml-org, 2026](#ref-ggml-org-2026)]。

批处理还受制于内存。每个请求的 KV 缓存随生成增长，若为每个请求预留一段连续的、按最大长度计算的空间，
就会产生大量碎片。vLLM 的分析显示，在当时的系统中，KV 缓存内存只有 20.4% 至 38.2% 真正用于存放词元状态。
PagedAttention 借鉴操作系统的虚拟内存与分页，把 KV 缓存切分为固定大小的块，按需分配；在此基础上，vLLM
做到了 KV 缓存内存几乎零浪费，并在相同延迟下把吞吐量提高到 FasterTransformer 与 Orca 的 2 至 4 倍
[[Kwon et al., 2023](#ref-kwon-et-al-2023)]。批大小与 KV 缓存的预算因此是绑定的。Ollama 在启动
`llama-server` 时，把上下文长度设为单个请求的上下文长度乘以并行请求数
[[Ollama, 2026c](#ref-ollama-2026c)]，其 FAQ 也提醒，所需内存随 `OLLAMA_NUM_PARALLEL` 与
`OLLAMA_CONTEXT_LENGTH` 的乘积增长 [[Ollama, 2026b](#ref-ollama-2026b)]。

准入策略也要随之调整。Forma 的批处理模式让所有槽位共用一个分块的 KV 缓存池，
并在注释中说明了一个容易忽视的死锁：如果只要有空闲槽位就准入请求，可能出现所有槽位都被占用、
缓存池已经耗尽、没有一个序列还能继续增长的局面，于是没有请求能够完成，也没有可以释放的资源。
因此它在准入时不仅为提示预留缓存块，也为回答预留一部分位置，保证被准入的请求能够完成
[[Ou, 2026](#ref-ou-2026)]。每一步的组成同样是调度策略的一部分：Forma 把预填充的分块与解码放进同一次计算，
先安排尚未得到首词元的预填充分块，以缩短首词元时间，再为每个解码中的序列各安排一行，
放不下的序列等待下一步，而不是被逐出。

用 Go 表达这样的调度循环并不困难。下面的骨架同样是示意性的：

```go
// 批处理调度：每一步动态增删在途的请求
func batchLoop(incoming <-chan *Seq) {
	batch := map[ID]*Seq{}
	for {
		drainNewArrivals(incoming, batch) // 非阻塞地收集新请求
		if len(batch) == 0 {
			seq := <-incoming // 批次为空时阻塞，等待第一个请求
			batch[seq.ID] = seq
			continue
		}
		toks := engine.Step(batch) // 一次前向计算，每个序列各得一个词元
		for id, tok := range toks {
			deliver(batch[id], tok) // 分发给各请求，见 20.3.4
			if tok.IsEOS() {
				delete(batch, id) // 已完成的请求移出批次
			}
		}
	}
}
```

迭代级调度下，新请求在下一步就能加入，不必为了凑满一批而等待。延迟与吞吐的取舍转移到了别处：
槽位数决定并发度与 KV 缓存的预算，预填充的分块大小决定长提示在多大程度上拖慢同批中的解码。
Forma 把这些策略与执行机制分成两个类型：`Scheduler` 决定准入谁、每一步算什么，`Batch` 负责执行；
注释给出的理由是，二者一起构建时，批处理的缺陷与准入的缺陷将无从区分 [[Ou, 2026](#ref-ou-2026)]。

## 20.3.3 流式

词元生成之后应当尽快送到用户面前。推理服务普遍采用流式传输，例如基于 HTTP 的 Server-Sent Events（SSE），
边生成边推送。在 Go 中，这条链路是若干通道的接力：生成循环、批处理的分发、每个请求的输出通道，最后由 HTTP
handler 写入响应。[20.2](./tokenize.md) 的 UTF-8 缓冲解码就位于这条链路上，
保证写给客户端的始终是完整的字符。

handler 一侧有两件事最容易出错。其一是每个事件之后都要刷新输出缓冲，否则 `net/http` 会缓冲响应，
客户端最终一次性收到整段回答。这样的实现能通过所有只检查内容的测试，却失去了流式的意义。
其二是刷新的方式。Forma 的处理如下：

```go
// NewResponseController rather than a w.(http.Flusher) assertion: it
// unwraps middleware, so a wrapper added later cannot silently turn
// flushing off while the content tests stay green.
rc := http.NewResponseController(w)
flush := func() { _ = rc.Flush() }
```

注释的意思是：使用 `NewResponseController` 而不是对 `w` 做 `http.Flusher` 类型断言，
因为前者会穿过中间件的包装，以后添加的包装层不会在内容测试照常通过的情况下悄悄关闭刷新
[[Ou, 2026](#ref-ou-2026)]。`http.ResponseController` 随 Go 1.20 引入。它的 `Flush`
方法依次检查当前这一层是否实现了 `FlushError` 或 `Flush`，都没有实现而带有 `Unwrap` 方法时，
就取出被包装的 `ResponseWriter` 继续检查，直到找到实现或返回 `ErrNotSupported`（以 Go 1.26
为准）[[Go Authors, n.d.b](#ref-go-authors-ndb)]。直接做类型断言时，一个没有实现 `Flush`
的包装层就会让断言失败。Forma 还要求流的最后一个事件携带停止原因与用量统计，
否则正常结束的流与中途断开的连接将无法区分。

## 20.3.4 背压与取消

设想一个**慢客户端**：网络很差，接收词元很慢，而词元在源源不断地生成。若生成与发送之间的通道无界，
积压的词元会越来越多，一个慢客户端就能耗尽内存。若通道有界，通道满时发送方就会阻塞，
慢消费者的速度反压回生产者，这就是**背压**。第 10 章讨论过，有界通道本身就是一种背压机制。但在推理服务中，
阻塞有一个严重的副作用：

> 因背压而阻塞的生成循环，仍然占着这个请求的 KV 缓存与批处理中的一个槽位。

在批处理架构中，情况更糟。若 20.3.2 的调度循环用阻塞发送把词元交给每个请求，
一个慢客户端就会让整个批次停下来，所有请求都跟着等待。所以分发必须是非阻塞的：每个请求有一个有界的缓冲，
缓冲满时判定客户端掉队，取消这个请求并释放它的资源。下面的程序模拟了这一策略：

```go {run=true}
package main

import "fmt"

type stream struct {
	name string
	out  chan int // 有界缓冲：每个请求最多积压 2 个词元
	read bool     // 模拟客户端是否及时读取
}

func main() {
	streams := []*stream{
		{name: "快", out: make(chan int, 2), read: true},
		{name: "慢", out: make(chan int, 2), read: false},
	}
	for step := 1; step <= 4; step++ {
		// 一次前向计算之后，把这一步的词元分发给批中的每个请求。
		live := streams[:0]
		for _, s := range streams {
			select {
			case s.out <- step: // 非阻塞发送：不让一个请求卡住整个批次
				live = append(live, s)
			default: // 缓冲已满：判定客户端掉队，移出批次
				fmt.Printf("第 %d 步：%s客户端积压 %d 个词元，取消该请求\n", step, s.name, len(s.out))
			}
		}
		streams = live
		for _, s := range streams {
			if s.read {
				<-s.out
			}
		}
		fmt.Printf("第 %d 步：批中剩余 %d 个请求\n", step, len(streams))
	}
}
```

```
第 1 步：批中剩余 2 个请求
第 2 步：批中剩余 2 个请求
第 3 步：慢客户端积压 2 个词元，取消该请求
第 3 步：批中剩余 1 个请求
第 4 步：批中剩余 1 个请求
```

慢客户端的缓冲在第 2 步之后已满，第 3 步的非阻塞发送落入 `default` 分支，请求被移出批次；
快客户端不受影响。缓冲的容量决定了容忍多大的网络抖动，而 `select` 的 `default`
分支保证调度循环永远不会因为某一个请求而停下。

取消依靠 context。最关键的一条是：**客户端断开连接时，必须立刻停止生成，归还 KV 缓存。** `net/http`
为此提供了现成的信号。`Request.Context` 的文档写明，对于服务端收到的请求，当客户端的连接关闭、
请求被取消（HTTP/2）或 `ServeHTTP` 方法返回时，这个 context 就会被取消（以 Go 1.26 为准）。
把它一路传入生成循环，循环就能在 `ctx.Done()` 上及时退出 [[Go Authors, n.d.a](#ref-go-authors-nda)]。
Forma 的 handler 注释特别指出，不读取这个 context 的循环会一直占着会话与它预留的 KV 缓存，直到生成达到
`max_tokens`；它甚至把 context 交给了等待空闲会话的那一步，在排队期间离开的客户端不应再占用一个它不会读取
的会话。这种情况以状态码 499 记录，沿用 nginx 表示「客户端已关闭请求」的约定，而不算作服务端的失败
[[Ou, 2026](#ref-ou-2026)]。

背压的另一端在入口处：请求太多时，应当尽早拒绝，而不是无限排队。Ollama
的调度器用一个带缓冲的通道作为待处理队列，容量由 `OLLAMA_MAX_QUEUE` 决定（默认 512），
新请求以非阻塞的方式入队 [[Ollama, 2026a](#ref-ollama-2026a)]：

```go
select {
case s.pendingReqCh <- req:
default:
	req.errCh <- ErrMaxQueue
}
```

队列满时，`select` 落入 `default` 分支，请求立即得到「服务繁忙」的错误，FAQ 说明此时服务器返回 503
[[Ollama, 2026b](#ref-ollama-2026b)]。有界缓冲通道加上 `select` 的 `default` 分支，就是 Go
中最简单的过载保护。

Forma 的准入队列走得更远。它同样有界，默认深度为每个槽位 8 个等待者，等待超过
30 秒或到达时队列已满的请求以 429 拒绝，并附带 `Retry-After` 头；注释写明，
无界队列只是把拒绝换成了无界的延迟。它刻意让「等待超时」与「客户端取消」成为两种不同的错误，因为前者对应
429，后者对应 499，若用一个由等待预算派生的 context 表示超时，二者就会混为一谈
[[Ou, 2026](#ref-ou-2026)]。唤醒等待者的方式也值得一看。调度器每释放一个槽位或一批缓存块，就发出一个信号：

```go
// signal offers one capacity event and drops it if one is already pending.
func (s *Scheduler) signal() {
	select {
	case s.capacity <- struct{}{}:
	default:
	}
}
```

`capacity` 是一个容量为 1 的通道，发送是非阻塞的：已有一个信号待处理时，新的信号被丢弃。这样，
一连串的释放只会触发一次重新评估，等待者等的是事件而不是计时器。队列只用一个 goroutine 驱动所有等待者，
因为先到先服务、队首被超越的次数这些规则都是全局状态；注释还指出，若有 N 个读者各自等在这个通道上，
就会丢失唤醒：抢到信号的那个读者可能恰好是规则不允许准入的，其余读者则要一直睡到下一次释放
[[Ou, 2026](#ref-ou-2026)]。

## 小结

一个大模型请求分为预填充与解码两个阶段，表现为一条随时间流出的词元流，对应 Go 中「一个 goroutine
向通道发送」的写法。解码受内存带宽限制，批处理让多个序列共享一次权重读取；迭代级调度（连续批处理）
让请求在每一步加入或离开批次，分页的 KV 缓存则减少了碎片，使批次可以更大。
准入时既要为提示也要为回答预留缓存，才能避免死锁。流式输出要求每个事件之后刷新，`http.ResponseController`
能穿过中间件完成刷新。背压与取消决定服务的可靠性：批处理的分发必须是非阻塞的，掉队的客户端要被取消；
`Request.Context` 在客户端断开时取消，生成循环必须响应它；入口处的队列必须有界，用带缓冲的通道与 `select`
的 `default` 分支即可实现过载保护。这些机制都来自第 10 章与 11.8 讨论的并发原语，只是这一次，
它们保护的是一块被 GB 级模型占用的设备。

至此，第 20 章讨论了如何用 Go 服务一个模型。当下的系统往往更进一步，让模型调用工具、串联成多步的自主流程，
这就是 Agent。[第 21 章](../ch21agent/readme.md) 暂且不谈模型的智能，只看运行时的一面：在 Go 看来，
一个 Agent 同样是一个控制循环与并发问题。

## 延伸阅读

- <a id="ref-ggml-org-2026"></a>[ggml-org, 2026] ggml-org. *llama.cpp b11963*（提交 39febd2adb）：
  `tools/server/README.md`. 2026. https://github.com/ggml-org/llama.cpp/blob/b11963/tools/server/README.md
  `-cb`（连续批处理，默认启用）与 `-np`（槽位数）等选项。
- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *Package context.*
  https://pkg.go.dev/context
  取消信号沿调用链传播；`http.Request.Context` 在客户端断开时取消。
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *Server-Sent Events 与 net/http
  的流式响应（Flusher）.* https://pkg.go.dev/net/http#Flusher
  把词元边生成边推送给客户端；另见 Go 1.20 引入的 https://pkg.go.dev/net/http#ResponseController 。
- <a id="ref-kwon-et-al-2023"></a>[Kwon et al., 2023] Woosuk Kwon 等. *Efficient Memory Management for
  Large Language Model Serving with PagedAttention (vLLM).* SOSP, 2023. https://arxiv.org/abs/2309.06180
  KV 缓存的分页管理，推理服务调度的代表作。
- <a id="ref-ollama-2026a"></a>[Ollama, 2026a] Ollama. *server/sched.go.* v0.40.13（提交 04088e7c9d），
  2026. https://github.com/ollama/ollama/blob/v0.40.13/server/sched.go
  以带缓冲通道实现的待处理队列与 `ErrMaxQueue`。
- <a id="ref-ollama-2026b"></a>[Ollama, 2026b] Ollama. *FAQ.* v0.40.13（提交 04088e7c9d），2026.
  https://github.com/ollama/ollama/blob/v0.40.13/docs/faq.mdx
  `OLLAMA_NUM_PARALLEL`、`OLLAMA_MAX_QUEUE` 与过载时的 503。
- <a id="ref-ollama-2026c"></a>[Ollama, 2026c] Ollama. *llm/llama_server.go.* v0.40.13（提交
  04088e7c9d），2026. https://github.com/ollama/ollama/blob/v0.40.13/llm/llama_server.go
  启动 `llama-server` 时的 `-np` 与 `-c` 参数。
- <a id="ref-ou-2026"></a>[Ou, 2026] Changkun Ou. *Forma: Run open-weight LLMs from Go.*
  https://github.com/latere-ai/forma, 2026.
以提交 5af707fbe6 为准；见 `batch.go`、`scheduler.go`、`schedule.go`、`queue.go`、`server/generate.go` 与
`docs/serving.md`。
- <a id="ref-yu-et-al-2022"></a>[Yu et al., 2022] Gyeong-In Yu 等. *Orca: A Distributed Serving System for
  Transformer-Based Generative Models.* OSDI, 2022.
  https://www.usenix.org/conference/osdi22/presentation/yu
  迭代级调度与选择性批处理，连续批处理思路的出处。
- 本书 [11.8 上下文](../../part3concurrency/ch11sync/context.md)、
  [第 10 章 通道与 select](../../part3concurrency/ch10chan/readme.md)、
  [18.4 异步编程模型](../ch18gpu/model.md)、
  [20.1 推理运行时与 FFI](./runtime.md)、[20.2 分词与张量](./tokenize.md)。
