---
weight: 3200
title: "Chapter 10 Channels and select"
bookCollapseSection: true
---

# Chapter 10 Channels and select

> This chapter has an accompanying online talk:
> [YouTube](https://www.youtube.com/watch?v=d7fFCGGn0Wc),
> [Google Slides](https://changkun.de/s/chansrc/).

- [10.1 Channels and the Engineering of CSP](./model.md)
- [10.2 hchan: The Internal Structure of a Channel](./impl.md)
- [10.3 Send, Receive, and Direct Handoff](./sendrecv.md)
- [10.4 The Semantics of Closing](./close.md)
- [10.5 The Implementation of select](./select.md)
- [10.6 The Memory Model and the Lock-Free Evolution](./lockfree.md)
- [10.7 Engineering Practice and Cross-Language Comparison](./pattern.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Channels orchestrate; mutexes serialize.</I></br>
<div class="quote-right">
-- Rob Pike, "Go Proverbs", Gopherfest SV 2015
</div>
</div>

"Do not communicate by sharing memory; instead, share memory by communicating" is the most widely
repeated maxim of Go concurrency, and the channel is its realization in the language: a send paired
with a receive both transfers data and synchronizes two goroutines. The intellectual roots of CSP
are covered in [1.3 Communicating Sequential Processes](../../part1overview/ch01intro/csp.md). This
chapter looks at how channels and `select` are implemented in the runtime: the layout of a channel
in memory, how one send and one receive complete between two goroutines, how closing notifies every
waiter, how `select` picks one of several communications fairly and without deadlock, and how these
operations satisfy the requirements of the memory model.

Pike's proverb fixes the role of the channel: it is not another kind of lock but a means of
organizing cooperation among goroutines. Notably, the runtime implements channels with the very
mutex that the other half of the proverb names. The chapter starts from the semantics and data
structure of channels, then covers sends and receives, closing, and the implementation of `select`;
10.6 explains why channels are still a lock-based structure, and 10.7 discusses when to use a
channel and when a lock, and compares channels with similar mechanisms in other languages.
