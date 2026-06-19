---
weight: 6402
title: "21.2 Tool Calls and MCP"
---

# 21.2 Tool Calls and MCP

[21.1](./loop.md) reduced an agent to a control loop, and the most important action inside that loop is "execute a tool". This section is about tools specifically: what a tool is mechanically, how the model decides to call it, how the runtime dispatches the call to real code, and how, when the number and the sources of tools explode, the **Model Context Protocol** (MCP) standardizes the whole thing with a single protocol. See through this layer and you find that a tool call is, in essence, a structured remote procedure call, and RPC is exactly Go's old trade.

## 21.2.1 What a Tool Is: a Function With a Schema

Peel back the word "tool" and it is nothing more than **a function with a typed description**, made of three parts: a name, a stretch of natural-language description for the model to read, and a structured schema for the parameters (usually JSON Schema). What the model sees at each step is a set of tools like this, their names, descriptions, and parameter formats. From these it decides whether to call, which to call, and what arguments to pass, and then emits a **structured call request**: a tool name plus a set of JSON arguments. The runtime receives this request, looks up the corresponding function, deserializes the arguments, executes, and serializes the result back.

Read that flow through and its shape is RPC: **name + serialized arguments -> execute -> serialized result**. In Go, a tool falls most naturally into an interface:

```go
type Tool interface {
    Name() string                  // the key used for dispatch
    Description() string           // the explanation the model reads
    Schema() json.RawMessage       // the JSON Schema of the parameters
    Invoke(ctx context.Context, args json.RawMessage) (json.RawMessage, error)
}

// dispatch is a map lookup plus a deserialization
func (a *Agent) callTool(ctx context.Context, call ToolCall) (json.RawMessage, error) {
    tool, ok := a.tools[call.Name]
    if !ok {
        return nil, fmt.Errorf("unknown tool: %s", call.Name)
    }
    return tool.Invoke(ctx, call.Args) // ctx threaded through, laying the wire for 21.3's cancellation
}
```

Note that `Invoke` carries a `context.Context` in its signature, and this is not decoration: a tool may make an HTTP request, query a database, or read a file, all potentially blocking I/O, and threading ctx through is what lets the timeouts and cancellation of 21.3 reach the lowest level. The runtime core of a tool-calling framework is basically this interface plus this map dispatch, and again, not a single line of machine learning.

## 21.2.2 Why a Protocol Is Needed: the M×N Problem

If each agent defined a few tools of its own, the above would suffice. But the reality is that the sources of tools are exploding: the file system, databases, search engines, code repositories, every kind of SaaS, each wanting to expose its capabilities to the model. The problem follows: if every agent framework (the host) defines tools its own way, and every tool provider builds its own interface, then M hosts integrating with N tool sources is **M×N** mutually incompatible integrations. This is the combinatorial explosion that recurs throughout software engineering.

The solution is the move that also recurs: insert a **narrow waist** in the middle, define a standard protocol, and let any host that speaks this protocol use any tool source that speaks it, so M×N collapses to M+N. MCP exists for exactly this, and is often likened to "USB-C for AI applications": a unified interface that each side adapts to just once. An agent framework implements an MCP client once, a tool provider implements an MCP server once, and the two become plug-and-play.

## 21.2.3 The Mechanism of MCP: Transports Over JSON-RPC

Mechanically, MCP is not mysterious. It is built on top of the mature **JSON-RPC 2.0**. The host and the tool server converse in JSON-RPC messages, and a few core methods standardize the flow of 21.2.1:

- `initialize`: the handshake, exchanging the capabilities each side supports.
- `tools/list`: the host asks the server "which tools do you provide", and gets back each tool's name, description, and schema, exactly the three-piece set of 21.2.1.
- `tools/call`: the host requests execution of some tool, passing the name and arguments, and gets back the result.

These JSON-RPC messages must be carried over some **transport**, and the choice of transport is precisely the echo, here, of that old "where to put the boundary" question of [18.1.4](../ch18gpu/boundary.md):

- **stdio**: the host launches the tool server as a **subprocess** and exchanges JSON-RPC messages over standard input and output. Suited to local tools, with process isolation and no network needed.
- **HTTP (including streaming)**: the tool server is a **network service**, and the host communicates with it over HTTP. Suited to tools that are remote, shared, or need to scale independently.

One is process-level, the other network-level, and the tradeoff is just like 18.1.4 and 20.1.4: for isolation and simplicity use the stdio subprocess, for remoteness and sharing use HTTP. The same design choice appears for a third time, at the device, at inference, and now at tools.

## 21.2.4 Implementing an End in Go

MCP has an **official Go SDK** (`github.com/modelcontextprotocol/go-sdk`, maintained by Anthropic in collaboration with Google's Go team). Through its shape you can see that an MCP server in Go is a piece of standard RPC service code. Registering a tool is hanging a handler function on a name; running the server is receiving JSON-RPC requests over the transport, dispatching by method name, executing, and replying:

```go
// expose a tool with the official SDK (illustrative)
server := mcp.NewServer(...)
mcp.AddTool(server, &mcp.Tool{
    Name:        "get_weather",
    Description: "Query the weather for a city",
}, func(ctx context.Context, req *GetWeatherRequest) (*GetWeatherResult, error) {
    // an ordinary Go function: make an HTTP request, query a database, ... ctx threaded, cancellable
    return fetchWeather(ctx, req.City)
})
server.Run(ctx, mcp.NewStdioTransport()) // or a network transport
```

Set this against the interface of 21.2.1 and you find that MCP merely takes that local interface and makes it **cross-process and standardized**: `AddTool` is registration, the dispatch of `tools/call` is a map lookup, and the handler is an ordinary Go function carrying a ctx. That the server can serve many concurrent `tools/call` requests at once rests on exactly the concurrency of Chapters 10 and 11: one goroutine per request, shared state guarded by channels or locks, and ctx handling cancellation. A Go programmer who has written any RPC service already knows nine-tenths of how to write an MCP server, and the remaining tenth is the protocol's message format, which the SDK packages up.

One engineering reality worth mentioning is that the schema of an MCP tool can be generated automatically from a Go struct by reflection (as with `GetWeatherRequest` above), sparing the drudgery of hand-writing JSON Schema. Go's reflection and the tag conventions of `encoding/json` stitch "type" and "protocol" together automatically here, another instance of putting Go's existing mechanisms to work on agents.

## Summary

A tool is a function with a schema: a name, a description, and a parameter format, from which the model emits a structured call that the runtime dispatches to real code. This shape is RPC, falling in Go into a `Tool` interface plus a map dispatch, with `Invoke` threading ctx to lay the wire for cancellation. When the sources of tools explode into the M×N integration nightmare, MCP collapses it to M+N with the narrow waist of a standard protocol. Mechanically it is JSON-RPC 2.0, with the core methods `initialize`/`tools/list`/`tools/call`, carried over a stdio subprocess or HTTP transport, and the choice between stdio and HTTP is the third echo of "where to put the boundary" from 18.1.4. The official Go SDK confirms one thing: writing an MCP server is writing a piece of standard concurrent RPC service, reusing Go's existing interfaces, reflection, `encoding/json`, goroutines, and context wholesale.

Tools can be called now, but tools are slow, they stall, they fail, and the model inference above is itself streamed. The last section, [21.3](./stream.md), brings the context of Chapter 7 and the channels of Chapter 10 on for a final appearance, to see how streaming, backpressure, and cancellation run through the entire agent chain.

## Further Reading

1. Anthropic. *Introducing the Model Context Protocol.* 2024.
   https://www.anthropic.com/news/model-context-protocol
   (the motivation for MCP: a unified interface solving the M×N integration problem, "USB-C for AI")
2. Model Context Protocol. *Specification.* https://modelcontextprotocol.io/
   (the JSON-RPC methods, `initialize`/`tools/list`/`tools/call`, the stdio and streamable-HTTP transports)
3. modelcontextprotocol. *Official Go SDK.*
   https://github.com/modelcontextprotocol/go-sdk
   (maintained by Anthropic with Google's Go team; `mcp.AddTool`, `session.CallTool`, transports)
4. The Go Authors. *Package encoding/json and reflect.*
   https://pkg.go.dev/encoding/json
   (generating/validating a schema from a struct, wiring Go types to protocol messages automatically)
5. This book: [10 Channels and select](../../part3concurrency/ch10chan),
   [11 Synchronization Primitives and Patterns](../../part3concurrency/ch11sync),
   [18.1 Crossing the FFI Boundary](../ch18gpu/boundary.md),
   [21.1 The Agent Control Loop](./loop.md), [21.3 Streaming, Backpressure, and Cancellation](./stream.md).
