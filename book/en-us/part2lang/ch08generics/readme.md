---
weight: 2500
title: "Chapter 8 Generics"
bookCollapseSection: true
---

# Chapter 8 Generics

- [8.1 The Evolution of Generics Design](./history.md)
- [8.2 Contract-Based Generics](./contracts.md)
- [8.3 Type-Checking Techniques](./checker.md)
- [8.4 The Future of Generics](./future.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>"Concepts", in some ways, that's a very old topic; and other thinks it's new.</I></br>
<div class="quote-right">
-- Bjarne Stroustrup, "Concepts: The Future of Generic Programming"
</div>
</div>

The term "generic programming" comes from the paper of the same name by David Musser and Alexander
Stepanov, published in 1989. Their central idea is to start from concrete, efficient algorithms and
abstract them into generic algorithms that can be combined with different data representations,
yielding a large body of useful software. The idea later became the foundation of the C++ Standard
Template Library.

Go did not support generics until Go 1.18, released in 2022. This chapter covers where the feature
came from and how it is implemented. Section 8.1 explains why Go went so long without generics, the
syntax that was finally added, and how the compiler implements generics through GC shape stenciling
plus dictionaries. Section 8.2 explains why the 2018 contracts draft was abandoned and how
constraints evolved from "a piece of code that is never executed" into type sets described by
interfaces. Section 8.3 covers type-checking problems such as type sets and type inference, along
with the compiler's type checker, `types2`. Section 8.4 covers the generic packages and language
features added since Go 1.18 (including generic methods in Go 1.27), the capabilities still missing,
and the performance cost of indirect access through dictionaries.
