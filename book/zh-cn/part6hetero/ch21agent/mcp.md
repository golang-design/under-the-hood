---
weight: 6402
title: "21.2 工具调用与 MCP"
---

# 21.2 工具调用与 MCP

[21.1](./loop.md) 把 Agent 归结为一个控制循环，循环中最关键的动作是执行工具。本节讨论工具本身：
一个工具在机制上是什么，运行时如何把模型的调用请求分发到真正的代码，以及当工具的数量与来源迅速增长时，**Model
Context Protocol**（MCP）如何用一套协议把工具的接入标准化。从结构上看，工具调用是一次结构化的
远程过程调用，而编写 RPC 服务是 Go 程序员熟悉的工作。

## 21.2.1 工具：带 schema 的函数

一个工具由三部分组成：一个名字，一段给模型阅读的自然语言描述，以及一份描述参数结构的 schema，
通常是 JSON Schema。模型在每一步看到的就是这样一组工具的名字、描述与参数格式；它据此决定是否调用、
调用哪个、传入什么参数，然后输出一个结构化的调用请求，即工具名加一组 JSON 参数。运行时收到请求后，
找到对应的函数，反序列化参数，执行，再把结果序列化交回模型。

名字加序列化的参数、执行、再返回序列化的结果，这就是 RPC 的结构。在 Go 中，工具最自然的表示是一个接口：

```go
type Tool interface {
	Name() string            // 分发用的键
	Description() string     // 给模型看的说明
	Schema() json.RawMessage // 参数的 JSON Schema
	Invoke(ctx context.Context, args json.RawMessage) (json.RawMessage, error)
}

// 分发是一次 map 查找
func (a *Agent) callTool(ctx context.Context, call ToolCall) (json.RawMessage, error) {
	tool, ok := a.tools[call.Name]
	if !ok {
		return nil, fmt.Errorf("unknown tool: %s", call.Name)
	}
	return tool.Invoke(ctx, call.Args) // ctx 随调用传入，21.3 的取消依赖于此
}
```

`Invoke` 的第一个参数是 `context.Context`。工具往往要发 HTTP 请求、查询数据库或读写文件，
这些都是可能阻塞的 I/O；只有把 ctx 一路传下去，21.3 讨论的超时与取消才能到达最底层。

这里有两类不同的失败。名字查不到，说明调用请求本身有误；工具执行时出错，例如参数取值越界或下游服务不可用，
则是模型可以据以修正的反馈。21.1 的示例把后一类错误作为观察结果交还模型，下文会看到，MCP
在协议中明确区分了这两类错误。

## 21.2.2 为什么需要协议：M×N 问题

如果每个 Agent 只使用自己定义的几个工具，上面的接口已经够用。但工具的来源越来越多：文件系统、数据库、
搜索引擎、代码仓库以及各种在线服务，都希望把自己的能力提供给模型。若每个 Agent
框架都以自己的方式定义工具，每个工具提供方也各自实现一套接口，M 个框架对接 N 个工具来源，就需要 M×N
套互不兼容的集成。Anthropic 在 2024 年 11 月 25 日开源 MCP 时，描述的正是这一问题
[[Anthropic, 2024](#ref-anthropic-2024)]：

```text
Every new data source requires its own custom implementation, making truly
connected systems difficult to scale.
```

即每接入一个新的数据源都需要一套定制实现，使真正互联的系统难以扩展。文章给出的方案是用一个开放标准
取代零散的集成。

这是软件工程中反复出现的解法：在中间放置一个**细腰**（narrow waist），定义一个标准协议，
任何实现了该协议的宿主都能使用任何实现了该协议的工具来源，M×N 套集成于是减少为 M+N 个实现。MCP
规范说明它借鉴了语言服务器协议（LSP）：LSP 为编程语言支持与开发工具之间建立了统一的协议，MCP 则在 AI
应用与外部的上下文和工具之间做同样的事
[[Model Context Protocol, 2026](#ref-model-context-protocol-2026)]。MCP 的官方网站还把它比作「AI 应用的
USB-C 接口」[[Model Context Protocol, n.d.](#ref-model-context-protocol-nd)]。

规范把参与方分为三种角色：**宿主**（host）是发起连接的 AI 应用，**客户端**（client）是宿主内部的连接器，**服
务器**（server）提供上下文与能力。一个宿主可以创建多个客户端，每个客户端只与一个服务器通信，
二者是一对一的关系 [[Model Context Protocol, 2026](#ref-model-context-protocol-2026)]。

## 21.2.3 协议机制：JSON-RPC 2.0 与两种传输

MCP 的消息格式是 JSON-RPC 2.0。JSON-RPC 定义了三种消息：带 `id` 的请求，与请求 `id` 对应、携带 `result`
或 `error` 的响应，以及不带 `id` 的通知；通知表示发送方不关心回应，接收方不得回复。JSON-RPC 与传输无关，
同一套消息可以在进程内、套接字或 HTTP 之上传递
[[JSON-RPC Working Group, 2010](#ref-json-rpc-working-group-2010)]。MCP 在此基础上加了几条约束：请求的
`id` 不得为 `null`，同一发送方尚未得到响应的请求不得共用 `id`，成功结果必须带有 `resultType` 字段
[[Model Context Protocol, 2026](#ref-model-context-protocol-2026)]。

与工具相关的方法有两个：`tools/list` 返回服务器提供的工具，每个工具带有名字、描述与 `inputSchema`，
即 21.2.1 中的三个组成部分；`tools/call` 以工具名与参数调用一个工具，取回结果。

握手的方式在规范的演进中发生过变化。从 2024-11-05 到 2025-11-25 的各个修订版中，一次会话以 `initialize`
请求开始，双方交换协议版本与能力，客户端再发送 `notifications/initialized` 通知，之后才进入正常的请求。
本节依据的 2026-07-28 修订版取消了这次握手，MCP 成为无状态协议：每个请求都在 `_meta`
字段中携带自己的协议版本（`io.modelcontextprotocol/protocolVersion`）
与客户端能力（`io.modelcontextprotocol/clientCapabilities`），服务器不得依赖同一连接上先前的请求来确定这些
信息；服务器必须实现新增的 `server/discover` 方法，客户端可以在其他请求之前用它查询服务器支持的版本与能
力。同一修订版还规定服务器不再主动发起 JSON-RPC 请求，原先由服务器发起的交互改为在结果中返回待补充的输入，
由客户端带着答复重试原请求 [[Model Context Protocol, 2026](#ref-model-context-protocol-2026)]。
对服务器的实现者而言，这意味着处理一个请求所需的信息全部在请求之内，任何一个副本都可以处理任何一个请求，
这与 Go 的 `net/http` 服务器按请求处理、水平扩展的方式一致。

JSON-RPC 消息由**传输**（transport）承载。2026-07-28 修订版定义了两种标准传输
[[Model Context Protocol, 2026](#ref-model-context-protocol-2026)]：

- **stdio**：客户端把服务器作为子进程启动，双方经由子进程的标准输入与标准输出交换以换行分隔的 JSON-RPC
  消息。服务器的标准输出上只能出现合法的 MCP 消息，日志写到标准错误。它适合本地工具：进程隔离，无需网络。
- **Streamable HTTP**：服务器是独立的进程，提供单一的 HTTP 端点；客户端发出的每条消息都是一次 POST，
  服务器以单个 JSON 对象，或者以只属于这次请求的 SSE（Server-Sent Events）流作答，
  流中先是与请求相关的通知，最后是响应。它适合远端、共享、需要独立伸缩的工具。

Streamable HTTP 在 2025-03-26 修订版中引入，取代了 2024-11-05 的 HTTP+SSE 传输，后者现已被正式列为弃用。2026-07-28
修订版又从 Streamable HTTP 中移除了用于服务器推送的 GET 端点和协议层的会话（`Mcp-Session-Id`
头）。这样的演进对中间层也有直接影响。pons 是一个代为持有用户凭据、转发工具调用的服务
[[Ou, 2026a](#ref-ou-2026a)]，它在转发 MCP 请求时，除了当前修订版唯一使用的 POST，仍然接受 GET 与 DELETE，
以兼容 2025-03-26 至 2025-11-25 各修订版中打开推送流与结束会话的用法：

```go
// MCPMethods are the methods the MCP address carries: POST, the one method
// of the current revision, and GET and DELETE, which the revisions
// 2025-03-26 to 2025-11-25 use to open a stream and to end a session. Any
// other is refused before the connection is loaded.
var MCPMethods = []string{http.MethodPost, http.MethodGet, http.MethodDelete}
```

stdio 与 Streamable HTTP 的取舍，是 [18.1](../ch18gpu/boundary.md) 中「边界放在哪里」
这一问题的又一次出现：需要隔离与简单时，选择子进程；需要远端访问与共享时，选择网络服务。

## 21.2.4 在 Go 中实现服务器

MCP 有官方的 Go SDK（`github.com/modelcontextprotocol/go-sdk`），v1.0.0 发布于 2025 年 9 月 30 日，自
v1.7.0 起支持 2026-07-28 修订版。它的设计文档写明，仓库最初由 Go 团队与 Anthropic 共同管理；
文档还解释了为什么把大部分 API 放进单一的 `mcp` 包：这与其他语言的 MCP SDK 不同，却与 `net/http`、`net/rpc`
和 `google.golang.org/grpc` 的做法一致，便于在文档与编辑器中查找
[[modelcontextprotocol, 2026](#ref-modelcontextprotocol-2026)]。

下面是一个只提供一个工具的服务器，基于 SDK 的 v1.8.0，以 Go 1.26.10 构建：

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type WeatherIn struct {
	City string `json:"city" jsonschema:"城市名"`
}

type WeatherOut struct {
	Summary string `json:"summary" jsonschema:"天气概况"`
}

func getWeather(ctx context.Context, req *mcp.CallToolRequest, in WeatherIn) (
	*mcp.CallToolResult, WeatherOut, error,
) {
	s, err := fetchWeather(ctx, in.City) // 普通的 Go 函数，ctx 随调用传入
	if err != nil {
		return nil, WeatherOut{}, err // 作为工具执行错误返回：isError 为 true
	}
	return nil, WeatherOut{Summary: s}, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: "weather", Version: "v0.1.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_weather",
		Description: "查询某个城市当前的天气",
	}, getWeather)
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}

func fetchWeather(ctx context.Context, city string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s：晴", city), nil
}
```

`mcp.AddTool` 是一个泛型函数，处理函数的类型是 `ToolHandlerFor[In, Out]`：

```go
type ToolHandlerFor[In, Out any] func(_ context.Context, request *CallToolRequest, input In) (result *CallToolResult, output Out, _ error)
```

SDK 据此做了几件事：由 `In` 类型推导工具的输入 schema，字段名取自 `json`
标签（[[Go Authors, 2026](#ref-go-authors-2026)]），字段说明取自 `jsonschema` 标签，推导与校验由
`github.com/google/jsonschema-go` 完成
[[JSON Schema Go Project Authors, 2026](#ref-json-schema-go-project-authors-2026)]；参数先按 schema 校验，
不合格的请求不会到达处理函数；`Out` 类型同样给出输出 schema，返回值填入结果的 `structuredContent`。
错误的处理与 21.2.1 的两类失败相对应：SDK 文档写明，`ToolHandlerFor` 返回的错误按工具错误处理，
放进结果的内容并把 `isError` 置为真；而底层的 `ToolHandler` 返回的错误按协议错误处理
[[modelcontextprotocol, 2026](#ref-modelcontextprotocol-2026)]。规范对两者的定位是：
协议错误表示请求结构本身的问题，例如未知的工具；工具执行错误则携带模型可以据以修正、重试的反馈，
客户端应当把它交给模型 [[Model Context Protocol, 2026](#ref-model-context-protocol-2026)]。

把编译好的程序作为子进程运行，经由标准输入按 2026-07-28 的格式依次发送 `server/discover`、`tools/list`
与两次 `tools/call`，每个请求都在 `_meta` 中带上协议版本、客户端信息与客户端能力，无需事先握手。第二次
`tools/call` 故意省略了必填的 `city` 参数。两次调用得到的响应如下（以 go-sdk v1.8.0 为准）：

```text
{"jsonrpc":"2.0","id":3,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"weather","version":"v0.1.0"}},"content":[{"type":"text","text":"{\"summary\":\"柏林：晴\"}"}],"structuredContent":{"summary":"柏林：晴"},"resultType":"complete"}}
{"jsonrpc":"2.0","id":4,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"weather","version":"v0.1.0"}},"content":[{"type":"text","text":"validating \"arguments\": validating root: required: missing properties: [\"city\"]"}],"isError":true,"resultType":"complete"}}
```

缺少参数的调用没有得到 JSON-RPC 错误，而是得到一个 `isError` 为真的正常结果，错误信息写在内容中，
可以原样交给模型。`tools/list` 的响应中，由 `WeatherIn` 推导出的输入 schema 如下，`city` 被列为必填，
且不接受额外的属性：

```text
"inputSchema":{"type":"object","properties":{"city":{"type":"string","description":"城市名"}},"required":["city"],"additionalProperties":false}
```

并发方面，SDK 对除 `initialize` 之外的每个请求调用 `jsonrpc2.Async`，使它的处理不必等待后续请求；
源码注释写明，请求异步处理，通知同步处理。服务器因而可以同时处理多个 `tools/call`，
处理函数中的共享状态需要按第 10、11 章的方式用通道或锁保护。写过 Go RPC 服务的读者，已经熟悉 MCP
服务器的大部分结构；协议的消息格式由 SDK 封装。

## 21.2.5 工具的权限边界

工具让模型的输出产生实际的外部影响，因此规范在工具一节中建议，出于安全考虑，应当始终有人能够拒绝工具调用，
应用应当清楚展示哪些工具对模型可见、何时被调用，并在执行操作前征求用户确认。对 Streamable HTTP，
服务器必须校验 `Origin` 头以防范 DNS 重绑定攻击，在本地运行时应当只绑定 localhost
[[Model Context Protocol, 2026](#ref-model-context-protocol-2026)]。

是否请人确认，本身也是运行框架要作出的决定。limen 把动作执行之前作出这一决定的代码称为决策点，它在允许、
询问与阻止三者之间选择 [[Ou, 2026b](#ref-ou-2026b)]。它的 README 指出，
许多运行框架只有允许与拒绝两种选择，而拒绝并不会让 Agent 停下来等人：Agent 把拒绝当作一个结果读入，
继续执行，常常改用一个比询问更糟的动作；能够询问的运行框架，又往往依据一份固定的清单，
看不到同一个人已经批准过上百次的测试命令。limen 根据同一个人此前的答复预测其批准某个动作的概率，
再由组织给定的各类代价换算出两个阈值：概率高于上阈值则允许，低于下阈值则阻止，介于二者之间则询问。
这个预测本身可能变慢或失败，limen 为此提供了一个包装，保证决策点等待预测的时间不超过上限，
也不会把失败当作允许：

```go
func (f failClosed) Predict(ctx context.Context, a Action) (Prediction, error) {
	if f.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, f.timeout)
		defer cancel()
	}
	type result struct {
		p   Prediction
		err error
	}
	done := make(chan result, 1)
	go func() {
		p, err := f.p.Predict(ctx, a)
		done <- result{p, err}
	}()
	var r result
	select {
	case r = <-done:
	case <-ctx.Done():
		r.err = ctx.Err()
	}
	if r.err == nil {
		return r.p, nil
	}
	// ……
	return Prediction{
		Key:     a.Key,
		Verdict: Ask,
		// ……
	}, nil
}
```

超时或出错时，结果一律是「询问」，动作交给人决定。`done` 的容量为 1，即使 `select` 已经因超时返回、
再没有人接收，预测的 goroutine 也能把结果放进缓冲区后退出，不会泄漏；它是否尽快结束，
则取决于底层预测器是否遵守 ctx 的取消，这是 21.3 的话题。

更棘手的是凭据。工具常常要以用户的身份访问代码仓库或文档，若把令牌交给 Agent 的沙箱，
沙箱中运行的任何代码都能读到它。pons 的做法是让凭据始终留在代理一侧：调用方以自己的令牌访问 pons
为某个连接分配的地址，pons 询问授权方这次调用是否被允许，在转发时加上凭据，再把答复传回；
转发时调用方自己的 `Authorization` 头首先被移除，上游返回的 `WWW-Authenticate` 等头也不会传回调用方
[[Ou, 2026a](#ref-ou-2026a)]。它的 README 这样概括其效果：

```text
A prompt that tricks an agent can make it send a request. It cannot make
it reveal a credential it never held.
```

即诱骗 Agent 的提示词可以让它发出一个请求，却不能让它泄露一份它从未持有的凭据。

## 小结

工具是一个带 schema 的函数：名字、描述与参数格式。模型据此输出结构化的调用请求，
运行时把它分发到真正的代码。这一结构就是 RPC，在 Go 中可以表示为一个 `Tool` 接口加一次 map 查找，`Invoke`
接受 ctx，为取消留下通路。当工具来源增长为 M×N 的集成问题时，MCP 以一个标准协议作为细腰，把它减少为 M+N
个实现。它以 JSON-RPC 2.0 为消息格式，以 `tools/list` 与 `tools/call` 发现和调用工具；2026-07-28
修订版取消了 `initialize` 握手，每个请求自带版本与能力，使服务器成为无状态的。消息经由 stdio 子进程或
Streamable HTTP 承载，二者的取舍仍是「边界放在哪里」的问题。官方 Go SDK 用泛型处理函数把 Go 类型映射为
JSON Schema，并把规范中协议错误与工具错误的区分对应到两种处理函数类型上。

工具会慢、会卡住、会失败，而上层的模型推理本身就是流式的。下一节 [21.3](./stream.md) 讨论流式、背压与取消
如何贯穿整条 Agent 链路，其中会再次用到 [11.8](../../part3concurrency/ch11sync/context.md) 的 context
与第 10 章的通道。

## 延伸阅读

- <a id="ref-anthropic-2024"></a>[Anthropic, 2024] Anthropic. *Introducing the Model Context Protocol.*
  November 25, 2024. https://www.anthropic.com/news/model-context-protocol
  （开源 MCP 的公告；以一个开放标准取代零散的定制集成。「USB-C」的比喻见于 MCP 官方网站的介绍页）
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Package encoding/json 与 reflect.*
  https://pkg.go.dev/encoding/json
  （结构体标签与反射，是由 Go 类型生成和校验 schema、把类型与协议消息对接的基础）
- <a id="ref-json-rpc-working-group-2010"></a>[JSON-RPC Working Group, 2010] JSON-RPC Working Group.
  *JSON-RPC 2.0 Specification.* 2010（2013 年 1 月 4 日修订）. https://www.jsonrpc.org/specification
  （请求、响应与通知三种消息；通知不带 `id`，接收方不得回复；与传输无关）
- <a id="ref-json-schema-go-project-authors-2026"></a>[JSON Schema Go Project Authors, 2026] The JSON
  Schema Go Project Authors. jsonschema-go. https://github.com/google/jsonschema-go, 2026.（由
  Go 类型推导 JSON Schema 并据以校验；go-sdk v1.8.0 依赖其 v0.4.3）
- <a id="ref-model-context-protocol-2026"></a>[Model Context Protocol, 2026] Model Context Protocol.
  *Specification,* revision 2026-07-28. https://modelcontextprotocol.io/specification/2026-07-28
  （本节依据的修订版：JSON-RPC 消息、无状态的请求、`server/discover`、`tools/list` 与 `tools/call`、stdio
  与 Streamable HTTP 传输，以及各修订版之间的变更记录；网站首页为 <https://modelcontextprotocol.io/>）
- <a id="ref-model-context-protocol-nd"></a>[Model Context Protocol, n.d.] Model Context Protocol. *What
  is the Model Context Protocol (MCP)?* https://modelcontextprotocol.io/docs/getting-started/intro
  （官方网站的介绍页，把 MCP 比作 AI 应用的 USB-C 接口）
- <a id="ref-modelcontextprotocol-2026"></a>[modelcontextprotocol, 2026] modelcontextprotocol.
  *Official Go SDK.* v1.8.0, 2026. https://github.com/modelcontextprotocol/go-sdk
  （`mcp.NewServer`、`mcp.AddTool`、`ToolHandlerFor`、`StdioTransport`、`session.CallTool`；
  仓库中的 `design/design.md` 说明了单一 `mcp` 包的取舍，以及仓库最初由 Go 团队与 Anthropic 共同管理）
- <a id="ref-ou-2026a"></a>[Ou, 2026a] Changkun Ou. pons. https://github.com/latere-ai/pons, 2026.（代
  为持有用户凭据、转发工具调用的服务；经 Streamable HTTP 转发 MCP，凭据不经过调用方）
- <a id="ref-ou-2026b"></a>[Ou, 2026b] Changkun Ou. limen. https://github.com/latere-ai/limen, 2026.（学
  习一个人会批准哪些自动执行的动作，并度量每种自动决定出错的频率；尚处于预发布阶段）
- 本书 [第 10 章 通道与 select](../../part3concurrency/ch10chan/readme.md)、[第
  11 章 同步原语与模式](../../part3concurrency/ch11sync/readme.md)、[11.8
  上下文](../../part3concurrency/ch11sync/context.md)、[18.1
  跨越 FFI 边界](../ch18gpu/boundary.md)、[21.1
  Agent 控制循环](./loop.md)、[21.3 流式、背压与取消](./stream.md)。
