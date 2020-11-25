---
weight: 1510
title: "5.10 进一步阅读的参考文献"
---

TODO: atomic.value 的 proposal

Package context · Golang
Go Concurrency Patterns: Context
Using context cancellation in Go
proposal: context: new package for standard library #14660 https://github.com/golang/go/issues/14660 ↩︎

Sameer Ajmani. 29 July 2014. “Go Concurrency Patterns: Context” https://blog.golang.org/context ↩︎

## 进一步阅读的参考文献

<!-- - [Pike and Cox, 2009] Rob Pike and Russ Cox. The Go Memory Model. February 21, 2009. https://golang.org/ref/mem
- [Vyukov, 2013] Dmitry Vyukov. cmd/cc: atomic intrinsics. Mar 1, 2013. https://github.com/golang/go/issues/4947
- [Cox, 2013] Russ Cox. doc: define how sync/atomic interacts with memory model. Mar 13, 2013. https://github.com/golang/go/issues/5045
- [Cox, 2014] Russ Cox. doc: allow buffered channel as semaphore without initialization. March 03, 2014. https://codereview.appspot.com/75130045
- [Vyukov, 2014a] Dmitry Vyukov. doc: define how sync interacts with memory model. May 7, 2014. https://github.com/golang/go/issues/7948
- [Vyukov, 2014b] Dmitry Vyukov. doc: define how finalizers interact with memory model. Dec 25, 2014. https://github.com/golang/go/issues/9442
- [Cox, 2016] Russ Cox. Go's Memory Model. February 25, 2016. http://nil.csail.mit.edu/6.824/2016/notes/gomem.pdf 
- Fannie Zhang. Specify the memory order guarantee provided by atomic Load/Store. July 15, 2019. https://groups.google.com/forum/#!msg/golang-dev/vVkH_9fl1D8/azJa10lkAwAJ -->

- [Cox, 2013] Russ Cox. gc-aware pool draining policy. Nov 27, 2013. https://groups.google.com/d/msg/golang-dev/kJ_R6vYVYHU/LjoGriFTYxMJ
- [Fitzpatrick, 2013] Brad Fitzpatrick. sync: add Pool type. Jan 28, 2013. https://github.com/golang/go/issues/4720
- [Vyukov, 2014a] Dmitry Vyukov. sync: scalable Pool. Jan 24, 2014. https://github.com/golang/go/commit/f8e0057bb71cded5bb2d0b09c6292b13c59b5748#diff-2e9fc106a7387ca4c32ecf856a91f82a
- [Vyukov, 2014b] Dmitry Vyukov. sync: less agressive local caching in Pool. Apr 14, 2014. https://github.com/golang/go/commit/8fc6ed4c8901d13fe1a5aa176b0ba808e2855af5#diff-2e9fc106a7387ca4c32ecf856a91f82a
- [Vyukov, 2014c] sync: release Pool memory during second and later GCs. Oct 22, 2014. https://github.com/golang/go/commit/af3868f1879c7f8bef1a4ac43cfe1ab1304ad6a4#diff-491b0013c82345bf6cfa937bd78b690d
- [Clements, 2019a] Austin Clements. sync: use lock-free structure for Pool stealing. Mar 1, 2019. https://github.com/golang/go/commit/d5fd2dd6a17a816b7dfd99d4df70a85f1bf0de31
- [Clements, 2019b] Austin Clements. sync: smooth out Pool behavior over GC with a victim cache. Mar 2, 2019. https://github.com/golang/go/commit/2dcbf8b3691e72d1b04e9376488cef3b6f93b286)
https://faiface.github.io/post/context-should-go-away-go2/

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).