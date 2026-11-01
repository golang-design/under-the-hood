---
weight: 5304
title: "17.4 The vgo versus dep Dispute"
---

# 17.4 The vgo versus dep Dispute

The previous three sections covered the technical core of Go modules: the hard parts of dependency
management ([17.1](./challenges.md)), semantic import versioning ([17.2](./semantics.md)) and
minimal version selection ([17.3](./minimum.md)). This section tells where the design came from.
From 2016, a committee of community members led the development of the dependency management tool
`dep`; in 2018 Cox proposed vgo, whose philosophy differed, and it was accepted as an official
proposal the same year and evolved into today's Go modules. This history left two contradictory
accounts: a set of tweets Cox published in July 2018, and Bourgon's point-by-point response that
followed [[Bourgon, 2018](#ref-bourgon-2018)]. This section quotes the documents left at the time
wherever possible, and attributes to the person concerned anything that rests only on
participants' recollection. The last subsection covers `go.sum` and the checksum database, which
17.1 and 17.3 deferred to here.

## 17.4.1 The Package Management Committee and dep

[17.1](./challenges.md) explained that `go get` has no notion of versions, so the community produced
many vendoring tools such as `godep` and `glide`. After Go 1.5 introduced the vendor directory
experiment and Go 1.6 enabled it by default, the discussion of a unified tool became more urgent.
Boyer recounts that at GopherCon in July 2016, over a hundred developers gathered to discuss
vendoring and the ecosystem, with Go team members including Rob Pike attending; until then the Go
team had largely treated dependency management as a problem left to the community, and after this
meeting solving it seriously became an explicit task [[Boyer, 2016](#ref-boyer-2016)]. A committee
and an advisory group were formed at the meeting, convened by Peter Bourgon; the committee members
were Andrew Gerrand, Edward Muller, Jessie Frazelle and Sam Boyer, and the goal was a new tool that
would unify and replace the existing ones. The committee drafted a specification, and Boyer then led
its implementation as `dep` [[Cox, 2018b](#ref-cox-2018b)].

The committee worked from September 2016: it collected user stories, surveyed the design space,
wrote the specification, and then implemented the tool on top of the solver library `gps` designed
by Boyer [[Boyer, 2016](#ref-boyer-2016)]. Bourgon later summarized the practices the committee
adopted to make its conclusions credible: members were drawn from existing leaders and experts in
the community, an advisory group covering the relevant projects was added, half a year was spent
gathering user feedback and studying other package management tools, consensus was sought on all
major decisions, and the whole process was recorded publicly [[Bourgon, 2018](#ref-bourgon-2018)].
`dep` was made public in January 2017 [[Boyer, 2016](#ref-boyer-2016)].

`dep` followed the route pioneered by Bundler and Cargo [[Cox, 2019](#ref-cox-2019)]: a manifest
declares acceptable version ranges, a solver picks a set of versions within the ranges, and a lock
file records the result of the selection. Below are excerpts from two files in the `dep` repository
itself [[Boyer et al., 2020](#ref-boyer-et-al-2020)]:

```toml
# Gopkg.toml (excerpt)
[[constraint]]
  name = "github.com/Masterminds/vcs"
  version = "1.11.0"

[[constraint]]
  name = "github.com/boltdb/bolt"
  version = "1.0.0"
```

```toml
# Gopkg.lock (excerpt)
[[projects]]
  digest = "1:442020d26d1f891d5014cae4353b6ff589562c2b303504627de3660adf3fb217"
  name = "github.com/Masterminds/vcs"
  packages = ["."]
  pruneopts = "NUT"
  revision = "3084677c2c188840777bff30054f2b553729d329"
  version = "v1.11.1"

[[projects]]
  digest = "1:a12d94258c5298ead75e142e8001224bf029f302fed9e96cd39c0eaf90f3954d"
  name = "github.com/boltdb/bolt"
  packages = ["."]
  pruneopts = "NUT"
  revision = "2f1ce7a837dcb8da3ec595b1dac9d0632f0f99e8"
  version = "v1.3.1"

# ...
  solver-name = "gps-cdcl"
  solver-version = 1
```

`dep` automatically prefixes a version number without an operator with `^`, so `version = "1.0.0"`
means $\ge 1.0.0$ and $< 2.0.0$; the lock file records v1.3.1 and its commit hash, which the solver
selected within this range. The manifest states expectations about the future, and the lock file
states the result at one moment; the gap between them is exactly the "selection that changes over
time" described in 17.1.

From the beginning there were two accounts of the committee's positioning of `dep`. Boyer wrote in
December 2016 that the committee's goal was for the tool to become part of the standard Go
toolchain, but that after the basic requirements were met, it still needed at least six months of
testing [[Boyer, 2016](#ref-boyer-2016)]. Cox said in February 2018 that `dep` was an "official
experiment", usable immediately and an important step toward the final solution, but not the direct
prototype of the `go` command's eventual integrated version management
[[Cox, 2018b](#ref-cox-2018b)].

## 17.4.2 The 2017 Disagreements

In June 2017 Cox shared with the committee a draft on how to integrate package management into the
`go` command, met the committee a few days later to discuss it, and turned the meeting minutes into
an email [[Cox, 2017a](#ref-cox-2017a)]. The minutes record most of the technical disagreements that
drove the later debate:

- Boyer pointed out that the draft wrote manifests per package rather than per project and might be
  incompatible with `dep`.
- Boyer worried that the draft relied too heavily on semantic versioning; for example, CockroachDB
  pins a particular commit of `x/text` to guarantee that collation tables do not change between
  versions.
- Boyer held that exclusion lists taking effect only in the top-level manifest was not enough, since
  every user would otherwise have to copy the exclusion lists of dependencies. Cox agreed at the
  time, believing that exclusions in dependencies should also take effect, as long as no
  satisfiability search was introduced; the final MVS took the opposite approach, with exclusions
  taking effect only in the main module ([17.3](./minimum.md)).
- Bourgon did not believe a program needed to use multiple versions of one package at once. Cox gave
  an example: if Amazon's official API used json v1 and Google Cloud's official API used json v2,
  with json only an internal implementation detail of each, forbidding coexistence of multiple
  versions would mean a program could not use both APIs:

```text
To me that's a show-stopper that must be avoided.
```

Cox considered this a fatal flaw that had to be avoided. At the contributor summit during GopherCon
that July, Cox met the package management group again, and the two sides' accounts of this meeting
differ greatly. Bourgon recalls that Cox said that to understand an area, Cox had to solve its
problems directly and build something, which gave the committee the impression that Cox would not
for the time being commit to the committee's research or to `dep`; Matt Farina recalls Cox saying
that Cox could do better working alone. Cox said in his tweets that he certainly had not said this,
and more likely said that the design of `dep` would need to change to be integrated into the `go`
command [[Bourgon, 2018](#ref-bourgon-2018)].

In November 2017 Cox sent the committee the draft of what later became semantic import versioning
[[Cox, 2017b](#ref-cox-2017b)] and suggested that `dep` support the rule. The two sides again differ
on the ensuing discussion: Cox says Boyer and Bourgon thought it too late to change `dep` and that
`dep` should become `go dep` directly; Bourgon says the committee never asked for `dep` to become
`go dep` as it was, only that Cox had not convinced the committee that semantic import versioning
was necessary, so the committee did not agree to change `dep` to enforce it
[[Bourgon, 2018](#ref-bourgon-2018)].

## 17.4.3 vgo and the Proposal

By Cox's account, since `dep` would not support import versioning, Cox wrote an implementation in
the `go` command to test the ideas, and found that semantic import versioning and minimal version
selection fit each other. The design had taken shape by early January 2018, but Boyer was to present
`dep` at FOSDEM on February 3 and Cox did not want to complicate matters, so Cox postponed
publication until mid-February [[Bourgon, 2018](#ref-bourgon-2018)]. Starting February 20, 2018, Cox
published seven consecutive "Go & Versioning" articles and released the prototype `vgo` at the same
time [[Cox, 2018a](#ref-cox-2018a)]. The first article promised that `dep` would continue to be
supported until the `go` command's integrated solution was settled and generally available, and
closed by thanking the committee and Boyer for their work [[Cox, 2018b](#ref-cox-2018b)].

The formal proposal was submitted on March 20, 2018, discussed in issue #24301, and accepted by the
proposal review committee on May 21 [[Cox, 2018a](#ref-cox-2018a)]. Cox says that Cox took no part
in the decision and left it to the other regular proposal reviewers; Bourgon points out that `dep`
never submitted a proposal because the committee had been waiting to establish a more formal channel
of communication with the core team [[Bourgon, 2018](#ref-bourgon-2018)]. After the proposal was
accepted, Cox explained that acceptance meant only that the design was suitable and that work on a
proper implementation could begin; `vgo` itself remained a prototype [[Cox, 2018c](#ref-cox-2018c)].

The `dep` side's technical views are most fully set out in Boyer's long article of May 2018
[[Boyer, 2018](#ref-boyer-2018)]. Boyer first listed the parts of vgo that Boyer agreed with:
modules declaring their own path in `go.mod`, no longer needing `GOPATH`, module proxies, nested
modules in one repository, pseudo-versions, implied compatibility, and the basic premises of
semantic import versioning. Boyer wrote that apart from the core algorithm the two of them agreed on
almost every issue. Boyer also accepted that high-fidelity builds are the strategy most likely to
produce working builds, and noted that the `dep` solver had long had a similar "preferred
version" mechanism, merely not yet enabled. The disagreement centered on MVS, and Boyer's conclusion
was:

```text
MVS, which is an algorithm for solving a math problem, not a community problem.
```

That is, MVS solves a math problem, not a community problem. In Boyer's analysis, MVS cuts away part
of the domain's essential complexity to avoid NP-completeness, and that complexity does not
disappear but moves elsewhere. The specific concerns include: when dependencies of newer versions
turn out to be incompatible, users are left with extreme choices such as refactoring, lobbying
upstream, forking or ignoring the problem; compatibility is itself hard to define, and without
shared rules it turns into a question of "who has the power"; forcing semantic import versioning
leads to runtime failures from global state when several copies of one package exist; assuming
compatibility even in v0 discourages experimentation; and `require` merges "the minimum usable
version" and "the version currently in use" into one number, so the true lower bound is lost. The
core disagreement between Boyer and Cox is whether a module can declare incompatibility with some
version of a dependency and have that declaration take effect globally. 17.3 has already discussed
this from Cox's side: such declarations are negative implications that would break the uniqueness
and minimality of MVS, and Cox advocates replacing them with cooperation ([17.3](./minimum.md)).

The main differences between the two designs are as follows:

| Aspect | `dep` | Go modules |
|:-----|:------|:--------|
| Dependency declaration | Version constraints in a manifest, any range allowed | Minimum requirements in `go.mod`; `exclude` takes effect only in the main module |
| Version selection | A solver chooses within ranges, usually favoring newer versions | Minimal version selection |
| Reproducible builds | Lock file `Gopkg.lock` | `go.mod` itself; `go.sum` only verifies |
| Multiple major versions of one module | Not allowed | Allowed, with the major version in the import path |
| Relation to the `go` command | External tool, relying on the vendor directory | Built into the `go` command |

The "multiple major versions" row is exactly the disagreement that already appeared in June 2017.
Cox considered the inability to use multiple major versions in one build a fatal flaw, and pointed
out that `dep` had to forbid it because Go's build system requires an import path to correspond to
one package and `dep` did not take semantic import versioning into account
[[Cox, 2019](#ref-cox-2019)]. Bourgon thought calling it a fatal flaw an exaggeration: at most it is
a matter of opinion, many other package management systems have the same restriction, and they do
not fail to function because of it [[Bourgon, 2018](#ref-bourgon-2018)].

## 17.4.4 Two Accounts

On July 26, 2018, Cox reviewed the history of `dep`, vgo and Go modules in a set of tweets, and
Bourgon published an article responding point by point the next day; since the tweets are hard to
consult in their original form, the quotations of Cox's tweets below are taken from Bourgon's
transcription [[Bourgon, 2018](#ref-bourgon-2018)]. Cox wrote that as early as December 2016 Cox had
told Boyer clearly that `dep` was only a step in the process and was expected to be replaced, yet
the whole community generally assumed `dep` was the official final answer. Cox's summary of that
responsibility was:

```text
In retrospect I made lots of mistakes, but the biggest one was not
communicating concerns with Dep and plans for go command integration more
widely and publicly.
```

Bourgon's response stresses that the committee had worked for nearly two years under the rigorous
process described above while Cox attended only two or three meetings, and that Cox's technical
arguments were not ignored but debated at length without convincing the committee; at that point
Cox, rather than refining the argument or seeking a compromise, implemented and proposed a solution
alone. Bourgon's initial conclusion was that no independent due diligence could make up for the
design not originating from the core team; Bourgon later amended this, holding that the heart of the
problem is how the Go project resolves design disagreements. A postscript at the end of the article
gives an explanation acceptable to both sides:

```text
I think the dep team and the core team were having two completely
different conversations, talking past each other, and it took the vgo papers to
collapse the quantum state.
```

By this explanation, the `dep` team believed `dep` was essentially different from earlier tools, the
researched, carefully considered, community-driven final form of Go dependency management; the core
team believed `dep` was essentially the same as earlier tools, just one more data point informing
the final solution. Bourgon holds that each side's position is well documented, but only when it was
too late did the two sides realize that their understandings differed.

## 17.4.5 From Experiment to Default

Go modules then took several years to go from an experimental feature to default behavior. The
following table lists the main milestones relevant to this chapter
[[Go Authors, n.d.](#ref-go-authors-nd)]:

| Version (release date) | Change |
|:-----|:-----|
| Go 1.11 (2018-08) | Preliminary support for modules, marked experimental; `go.mod` and `go.sum` introduced [[Go Authors, 2018](#ref-go-authors-2018)] |
| Go 1.13 (2019-09) | `GOPROXY` defaults to `https://proxy.golang.org,direct`; `GOSUMDB` and `GOPRIVATE` added; `GO111MODULE=auto` enables module mode whenever a `go.mod` exists, even inside `GOPATH/src` [[Go Authors, 2019](#ref-go-authors-2019)] |
| Go 1.14 (2020-02) | Module support considered ready for production use [[Go Authors, 2020](#ref-go-authors-2020)] |
| `dep` (2020) | Deprecation announced and repository archived [[Boyer et al., 2020](#ref-boyer-et-al-2020)] |
| Go 1.16 (2021-02) | `GO111MODULE` defaults to `on`; `retract` directive added; `exclude` no longer redirects to the next version [[Go Authors, 2021](#ref-go-authors-2021)] |
| Go 1.17, 1.18, 1.21 (2021-08 to 2023-08) | Module graph pruning, workspaces, toolchain management (see [17.3](./minimum.md)) |
| Go 1.22 (2024-02) | `go mod init` no longer tries to import dependencies from the configuration files of other tools such as `Gopkg.lock` [[Go Authors, 2024](#ref-go-authors-2024)] |

From 2019 the official blog introduced everyday use of modules in a series of articles, beginning
with creating a module and adding and upgrading dependencies
[[Bui-Palsulich and Compton, 2019](#ref-bui-palsulich-and-compton-2019)]. Looking back on this
history in 2019, Cox summarized the role of `dep` as what Go learned from it: some decisions in the
route shared by Bundler, Cargo and `dep` make software engineering more complicated, so Go modules
made different decisions [[Cox, 2019](#ref-cox-2019)].

## 17.4.6 go.sum and the Checksum Database

Minimal version selection decides which version to use, but does not guarantee that the downloaded
code is what that version originally contained. A code hosting service may be compromised, and an
author may repoint an already published tag at another commit. Go 1.11 introduced the `go.sum` file
along with modules, recording a cryptographic hash of the content of each dependency
[[Cox and Valsorda, 2019](#ref-cox-and-valsorda-2019)]. The following are the first two lines of
`go.sum` for the `cmd` module in the Go source tree [[Go Authors, 2026](#ref-go-authors-2026)]:

```text
github.com/google/go-cmp v0.7.0 h1:wk8382ETsv4JYUZwIsn6YpYiWiBsYLSJiTsyBybVuN8=
github.com/google/go-cmp v0.7.0/go.mod h1:pXiqmnSA92OHEEa9HXL2W4E7lf9JzCmGVUdgjX3N/iU=
```

Each line gives the module path, the version and the hash, in that order. When the version ends in
`/go.mod`, the hash covers only that version's `go.mod` file; otherwise it covers all files in the
module zip file. `h1:` denotes SHA-256, currently the only supported algorithm
[[Go Authors, n.d.](#ref-go-authors-nd)]. `go.sum` is not a lock file: MVS may need to read the
`go.mod` of several versions of a dependency, so `go.sum` can contain versions that are not in the
build list; it only verifies and takes no part in selection ([17.3](./minimum.md)).

`go.sum` guarantees that the code downloaded tomorrow is the same as today's, but it cannot verify
the first download. Cox and Valsorda liken this to SSH's "trust on first use": the first time a
dependency is added or upgraded, the `go` command can only trust that what it downloaded is the
correct code and then write its hash into `go.sum`. In their 2019 design the two
defined "correct" as follows [[Cox and Valsorda, 2019](#ref-cox-and-valsorda-2019)]:

```text
For our purposes, "correct" for a particular module version download is
defined as the same code everyone else downloads.
```

By this definition there is no need to assign keys to every author; a single global `go.sum` listing
the hashes of all public module versions suffices. So that this global file does not become a new
target of attack, the checksum database `sum.golang.org` uses the transparent log employed by
Certificate Transparency: the log is organized as a Merkle tree, clients can verify that a record is
indeed in the log and that the server has never deleted records, and independent auditors can check
that the records themselves are correct. The `go` command caches the most recently seen signed tree
head and, on discovering two inconsistent tree heads, reports an error and fails the build. Both
code hosting services and module proxies are thus removed from the trusted computing base: they can
stop serving a version, but cannot replace its content
[[Cox and Valsorda, 2019](#ref-cox-and-valsorda-2019)].

Go 1.13 made the module proxy and checksum database the default
[[Go Authors, 2019](#ref-go-authors-2019)]. Private modules should not query the public database,
which would leak internal import paths, so they must be listed through `GOPRIVATE` or `GONOSUMDB`;
when the database cannot provide a record for a module, the `go` command treats it as a hard
failure, so that an attacker cannot make arbitrary code appear genuine by blocking the database
[[Cox and Valsorda, 2019](#ref-cox-and-valsorda-2019)]. With this, the reproducible build posed in
17.1 has two layers of guarantee: MVS makes the selection of versions unchanging over time, and
`go.sum` with the checksum database makes the content of a given version unchanging over time.

## 17.4.7 Summary

The disagreement between `dep` and vgo was technical as well as procedural. Technically, the two
sides agreed on most issues, such as module paths, removing `GOPATH` and module proxies; the
disagreement centered on the version selection algorithm, whether multiple major versions can
coexist, and whether dependencies can declare globally effective incompatibilities. These were
discussed from Cox's side in 17.2 and 17.3, and Boyer's analysis gives the other side's reasons.
Procedurally, Cox admits that the biggest mistake was not stating the concerns about `dep` more
publicly, while Bourgon attributes the problem to how the Go project resolves design disagreements;
the explanation both accept is that for a long time the two sides were having different
conversations. Go modules have since continued to evolve in default behavior, security and scale,
while `dep` was archived in 2020.

## Further Reading

- <a id="ref-bourgon-2018"></a>[Bourgon, 2018] Peter Bourgon. *A response about dep and vgo.*
  2018-07-27. https://peter.bourgon.org/blog/2018/07/27/a-response-about-dep-and-vgo.html
  Transcribes and responds point by point to Cox's tweets of 2018-07-26, with a postscript at the
  end.
- <a id="ref-boyer-2016"></a>[Boyer, 2016] Sam Boyer. *The Saga of Go Dependency Management.* Gopher
  Academy Blog, 2016-12-13.
  https://blog.gopheracademy.com/advent-2016/saga-go-dependency-management/ The formation, working
  method and goals of the package management committee.
- <a id="ref-boyer-2018"></a>[Boyer, 2018] Sam Boyer. *An Analysis of Vgo.* 2018-05-14.
  https://sdboyer.io/vgo/intro/
  Archived: https://web.archive.org/web/20180708073730/https://sdboyer.io/vgo/intro/
  The `dep` side's most complete technical assessment of vgo.
- <a id="ref-boyer-et-al-2020"></a>[Boyer et al., 2020] Sam Boyer et al. *dep: Go dependency
  management tool (official experiment, now archived).* https://github.com/golang/dep The README
  states that `dep` was deprecated and archived in 2020; for the syntax of version constraints see
  `docs/Gopkg.toml.md` in the repository.
- <a id="ref-bui-palsulich-and-compton-2019"></a>[Bui-Palsulich and Compton, 2019] Tyler
  Bui-Palsulich, Eno Compton. *Using Go Modules (official blog series).* 2019-03-19.
  https://go.dev/blog/using-go-modules
- <a id="ref-cox-2017a"></a>[Cox, 2017a] Russ Cox. *Go package management meeting notes - June 13,
  2017.* https://research.swtch.com/go-pkg-june-2017-notes.html Made public in 2018; also made
  public was the draft discussed at the meeting, https://research.swtch.com/go-pkg-june-2017.html .
- <a id="ref-cox-2017b"></a>[Cox, 2017b] Russ Cox. *Import Versioning (draft).* 2017-11-20.
  https://research.swtch.com/impver-draft-20171120.pdf
  An early draft of semantic import versioning.
- <a id="ref-cox-2018a"></a>[Cox, 2018a] Russ Cox. *Go & Versioning (the vgo series, February 2018,
  seven articles).* https://research.swtch.com/vgo . Among them, *Minimal Version Selection*
  (<https://research.swtch.com/vgo-mvs>) gives the argument that MVS is confined to a subclass of
  Horn formulas and avoids NP-completeness, and *Semantic Import Versioning*
  (<https://research.swtch.com/vgo-import>) explains the design of putting the major version in the
  path. The series index also lists the submission and acceptance dates of the proposal and the
  later follow-ups.
- <a id="ref-cox-2018b"></a>[Cox, 2018b] Russ Cox. *Go += Package Versioning.* 2018-02-20.
  https://research.swtch.com/vgo-intro The first article of the vgo series, reviewing the history of
  `go get`, vendoring tools and the package management committee.
- <a id="ref-cox-2018c"></a>[Cox, 2018c] Russ Cox. *The vgo proposal is accepted. Now what?*
  2018-05-29. https://research.swtch.com/vgo-accepted
- <a id="ref-cox-2019"></a>[Cox, 2019] Russ Cox. *The Principles of Versioning in Go.* 2019-12-03.
  https://research.swtch.com/vgo-principles
- <a id="ref-cox-and-valsorda-2019"></a>[Cox and Valsorda, 2019] Russ Cox, Filippo Valsorda.
  *Proposal: Secure the Public Go Module Ecosystem.* 2019. https://go.dev/design/25530-sumdb The
  trust problem of `go.sum` and the design of the checksum database.
- <a id="ref-go-authors-2018"></a>[Go Authors, 2018] The Go Authors. *Go 1.11 Release
  Notes (preliminary experimental support for modules).* https://go.dev/doc/go1.11
- <a id="ref-go-authors-2019"></a>[Go Authors, 2019] The Go Authors. *Go 1.13 Release Notes.*
  https://go.dev/doc/go1.13#modules
- <a id="ref-go-authors-2020"></a>[Go Authors, 2020] The Go Authors. *Go 1.14 Release Notes.*
  https://go.dev/doc/go1.14#introduction
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.16 Release Notes
  (GO111MODULE defaults to on, modules become the default).* https://go.dev/doc/go1.16
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. *Go 1.22 Release Notes.*
  https://go.dev/doc/go1.22#go-command
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. src/cmd/go.sum. Go 1.26 source.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/go.sum
- <a id="ref-go-authors-nd"></a>[Go Authors, n.d.] The Go Authors. *Go Modules Reference (the
  authoritative description of the cmd/go module mechanism).* https://go.dev/ref/mod
- This book: [17.1 The Hard Parts of Dependency Management](./challenges.md),
  [17.2 Semantic Version Management](./semantics.md),
  [17.3 Minimal Version Selection](./minimum.md), and
  [Chapter 1 Design Philosophy and History](../../part1overview/ch01intro/readme.md).
