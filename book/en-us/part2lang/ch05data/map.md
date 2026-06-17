---
weight: 2203
title: "5.3 Hash Tables: Principles and Security"
---

# 5.3 Hash Tables: Principles and Security

> Go's `map` underwent a rare, complete rewrite in 2024 alongside Go 1.24,
> moving from the classic bucketed hash table it had used for fourteen years to an implementation based on Swiss Tables. This section first clarifies the general principles of hash tables
> and the attack-and-defense around them, leaving the full story of the rewrite to [5.4](./swisstable.md).

`map` is one of only two generic containers Go provides (the other being slice). It is implemented by the runtime with the compiler assisting in layout,
and at its core it is a hash table. When the reader writes `m[k]`, the compiler translates it into calls to the `runtime.mapaccess`
and `runtime.mapassign` family of functions; the real storage, lookup, and growth all happen inside the
`internal/runtime/maps` package. This section first lays out the general principles of hash tables and the attack-and-defense around them, to ground the next section where we drop down to Go's own
two generations of implementation (the classic bucketed design from 1.0 through 1.23, and the Swiss Table design from 1.24 onward). Only by understanding the trade-offs here
can we see why the latter was worth a rewrite that cut to the bone.

## 5.3.1 Two Routes for Hash Tables: Chaining and Open Addressing

The core tension a hash table must resolve is squeezing a nearly infinite key space into a finite, contiguous stretch of memory. A hash function
$h$ maps a key to a slot index in $[0, m)$, and in the ideal case a single memory access locates it. But the mapping cannot be injective:
when two keys compute the same index, that is a "collision," and how to place a colliding key splits into two long-standing routes.

**Chaining** hangs a linked list off each slot, with colliding keys threaded one after another along the chain. It is simple to implement, cleans up neatly on deletion,
and is insensitive to hash quality; the cost is one extra pointer per element and poor cache locality (the list nodes are scattered across the heap). Let the load factor
$\alpha = n/m$ (number of elements over number of slots); under the uniform-hashing assumption, an unsuccessful lookup compares on average $\approx \alpha$
elements, and a successful lookup $\approx 1 + \alpha/2$. Chaining permits $\alpha > 1$, with performance degrading linearly in $\alpha$.

**Open addressing** does the opposite: all elements live in the slot array itself, and on collision it follows some "probe sequence" to find the next empty slot. It has no pointer overhead, the data is laid out
contiguously, and it is cache-friendly, but it requires $\alpha < 1$,
and performance worsens sharply as $\alpha \to 1$. Under the uniform-probing assumption, an unsuccessful lookup probes on average

$$
\frac{1}{1-\alpha}
$$

times. This curve already reaches $10$ at $\alpha = 0.9$, and $100$ at $\alpha = 0.99$. The entire engineering effort of open addressing
is spent fighting this divergent curve.

The choice of probe sequence branches further. **Linear probing** walks $h, h+1, h+2, \dots$; it is the simplest to implement and has the best
cache behavior, but adjacent occupied slots merge into long runs (primary clustering), and the cost of an unsuccessful lookup rises to

$$
\frac{1}{2}\left(1 + \frac{1}{(1-\alpha)^2}\right)
$$

degrading faster than uniform probing. **Quadratic probing** walks sequences like $h, h+1, h+3, h+6, \dots$ with growing step sizes,
breaking up the clusters; **double hashing** uses a second hash function to set the step, approaching the theoretical curve of uniform probing,
at the cost of one extra hash per probe. There is also **Robin Hood hashing** (Celis 1985): on insertion, if you find that your distance from
your ideal slot already exceeds that of the current occupant, you "rob from the rich to give to the poor," evicting them and moving in yourself, thereby lowering the
variance of probe distances and making lookup cost more predictable. The shared goal of these techniques is to flatten that divergent curve
without giving up the contiguous-memory advantage of open addressing. The Swiss Table is the culmination of this route ([5.4.1](./swisstable.md#541-swiss-table-设计abseil)).

## 5.3.2 Hash Flooding: The Security Face of Hash Tables

The $O(1)$ of hash tables is in the average sense. In the worst case, if all keys collide into the same slot, chaining degenerates into a single chain and
open addressing degenerates into a linear scan, a single operation becomes $O(n)$, and $n$ insertions total $O(n^2)$. In most algorithmic analyses this
is just a footnote, but Crosby and Wallach pointed out in 2003 that it is a class of remotely triggerable denial-of-service vulnerability: when the hash
function is fixed and public, an attacker can construct offline a large batch of keys that collide into the same bucket, and then feed them as HTTP headers, JSON fields, or
POST parameters to a server. The server stuffs these keys into a `map`, and an insertion that should be $O(1)$ degenerates into $O(n)$, so a small number of requests can
exhaust the CPU. This class of attack is called "hash flooding."

The key to defense is to make the hash result unpredictable to the attacker, and the way to do that is to inject a process-private,
randomly generated **seed** into the hash function at runtime. The same key hashes differently across different processes, and even across different `map`s in the same program, so constructing
collisions offline loses its target. SipHash, proposed by Aumasson and Bernstein in 2012, is a keyed
short-input pseudorandom function designed for exactly this purpose, and is widely adopted by Python, Rust, Ruby, and others as the default string hash.

Go takes the same approach but a different choice. At runtime startup, `alginit` selects a hash algorithm by CPU instruction set: on platforms supporting
the AES instructions (`AES`/`SSSE3`/`SSE4.1` on amd64, `AES` on arm64) it enables `aeshash`, based on the AES round function,
and fills the key from random data read from the operating system; otherwise it falls back to a non-cryptographic hash with a random seed.

```go
// runtime/alg.go: at startup, select a hash algorithm by CPU capability (sketch)
func alginit() {
	if (GOARCH == "amd64" || GOARCH == "386") &&
		cpu.X86.HasAES && cpu.X86.HasSSSE3 && cpu.X86.HasSSE41 {
		initAlgAES()   // install aeshash, with the key taken from random data
		return
	}
	if GOARCH == "arm64" && cpu.ARM64.HasAES {
		initAlgAES()
		return
	}
	// no AES: initialize hashkey with random data from the auxiliary vector / /dev/urandom
	getRandomData(hashkey[:])
	hashkey[0] |= 1 // force it odd, for better hash quality
}
```

The randomness does not stop at the process level. In the new `map`, each instance computes a `seed uintptr` when it is created
([5.4.2](./swisstable.md#542-go-124-的-swiss-table-重写)), so the hashing of different `map`s within the same process is also mutually independent. This layer of
randomization is also exactly why the Go specification does not guarantee `range` iteration order: the order already drifts with the seed, and the runtime simply layers on a
random starting point as well, forcing users not to depend on any iteration order. The defense against hash flooding and the nondeterminism of iteration order are, here, two sides of the same
coin.

## Further Reading

- [Knuth, D. E. *The Art of Computer Programming, Vol. 3: Sorting and Searching*, §6.4 Hashing. 2nd ed., Addison-Wesley, 1998.](https://www-cs-faculty.stanford.edu/~knuth/taocp.html) The classic source for open addressing, chaining, and load-factor cost analysis.
- [Celis, P., Larson, P.-Å., Munro, J. I. "Robin Hood Hashing." *FOCS*, 1985.](https://doi.org/10.1109/SFCS.1985.48) Robin Hood hashing, lowering the variance of probe distances.
- [Crosby, S. A., Wallach, D. S. "Denial of Service via Algorithmic Complexity Attacks." *USENIX Security*, 2003.](https://www.usenix.org/conference/12th-usenix-security-symposium/denial-service-algorithmic-complexity-attacks) The first systematic treatment of hash-flooding attacks.
- [Aumasson, J.-P., Bernstein, D. J. "SipHash: a fast short-input PRF." *INDOCRYPT*, 2012.](https://www.aumasson.jp/siphash/siphash.pdf) A keyed short-input hash resistant to hash flooding.
