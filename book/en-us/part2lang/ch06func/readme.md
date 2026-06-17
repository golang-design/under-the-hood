---
weight: 2300
title: "Chapter 6 Functions, Defer, and Panic"
bookCollapseSection: true
---

# Chapter 6 Functions, Defer, and Panic

- [6.1 Function Calls](./func.md)
- [6.2 The Defer Statement](./defer.md)
- [6.3 The Panic and Recover Builtins](./panic.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>Thus in a sense procedures in ALGOL are second class citizens, they always have to appear in person and can never be represented by a variable or expression.</I></br>
<div class="quote-right">
-- Christopher Strachey, "Fundamental Concepts in Programming Languages"
</div>
</div>

Making functions "first-class citizens" means they can be assigned, passed, and returned like ordinary values, and can capture their environment to become closures. This capability, a luxury in Strachey's day, is exactly what this chapter takes apart: how a function value is represented in memory, how a single call passes arguments and returns at the lowest level, how `defer` guarantees that "no matter which path we leave by, the cleanup still happens," and how `panic` and `recover` unwind the call stack and then get caught. These features share one set of runtime machinery, and explaining it thoroughly lets us see the trade-offs Go makes among convenience, performance, and explicit control flow.
