# 垃圾回收器: 过去、现在与未来

[TOC]

## 进一步阅读的参考文献

- [Clements, 2015a] [Concurrent garbage collector pacing & Final implementation](https://docs.google.com/document/d/1wmjrocXIWTr1JxU-3EQBI6BK6KgtiFArkG47XK73xIQ/edit#heading=h.xy314pvxblbm), [Proposal: Garbage collector pacing](https://groups.google.com/forum/#!topic/golang-dev/YjoG9yJktg4) released in go1.5
- [Clements, 2015b] [Proposal: Decentralized GC coordination](https://go.googlesource.com/proposal/+/master/design/11970-decentralized-gc.md), [Discussion #11970](https://golang.org/issue/11970) released in go1.6
- [Clements, 2015c] [Proposal: Dense mark bits and sweep-free allocation](https://go.googlesource.com/proposal/+/master/design/12800-sweep-free-alloc.md), [Discussion #12800](https://golang.org/issue/12800) released in go1.6
- [Clements, 2016] [Proposal: Separate soft and hard heap size goal](https://go.googlesource.com/proposal/+/master/design/14951-soft-heap-limit.md), [Discussion #14951](https://golang.org/issue/14951) released in go1.10
- [Clements and Hudson, 2016a] [Proposal: Eliminate STW stack re-scanning](https://go.googlesource.com/proposal/+/master/design/17503-eliminate-rescan.md) [Discussion #17503](https://golang.org/issue/17503) released in go1.8 (hybrid barrier), go1.9 (remove re-scan), go1.12 (fix mark termination race)
- [Clements and Hudson, 2016b] [Proposal: Concurrent stack re-scanning](https://go.googlesource.com/proposal/+/master/design/17505-concurrent-rescan.md), [Discussion #17505](https://golang.org/issue/17505), unreleased.
- [Hudson and Clements, 2016] [Request Oriented Collector (ROC) Algorithm](https://docs.google.com/document/d/1gCsFxXamW8RRvOe5hECz98Ftk-tcRRJcDFANj2VwCB0/edit), unreleased.
- [Clements, 2018] [Proposal: Simplify mark termination and eliminate mark 2](https://go.googlesource.com/proposal/+/master/design/26903-simplify-mark-termination.md), [Discussion #26903](https://golang.org/issue/26903), released go1.12
- [Hudson, 2015] [Go GC: Latency Problem Solved](https://talks.golang.org/2015/go-gc.pdf)


## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
