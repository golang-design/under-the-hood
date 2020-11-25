---
weight: 2101
title: "6.1 随机调度的基本概念"
---

# 6.1 随机调度的基本概念




## 离线调度

TODO:

## 在线调度

在线调度（On-Line scheduling）指任务的处理时长未知的调度。对于 $1|r_j| \sum C_j$ 调度模型而言:

- 单机调度时，给定 $n$ 个任务，其处理时间分别为 $C1, ..., Cn$，其被调度时刻为 $r1, ..., rn$
- 是一个 NP-hard 问题
- 如果所有任务的调度时刻相同，则可以使用 SPT（最短处理时间有限, shortest processing time first）策略解决此问题
- SPT 是一个在线调度算法（每当单机空闲时，处理一个具有最短处理时间的任务）。
- 定理：对于 $1|r_j|\sum C_j$ 的 SPT-算法具有常数竞争率
- 可以更好吗？最好是什么程度？下界：竞争率至少为 2

### 竞争分析

- 一个在线算法具有 $\rho$-竞争率，如果他的目标值不超过 $\rho$ 乘以所有实例的最优在线值
- 竞争率与在线设置的近似值有关
- 一个允许随机化的在线算法（允许随机选择）则竞争分析使用期望值来进行计算

### $\alpha$-调度器

调度算法：

```
1. L: list of tasks for which in the optimal preemptive schedule an alpha fraction has already been scheduled at the current time; initially L = {};
2. proceed in time whereby the preemptive schedule is updated
3. If alpha fraction of task j is finished in preemptive schedule Then
4.    add j at the end of L;
5. If machine gets idle Then
6.    schedule first job of L or if L is empty proceed in time;
```

- 对于固定的 $\alpha$, $\alpha$-调度器是一个确定性算法
- 对于 $\alpha$ = 1, $\alpha$-调度器的竞争率为 2
- 其他 $\alpha$ 值具有更高的竞争率
- 定理: 任何随机在线 $\alpha$-调度器算法具有竞争率 $e / (e-1) \simeq 1.582$，其中 $\alpha$ 根据概率密度函数 $f(\alpha) = \frac{ e^\alpha }{ e - 1 }$ 进行选择 
- 定理: Any randomized on-line algorithm for problem $1|r_j| \sum C_j$ 问题的任何随机化在线算法竞争率至少为 $e/(e-1)$ 。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
