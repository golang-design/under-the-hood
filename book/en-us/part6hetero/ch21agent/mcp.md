---
weight: 6402
title: "21.2 Tool Calls and MCP"
---

# 21.2 Tool Calls and MCP

[21.1](./loop.md) reduced the agent to a control loop, and the most important action in that loop is
executing a tool. This section covers tools themselves: what a tool is mechanically, how the runtime
dispatches the model's call request to real code, and how the **Model Context Protocol** (MCP)
standardizes tool integration with a single protocol once the number and sources of tools grow
quickly. Structurally, a tool call is a structured remote procedure call, and writing RPC services
is familiar work for Go programmers.

## 21.2.1 A Tool Is a Function with a Schema

A tool consists of three parts: a name, a natural-language description for the model to read, and a
schema describing the structure of its parameters, usually JSON Schema. At each step the model sees
a set of such names, descriptions and parameter formats; from them it decides whether to call a
tool, which one, and with what arguments, and then it emits a structured call request: the tool name
plus a set of JSON arguments. On receiving the request, the runtime finds the corresponding
function, deserializes the arguments, executes it, and serializes the result back to the model.

A name plus serialized arguments, an execution, and a serialized result back: this is the structure
of an RPC. In Go, the most natural representation of a tool is an interface:

```go
type Tool interface {
	Name() string            // the key used for dispatch
	Description() string     // the explanation shown to the model
	Schema() json.RawMessage // JSON Schema of the parameters
	Invoke(ctx context.Context, args json.RawMessage) (json.RawMessage, error)
}

// Dispatch is a map lookup
func (a *Agent) callTool(ctx context.Context, call ToolCall) (json.RawMessage, error) {
	tool, ok := a.tools[call.Name]
	if !ok {
		return nil, fmt.Errorf("unknown tool: %s", call.Name)
	}
	return tool.Invoke(ctx, call.Args) // ctx is passed with the call; the cancellation of 21.3 depends on it
}
```

The first parameter of `Invoke` is a `context.Context`. Tools often issue HTTP requests, query
databases or read and write files, all of which are I/O that may block; only by passing ctx all the
way down can the timeouts and cancellation discussed in 21.3 reach the lowest level.

There are two different kinds of failure here. If the name cannot be found, the call request itself
is wrong. If the tool fails during execution, for example an argument is out of range or a
downstream service is unavailable, that is feedback the model can use to correct itself. The example
in 21.1 hands the latter kind of error back to the model as an observation, and, as we will see
below, MCP distinguishes the two kinds explicitly in the protocol.

## 21.2.2 Why a Protocol: The M×N Problem

If each agent uses only a few tools of its own definition, the interface above is enough. But tools
come from more and more sources: file systems, databases, search engines, code repositories and all
kinds of online services want to offer their capabilities to models. If every agent framework
defines tools in its own way and every tool provider implements its own interface, then M frameworks
connecting to N tool sources need M×N mutually incompatible integrations. This is exactly the
problem Anthropic described when it open-sourced MCP on November 25, 2024
[[Anthropic, 2024](#ref-anthropic-2024)]:

```text
Every new data source requires its own custom implementation, making truly
connected systems difficult to scale.
```

The article's proposal is to replace the fragmented integrations with an open standard.

This is a recurring solution in software engineering: put a **narrow waist** in the middle and
define a standard protocol, so that any host implementing the protocol can use any tool source
implementing the protocol, and M×N integrations shrink to M+N implementations. The MCP specification
says it draws on the Language Server Protocol (LSP): LSP created a uniform protocol between
programming-language support and development tools, and MCP does the same between AI applications
and external context and tools [[Model Context Protocol, 2026](#ref-model-context-protocol-2026)].
The official MCP website also likens it to a "USB-C port for AI
applications" [[Model Context Protocol, n.d.](#ref-model-context-protocol-nd)].

The specification divides the participants into three roles. The **host** is the AI application that
initiates connections, the **client** is a connector inside the host, and the **server** provides
context and capabilities. A host can create multiple clients, and each client communicates with
exactly one server, a one-to-one relationship
[[Model Context Protocol, 2026](#ref-model-context-protocol-2026)].

## 21.2.3 Protocol Mechanics: JSON-RPC 2.0 and Two Transports

MCP messages use JSON-RPC 2.0. JSON-RPC defines three kinds of messages: a request with an `id`, a
response that carries either `result` or `error` and matches the request's `id`, and a notification
without an `id`; a notification means the sender does not care about a reply, and the receiver must
not reply. JSON-RPC is transport-independent, so the same messages can travel in-process, over
sockets or over HTTP [[JSON-RPC Working Group, 2010](#ref-json-rpc-working-group-2010)]. MCP adds a
few constraints on top: the request `id` must not be `null`, requests from the same sender that have
not yet received a response must not share an `id`, and a successful result must carry a
`resultType` field [[Model Context Protocol, 2026](#ref-model-context-protocol-2026)].

Two methods relate to tools. `tools/list` returns the tools the server offers, each with a name, a
description and an `inputSchema`, the three components of 21.2.1. `tools/call` invokes a tool by
name and arguments and returns the result.

The handshake changed as the specification evolved. In the revisions from 2024-11-05 to 2025-11-25,
a session began with an `initialize` request in which the two sides exchanged protocol versions and
capabilities, and the client then sent a `notifications/initialized` notification before normal
requests began. The 2026-07-28 revision, on which this section is based, removes this handshake and
makes MCP a stateless protocol. Every request carries its own protocol version
(`io.modelcontextprotocol/protocolVersion`) and client capabilities
(`io.modelcontextprotocol/clientCapabilities`) in the `_meta` field, and the server must not rely on
earlier requests on the same connection to determine them. Servers must implement the new
`server/discover` method, which a client can use before any other request to query the versions and
capabilities the server supports. The same revision also stipulates that servers no longer initiate
JSON-RPC requests themselves; interactions that servers used to initiate now return the input still
needed in the result, and the client retries the original request with the answer
[[Model Context Protocol, 2026](#ref-model-context-protocol-2026)]. For a server implementer, this
means all the information needed to handle a request is in the request, and any replica can handle
any request, which matches how Go's `net/http` servers handle requests one at a time and scale
horizontally.

JSON-RPC messages are carried by a **transport**. The 2026-07-28 revision defines two standard
transports [[Model Context Protocol, 2026](#ref-model-context-protocol-2026)]:

- **stdio**: the client launches the server as a subprocess, and the two sides exchange
  newline-delimited JSON-RPC messages over the subprocess's standard input and standard output. Only
  valid MCP messages may appear on the server's standard output; logs go to standard error. It suits
  local tools: process isolation, no network needed.
- **Streamable HTTP**: the server is an independent process exposing a single HTTP endpoint. Every
  message the client sends is a POST, and the server answers with either a single JSON object or an
  SSE (Server-Sent Events) stream scoped to that request, in which notifications related to the
  request come first and the response comes last. It suits remote, shared tools that need to scale
  independently.

Streamable HTTP was introduced in the 2025-03-26 revision and replaced the HTTP+SSE transport of
2024-11-05, which is now formally deprecated. The 2026-07-28 revision further removed from
Streamable HTTP the GET endpoint used for server push and the protocol-level session (the
`Mcp-Session-Id` header). This evolution directly affects intermediaries. pons is a service that
holds user credentials on their behalf and forwards tool calls [[Ou, 2026a](#ref-ou-2026a)]. When
forwarding MCP requests, besides POST, the only method the current revision uses, it still accepts
GET and DELETE, to stay compatible with how the 2025-03-26 to 2025-11-25 revisions open a push
stream and end a session:

```go
// MCPMethods are the methods the MCP address carries: POST, the one method
// of the current revision, and GET and DELETE, which the revisions
// 2025-03-26 to 2025-11-25 use to open a stream and to end a session. Any
// other is refused before the connection is loaded.
var MCPMethods = []string{http.MethodPost, http.MethodGet, http.MethodDelete}
```

The choice between stdio and Streamable HTTP is another instance of the question "where to put the
boundary" from [18.1](../ch18gpu/boundary.md): when isolation and simplicity are needed, choose a
subprocess; when remote access and sharing are needed, choose a network service.

## 21.2.4 Implementing a Server in Go

MCP has an official Go SDK (`github.com/modelcontextprotocol/go-sdk`), whose v1.0.0 was released on
September 30, 2025 and which supports the 2026-07-28 revision from v1.7.0. Its design document
states that the repository was initially maintained jointly by the Go team and Anthropic. The
document also explains why most of the API lives in a single `mcp` package: unlike MCP SDKs in other
languages, but like `net/http`, `net/rpc` and `google.golang.org/grpc`, this makes it easier to find
things in documentation and editors [[modelcontextprotocol, 2026](#ref-modelcontextprotocol-2026)].

Below is a server that offers a single tool, based on v1.8.0 of the SDK and built with Go 1.26.10:

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type WeatherIn struct {
	City string `json:"city" jsonschema:"City name"`
}

type WeatherOut struct {
	Summary string `json:"summary" jsonschema:"Weather summary"`
}

func getWeather(ctx context.Context, req *mcp.CallToolRequest, in WeatherIn) (
	*mcp.CallToolResult, WeatherOut, error,
) {
	s, err := fetchWeather(ctx, in.City) // an ordinary Go function; ctx is passed with the call
	if err != nil {
		return nil, WeatherOut{}, err // returned as a tool execution error: isError is true
	}
	return nil, WeatherOut{Summary: s}, nil
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: "weather", Version: "v0.1.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_weather",
		Description: "Look up the current weather of a city",
	}, getWeather)
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatal(err)
	}
}

func fetchWeather(ctx context.Context, city string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s: sunny", city), nil
}
```

`mcp.AddTool` is a generic function, and the handler's type is `ToolHandlerFor[In, Out]`:

```go
type ToolHandlerFor[In, Out any] func(_ context.Context, request *CallToolRequest, input In) (result *CallToolResult, output Out, _ error)
```

From this the SDK does several things. It derives the tool's input schema from the `In` type, taking
field names from `json` tags ([[Go Authors, 2026](#ref-go-authors-2026)]) and field descriptions
from `jsonschema` tags; the derivation and validation are done by `github.com/google/jsonschema-go`
[[JSON Schema Go Project Authors, 2026](#ref-json-schema-go-project-authors-2026)]. Arguments are
validated against the schema first, and a request that fails validation never reaches the handler.
The `Out` type likewise yields an output schema, and the return value is placed in the result's
`structuredContent`. Error handling corresponds to the two kinds of failure in 21.2.1: the SDK
documentation states that an error returned from `ToolHandlerFor` is treated as a tool error, placed
in the result's content with `isError` set to true, whereas an error returned from the lower-level
`ToolHandler` is treated as a protocol error
[[modelcontextprotocol, 2026](#ref-modelcontextprotocol-2026)]. The specification's positioning of
the two is that a protocol error indicates a problem with the structure of the request itself, such
as an unknown tool, while a tool execution error carries feedback the model can use to correct and
retry, and the client should pass it to the model
[[Model Context Protocol, 2026](#ref-model-context-protocol-2026)].

Run the compiled program as a subprocess and send, over standard input in the 2026-07-28 format,
`server/discover`, `tools/list` and two `tools/call` requests in turn. Every request carries the
protocol version, client information and client capabilities in `_meta`, with no prior handshake.
The second `tools/call` deliberately omits the required `city` argument. The responses to the two
calls are as follows (with go-sdk v1.8.0):

```text
{"jsonrpc":"2.0","id":3,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"weather","version":"v0.1.0"}},"content":[{"type":"text","text":"{\"summary\":\"Berlin: sunny\"}"}],"structuredContent":{"summary":"Berlin: sunny"},"resultType":"complete"}}
{"jsonrpc":"2.0","id":4,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"weather","version":"v0.1.0"}},"content":[{"type":"text","text":"validating \"arguments\": validating root: required: missing properties: [\"city\"]"}],"isError":true,"resultType":"complete"}}
```

The call with the missing argument gets not a JSON-RPC error but a normal result with `isError`
true, and the error message in the content can be handed to the model as is. In the `tools/list`
response, the input schema derived from `WeatherIn` is as follows; `city` is listed as required, and
additional properties are not accepted:

```text
"inputSchema":{"type":"object","properties":{"city":{"type":"string","description":"City name"}},"required":["city"],"additionalProperties":false}
```

On concurrency, the SDK calls `jsonrpc2.Async` for every request except `initialize`, so that its
handling need not wait for later requests; a source comment states that requests are handled
asynchronously and notifications synchronously. The server can therefore handle multiple
`tools/call` requests at once, and shared state in a handler must be protected with channels or
locks as in Chapters 10 and 11. Readers who have written a Go RPC service already know most of the
structure of an MCP server; the SDK encapsulates the protocol's message format.

## 21.2.5 The Permission Boundary of Tools

Tools give the model's output real external effects, so in its section on tools the specification
recommends that, for safety, there should always be a human able to deny a tool call, that
applications should clearly show which tools are visible to the model and when they are invoked, and
that they should ask for user confirmation before performing operations. For Streamable HTTP,
servers must validate the `Origin` header to guard against DNS rebinding attacks, and when running
locally should bind only to localhost
[[Model Context Protocol, 2026](#ref-model-context-protocol-2026)].

Whether to ask a human is itself a decision the harness has to make. limen calls the code that makes
this decision before an action is executed a decision point, and it chooses among allow, ask and
block [[Ou, 2026b](#ref-ou-2026b)]. Its README points out that many harnesses offer only allow and
deny, and a denial does not make the agent stop and wait for a person: the agent reads the denial as
a result and carries on, often switching to an action worse than asking would have been. Harnesses
that can ask often rely on a fixed list, and cannot see that the same person has already approved a
test command a hundred times. limen predicts the probability that a person will approve an action
from that person's earlier answers, and then derives two thresholds from the costs the organization
assigns: a probability above the upper threshold allows, one below the lower threshold blocks, and
one in between asks. The prediction itself can be slow or fail, so limen provides a wrapper that
guarantees the decision point waits for the prediction no longer than a limit and never treats a
failure as an allow:

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
	// ...
	return Prediction{
		Key:     a.Key,
		Verdict: Ask,
		// ...
	}, nil
}
```

On a timeout or error, the result is always "ask", and the action is left to a person to decide.
`done` has capacity 1, so even if `select` has already returned because of the timeout and no one
will receive, the prediction goroutine can put its result in the buffer and exit without leaking.
Whether it finishes promptly depends on whether the underlying predictor honors the cancellation of
ctx, which is the topic of 21.3.

Credentials are thornier. Tools often need to access code repositories or documents as the user, and
if a token is handed to the agent's sandbox, any code running there can read it. pons keeps
credentials on the proxy side: the caller reaches the address pons allocated for a connection with
the caller's own token, pons asks the authorizer whether this call is allowed, adds the credential
when forwarding, and passes the reply back. When forwarding, the caller's own `Authorization` header
is removed first, and headers such as the upstream's `WWW-Authenticate` are not passed back to the
caller [[Ou, 2026a](#ref-ou-2026a)]. Its README summarizes the effect:

```text
A prompt that tricks an agent can make it send a request. It cannot make
it reveal a credential it never held.
```

## Summary

A tool is a function with a schema: a name, a description and a parameter format. From these the
model emits a structured call request, and the runtime dispatches it to real code. This structure is
RPC; in Go it can be represented as a `Tool` interface plus a map lookup, and `Invoke` takes ctx,
leaving a path for cancellation. When tool sources grow into an M×N integration problem, MCP uses a
standard protocol as the narrow waist and reduces it to M+N implementations. It uses JSON-RPC 2.0 as
the message format and `tools/list` and `tools/call` to discover and invoke tools; the 2026-07-28
revision removed the `initialize` handshake, so that each request carries its own version and
capabilities and the server is stateless. Messages travel over a stdio subprocess or Streamable
HTTP, and the choice between them is again a matter of where to put the boundary. The official Go
SDK uses generic handlers to map Go types to JSON Schema, and maps the specification's distinction
between protocol errors and tool errors onto two handler types.

Tools can be slow, can hang and can fail, and the model inference above them is itself streamed. The
next section, [21.3](./stream.md), covers how streaming, backpressure and cancellation run through
the whole agent chain, and it uses the context of [11.8](../../part3concurrency/ch11sync/context.md)
and the channels of Chapter 10 again.

## Further Reading

- <a id="ref-anthropic-2024"></a>[Anthropic, 2024] Anthropic. *Introducing the Model Context
  Protocol.* November 25, 2024. https://www.anthropic.com/news/model-context-protocol (The
  announcement that open-sourced MCP; it replaces fragmented custom integrations with an open
  standard. The "USB-C" analogy appears on the introduction page of the official MCP website)
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *Package encoding/json and
  reflect.* https://pkg.go.dev/encoding/json (Struct tags and reflection, the basis for generating
  and validating schemas from Go types and for connecting types to protocol messages)
- <a id="ref-json-rpc-working-group-2010"></a>[JSON-RPC Working Group, 2010] JSON-RPC Working Group.
  *JSON-RPC 2.0 Specification.* 2010 (revised January 4, 2013).
  https://www.jsonrpc.org/specification (The three message kinds: request, response and
  notification; a notification carries no `id` and the receiver must not reply;
  transport-independent)
- <a id="ref-json-schema-go-project-authors-2026"></a>[JSON Schema Go Project Authors, 2026] The
  JSON Schema Go Project Authors. jsonschema-go. https://github.com/google/jsonschema-go, 2026.
  (Derives JSON Schema from Go types and validates against it; go-sdk v1.8.0 depends on its v0.4.3)
- <a id="ref-model-context-protocol-2026"></a>[Model Context Protocol, 2026] Model Context Protocol.
  *Specification,* revision 2026-07-28. https://modelcontextprotocol.io/specification/2026-07-28
  (The revision this section is based on: JSON-RPC messages, stateless requests, `server/discover`,
  `tools/list` and `tools/call`, the stdio and Streamable HTTP transports, and the changelog between
  revisions; the website's home page is <https://modelcontextprotocol.io/>)
- <a id="ref-model-context-protocol-nd"></a>[Model Context Protocol, n.d.] Model Context Protocol.
  *What is the Model Context Protocol (MCP)?*
  https://modelcontextprotocol.io/docs/getting-started/intro (The introduction page of the official
  website, which likens MCP to a USB-C port for AI applications)
- <a id="ref-modelcontextprotocol-2026"></a>[modelcontextprotocol, 2026] modelcontextprotocol.
  *Official Go SDK.* v1.8.0, 2026. https://github.com/modelcontextprotocol/go-sdk (`mcp.NewServer`,
  `mcp.AddTool`, `ToolHandlerFor`, `StdioTransport`, `session.CallTool`; `design/design.md` in the
  repository explains the trade-off of the single `mcp` package, and that the repository was
  initially maintained jointly by the Go team and Anthropic)
- <a id="ref-ou-2026a"></a>[Ou, 2026a] Changkun Ou. pons. https://github.com/latere-ai/pons, 2026.
  (A service that holds user credentials on their behalf and forwards tool calls; it forwards MCP
  over Streamable HTTP, and credentials never pass through the caller)
- <a id="ref-ou-2026b"></a>[Ou, 2026b] Changkun Ou. limen. https://github.com/latere-ai/limen, 2026.
  (Learns which automatically executed actions a person would approve, and measures how often each
  kind of automatic decision is wrong; still pre-release)
- This book: [Chapter 10 Channels and select](../../part3concurrency/ch10chan/readme.md), [Chapter
  11 Synchronization Primitives and Patterns](../../part3concurrency/ch11sync/readme.md), [11.8
  Context](../../part3concurrency/ch11sync/context.md), [18.1
  Crossing the FFI Boundary](../ch18gpu/boundary.md), [21.1
  The Agent Control Loop](./loop.md), [21.3 Streaming, Backpressure, and Cancellation](./stream.md).
