---
weight: 5204
title: "16.4 Testing Code"
---

# 16.4 Testing Code

Testing in Go is not a bolt-on, it is a first-class citizen of the language toolchain. `go test` is built in, the `testing` package is standard, and convention replaces configuration. This set of design choices has deeply shaped Go's engineering culture: in other languages, "whether to write tests at all, and which framework to use" is a decision that requires weighing trade-offs; in Go it is the default action. This section explains how this machinery runs, why it was designed this way, and how it grew from unit testing all the way to Go 1.18 fuzzing.

## 16.4.1 A First-Class Citizen: Convention over Configuration

Go's testing runs on convention, with almost zero configuration. Three rules are all there is: test files end in `_test.go`, test functions take the form `func TestXxx(t *testing.T)`, and they live in the same package as the code under test. `go test` discovers and runs them automatically, with no XML configuration, no external runner, and no annotations. No matter how large a project is, a single line `go test ./...` runs every test:

```go
// strings_test.go, same directory and same package as the strings package under test
package strings

import "testing"

func TestIndex(t *testing.T) {
    got := Index("chicken", "ken")
    if got != 4 {
        t.Errorf("Index = %d, want 4", got) // report the failure, but do not abort
    }
}
```

"Convention over configuration" brings two layers of benefit. The first is a zero barrier to entry: writing a test does not require learning a framework first, get the function signature right and it runs. The second, and the more far-reaching layer, is the unification of the whole ecosystem. Every Go project tests in exactly the same way, so CI, coverage tools, IDEs, and `go vet` all face just one convention, without having to write a separate adapter for each different framework. This stands in sharp contrast to others: the Java world has JUnit 4 versus JUnit 5 versus TestNG, with different annotations and runners; Python has `unittest`, `pytest`, and `nose` coexisting, with incompatible discovery rules and fixture mechanisms. The diversity of frameworks turns "run this project's tests" into something that requires reading the docs first. Go flattens that to zero with one built-in convention.

A distinction worth drawing: `go test` is a subcommand of the `go` command, responsible for compiling and running the test binary and parsing flags such as `-run`, `-bench`, and `-fuzz`; the `testing` package is the standard library that test code imports, providing the `*T`, `*B`, and `*F` types. The tool and the library have a clear division of labor, but from the user's vantage point they are one.

## 16.4.2 The Deliberately Minimal testing Package

The `testing` package has no assertion library. It gives you only a few plain reporting primitives: `t.Error` / `t.Errorf` record one failure but keep running, while `t.Fatal` / `t.Fatalf` record a failure and immediately abort the current test (implemented internally via `runtime.Goexit`, so they can only be called from the test goroutine). There is no `assertEqual`, no `assertThat(x).isGreaterThan(y)`, none of that whole suite of chained assertions.

This is deliberate, and the reasoning is written down in the official Go Test Comments. The Go team holds that an assertion library tempts people to think "which assertion do I write on this line" rather than "what do I want to see when it fails, so I can locate the problem directly." Using plain `if` paired with `t.Errorf` forces the author to write an informative failure message by hand:

```go
if got != want {
    t.Errorf("Sqrt(%v) = %v, want %v", in, got, want)
}
```

The `got` / `want` naming pair has nearly become a dialect of Go testing, and failure output reads at a glance as "what was the input, what came out, what was expected." The cost is that there is indeed more boilerplate than a one-line assertion. The community has argued over this for a long time, and third-party assertion libraries like `testify` do have a large user base. But the stance taken by the standard library reflects Go's consistent preference: explicit beats magic, less is more, and leave the control and the responsibility for expressing failure with the author, rather than handing it to a framework that assembles messages on its own.

## 16.4.3 Table-Driven Tests and Subtests

The most representative paradigm in the Go community is the table-driven test: write several groups of "input and expectation" as a table (a slice of structs), and verify each group with a single loop. Adding a case is just adding one row to the table, which makes covering many boundary situations both compact and clear. Combined with subtests `t.Run`, introduced in Go 1.7, each group can become an independently named subtest that can be run on its own (`go test -run TestSplit/empty`) and run in parallel:

```go
func TestSplit(t *testing.T) {
    tests := []struct {
        name  string
        input string
        sep   string
        want  []string
    }{
        {"simple", "a,b,c", ",", []string{"a", "b", "c"}},
        {"empty", "", ",", []string{""}},
        {"no-sep", "abc", ",", []string{"abc"}},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            tt := tt            // required before Go 1.22; can be deleted afterward
            t.Parallel()        // run the subtests in parallel
            got := Split(tt.input, tt.sep)
            if !reflect.DeepEqual(got, tt.want) {
                t.Errorf("Split(%q, %q) = %v, want %v",
                    tt.input, tt.sep, got, tt.want)
            }
        })
    }
}
```

Hidden here is a once-classic trap. Before Go 1.22, the iteration variable `tt` of a `for` loop had only one instance across the whole loop, and the closure captured this repeatedly overwritten variable; when the subtests were deferred past the end of the loop by `t.Parallel` before actually running, the `tt` they saw was all the value of the last iteration. The fix of the day was to write one line `tt := tt` in the loop body to copy the current value into a new variable. Go 1.22 changed the language specification so that each iteration of a `for` loop has its own independent iteration variable (the spec: "each iteration has its own new variables"), and this trap was eliminated at the language level, so that line `tt := tt` can be deleted from then on. This is a rare example of changing language semantics to fix a long-standing footgun.

Table-driven testing is so common that it has nearly become synonymous with Go testing. It again bears out Go's orientation: solve problems like "parameterized testing" with plain data plus a loop, rather than a dedicated framework mechanism.

## 16.4.4 Fuzzing

Go 1.18 (March 2022) brought fuzzing into the standard toolchain. The idea of fuzzing is: rather than have a person enumerate cases, let a tool keep generating large amounts of random or mutated input to bombard a function, specifically hunting for the one that triggers a panic or violates an invariant. In Go, it reuses the same set of conventions, with functions of the form `func FuzzXxx(f *testing.F)`:

```go
func FuzzReverse(f *testing.F) {
    f.Add("hello")          // seed corpus: give the mutation engine a starting point
    f.Add("世界")
    f.Fuzz(func(t *testing.T, s string) {
        rev := Reverse(s)
        doubleRev := Reverse(rev)
        if s != doubleRev {                 // invariant: reversing twice should restore the original
            t.Errorf("Reverse(Reverse(%q)) = %q", s, doubleRev)
        }
        if utf8.ValidString(s) && !utf8.ValidString(rev) {
            t.Errorf("Reverse(%q) produced invalid UTF-8: %q", s, rev)
        }
    })
}
```

By default, `go test` only runs the seeds sown by `f.Add` and the corpus already in the `testdata/fuzz/FuzzReverse/` directory as ordinary cases once; adding `go test -fuzz=FuzzReverse` is what enters true fuzzing mode, where the engine keeps mutating input based on coverage feedback. Once it finds an input that makes the assertion fail, it writes this minimized counterexample into `testdata/fuzz/FuzzReverse/`, and this corpus is committed along with the code, so the bug is "frozen" into a permanent regression case. The example above is the classic one from the official tutorial: against a naive "reverse byte by byte" implementation, the fuzzing engine quickly finds a multi-byte UTF-8 character and proves that it breaks the encoding, a malformed-input boundary that is nearly impossible to think through fully with hand-written cases.

Placed in its lineage, this capability is the confluence of two clear sources. One is coverage-guided fuzzing, from AFL to LLVM's libFuzzer, and on to Dmitry Vyukov's `go-fuzz` (the direct predecessor of Go's native fuzzing, which proved this path was viable on Go). The other is property-based random testing, originating from Claessen and Hughes's QuickCheck (ICFP 2000), whose idea is "do not write concrete cases, write the properties that should always hold, and let the tool sample randomly to falsify them." The long-frozen `testing/quick` package in the standard library is an early remnant of this line (its documentation states of itself that it is "frozen and is not accepting new features"). Go 1.18's fuzzing can be seen as the merger of the two lines: use the QuickCheck style of "writing invariants" for assertions, and the libFuzzer style of "coverage-guided mutation" for input generation.

## 16.4.5 Benchmarks

Benchmarks too are gathered under this set of conventions, with functions of the form `func BenchmarkXxx(b *testing.B)`. Go 1.24 introduced `b.Loop()`, replacing the traditional `for i := 0; i < b.N; i++` form: it manages the timer automatically (resetting on the first call and stopping on exit, so that setup and cleanup outside the loop are not counted in the measurement), and it prevents the compiler from optimizing the loop body away, and each benchmark function runs only once within a single measurement:

```go
func BenchmarkIndex(b *testing.B) {
    for b.Loop() {
        Index("chicken caesar salad", "salad")
    }
}
```

At this point, unit tests, table-driven tests, subtests, fuzzing, and benchmarks are all gathered under the same `testing` package and the same `go test` command. The internal mechanics of benchmarking (how `b.N` converges, the compiler transformation of `b.Loop`, and `-benchmem` and memory measurement) are detailed in [16.5](./perf.md).

## 16.4.6 Cultural Impact and Trade-offs

Making testing a first-class citizen of the toolchain has an impact at the cultural level. When `go test` is built in, when the convention is unified, and when the barrier is zero, "writing tests" goes from extra work that needs a formal go-ahead to a default habit of Go projects. The standard library itself and nearly every mainstream open-source Go library carry a systematic set of `_test.go` files, and newcomers can contribute tests by following the same convention. A language's attitude toward testing settles, through tens of millions of tiny "write it or not" decisions, into the quality culture of the software written in it. This is the place where Go's "engineering-friendly" philosophy ([1.1](../../part1overview/ch01intro/history.md)) lands most thoroughly.

This design of course gives up some things. The minimal `testing` package leaves the conveniences of assertions, mocking, and parameterization to third parties (`testify`, `gomock`) or to boilerplate, in exchange for the stability of the standard library and the unification of the ecosystem. Convention over configuration sacrifices flexibility (you cannot redefine the discovery rules of tests) in exchange for zero adaptation cost. This is the same trade-off Go makes again and again: use a plain convention that everyone understands and every tool recognizes, in exchange for low friction across the whole ecosystem in collaboration. Performance and convenience never come for free, and here Go chooses to press the cost onto "the few who need fancy assertions writing a few more lines," so that "everyone can run tests at zero cost."

## Further Reading

1. The Go Authors. *Package testing.* https://pkg.go.dev/testing
   (the complete API and documentation for `T` / `B` / `F`)
2. The Go Authors. *Go Fuzzing.* https://go.dev/doc/security/fuzz/ ; Go 1.18 Release Notes.
   https://go.dev/doc/go1.18#fuzzing (the design of native fuzzing and the corpus directory convention)
3. The Go Authors. *Go Test Comments (wiki).* https://go.dev/wiki/TestComments
   (the `if got != want` style and the official rationale for "not providing an assertion library")
4. Dave Cheney. *Prefer table driven tests.* 2019.
   https://dave.cheney.net/2019/05/07/prefer-table-driven-tests
5. Koen Claessen, John Hughes. *QuickCheck: A Lightweight Tool for Random Testing of Haskell
   Programs.* ICFP 2000. https://doi.org/10.1145/351240.351266 (the origin of property-based random testing)
6. The Go Authors. *Add a test / Fuzzing (tutorial).* https://go.dev/doc/tutorial/add-a-test ;
   https://go.dev/doc/tutorial/fuzz
7. This book, [16.5 Performance Testing](./perf.md) (the mechanics of `b.Loop`, `b.N` convergence, and memory measurement).
