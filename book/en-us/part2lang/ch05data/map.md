---
weight: 2203
title: "5.3 Hash Tables: Principles and Security"
---

# 5.3 Hash Tables: Principles and Security

`map` is Go's built-in hash table. The runtime implements it: the compiler translates operations
such as `m[k]` into calls to functions like `runtime.mapaccess1` and `runtime.mapassign`, and the
actual storage, lookup and growth all happen in the `internal/runtime/maps` package. Go's `map` has
had three implementations. Go 1.0 used a multi-level subtable design; from Go 1.1 it became a bucket
design with eight slots per bucket, linked by overflow buckets; from Go 1.24 it is an
open-addressing implementation based on the Swiss Table. This section covers the general principles
of hash tables and the security issues that arise when a hash table is an attack surface. Go's two
main implementations are discussed in [5.4](./swisstable.md).

## 5.3.1 Two Routes for Hash Tables: Chaining and Open Addressing

The basic problem a hash table solves is mapping a practically unbounded key space onto a finite
stretch of contiguous memory. A hash function $h$ maps a key to a slot index in $[0, m)$, and
ideally a single memory access locates the slot. The mapping cannot be injective, though: two
different keys that get the same index are said to **collide**. How to place colliding keys has
given rise to two long-established routes.

**Chaining** hangs a linked list on each slot and links colliding keys onto it. It is simple to
implement, deletion is straightforward, and it is not very sensitive to the quality of the hash
function. The cost is an extra pointer per element, and the list nodes are scattered over the heap,
so cache locality is poor. Let the **load factor** be $\alpha = n/m$, the ratio of the number of
elements to the number of slots. Under the assumption of simple uniform hashing, an unsuccessful
lookup compares about $\alpha$ elements on average and a successful one about $1 + \alpha/2$.
Chaining permits $\alpha > 1$, and performance degrades linearly in $\alpha$
[[Knuth, 1998](#ref-knuth-1998)].

**Open addressing** stores all elements directly in the slot array, and on a collision follows some
**probe sequence** to find the next empty slot. It has no pointer overhead, the data is contiguous,
and it is cache friendly. But it requires $\alpha < 1$, and performance deteriorates sharply as
$\alpha$ approaches 1. Under uniform hashing, the average number of probes for an unsuccessful
lookup is

$$
\frac{1}{1-\alpha}
$$

which is 10 at $\alpha = 0.9$ and 100 at $\alpha = 0.99$. The various refinements of open addressing
all aim to hold this curve down.

There are several choices of probe sequence. **Linear probing** checks $h, h+1, h+2, \dots$ in turn.
It is the simplest to implement and has the best cache hit rate, but adjacent occupied slots merge
into long runs, known as **primary clustering**, which raises the average cost of an unsuccessful
lookup to

$$
\frac{1}{2}\left(1 + \frac{1}{(1-\alpha)^2}\right)
$$

a faster growth than under uniform hashing [[Knuth, 1998](#ref-knuth-1998)]. **Quadratic probing**
uses a sequence with increasing steps, such as $h, h+1, h+3, h+6, \dots$ (successive differences 1,
2, 3, ...), to break up the clusters. **Double hashing** uses a second hash function to determine
the step; it comes close to the theoretical curve of uniform hashing, but each lookup needs one more
hash computation. **Robin Hood hashing** [[Celis et al., 1985](#ref-celis-et-al-1985)] compares, on
insertion, how far the new key and the current occupant each are from their ideal slot: if the new
key is farther away, it takes the occupant's place, and a position is then sought for the displaced
key. This reduces the variance of probe distances and makes the cost of a lookup more predictable.
These methods share a goal: to keep the contiguous-storage advantage of open addressing while
limiting the deterioration of performance with load factor. The Swiss Table is an important result
along this route ([5.4.1](./swisstable.md)).

## 5.3.2 Hash Flooding: A Security Problem of Hash Tables

The $O(1)$ of a hash table is an average-case figure. In the worst case, if all keys collide into
one slot, chaining degenerates into a single linked list and open addressing into a linear scan; a
single operation costs $O(n)$ and $n$ insertions cost $O(n^2)$ in total. In most algorithm analyses
this is a footnote, but in 2003 Crosby and Wallach pointed out that it forms a class of
denial-of-service vulnerabilities that can be triggered remotely
[[Crosby and Wallach, 2003](#ref-crosby-wallach-2003)]. If the hash function is fixed and public, an
attacker can construct, offline, a large number of keys that collide at the same position and send
them to a server as HTTP headers, JSON fields or POST parameters. When the server inserts these keys
into a hash table, each insertion costs $O(n)$, and a small number of requests can exhaust the CPU.
This kind of attack is called **hash flooding**. In December 2011, at the 28th Chaos Communication
Congress (28C3), Alexander Klink and Julian Wälde demonstrated the effect of this attack on
mainstream web platforms such as PHP, Java, Python and Ruby, which prompted these languages to
change their hash table implementations one after another
[[Klink and Wälde, 2011](#ref-klink-walde-2011)].

The key to the defense is to make hash results unpredictable to the attacker, by adding to the hash
function a **seed** that the runtime generates randomly and the attacker cannot learn. The same key
then hashes differently in different processes, and even in different hash tables of the same
process, so constructing collisions offline loses its target. SipHash, proposed by Aumasson and
Bernstein in 2012, is a keyed pseudorandom function designed for exactly this purpose and optimized
for short inputs [[Aumasson and Bernstein, 2012](#ref-aumasson-bernstein-2012)]. The standard
libraries of Python (since 3.4, PEP 456 [[Heimes, 2013](#ref-heimes-2013)]) and Rust both use a
variant of SipHash as the default string hash function.

Go follows the same idea but does not use SipHash. The `map` of Go 1.0 already generated a random
seed for each hash table; in Go 1.1, Keith Randall introduced `aeshash`, a hash function built on
AES instructions, and the commit message says it contains a random key to prevent hash-collision
denial-of-service attacks [[Randall, 2013](#ref-randall-2013)]. In Go 1.26, at startup the runtime
selects the hash algorithm in `alginit` according to the capabilities of the CPU (`runtime/alg.go`
[[Go Authors, 2026](#ref-go-authors-2026)]):

```go
func alginit() {
	// Use the AES hash algorithm if the required instructions are available.
	if (GOARCH == "386" || GOARCH == "amd64") &&
		cpu.X86.HasAES && // AESENC
		cpu.X86.HasSSSE3 && // PSHUFB
		cpu.X86.HasSSE41 { // PINSR{D,Q}
		initAlgAES()
		return
	}
	if GOARCH == "arm64" && cpu.ARM64.HasAES {
		initAlgAES()
		return
	}
	for i := range hashkey {
		hashkey[i] = uintptr(bootstrapRand())
	}
}
```

When AES instructions are available, `initAlgAES` initializes the AES round keys with random data so
that collisions are hard to construct deliberately. Otherwise a non-cryptographic hash function is
used (on 64-bit platforms, since Go 1.17 modeled on the design of wyhash), keyed with a random
`hashkey`.

In addition to the process-level key, each `map` generates its own seed on creation (the `seed`
field of the `Map` struct in `internal/runtime/maps`), so the hash values of different `map`s in the
same process are independent of one another. When all elements of a `map` have been deleted, the
runtime also gives it a new seed [[Bleecher Snyder, 2018](#ref-bleecher-snyder-2018)], which makes
it hard for an attacker to produce collisions in the same `map` repeatedly. The standard library
package `hash/maphash` exposes the same hash functions and lets one observe the effect of the seed
directly:

```go {run=true}
package main

import (
	"fmt"
	"hash/maphash"
)

func main() {
	s1, s2 := maphash.MakeSeed(), maphash.MakeSeed()
	fmt.Println(maphash.String(s1, "golang") == maphash.String(s1, "golang")) // same seed
	fmt.Println(maphash.String(s1, "golang") == maphash.String(s2, "golang")) // different seeds
}
```

```
true
false
```

## 5.3.3 Randomized Iteration Order

Another design tied to the hash seed is the randomization of `map` iteration order. The Go 1 release
notes say that the old language specification did not define the iteration order of a `map`, and
that the actual order differed across hardware platforms, so a test that depended on iteration order
could pass every time on one machine and fail on another. Go 1 therefore specified that even if the
same `for range` loop is executed several times over the same `map`, the order in which elements are
visited is unpredictable [[Go Authors, 2012](#ref-go-authors-2012)]. Code that depends on iteration
order then fails early and gets fixed before the problem spreads.

The hash seed already makes the order vary with the process and the `map`, and at the start of every
iteration the runtime also picks a random starting position (in Go 1.26 both `entryOffset` and
`dirOffset` of the iterator come from random numbers). So even repeated iteration over the same
`map` in one process gives different orders:

```go {run=true}
package main

import (
	"fmt"
	"strings"
)

func main() {
	m := map[int]bool{}
	for i := range 8 {
		m[i] = true
	}

	orders := map[string]bool{}
	for range 100 {
		var b strings.Builder
		for k := range m {
			fmt.Fprint(&b, k)
		}
		orders[b.String()] = true
	}
	fmt.Println(len(orders) > 1) // the same map, more than one iteration order
	fmt.Println(m)               // fmt prints in key order
}
```

```
true
map[0:true 1:true 2:true 3:true 4:true 5:true 6:true 7:true]
```

The second line of output is always ordered: since Go 1.12, `fmt` sorts a `map` by key when printing
it, so that the output is reproducible [[Go Authors, 2019](#ref-go-authors-2019)]. A program that
needs to process a `map` in a deterministic order should likewise extract the keys and sort them
first, for example with `slices.Sorted(maps.Keys(m))`.

Defense against hash flooding and the nondeterminism of iteration order are thereby linked: both
require hash values to be unpredictable, and Go goes further by fixing this unpredictability as a
language rule, so a program cannot depend on any particular order.

## Further Reading

- <a id="ref-knuth-1998"></a>[Knuth, 1998] Donald E. Knuth. *The Art of Computer Programming, Vol.
  3: Sorting and Searching*, 2nd ed. Addison-Wesley, 1998. §6.4 "Hashing".
  https://www-cs-faculty.stanford.edu/~knuth/taocp.html The classic analysis of open addressing,
  chaining, and how load factor relates to lookup cost.
- <a id="ref-celis-et-al-1985"></a>[Celis et al., 1985] Pedro Celis, Per-Åke Larson, J. Ian
  Munro. "Robin Hood Hashing." *26th Annual Symposium on Foundations of Computer Science (FOCS)*,
  281–288, 1985. https://doi.org/10.1109/SFCS.1985.48 The original paper on Robin Hood hashing.
- <a id="ref-crosby-wallach-2003"></a>[Crosby and Wallach, 2003] Scott A. Crosby, Dan S.
  Wallach. "Denial of Service via Algorithmic Complexity Attacks." *12th USENIX Security
  Symposium*, 2003.
  https://www.usenix.org/conference/12th-usenix-security-symposium/denial-service-algorithmic-complexity-attacks
  The first systematic account of the worst case of hash tables being used as an attack.
- <a id="ref-klink-walde-2011"></a>[Klink and Wälde, 2011] Alexander Klink, Julian Wälde. "Effective
  Denial of Service attacks against web application platforms." 28th Chaos Communication
  Congress, 2011. https://fahrplan.events.ccc.de/congress/2011/Fahrplan/events/4680.en.html The hash
  flooding demonstration that prompted mainstream languages to change their hash table
  implementations.
- <a id="ref-aumasson-bernstein-2012"></a>[Aumasson and Bernstein, 2012] Jean-Philippe Aumasson,
  Daniel J. Bernstein. "SipHash: a fast short-input PRF." *INDOCRYPT*, 2012.
  https://www.aumasson.jp/siphash/siphash.pdf A keyed hash function designed to withstand hash
  flooding.
- <a id="ref-go-authors-2012"></a>[Go Authors, 2012] The Go Authors. Go 1 Release Notes, "Iterating
  in maps." https://go.dev/doc/go1 The reason for randomizing iteration order.
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. `runtime/alg.go` and
  `internal/runtime/maps/map.go`.
  https://github.com/golang/go/blob/release-branch.go1.26/src/runtime/alg.go
  The choice of hash algorithm, the per-`map` seed, and the randomized iteration starting point.
- <a id="ref-randall-2013"></a>[Randall, 2013] Keith Randall. "runtime: faster & safer hash
  function." Go commit a5d4024139, 2013. https://go.googlesource.com/go/+/a5d4024139 Go 1.1
  introduced a hash function built on AES instructions, with a random key.
- <a id="ref-bleecher-snyder-2018"></a>[Bleecher Snyder, 2018] Josh Bleecher Snyder. "runtime:
  opportunistically rotate map key seed." Go issue 25237, 2018. https://go.dev/issue/25237
  The discussion of changing the seed when a `map` is emptied.
- <a id="ref-heimes-2013"></a>[Heimes, 2013] Christian Heimes. "PEP 456 – Secure and interchangeable
  hash algorithm." 2013. https://peps.python.org/pep-0456/ Python 3.4 switched to SipHash as the
  default hash function for strings and bytes.
- <a id="ref-go-authors-2019"></a>[Go Authors, 2019] The Go Authors. *Go 1.12 Release Notes*, "fmt".
  https://go.dev/doc/go1.12#fmtpkgfmt
  `fmt` now prints a `map` sorted by key.
