---
weight: 6400
title: "第 21 章 AI Agent 运行时"
bookCollapseSection: true
---

# 第 21 章 AI Agent 运行时

- [21.1 Agent 控制循环](./loop.md)
- [21.2 工具调用与 MCP](./mcp.md)
- [21.3 流式、背压与取消](./stream.md)

把模型的智能搁在一边，一个 AI Agent 在运行时眼里不过是一个控制循环：
观察、决策、调用工具、再观察，循环往复，其间大量地等待远端模型、流式地接收输出。
这恰恰是 Go 的并发模型最称手的形状。本章不谈提示工程，只谈运行时的那一面。
先把 Agent 还原成一个状态机与控制循环，看「每个 Agent 一个 goroutine」与集中编排各自的取舍；
再看工具调用如何分发，Model Context Protocol 怎样用 JSON-RPC 把工具暴露给模型，
它的传输层与 Go 的接口如何对接；最后回到并发的硬骨头：
流式 token 的逐段处理、慢消费者带来的背压、以及一次取消如何沿着 context
穿过层层工具调用干净地传播下去。第 7 章的 context 与第 10、11 章的并发原语，
将在这里完成它们在本书的最后一次出场。
