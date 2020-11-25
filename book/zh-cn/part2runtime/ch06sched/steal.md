---
weight: 2102
title: "6.2 工作窃取式调度"
---

# 6.2 工作窃取式调度



## 性能模型

- 性能方程
- memory wall
- Amdahl 定律
- Gustafson 定律
- 经典例子：矩阵乘法的瓶颈, tiling 技巧
- 性能测量


TODO: 讨论与 work tealing 相关的调度理论，可能的讨论的主题包括：

0. original work stealing scheduling
1. NUMA-aware scheduling
2. non-cooperative preemption
3. work stealing with latency
4. thread scheduling
5. nested parallel scheduling
6. power-aware scheduling
7. distributed work stealing
8. ...

# 基于工作窃取的多线程计算调度

Robert D. Blumofe, Charles E. Leiserson

Journal of the ACM, Vol. 46, No.5, Spectember 1999, pp. 720-748

## 摘要

本文研究了并行计算机上有效调度完全严格（即结构良好）的多线程计算问题。调度此类动态多指令多数据流式（MIMD-style）计算的一种流行的方法是**工作窃取**，其中需要工作的处理器从运行其他计算线程的处理器中窃取任务。本文首次证明了有依赖的多线程计算中一个有效的工作窃取式调度器。

具体而言，我们的分析显示，使用我们的工作窃取调度器在 $P$ 个处理器上执行完全严格计算的期望时间为 $T_{1} / P + O(T_{\infty})$，其中 $T_1$为多线程计算中最少串行执行时间，$T_{\infty}$ 为无穷多个处理器的最少执行时间。 此外，执行所需的空间至多为 $S_{1}P$，其中 $S_1$为要求的最小连续空间。我们还指出算法的总通信时间期望至多为 $O(PT_{\infty}(1+n_d)S_{max})$，其中 $S_{max}$为任意线程的最大活跃记录的大小，$n_d$则为任意线程与其父线程同步的次数。此上界证明了民间智慧的正确性：工作窃取调度器与**工作共享**调度器相比通信效率更高。以上三个上界在常数因子内均存在且为最优。

## 1 引言

为了在 MIMD 型并行计算机上有效执行动态增长的多线程计算，调度算法必须确保足够的线程同时处于活跃状态以保持处理器繁忙。同时，它应确保并发活跃线程的数量保持在合理的限制范围内，以便内存要求不会过大。此外，如果可能，调度程序还应尝试在同一处理器上维护相关线程，以便最小化它们之间的通信。毫无疑问，同时实现所有这些目标可能很困难。

目前已经出现了两种调度范式来解决调度多线程计算的问题：**工作共享**（work sharing）和**工作窃取**（work stealing）。在工作共享中，只要处理器生成新线程，调度程序就会尝试将其中一些线程迁移到其他处理器，以期将工作分配给未充分利用的处理器。然而，在工作窃取中，未充分利用的处理器采取主动：它们试图从其他处理器「窃取」线程。直观地说，线程迁移在工作窃取中的发生频率低于工作共享，因为当所有处理器都有工作要做时，工作窃取调度程序不会迁移任何线程，但线程总是受到工作共享调度程序迁移。

工作窃取的想法至少可以追溯到 [Burton and Sleep, 1981] 关于函数式程序并行执行的研究和 [Halstead, 1984] 对 Multilisp 的实现。这些作者指出了工作偷窃在空间和通信方面的启发式好处。从那时起，许多研究人员就这一策略实现了诸多变体（参见，例如，[Blumofe and Lisiecki, 1997]，[Feldmann et al. 1993]，[Finkel and Manber, 1987]，[Halbherr et al. 1994]，[Kuszmaul, 1994]，[Mohr et al. 1991] 和 [Vandevoorde and Roberts, 1988]）。[Rudolph et al. 1991] 分析了在并行计算机上独立工作负载均衡的随机工作窃取策略，[Karp and Zhang, 1993] 分析了并行回溯搜索的随机工作窃取策略。[Zhang and Ortynski, 1994] 已经对这个算法的通信要求有了很好的界限。

在本文中，我们提出并分析了一种用于调度「完全严格」（结构良好）多线程计算的工作窃取算法。这类计算包括回溯搜索计算 [Karp and Zhang, 1993; Zhang and Ortynski, 1994] 和分治计算 [Wu and Kung 1991]，以及由于数据依赖性，线程可能会停顿的数据流计算 [Arvind et al. 1989]。类似于 [Liu et al. 1993] 的对同一数据结构通过对手串行排队的并发访问的原子消息传递（message passing）模型，我们在一个严格的原子访问模型中分析我们的算法。

我们的主要贡献是用于完全严格的多线程计算的随机工作窃取调度器，它在时间、空间和通信方面证明是有效的。我们证明使用我们的工作窃取调度算法在 $P$ 个处理器上执行完全严格计算的期望时间是 $T_{1} / P + O(T_{\infty})$，其中 $T1$ 是多线程计算的最小串行执行时间，$T_\infty$􏱇 是具有无限数量处理器的最少执行时间。此外，执行所需的空间最多为 $S_{1}P$，其中 $S_1$ 为最小连续空间要求。这些界限优于以前的工作共享调度器 [Blumofe and Leiserson, 1998]，并且工作窃取调度器更加简单且非常实用。与 [Blumofe and Leiserson, 1998] 研究的（一般）严格计算相比，这种改进的部分原因在于我们专注于完全严格的计算。我们还证明了执行的总通信期望最多为 $O(PT_{\infty}(1+n_d)S_{max})$，其中$S_{max}$ 是任何线程的最大活跃记录的大小，$n_d$则为任意线程与其父线程同步的次数。这种界限存在于一个常数因子内，与 [Wu and Kung, 1991] 中并行分治通信的下界相同。相比之下，工作共享调度	器具有几乎最坏情况的通信行为。因此，我们的结果支持了民间智慧，即工作窃取优于工作共享。

其他人已经研究并继续研究有效管理并行计算的空间要求的问题。[Culler and Arvind, 1988] 以及[Ruggiero and Sargeant, 1987] 给出了限制数据流程序所需空间的启发式方法。[Burton, 1988] 展示了如何在不导致死锁的情况下限制某些并行计算中的空间。最近，[Burton, 1996] 开发并分析了一种具有可证明的良好时间和空间界限的调度算法。[Blelloch et al. 1995; 1997] 还开发并分析了具有可证明的良好时间和空间界限的调度算法。目前尚不清楚这些算法中的任何算法是否与偷工作一样实用。

本文的其余部分组织如下：在第 2 节中，我们回顾了 [Blumofe and Leiserson, 1998] 中介绍的多线程计算的图论模型，它为分析调度程序提供了理论基础。第 3 节给出了一个使用中央队列的简单调度算法。这种 Busy-leaves 算法构成了我们随机化工作窃取算法的基础，并在第 4 节中介绍了这一算法。在第 5 节中，我们介绍了用于分析工作窃取算法执行时间和通信成本的原子访问模型，提出并分析一个组合的「ball and bins」博弈，我们用它来推导随机工作窃取中出现的争用的界限。然后，我们在第 6 节中使用此接线以及延迟序列参数 [Ranade, 1987] 来分析工作窃取算法的执行时间和通信成本。最后，在第 7 节中，我们简要讨论了如何本文中的理论思想应用于 Cilk 编程语言和运行时系统 [Blumofe et al. 1996] 和 [Frigo et al. 1998] ，并进行了总结性陈述。

## 2 多线程计算模型

TODO:

**定理1 （贪心调度定理）**：对于具有工作 $T1$ 和临界路径长度 $T_\infty$ 􏱇的任何多线程计算，对于任何数量为 $P$ 的处理器，任何贪婪的 $P$ 处理器执行调度 $X$ 达到 $T(X) \leq T_1 / P + T_\infty$。

## 3 Busy-Leaves 属性

TODO:

**引理2**：对于栈深度为 $S_1$ 的任何多线程计算，维护 Busy-leaves 属性的任何 $P$ 处理器执行调度 $X$ 的空间界限为 $S(X) \leq S_1 P$。

**定理3**：对于任意数量的 P 处理器和任何具有工作 $T_1$，关键路径长度 $T_\infty$ 和堆栈深度 $S_1$ 的严格多线程计算，Busy-Leaves 算法计算 $P$ 处理器执行调度 $X$，其执行时间满足 $T(X) \leq T_1 / P + T_\infty$ 并且其空间满足 $S(X) \leq S_1 P$。

## 4 随机化工作窃取算法

TODO:

**引理4**：在通过工作窃取算法执行任何完全严格的多线程计算时，考虑任何处理器 $p$ 以及 $p$ 在线程上工作的任何给定时间步长。设 $\Gamma_0$ 是 $p$ 正在处理的线程，令 $k$ 为 $p$ 的就绪队列的线程数，令$\Gamma_0$，$\Gamma_1$，$\Gamma_k$表示从下到上排序的 $p$ 的就绪队列线程，使得 $\Gamma_􏱃1$ 在最底端，而 $\Gamma_k$ 在最顶端。如果我们有 $k>0$，则 p 的就绪队列中的线程满足以下性质：

1. 对于 $i = 1,2, ..., k$，线程 $\Gamma_i$ 为 $\Gamma_{i-1}$ 的父线程。
2. 如果有 $k>1$，则对于 $i=1,2,...,k-1$，线程 $\Gamma_{i}$ 没有执行工作因为它尚未被 $\Gamma_{i-1}$ 创建。

定理5.对于堆栈深度为S1的任何完全严格的多线程计算，工作窃取算法在具有P处理器的计算机上运行，最多使用S1P空间。

## 5 原子访问与回收博弈

TODO:

## 6 工作窃取算法的分析

TODO:

**定理13**：考虑在具有 P 处理器的并行计算机上通过工作窃取算法执行任何完全严格的多线程计算，其中工作 $T1$和临界路径长度为 $T_\infty$，则包含调度开销的期望运行时间 为 $T_1 / P + O(T_\infty)$。进一步，对于任意 $\epsilon > 0$，以至少 $1-\epsilon$的概率，在 $P$ 处理器上的执行时间为 $T_1 / P + O(T_\infty + \log{P} + \log{(1/\epsilon)})^3$。

**定理14**：考虑在具有 P 处理器的并行计算机上通过工作窃取算法执行任何具有临界路径长度为 $T_\infty$的完全严格的多线程计算。则传送总字节数的期望为 $O(PT_\infty (1+n_d) S_{max})$ ，其中 $n_d$为最大活跃帧的字节大小。进一步，对于任意 $\epsilon>0$，以至少 $1-\epsilon$的概率，遭遇的通信数为 $O(P(T_\infty + \log{(1/\epsilon)})(1+n_d)S_{max})$ 。

## 7 结论

本文分析的方法有多实用？我们一直积极致力于构建一种基于 C 语言的名为 Cilk（发音为 "silk"）的编程语言，并用于编程多线程计算（参见，例如，[Blumofe 1995]，[Blumofe et al. 1996]，[Frigo et al. 1998]，[Joerg, 1996] 和 [Randall, 1998]）。Cilk 源自 PCM（Parallel Continuation Machine）系统 [Halbherr et al. 1994]，其本身一部分受到此处研究报告的启发。Cilk 运行时系统采用本文中描述的工作窃取算法。由于 Cilk 采用了可证明有效的调度算法，因此 Cilk 为用户应用程序提供了有保证的性能。具体来说，我们已经凭经验发现使用模型 $T_1/P+T_\infty$ 可以准确预测用 Cilk 语言编写的应用程序在具有 P 个处理器上的运行性能。

Cilk 系统目前运行在现代共享内存多处理器上，例如 Sun Enterprise，Silicon Graphics Origin，Intel Quad Pentium 和 DEC Alphaserver（早期版本的 Cilk 运行在 Thinking Machines CM-5 MPP，Intel Paragon MPP 和 IBM SP-2 上）。迄今为止，用 Cilk 编写的应用程序包括蛋白质折叠 [Pande et al. 1994]，图形渲染 [Stark 1998]，回溯搜索和 *􏱑Socrates 国际象棋程序 [Joerg and Kuszmaul, 1994]，它在 1995 年 ICCA 世界计算机国际象棋锦标赛中获得二等奖，该锦标赛在桑迪亚国家实验室的 1824-node Paragon上运行。我们最近的国际象棋程序 Cilkchess 赢得了 1996 年荷兰公开赛计算机国际象棋锦标赛。 Cilk 的团队编程在国际功能编程大会主办的 ICFP'98 编程竞赛中获得了一等奖（不败）。

作为我们研究的一部分，我们在工作站网络上为 Cilk 实现了原型运行时系统。这个运行时系统叫做 Cilk-NOW [Blumofe 1995; Blumofe and Lisiecki 1997; Lisiecki 1996] 支持自适应并行，其中工作站环境中的处理器可以加入用户的计算，如果它们在其他方面处于空闲状态，并且可以立即使用，以便在需要时由其所有者再次离开计算。 Cilk-NOW 还支持透明容错，这意味着即使面对程序员以完全错误的方式编写的代码导致处理器崩溃，计算也可以继续进行。[Randall, 1998] 描述了更新的 SMP 集群分布式实现。

我们还调查了与 Cilk 相关的其他主题，包括分布式共享内存和调试工具（有关分布式共享内存的示例，请参阅 [Blumofe et al, 1996a; 1996b]，[Frigo, 1998]，[Frigo and Luchangco, 1998]。有关调试工具的示例，请参见 [Cheng, 1998]，[Cheng et al. 1998]，[Feng and Leiserson, 1997]，和 [Stark, 1998]）可以在 http://supertech.lcs.mit.edu/cilk 上找到论文和软件版本的最新信息。

对于共享内存多处理器的情况，我们最近推广了两个维度的时间界限（但不是空间或通信边界）[Arora et al. 1998]。首先，我们已经证明，对于任意（不一定是完全严格甚至严格的）多线程计算，预期的执行时间是 $O(T_{1}/P+T_{\infty})$􏱇。该界限基于新的结构引理和使用潜在函数的摊销分析。其次，我们开发了工作窃取算法的非阻塞式实现，并且我们分析了它在多程序环境中的执行时间，其中计算在一组数量随时间增长和缩小的处理器上执行，这种增长和缩小是由争用对手控制。如果攻击者选择不增加或缩小处理器数量，则绑定专门用于匹配我们之前的绑定。非阻塞工作窃取调度器已在 Hood 用户级线程库中实现 [Blumofe and Papadopoulos 1998; Papadopoulos 1998]。可以在万维网上找到论文和软件版本的最新的信息，网址为 http://www.cs.utexas.edu/users/hood。

## 参考文献

- ARORA, N. S., BLUMOFE, R. D., AND PLAXTON, C. G. 1998. **Thread scheduling for multiprogrammed multiprocessors**. In Proceedings of the 10th Annual ACM Symposium on Parallel Algorithms and Architectures (SPAA’98) (Puerto Vallarta, Mexico, June 28–July 2). ACM, New York, pp. 119–129.
- ARVIND, NIKHIL, R. S., AND PINGALI, K. K. 1989. I-structures: **Data structures for parallel computing**. ACM Trans. Program. Lang. Syst. 11, 4 (Oct.), 598–632. 
- BLELLOCH, G. E., GIBBONS, P. B., AND MATIAS, Y. 1995. **Provably efficient scheduling for languages with fine-grained parallelism**. In Proceedings of the 7th Annual ACM Symposium on Parallel Algorithms and Architectures (SPAA’95) (Santa Barbara, Calif., July 17–19). ACM, New York, pp. 1–12. 
- BLELLOCH, G. E., GIBBONS, P. B., MATIAS, Y., AND NARLIKAR, G. J. 1997. **Space-efficient scheduling of parallelism with synchronization variables**. In Proceedings of the 9th Annual ACM Symposium on Parallel Algorithms and Architectures (SPAA’97) (Newport, R.I., June 22–25). ACM, New York, pp. 12–23. 
- BLUMOFE, R. D. 1995. **Executing multithreaded programs efficiently**. Ph.D. thesis, Department of Electrical Engineering and Computer Science, Massachusetts Institute of Technology. Also avail- able as MIT Laboratory for Computer Science Technical Report MIT/LCS/TR-677. 
- BLUMOFE, R. D., FRIGO, M., JOERG, C. F., LEISERSON, C. E., AND RANDALL, K. H. 1996a. **An analysis of dag-consistent distributed shared-memory algorithms**. In Proceedings of the 8th Annual ACM Symposium on Parallel Algorithms and Architectures (SPAA’96) (Padua, Italy, June 24–26). ACM, New York, pp. 297–308. 
- BLUMOFE, R. D., FRIGO, M., JOERG, C. F., LEISERSON, C. E., AND RANDALL, K. H. 1996b. **Dag-consistent distributed shared memory**. In Proceedings of the 10th International Parallel Process- ing Symposium (IPPS) (Honolulu, Hawaii, April). IEEE Computer Society Press, Los Alamitos, Calif., pp. 132–141. 
- BLUMOFE, R. D., JOERG, C. F., KUSZMAUL, B. C., LEISERSON, C. E., RANDALL, K. H., AND ZHOU, Y. 1996c. **Cilk: An efficient multithreaded runtime system**. J. Paral. Dist. Comput. 37, 1 (Aug.), 55– 69. 
- BLUMOFE, R. D., AND LEISERSON, C. E. 1998. **Space-efficient scheduling of multithreaded computations**. SIAM J. Comput. 27, 1 (Feb.), 202–229. 
- BLUMOFE, R. D., AND LISIECKI, P. A. 1997. **Adaptive and reliable parallel computing on networks of workstations**. In Proceedings of the USENIX 1997 Annual Technical Conference on UNIX and Advanced Computing Systems (Anaheim, Calif., Jan.). USENIX Associates, Berkeley, Calif., pp. 133–147. 
- BLUMOFE, R. D., AND PAPADOPOULOS, D. 1998. **The performance of work stealing in multiprogrammed environments**. Tech. Rep. TR-98-13 (May). Dept. Computer Sciences, The University of Texas at Austin, Austin, Tex. 
- BRENT, R. P. 1974. **The parallel evaluation of general arithmetic expressions**. J. ACM 21, 2 (Apr.), 201–206. 
- BURTON, F. W. 1988. **Storage management in virtual tree machines**. IEEE Trans. Comput. 37, 3 (Mar.), 321–328. 
- BURTON, F. W. 1996. **Guaranteeing good memory bounds for parallel programs**. IEEE Trans. Softw. Eng. 22, 10 (Oct.), 762–773. 
- BURTON, F. W., AND SLEEP, M. R. 1981. **Executing functional programs on a virtual tree of processors**. In Proceedings of the 1981 Conference on Functional Programming Languages and Computer Architecture (Portsmouth, N.H., Oct.). ACM, New York, N.Y., pp. 187–194. 
- CHENG, G.-I. 1998. **Algorithms for data-race detection in multithreaded programs**. Master’s thesis, Department of Electrical Engineering and Computer Science, Massachusetts Institute of Technol- ogy. 
- CHENG, G.-I., FENG, M., LEISERSON, C. E., RANDALL, K. H., AND STARK, A. F. 1998. **Detecting data races in Cilk programs that use locks**. In Proceedings of the 10th ACM Symposium on Parallel Algorithms and Architectures (SPAA’98) (Puerto Vallarta, Mexico, June 28–July 2). ACM, New York, pp. 298–309. 
- CULLER, D. E., AND ARVIND. 1988. **Resource requirements of dataflow programs**. In Proceedings of the 15th Annual International Symposium on Computer Architecture (ISCA) (Honolulu, Hawaii, May). IEEE Computer Society Press, Los Alamitos, Calif., pp. 141–150. Also available as MIT Laboratory for Computer Science, Computation Structures Group Memo 280. 
- EAGER, D. L., ZAHORJAN, J., AND LAZOWSKA, E. D. 1989. **Speedup versus efficiency in parallel systems**. IEEE Trans. Comput. 38, 3 (Mar.), 408–423. 
- FELDMANN, R., MYSLIWIETZ, P., AND MONIEN, B. 1993. **Game tree search on a massively parallel system**. Adv. Comput. Chess 7, 203–219. 
- FENG, M., AND LEISERSON, C. E. 1997. **Efficient detection of determinacy races in Cilk programs**. In Proceedings of the 9th Annual ACM Symposium on Parallel Algorithms and Architectures (SPAA’97) (Newport, R.I., June 22–25). ACM, New York, pp. 1–11. 
- FINKEL, R., AND MANBER, U. 1987. DIB—**A distributed implementation of backtracking**. ACM Trans. Program. Lang. Syst. 9, 2 (Apr.), 235–256. 
- FRIGO, M. 1998. **The weakest reasonable memory model**. Master’s thesis, Dept. Electrical Engi- neering and Computer Science, Massachusetts Institute of Technology, Cambridge, Mass. 
- FRIGO, M., LEISERSON, C. E., AND RANDALL, K. H. 1998. **The implementation of the Cilk-5 multithreaded language**. In Proceedings of the 1998 ACM SIGPLAN Conference on Programming Language Design and Implementation (PLDI’98) (Montreal, Canada, June 17–19). ACM, New York. 
- FRIGO, M., AND LUCHANGCO, V. 1998. **Computation-centric memory models**. In Proceedings of the 10th Annual ACM Symposium on Parallel Algorithms and Architectures (SPAA’98) (Puerto Vallarta, Mexico, June 28–July 2). ACM, New York, pp. 240–249. 
- GRAHAM, R. L. 1966. **Bounds for certain multiprocessing anomalies**. Bell Syst. Tech. J. 45, 1563–1581. 
- GRAHAM, R. L. 1969. **Bounds on multiprocessing timing anomalies**. SIAM J. Appl. Math. 17, 2 (Mar.), 416–429. 
- HALBHERR, M., ZHOU, Y., AND JOERG, C. F. 1994. **MIMD-style parallel programming with continuation-passing threads**. In Proceedings of the 2nd International Workshop on Massive Parallel- ism: Hardware, Software, and Applications (Capri, Italy, Sept.). World Scientific, Singapore. (Also available as MIT Laboratory for Computer Science Computation Structures, Group Memo 355, March 1994. MIT, Cambridge, Mass. 
- HALSTEAD, R. H., JR. 1984. **Implementation of Multilisp: Lisp on a multiprocessor**. In Conference Record of the 1984 ACM Symposium on LISP and Functional Programming (Austin, Tex., Aug.) ACM, New York, pp. 9–17. 
- JOERG, C. F. 1996. **The Cilk System for Parallel Multithreaded Computing**. Ph.D. dissertation. Dept. Electrical Engineering and Computer Science, Massachusetts Institute of Technology, Cambridge, Mass. 
- JOERG, C., AND KUSZMAUL, B. C. 1994. **Massively parallel chess**. In Proceedings of the 3rd DIMACS Parallel Implementation Challenge (Rutgers University, New Jersey, Oct. 1994). 
- KARP, R. M., AND ZHANG, Y. 1993. **Randomized parallel algorithms for backtrack search and branch-and-bound computation**. J. ACM 40, 3 (July), 765–789. 
- KUSZMAUL, B. C. 1994. **Synchronized MIMD computing**. Ph.D. thesis, Dept. Electrical Engineering and Computer Science, Massachusetts Institute of Technology, Cambridge, Mass. Also available as MIT Laboratory for Computer Science Technical Report MIT/LCS/TR-645. 
- LISIECKI, P. 1996. **Macroscheduling in the Cilk network of workstations environment**. Master’s thesis, Dept. Electrical Engineering and Computer Science, Massachusetts Institute of Technology, Cambridge, Mass. 
- LIU, P., AIELLO, W., AND BHATT, S. 1993. **An atomic model for message-passing**. In Proceedings of the 5th Annual ACM Symposium on Parallel Algorithms and Architectures (SPAA’93) (Velen, Germany, June 30–July 2). ACM, New York, pp. 154–163. 
- MOHR, E., KRANZ, D. A., AND HALSTEAD, R. H., JR. 1991. **Lazy task creation: A technique for increasing the granularity of parallel programs**. IEEE Trans. Parall. Dist. Syst. 2, 3 (July), 264–280. PANDE, V. S., JOERG, C. F., GROSBERG, A. Y., AND TANAKA, T. 1994. Enumerations of the 
- Hamiltonian walks on a cubic sublattice. J. Phys. A 27.
   PAPADOPOULOS, D. P. 1998. **Hood: A user-level thread library for multiprogramming multiprocessors**. Master’s thesis, Dept. Computer Sciences, The University of Texas at Austin, Austin, Tex. RANADE, A. 1987. How to emulate shared memory. In Proceedings of the 28th Annual Symposium on Foundations of Computer Science (FOCS) (Los Angeles, Calif., Oct.). IEEE Computer Society 
- Press, Los Alamitos, Calif., pp. 185–194.
   RANDALL, K. H. 1998. **Cilk: Efficient multithreaded computing**. Ph.D. dissertation. Dept. Electrical Engineering and Computer Science, Massachusetts Institute of Technology, Cambridge, Mass. RUDOLPH, L., SLIVKIN-ALLALOUF, M., AND UPFAL, E. 1991. A simple load balancing scheme for task allocation in parallel machines. In Proceedings of the 3rd Annual ACM Symposium on Parallel Algorithms and Architectures (SPAA’91) (Hilton Head, S.C., July 21–24). ACM, New York, pp. 237–245.
- RUGGIERO, C. A., AND SARGEANT, J. 1987. **Control of parallelism in the Manchester dataflow machine**. In Functional Programming Languages and Computer Architecture, Number 274 in Lecture Notes in Computer Science. Springer-Verlag, New York, pp. 1–15.
- STARK, A. F. 1998. **Debugging multithreaded programs that incorporate user-level locking**. Master’s thesis, Department of Electrical Engineering and Computer Science, Massachusetts Institute of Technology, Cambridge, Mass.
- VANDEVOORDE, M. T., AND ROBERTS, E. S. 1988. **WorkCrews: An abstraction for controlling parallelism**. International Journal of Parallel Programming 17, 4 (Aug.), 347–366.
- WU, I.-C., AND KUNG, H. T. 1991. **Communication complexity for parallel divide-and-conquer**. In Proceedings of the 32nd Annual Symposium on Foundations of Computer Science (FOCS) (San Juan, Puerto Rico, Oct. 1991). IEEE Computer Society Press, Los Alamitos, Calif., pp. 151–162. 
- ZHANG, Y., AND ORTYNSKI, A. 1994. **The efficiency of randomized parallel backtrack search**. In Proceedings of the 6th IEEE Symposium on Parallel and Distributed Processing (Dallas, Texas, Oct. 1994). IEEE Computer Society Press, Los Alamitos, Calif.

## 进一步阅读的参考文献

- [runtime: tight loops should be preemptible](https://github.com/golang/go/issues/10958)
- [Non-cooperative goroutine preemption](https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md)
- [NUMA-aware scheduler for Go](https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub)

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).