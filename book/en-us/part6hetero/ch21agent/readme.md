---
weight: 6400
title: "Chapter 21 The AI Agent Runtime"
bookCollapseSection: true
---

# Chapter 21 The AI Agent Runtime

- [21.1 The Agent Control Loop](./loop.md)
- [21.2 Tool Calls and MCP](./mcp.md)
- [21.3 Streaming, Backpressure, and Cancellation](./stream.md)

Set the model's intelligence aside, and in the eyes of the runtime an AI agent is nothing more than a control loop: observe, decide, call a tool, observe again, around and around, spending most of its time waiting on a remote model and receiving its output as a stream. This is exactly the shape Go's concurrency model handles best. This chapter does not talk about prompt engineering. It looks only at the runtime side. We first reduce an agent to a state machine and a control loop, and weigh "one goroutine per agent" against centralized orchestration. We then look at how tool calls are dispatched, and how the Model Context Protocol uses JSON-RPC to expose tools to the model and how its transport layer meets Go's interfaces. We close on the hard bone of concurrency: the piece-by-piece handling of streamed tokens, the backpressure a slow consumer creates, and how a single cancellation propagates cleanly down through layer upon layer of tool calls along a context. The context of Chapter 7 and the concurrency primitives of Chapters 10 and 11 make their final appearance in the book here.
