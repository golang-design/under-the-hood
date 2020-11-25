---
weight: 2113
title: "6.13 进一步阅读的参考文献"
---

# 6.13 进一步阅读的参考文献

<table class="bib">

<tr>
<td>[Robert et al., 1999]</td><td>Robert D. Blumofe and Charles E. Leiserson. 1999. "Scheduling multithreaded computations by work stealing." J. ACM 46, 5 (September 1999), 720-748. https://dl.acm.org/citation.cfm?id=324234</td>
</tr>

<tr>
<td>[Mullender and Cox, 2008]</td><td>Mullender, Sape, and Russ Cox. "Semaphores in plan 9." 3rd International Workshop on Plan. Vol. 9. 2008. https://swtch.com/semaphore.pdf</td>
</tr>

<tr>
<td>[Stevens et al., 2008]</td><td>Stevens, W. Richard, and Stephen A. Rago. "Advanced programming in the UNIX environment." Addison-Wesley, 2008.</td>
</tr>

<tr>
<td>[Cox, 2008]</td><td>Russ Cox, "Clean up scheduler." Aug 5, 2008. https://github.com/golang/go/commit/96824000ed89d13665f6f24ddc10b3bf812e7f47#diff-1fe527a413d9f1c2e5e22e08e605a192</td>
</tr>


<tr>
<td>[Cox, 2009]</td><td>Russ Cox, things are much better now, Nov 11, 2009. https://github.com/golang/go/commit/fe1e49241c04c748d0e3f4762925241adcb8d7da</td>
</tr>

<tr>
<td>[Drepper, 2011]</td><td>Ulrich Drepper. "Futexes are tricky." Red Hat Inc, Nov 5, 2011. http://people.redhat.com/drepper/futex.pdf</td>
</tr>

<tr>
<td>[Vyukov, 2012]</td><td>Dmitry Vyukov. "Scalable Go Scheduler Design Doc." May 2, 2012. https://golang.org/s/go11sched</td>
</tr>

<tr>
<td>[Vyukov, 2013a]</td><td>Dmitry Vyukov, "runtime: improved scheduler." Mar 1, 2013. https://github.com/golang/go/commit/779c45a50700bda0f6ec98429720802e6c1624e8</td>
</tr>

<tr>
<td>[Vyukov, 2013b]</td><td>Dmitry Vyukov. "Go Preemptive Scheduler Design Doc." May 15, 2013. https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit#heading=h.3pilqarbrc9h</td>
</tr>

<tr>
<td>[Vyukov, 2013c]</td><td>Dmitry Vyukov. "runtime: make timers faster." Aug 24, 2013. https://golang.org/issue/6239</td>
</tr>

<tr>
<td>[Vyukov, 2014]</td><td>Dmitry Vyukov, "NUMA-aware scheduler for Go." Sep 2014. https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub</td>
</tr>

<tr>
<td>[Clements, 2015]</td><td>Austin Clements. "runtime: tight loops should be preemptible." May 26, 2015. https://golang.org/issue/10958</td>
</tr>

<tr>
<td>[Lopez et al., 2016]</td><td>Brian Lopez et al. "runtime: let idle OS threads exit." Mar 2, 2016. https://golang.org/issue/14592</td>
</tr>

<tr>
<td>[Valialkin, 2016]</td><td>Aliaksandr Valialkin et al. "runtime: timer doesn't scale on multi-CPU systems with a lot of timers." Apr 5, 2016. https://golang.org/issue/15133</td>
</tr>

<tr>
<td>[Taylor et al., 2016]</td><td>Ian Lance Taylor et al. "runtime: unexpectedly large slowdown with runtime.LockOSThread." Nov 22, 2016. https://golang.org/issue/18023</td>
</tr>

<tr>
<td>[Hofer et al., 2016]</td><td>Phil Hofer et al. "runtime: scheduler is slow when goroutines are frequently woken." Dec 7, 2016. https://golang.org/issue/18237</td>
</tr>

<tr>
<td>[Chase, 2017]</td><td>David Chase. "cmd/compile: loop preemption with fault branch on amd64." May 09, 2019. https://golang.org/cl/43050</td>
</tr>

<tr>
<td>[Mills, 2017]</td><td>Bryan C. Mills. "proposal: runtime: pair LockOSThread, UnlockOSThread calls." May 22, 2017. https://golang.org/issue/20458</td>
</tr>

<tr>
<td>[Rgooch et al., 2017]</td><td>rgooch et al. "runtime: terminate locked OS thread if its goroutine exits." May 17, 2017. https://golang.org/issue/20395</td>
</tr>

<tr>
<td>[Smelkov et al., 2017]</td><td>Kirill Smelkov. "runtime: big performance penalty with runtime.LockOSThread." Sep 10, 2017. https://golang.org/issue/21827</td>
</tr>

<tr>
<td>[lni et al, 2018]</td><td>lni et al. "time: excessive CPU usage when using Ticker and Sleep." Sep 17, 2018. https://golang.org/issue/27707</td>
</tr>

<tr>
<td>[Hines et al., 2018]</td><td>Chris Hines et al. "runtime: scheduler work stealing slow for high GOMAXPROCS." Nov 15, 2018. https://golang.org/issue/28808</td>
</tr>

<tr>
<td>[Clements, 2019]</td><td>Austin Clements. "Proposal: Non-cooperative goroutine preemption." January 18, 2019. https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md</td>
</tr>

</table>


<!-- Brad Fitzpatrick. May, 2016. “net: add mechanism to wait for readability on a TCPConn” https://github.com/golang/go/issues/15735
Ian Lance Taylor. Feb 11, 2017. “os: use poller for file I/O” https://github.com/golang/go/commit/c05b06a12d005f50e4776095a60d6bd9c2c91fac
Ian Lance Taylor. Apr 3, 2019. “runtime: change netpoll to take an amount of time to block” https://github.com/golang/go/commit/831e3cfaa594ceb70c3cbeff2d31fddcd9a25a5e
“The Go netpoller” https://morsmachine.dk/netpoller
Wikipedia: File descriptor https://en.wikipedia.org/wiki/File_descriptor

SELECT(2) · Linux Programmer's Manual http://man7.org/linux/man-pages/man2/select.2.html

Ian Lance Taylor. Apr 3, 2019. “runtime: change netpoll to take an amount of time to block” https://github.com/golang/go/commit/831e3cfaa594ceb70c3cbeff2d31fddcd9a25a5e

Ian Lance Taylor. Apr 6, 2019. “runtime: add netpollBreak” https://github.com/golang/go/commit/50f4896b72d16b6538178c8ca851b20655075b7f

Dmitry Vyukov. Oct 31, 2018. “runtime: don't recreate netpoll timers if they don't change” https://github.com/golang/go/commit/86d375498fa377c7d81c5b93750e8dce2389500e -->

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
