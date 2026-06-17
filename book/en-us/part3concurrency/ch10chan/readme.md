---
weight: 3200
title: "Chapter 10 Channels and select"
bookCollapseSection: true
---

# Chapter 10 Channels and select

> This chapter comes with an online talk: [YouTube](https://www.youtube.com/watch?v=d7fFCGGn0Wc),
> [Google Slides deck](https://changkun.de/s/chansrc/).

"Do not communicate by sharing memory; instead, share memory by communicating." This widely quoted maxim distills Go's concurrency philosophy. The channel is the vehicle for that sentence: it fuses synchronization and data transfer into one. The intellectual lineage of CSP was laid out in [1.3 Communicating Sequential Processes](../../part1overview/ch01intro/csp.md), and we will not repeat it here. Instead, this chapter focuses on **how channels and select are actually implemented** in the runtime: what a channel looks like in memory, how a single send or receive brings two goroutines into rendezvous, how a close broadcasts, how `select` picks one path among several fairly and without deadlock, and why this machinery chose to be lock-based and how it meshes with the memory model.

- [10.1 Channels and the Engineering of CSP](./model.md)
- [10.2 hchan: The Internal Structure of a Channel](./impl.md)
- [10.3 Send, Receive, and Direct Handoff](./sendrecv.md)
- [10.4 The Semantics of Close](./close.md)
- [10.5 The Implementation of select](./select.md)
- [10.6 The Memory Model and the Lock-free Evolution](./lockfree.md)
- [10.7 Engineering Practice and Cross-language Comparison](./pattern.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Channels orchestrate; mutexes serialize.</I></br>
<div class="quote-right">
-- Rob Pike, "Go Proverbs", Gopherfest SV 2015
</div>
</div>

This maxim pins down where the channel sits in Go's concurrency model: it is not yet another lock, but a means of orchestration, organizing "who exchanges what with whom, and when" among several goroutines into a readable structure. What makes it intriguing is that the way the runtime redeems this layer of orchestration semantics is precisely the mutex at the other end of the maxim. This chapter follows that tension all the way to its end, to see clearly how the abstraction of "orchestration through communication" ultimately rests on an implementation of "serialization through locks."
