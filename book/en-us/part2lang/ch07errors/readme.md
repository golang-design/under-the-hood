---
weight: 2400
title: "Chapter 7 Error Handling"
bookCollapseSection: true
---

# Chapter 7 Error Handling

- [7.1 The Evolution of the Problem](./value.md)
- [7.2 Inspecting Error Values](./inspect.md)
- [7.3 Error Formatting and Context](./context.md)
- [7.4 Error Semantics](./semantics.md)
- [7.5 The Future of Error Handling](./future.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Define errors out of existence.</I></br>
<div class="quote-right">
-- John Ousterhout, "A philosophy of Software Design"
</div>
</div>

What is an error? Where does it come from, and where does it go? When an error arises, what should we do about it?
These questions are not simple, but once we answer them we need no longer fear errors.
The word "error" carries different understandings and interpretations across different programming languages.
In Go, an error is treated as an ordinary value. It is precisely because of the special nature of values
that Go lets programmers build their own higher-level abstractions over errors at different layers for different scenarios,
while at the same time requiring the programmer to handle the error as soon as it is obtained.
On one hand this design gives the programmer enormous freedom, but on the other it has continually troubled programmers,
leaving them at a loss for what to do when they receive an error.
