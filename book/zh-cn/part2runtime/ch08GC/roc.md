---
weight: 2309
title: "8.9 请求假设与事务制导回收"
---

# 8.9 请求假设与事务制导回收



ROC 的全称是面向请求的回收器（Request Oriented Collector），它其实也是分代 GC 的一种重新叙述。它提出了一个请求假设（Request Hypothesis）：与一个完整请求、休眠 goroutine 所关联的对象比其他对象更容易死亡。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
