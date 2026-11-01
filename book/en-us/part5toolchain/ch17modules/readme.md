---
weight: 5300
title: "Chapter 17 Modules and Dependencies"
bookCollapseSection: true
---

# Chapter 17 Modules and Dependencies

- [17.1 The Hard Parts of Dependency Management](./challenges.md)
- [17.2 Semantic Version Management](./semantics.md)
- [17.3 Minimal Version Selection](./minimum.md)
- [17.4 The vgo versus dep Dispute](./fight.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>You might wonder: Why not do what other languages do? Java has Maven, Node has NPM, Ruby has Bundler, Rust has Cargo. How is this not a solved problem?</I></br>
<div class="quote-right">
-- Russ Cox, "The Principles of Versioning in Go"
</div>
</div>

The epigraph is a question Cox posed on the reader's behalf in 2019. Cox's answer is that Go learned
from the practice of `dep` that some decisions in the approach shared by Bundler, Cargo and `dep`
make software engineering more complicated, so Go modules chose differently. This chapter examines
those choices and where they came from.

Section 17.1 explains why dependency management is hard: `go get` without versions, diamond
dependencies, the NP-completeness of the general version selection problem, and reproducible builds,
followed by the three principles Go derived from them. Section 17.2 covers semantic versioning and
the import compatibility rule, which writes the major version into the import path, and shows how
untagged code takes part in version ordering through pseudo-versions. Section 17.3 covers the
minimal version selection algorithm: why it avoids NP-completeness, what high-fidelity builds gain
and cost, and how module graph pruning, workspaces and toolchain management extend it. Section 17.4
covers the disagreement between `dep` and vgo, the path of Go modules from experiment to default,
and the `go.sum` file and checksum database that keep the content of a version fixed.
