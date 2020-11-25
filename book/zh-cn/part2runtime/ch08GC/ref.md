---
weight: 2313
title: "8.13 进一步阅读的参考文献"
---

# 8.13 进一步阅读的参考文献

<!-- - [Dijkstra et al., 1978] Edsger W. Dijkstra, Leslie Lamport, A. J. Martin, C. S. Scholten, and E. F. M. Steffens. 1978. On-the-fly garbage collection: an exercise in cooperation. Commun. ACM 21, 11 (November 1978), 966–975. DOI:https://doi.org/10.1145/359642.359655 -->

<!-- - [Pirinen, 1998] Pekka P. Pirinen. 1998. Barrier techniques for incremental tracing. In Proceedings of the 1st international symposium on Memory management (ISMM '98). ACM, New York, NY, USA, 20-25.
- [Yuasa, 1990] T. Yuasa. 1990. Real-time garbage collection on general-purpose machines. J. Syst. Softw. 11, 3 (March 1990), 181-198.
- [Wilson, 1992] Raul R. Wilson. 1992. Uniprocessor Garbage Collection Techniques. In Proceedings of the International Workshop on Memory Management (IWMM '92), Yves Bekkers and Jaques Cohen (Eds.). Springer-Verlag, London, UK, UK, 1-42.
- [Dijkstra et al. 1978] Edsger W. Dijkstra, Leslie Lamport, A. J. Martin, C. S. Scholten, and E. F. M. Steffens. 1978. On-the-fly garbage collection: an exercise in cooperation. *Commun. ACM* 21, 11 (November 1978), 966-975. -->

<table class="bib">

<tr>
<td>[Clements and Hudson, 2016]</td><td>Austin Clements, Rick Hudson. "Eliminate STW stack re-scanning." October 21, 2016. https://go.googlesource.com/proposal/+/master/design/17503-eliminate-rescan.md</td>
</tr>

<tr>
<td>[Dijkstra et al. 1978]</td><td>Edsger W. Dijkstra, Leslie Lamport, A. J. Martin, C. S. Scholten, and E. F. M. Steffens. 1978. "On-the-fly garbage collection: an exercise in cooperation." Commun. ACM 21, 11 (November 1978), 966-975.</td>
</tr>

<tr>
<td>[Hudson, 2015]</td><td>Rick Hudson. "Go GC: Latency Problem Solved." GopherCon Denver. July 8, 2015. https://talks.golang.org/2015/go-gc.pdf</td>
</tr>


<tr>
<td>[Clements et al, 2015]</td><td>Austin Clements et al. "Discussion of 'Proposal: Garbage collector pacing'." March 10, 2015. https://groups.google.com/forum/#!topic/golang-dev/YjoG9yJktg4 </td>
</tr>

<tr>
<td>[Clements, 2015a]</td><td>Austin Clements. "Concurrent garbage collector pacing and final implementation." Mar 10, 2015. https://golang.org/s/go15gcpacing.</td>
</tr>

<tr>
<td>[Clements, 2015b]</td><td>Austin Clements. "runtime: replace GC coordinator with state machine." Jul 31, 2015. https://golang.org/issue/11970</td>
</tr>

<tr>
<td>[Clements, 2015c]</td><td>Austin Clements. "Proposal: Dense mark bits and sweep-free allocation." Sep 30, 2015. https://go.googlesource.com/proposal/+/master/design/12800-sweep-free-alloc.md</td>
</tr>

<tr>
<td>[Clements, 2015d]</td><td>Austin Clements. "runtime: replace free list with direct bitmap allocation." Sep 30, 2015. https://golang.org/issue/12800</td><!--released in go1.6-->
</tr>

<tr>
<td>[Clements, 2015e]</td><td>Austin Clements. Proposal: Decentralized GC coordination. October 25, 2015. https://go.googlesource.com/proposal/+/master/design/11970-decentralized-gc.md</td> <!--released in go1.6-->
</tr>

<tr>
<td>[Clements, 2016a]</td><td>Austin Clements. runtime: shrinkstack during mark termination significantly increases GC STW time. Jan 14, 2016. https://golang.org/issue/12967#issuecomment-171466238</td> <!--released in go1.7-->
</tr>

<tr>
<td>[Clements, 2016b]</td><td>Austin Clements. runtime: mutator assists are over-aggressive, especially at high GOGC. Mar 24, 2016. https://golang.org/issue/14951</td><!--released in go1.10-->
</tr>

<tr>
<td>[Hudson and Clements, 2016]</td><td>Rick Hudson and Austin Clements. Request Oriented Collector (ROC) Algorithm. June 2016. https://golang.org/s/gctoc</td> <!--unreleased-->
</tr>

<tr>
<td>[Fitzpatrick, 2016]</td><td>Brad Fitzpatrick. runtime: mechanism for monitoring heap size. Aug 23, 2016. https://golang.org/issue/16843</td>
</tr>

<tr>
<td>[Clements and Hudson, 2016a]</td><td>Austin Clements. runtime: eliminate stack rescanning. Oct 18, 2016. https://golang.org/issue/17503</td> <!--released in go1.8 (hybrid barrier), go1.9 (remove re-scan), go1.12 (fix mark termination race)-->
</tr>

<tr>
<td>[Clements and Hudson, 2016b]</td><td>Austin Clements, Rick Hudson. Proposal: Concurrent stack re-scanning. Oct 18, 2016. https://go.googlesource.com/proposal/+/master/design/17505-concurrent-rescan.md</td>
</tr>

<tr>
<td>[Clements, 2016c]</td><td>Austin Clements. runtime: perform concurrent stack re-scanning. Oct 18, 2016 https://golang.org/issue/17505</td><!--unreleased-->
</tr>

<tr>
<td>[Clements and Hudson, 2016c]</td><td>Austin Clements, Rick Hudson. Proposal: Eliminate STW stack re-scanning. Oct 21, 2016 https://go.googlesource.com/proposal/+/master/design/17503-eliminate-rescan.md</td>
</tr>

<tr>
<td>[Clements 2017a]</td><td>Austin Clements. runtime/debug: add SetMaxHeap API. Jun 26 2017. https://go-review.googlesource.com/c/go/+/46751/</td>
</tr>

<tr>
<td>[Clements, 2017b]</td><td>Austin Clements. Proposal: Separate soft and hard heap size goal. October 21, 2017. https://go.googlesource.com/proposal/+/master/design/14951-soft-heap-limit.md</td>
</tr>

<tr>
<td>[Hudson, 2018]</td><td>Richard L. Hudson. Getting to Go: The Journey of Go's Garbage Collector, in International Symposium on Memory Management (ISMM), June 18, 2018. https://blog.golang.org/ismmkeynote</td>
</tr>

<tr>
<td>[Clements, 2018a]</td><td>Austin Clements. Proposal: Simplify mark termination and eliminate mark 2. Aug 9, 2018. https://go.googlesource.com/proposal/+/master/design/26903-simplify-mark-termination.md</td>
</tr>

<tr>
<td>[Clements, 2018b]</td><td>Austin Clements. runtime: simplify mark termination and eliminate mark 2. Aug 9, 2018. https://golang.org/issue/26903</td><!--released go1.12-->
</tr>

<tr>
<td>[Taylor et al., 2018]</td><td>Ian Lance Taylor et al. Runtime: error message: P has cached GC work at end of mark termination. Oct 3, 2018. https://golang.org/issue/27993</td>
</tr>

<tr>
<td>[Knyszek, 2019a]</td><td>Michael Knyszek. Proposal: Smarter Scavenging. Feb 20, 2019. https://go.googlesource.com/proposal/+/master/design/30333-smarter-scavenging.md</td>
</tr>

<tr>
<td>[Knyszek, 2019b]</td><td>Michael Knyszek. runtime: smarter scavenging. Feb 20, 2019. https://golang.org/issue/30333</td>
</tr>

</table>


## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).
