---
weight: 1000
title: "Part I Overview and History"
bookCollapseSection: true
---

# Part I Overview and History

- [Chapter 1 Design Philosophy and History](./ch01intro)
- [Chapter 2 Assembly and Calling Conventions](./ch02asm)
- [Chapter 3 The Lifecycle of a Program](./ch03life)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Simplicity is prerequisite for reliability.</I></br>
<div class="quote-right">
-- Edsger W. Dijkstra, "How do we tell truths that might hurt?" (EWD498)
</div>
</div>

To understand the implementation of a language, we first have to understand why it was designed the way it is today. Go did not appear out of nowhere. Every one of its trade-offs carries the traditions of Unix, C, and CSP, along with the designers' long-standing worry about complexity spinning out of control in large-scale engineering. This part starts from design philosophy and historical context, sketching the full picture of the language first: what problems it set out to solve, and what it deliberately gave up. We then descend to assembly and calling conventions, the layer closest to the machine, to work out how functions, arguments, and stack frames actually land on real hardware. Finally, we follow the complete lifecycle of a program from startup to exit, stringing together the runtime's various subsystems into a single traceable thread. Once we have read through this part, the seemingly scattered implementation details in later chapters will fall back into a unified design intent.
