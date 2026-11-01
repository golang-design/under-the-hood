---
weight: 6400
title: "Chapter 21 The AI Agent Runtime"
bookCollapseSection: true
---

# Chapter 21 The AI Agent Runtime

- [21.1 The Agent Control Loop](./loop.md)
- [21.2 Tool Calls and MCP](./mcp.md)
- [21.3 Streaming, Backpressure, and Cancellation](./stream.md)

Setting the model's decision-making aside, an AI agent looks to the runtime like a control loop:
send the context to the model, which either gives an answer or requests a tool call; the runtime
executes the tool, appends the result to the context, and repeats. Most of the loop's time is spent
waiting on remote models and tools, and the output is streamed, which is exactly the kind of load
Go's concurrency model handles well. This chapter does not discuss prompt engineering, only the
runtime side.

Section 21.1 reduces the agent to a control loop and discusses the loop's exits and stop conditions,
explicit state and a recoverable event log, and the trade-off between one goroutine per agent and
centralized orchestration. Section 21.2 covers how tool calls are dispatched, how the Model Context
Protocol offers tools to the model over JSON-RPC 2.0, how it became a stateless protocol in the
2026-07-28 revision, and how the official Go SDK maps Go types to tool schemas. Section 21.3 covers
the piecewise handling of streamed tokens, the backpressure that slow consumers create, and how a
cancellation travels through layers of tool calls via context, all the way to a tool handler in
another process. The channels of Part 3 ([Chapter 10](../../part3concurrency/ch10chan/readme.md)),
the synchronization primitives and context ([Chapter 11](../../part3concurrency/ch11sync/readme.md),
[11.8 Context](../../part3concurrency/ch11sync/context.md)) are the tools this chapter uses again
and again.
