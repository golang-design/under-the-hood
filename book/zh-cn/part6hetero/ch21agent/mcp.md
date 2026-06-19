---
weight: 6402
title: "21.2 工具调用与 MCP"
---

# 21.2 工具调用与 MCP

[21.1](./loop.md) 把 Agent 还原成了一个控制循环，而循环里最关键的那个动作是「执行工具」。
这一节就专讲工具:一个工具在机制上是什么，模型怎么决定调用它，运行时怎么把调用分发到真正的代码，
以及当工具的数量与来源爆炸式增长时，**Model Context Protocol**(MCP)如何用一套协议把这件事
标准化。看清这一层，会发现工具调用本质上就是一次结构化的远程过程调用,而 RPC 正是 Go 的老本行。

## 21.2.1 工具是什么：一个带 schema 的函数

剥开「工具」这个词，它不过是**一个带类型描述的函数**,由三部分组成:一个名字、一段给模型看的
自然语言描述、一份参数的结构化 schema(通常是 JSON Schema)。模型在每一步看到的，就是这样一组
工具的名字、描述与参数格式;它据此决定要不要调、调哪个、传什么参数，然后输出一个**结构化的调用
请求**:工具名加一组 JSON 参数。运行时接到这个请求，查到对应的函数，反序列化参数，执行，
再把结果序列化回去。

把这个流程念一遍，它的形状就是 RPC:**名字 + 序列化参数 → 执行 → 序列化结果**。在 Go 里，
工具最自然地落成一个接口:

```go
type Tool interface {
    Name() string                  // 分发用的键
    Description() string           // 给模型看的说明
    Schema() json.RawMessage       // 参数的 JSON Schema
    Invoke(ctx context.Context, args json.RawMessage) (json.RawMessage, error)
}

// 分发就是一次 map 查找加一次反序列化
func (a *Agent) callTool(ctx context.Context, call ToolCall) (json.RawMessage, error) {
    tool, ok := a.tools[call.Name]
    if !ok {
        return nil, fmt.Errorf("unknown tool: %s", call.Name)
    }
    return tool.Invoke(ctx, call.Args) // ctx 一路透传，为 21.3 的取消埋好线
}
```

注意 `Invoke` 的签名带着 `context.Context`,这不是摆设:工具可能要发 HTTP、查数据库、读文件，
都是可能阻塞的 I/O,把 ctx 透传进去，21.3 讲的超时与取消才能一路抵达最底层。一个工具调用框架的
运行时核心，基本就是这个接口加这次 map 分发,又一次，没有一行机器学习。

## 21.2.2 为什么需要一个协议：M×N 问题

如果每个 Agent 自己定义几个工具，上面这套就够了。可现实是工具的来源在爆炸:文件系统、数据库、
搜索引擎、代码仓库、各种 SaaS,每一个都想把自己的能力暴露给模型。问题随之而来:如果每个 Agent
框架(host)都用自己的方式定义工具，每个工具提供方都各搞一套接口，那么 M 个 host 对接 N 个工具源，
就是 **M×N** 套互不兼容的集成。这是软件工程里一再出现的组合爆炸。

解法也是一再出现的那一招:在中间插一根**细腰**(narrow waist),定义一个标准协议，让任何说这个
协议的 host 都能用上任何说这个协议的工具源,M×N 就坍缩成 M+N。MCP 正是为此而生,它常被类比成
「AI 应用的 USB-C」:一个统一的接口，两边各自适配一次即可。Agent 框架实现一次 MCP 客户端，
工具提供方实现一次 MCP 服务端，二者就能即插即用。

## 21.2.3 MCP 的机制：JSON-RPC 之上的传输

MCP 在机制上并不神秘，它建立在成熟的 **JSON-RPC 2.0** 之上。host 与工具服务端之间用 JSON-RPC
消息交谈，几个核心方法把 21.2.1 那套流程标准化了:

- `initialize`:握手，交换双方支持的能力。
- `tools/list`:host 问服务端「你提供哪些工具」,拿回每个工具的名字、描述、schema,正是
  21.2.1 那三件套。
- `tools/call`:host 请求执行某个工具，传名字与参数，拿回结果。

这些 JSON-RPC 消息要经由某种**传输**(transport)承载，而传输的选择，恰好又是 [18.1.4](../ch18gpu/boundary.md)
那个「边界放在哪」的老问题在这里的回声:

- **stdio**:host 把工具服务端作为**子进程**启动，通过标准输入输出交换 JSON-RPC 消息。
  适合本地工具,进程隔离、无需网络。
- **HTTP（含流式)**:工具服务端是一个**网络服务**,host 通过 HTTP 与之通信。适合远端、
  共享、需要独立伸缩的工具。

一个是进程级、一个是网络级，取舍与 18.1.4、20.1.4 如出一辙:要隔离与简单用 stdio 子进程，
要远端与共享用 HTTP。同一个设计抉择，在设备、在推理、在工具，第三次出现。

## 21.2.4 在 Go 里实现一端

MCP 有**官方的 Go SDK**(`github.com/modelcontextprotocol/go-sdk`,由 Anthropic 与 Google 的
Go 团队合作维护)。透过它的形状，能看清 MCP 服务端在 Go 里就是一段标准的 RPC 服务代码。
注册一个工具，是把一个处理函数挂到一个名字上;服务端跑起来，就是在传输上收 JSON-RPC 请求、
按方法名分发、执行、回包:

```go
// 用官方 SDK 暴露一个工具（示意）
server := mcp.NewServer(...)
mcp.AddTool(server, &mcp.Tool{
    Name:        "get_weather",
    Description: "查询某城市的天气",
}, func(ctx context.Context, req *GetWeatherRequest) (*GetWeatherResult, error) {
    // 普通的 Go 函数：发 HTTP、查库……ctx 透传，可被取消
    return fetchWeather(ctx, req.City)
})
server.Run(ctx, mcp.NewStdioTransport()) // 或网络传输
```

把这段和第 21.2.1 的接口对照，会发现 MCP 不过是把那个本地接口**跨进程化、标准化**了:
`AddTool` 是注册，`tools/call` 的分发是 map 查找，处理函数是一个带 ctx 的普通 Go 函数。
而服务端能同时伺候多个并发的 `tools/call`,靠的正是第 10、11 章那套并发:每个请求一个 goroutine，
共享状态用通道或锁守护，ctx 负责取消。Go 程序员写过任何一个 RPC 服务，就已经会写 MCP 服务端的
九成,剩下的一成是协议的消息格式，而 SDK 把它包好了。

值得一提的工程现实是:MCP 工具的 schema，可以由 Go 的结构体经反射自动生成（如上例的
`GetWeatherRequest`),省去手写 JSON Schema 的苦工。Go 的反射、`encoding/json` 的标签约定,
在这里把「类型」与「协议」自动地缝在了一起,这又是一处把 Go 既有机制用在 Agent 上的例子。

## 小结

一个工具就是一个带 schema 的函数:名字、描述、参数格式,模型据此输出结构化的调用，运行时分发到
真正的代码。这形状就是 RPC，在 Go 里落成一个 `Tool` 接口加一次 map 分发，`Invoke` 透传 ctx 为
取消埋线。当工具来源爆炸成 M×N 的集成噩梦，MCP 用一根标准协议的细腰把它坍缩成 M+N,机制上是
JSON-RPC 2.0,核心方法 `initialize`/`tools/list`/`tools/call`,经 stdio 子进程或 HTTP 传输承载,
而 stdio 与 HTTP 的取舍，正是 18.1.4 那个「边界放哪」的第三次回声。官方 Go SDK 印证了一点:
写 MCP 服务端就是写一段标准的并发 RPC 服务，Go 既有的接口、反射、`encoding/json`、goroutine
与 context 全都直接复用。

工具能调了，可工具会慢、会卡、会失败,而上层的模型推理本就是流式的。最后一节 [21.3](./stream.md)
把第 7 章的 context 与第 10 章的通道做最后一次出场，看流式、背压与取消如何贯穿整条 Agent 链路。

## 延伸阅读的文献

1. Anthropic. *Introducing the Model Context Protocol.* 2024.
   https://www.anthropic.com/news/model-context-protocol
   （MCP 的动机:统一接口解决 M×N 集成问题，「AI 的 USB-C」)
2. Model Context Protocol. *Specification.* https://modelcontextprotocol.io/
   （JSON-RPC 方法、`initialize`/`tools/list`/`tools/call`、stdio 与可流式 HTTP 传输)
3. modelcontextprotocol. *Official Go SDK.*
   https://github.com/modelcontextprotocol/go-sdk
   （Anthropic 与 Google Go 团队合作维护;`mcp.AddTool`、`session.CallTool`、传输)
4. The Go Authors. *Package encoding/json 与 reflect.*
   https://pkg.go.dev/encoding/json
   （由结构体生成/校验 schema，把 Go 类型与协议消息自动对接)
5. 本书 [10 通道与 select](../../part3concurrency/ch10chan)、
   [11 同步原语与模式](../../part3concurrency/ch11sync)、
   [18.1 跨越 FFI 边界](../ch18gpu/boundary.md)、
   [21.1 Agent 控制循环](./loop.md)、[21.3 流式、背压与取消](./stream.md)。
