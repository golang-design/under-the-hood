---
weight: 6400
title: "第 21 章 AI Agent 运行时"
bookCollapseSection: true
---

# 第 21 章 AI Agent 运行时

- [21.1 Agent 控制循环](./loop.md)
- [21.2 工具调用与 MCP](./mcp.md)
- [21.3 流式、背压与取消](./stream.md)

把模型的决策能力放在一边，AI Agent 在运行时看来是一个控制循环：把上下文发给模型，模型要么给出答案，
要么请求调用工具；运行时执行工具，把结果追加回上下文，如此反复。循环的大部分时间花在等待远端的模型与工具
上，输出又是流式的，这正是 Go 的并发模型擅长处理的负载。本章不讨论提示工程，只讨论运行时这一面。

21.1 把 Agent 归结为控制循环，讨论循环的出口与停止条件、显式状态与可恢复的事件日志，以及「每个 Agent 一个
goroutine」与集中编排之间的取舍；21.2 讨论工具调用如何分发，Model Context Protocol 如何以 JSON-RPC 2.0
把工具提供给模型，它在 2026-07-28 修订版中如何变为无状态协议，以及官方 Go SDK 如何把 Go 类型映射为工具的
schema；21.3 讨论流式词元（token）的逐段处理、慢消费者带来的背压，以及一次取消如何沿着 context
穿过层层工具调用，直到另一个进程中的工具处理函数。第三部分的通道
（[第 10 章](../../part3concurrency/ch10chan/readme.md)）、同步原语与
context（[第 11 章](../../part3concurrency/ch11sync/readme.md)、[11.8](../../part3concurrency/ch11sync/context.md)）
是本章反复使用的工具。
