---
weight: 5302
title: "17.2 Semantic Version Management"
---

# 17.2 Semantic Version Management

Version selection presupposes that version numbers have a definite meaning. If the relationship
between v1.5 and v1.4 cannot be predicted, no selection algorithm has anything to work with. Go
modules adopt semantic versioning as the syntax and ordering of version numbers, but Cox argues in
the "vgo" series [[Cox, 2018a](#ref-cox-2018a)] that semantic versioning is only a way of choosing
and comparing version strings; what actually decides whether dependencies can be composed is another
rule, the import compatibility rule [[Cox, 2018b](#ref-cox-2018b)]. This section introduces semantic
versioning and its limits, then the import compatibility rule and the semantic import versioning
that follows from it, and finally how Go assigns versions to code that has no version tag and no
`go.mod`. Together these rules are the premises of the version selection algorithm in
[17.3](./minimum.md).

## 17.2.1 Semantic Versioning

**Semantic Versioning** (SemVer) was drafted by Tom Preston-Werner; the current version, 2.0.0, was
published in 2013 [[Preston-Werner, 2013](#ref-preston-werner-2013)]. The specification requires
software to declare a public API first, and version number changes describe changes to that API. A
version number has the form X.Y.Z, whose three parts are called the major, minor and patch versions:
increment the major version when making incompatible API changes, the minor version when adding
functionality in a backward compatible manner, and the patch version when making backward compatible
bug fixes. When a higher part is incremented, the lower parts reset to zero. A few other rules are
easy to overlook: once a version is released its contents must not be modified, and any modification
must be released as a new version; major version zero (0.y.z) is for initial development, where
anything may change at any time; and 1.0.0 marks the establishment of the public API.

A pre-release identifier introduced by a hyphen, such as `1.0.0-rc.1`, and build metadata introduced
by a plus sign, such as `1.0.0+20130313144700`, may follow the patch version. When comparing two
versions, the major, minor and patch versions are compared numerically in turn; if all three are
equal, a pre-release version is lower than the normal version; pre-release identifiers are compared
one dot-separated identifier at a time; build metadata does not take part in comparison. The
specification gives this example:

```text
1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0
```

This total order is what makes operations such as "take the higher version" well defined. Go's
implementation is `golang.org/x/mod/semver`, and the `go` command uses the copy shipped in the Go
source tree. The package comment states two differences from the specification
[[Go Authors, 2026a](#ref-go-authors-2026a)]:

```go
// This package follows Semantic Versioning 2.0.0 (see semver.org)
// with two exceptions. First, it requires the "v" prefix. Second, it recognizes
// vMAJOR and vMAJOR.MINOR (with no prerelease or build suffixes)
// as shorthands for vMAJOR.0.0 and vMAJOR.MINOR.0.
package semver
```

Go module versions are therefore always written `v1.4.2` rather than `1.4.2`, and `v1` and `v1.4`
are shorthands for `v1.0.0` and `v1.4.0`.

## 17.2.2 What a Version Number Cannot Promise

Semantic versioning is a convention; no mechanism forces authors to follow it. The experimental tool
`gorelease` in `golang.org/x/exp` can compare a module's base version with the public API and
dependencies of the current revision, and judge whether the proposed version number conforms to
semantic versioning [[Go Authors, n.d.b](#ref-go-authors-ndb)]. But such tools check only the form
of the API: unchanged function signatures do not mean unchanged behavior.

Winters calls semantic versioning a "lossy estimate" of compatibility that can both over-constrain
and under-protect [[Winters et al., 2020](#ref-winters-et-al-2020)]. Over-constraint looks like
this: a library contains two functions, `Foo` and `Bar`, and its author makes an incompatible change
to `Bar` and so must increment the major version; two other libraries that depend on it use only
`Foo` and could have worked as before, yet the solver rejects them because they declared only
compatibility with 1.x. Under-protection stems from Hyrum's Law: with enough users, every observable
behavior of a system will be depended on by somebody. Changing a log format or the order
of "unordered" results is not an incompatible change within the contract of the API and, by the
specification, needs only a patch increment, yet it will always break some users.

Cox criticizes from another angle [[Cox, 2018b](#ref-cox-2018b)]. The specification says that
incompatible changes should increment the major version but not what to do after the increment. Cox
illustrates this with a fictional story: the OAuth2 library releases a partially incompatible 2.0.0,
the AWS client library internally switches to it, and the Azure client library still uses 1.x; an
application using both falls into a diamond dependency, although not one of the packages the
application imports directly has changed its major version. Worse, Moauth, a middleware both use,
exposes OAuth2 types in its own API, so even if two versions of OAuth2 were allowed to coexist, it
would be unclear which one Moauth should import. By the rules of semantic versioning every step is
beyond reproach, yet the build fails again and again. Cox concludes that labeling an incompatible
change 2.0.0 is easily taken to mean "increment the major version and everything else will sort
itself out", which is not so.

## 17.2.3 The Import Compatibility Rule and Semantic Import Versioning

Go modules answer by establishing the advice from the 2013 FAQ ([17.1](./challenges.md)) as a rule,
which Cox calls the **import compatibility rule** [[Cox, 2019](#ref-cox-2019)]:

```text
If an old package and a new package have the same import path,
the new package must be backwards compatible with the old package.
```

By semantic versioning, different major versions have no compatibility relationship; by this rule,
incompatible packages cannot share an import path. With both holding, different major versions must
use different import paths. Go modules write the major version into the module path: from v2 on, the
module path must carry a suffix matching the major version, so the v1 `example.com/mod` becomes
`example.com/mod/v2` at v2.0.0 [[Go Authors, n.d.a](#ref-go-authors-nda)]. Cox calls this **semantic
import versioning** [[Cox, 2019](#ref-cox-2019)]. The module path is the prefix of the import path
of every package in the module, so the suffix passes to every package in the module. The first line
of a v2 module's `go.mod` and a user's import statements look like this:

```text
module example.com/mod/v2
```

```go
import (
	"example.com/mod"          // v0 or v1
	modv2 "example.com/mod/v2" // v2, a different package from the line above
)
```

Both packages are usually named `mod`, so importing both requires an alias for one of them. The rule
has several boundaries:

- v0 and v1 carry no suffix. v0 promises no compatibility, so moving from v0 to v1 needs no path
  change; for most modules, v1 is compatible with the last v0 version, and expresses a promise of
  compatibility rather than an incompatible change.
- Paths beginning with `gopkg.in/` are an exception: they must carry a major version suffix even at
  v0 and v1, separated by a dot rather than a slash, as in `gopkg.in/yaml.v2`. This service, which
  predates Go modules, already put the major version in the import path.
- A repository can develop different major versions on different branches, or create a subdirectory
  named `v2` on the main branch for v2, holding a module with its own `go.mod`. The Go blog
  recommends the latter because it has the best compatibility with builds in GOPATH mode
  [[Barkhuysen and Bui-Palsulich, 2019](#ref-barkhuysen-and-bui-palsulich-2019)].

In the OAuth2 story the rule changes two plot points [[Cox, 2018b](#ref-cox-2018b)]. First, the
OAuth2 author cannot release the incompatible new API under the original import path and can only
release it as a new package. Second, Moauth exposes OAuth2 types in its API, so the split of OAuth2
into two packages forces Moauth to split into two packages as well. The import statements of the
various packages then correspond exactly to what must be built, and the application's build needs no
special handling. The cost falls on package authors: every incompatible change needs a new name. Cox
considers the cost worth paying, because authors can reason about the effect of a change on users
with the long-familiar notions of "package" and "import path", and may as a result make better
decisions, such as adding the new API alongside the old one in the existing package, or using
interfaces so that Moauth supports both versions, avoiding the split.

The diamond dependency is resolved along the way. D 1.3 must be backward compatible with D 1.2, and
the import path of D 2.0 is `D/v2`; a program using both major versions treats them as it treats any
two packages with different import paths [[Cox, 2019](#ref-cox-2019)]. A large program can migrate
from v1 to v2 package by package, and at any moment it is clear which code has migrated and which
has not.

The rule drew much opposition when introduced. Cox answered the objections one by one in 2019
[[Cox, 2019](#ref-cox-2019)]:

| Objection | Response |
|:----|:----|
| Version numbers in import paths are ugly | Capital letters for exports and full URLs as import paths were also once thought ugly and are now taken for granted |
| Upgrading a major version requires rewriting every import path | The rewrite can be done by tools; versions in paths also make gradual migration possible |
| A single build should not allow multiple major versions | This is simpler only for authors of depended-on packages; forbidding coexistence brings diamond dependencies back and splits the ecosystem into two mutually incompatible camps. Cargo and others allow it too |
| Breaking compatibility frequently during early development makes the suffix a burden | v0 promises no compatibility and does not appear in import paths |

## 17.2.4 Code Without Tags and Without `go.mod`

Semantic import versioning requires modules at v2 and above to carry a suffix, but before modules
existed, many repositories had already published tags for v2 or higher, with no suffix in the path
and no `go.mod` in the repository. To stay compatible with these repositories, the `go` command adds
a `+incompatible` suffix to such versions, for example `v4.1.2+incompatible`
[[Go Authors, n.d.a](#ref-go-authors-nda)]. The suffix indicates that the version belongs to the
same module as the lower major versions, and the `go` command may upgrade automatically from v1.5.2
to v4.1.2+incompatible, even if this breaks the build. This is a transitional channel; the reference
manual advises such repositories to publish a new major version with a suffixed path when they
migrate to modules.

Other code has no version tag at all. When a dependency is an untagged commit, the `go` command
synthesizes a **pseudo-version** for it, of the form `v0.0.0-20191109021931-daa7c04131f5`, made of
three parts: a base version prefix, the UTC timestamp of the revision's creation (in Git the commit
time rather than the author time), and a 12-character prefix of the commit hash
[[Go Authors, n.d.a](#ref-go-authors-nda)]. The comment in `x/mod` lists every form of
pseudo-version [[Go Authors, 2026b](#ref-go-authors-2026b)]:

```go
// A pseudo-version takes one of the general forms:
//
//	(1) vX.0.0-yyyymmddhhmmss-abcdef123456
//	(2) vX.Y.(Z+1)-0.yyyymmddhhmmss-abcdef123456
//	(3) vX.Y.(Z+1)-0.yyyymmddhhmmss-abcdef123456+incompatible
//	(4) vX.Y.Z-pre.0.yyyymmddhhmmss-abcdef123456
//	(5) vX.Y.Z-pre.0.yyyymmddhhmmss-abcdef123456+incompatible
//
// If there is no recently tagged version with the right major version vX,
// then form (1) is used, creating a space of pseudo-versions at the bottom
// of the vX version range, less than any tagged version, including the unlikely v0.0.0.
```

A pseudo-version is a kind of pre-release version. If the most recent tag before the commit is
vX.Y.Z, the pseudo-version takes form (2), a pre-release of the next patch version, which is higher
than vX.Y.Z and lower than any proper pre-release of vX.Y.(Z+1); pseudo-versions with the same base
version are ordered by time. With pseudo-versions, a commit that was never named can still take part
in version comparison.

To prevent pseudo-versions from being abused, the `go` command makes three further checks
[[Go Authors, n.d.a](#ref-go-authors-nda)]. If a base version is specified, the corresponding tag
must be an ancestor of the commit; otherwise someone could construct a pseudo-version such as
`v1.999.999-99999999999999-daa7c04131f5` that is higher than every tag and bypass minimal version
selection. The timestamp must match the commit's time, to prevent someone from creating countless
pseudo-versions from one commit or changing the relative order of versions. The commit must be an
ancestor of some branch or tag in the repository, to prevent references to unendorsed changes such
as pull requests that have not been merged.

## 17.2.5 Summary

Semantic versioning provides version numbers with a syntax and a total order, but it is only a way
for authors to convey expectations to users: it cannot describe compatibility precisely, and it does
not say how an incompatible change should coexist with existing dependencies. Go modules add one
rule on top: a new version under the same import path must be compatible with the old one, and an
incompatible change must use a new import path. The resulting semantic import versioning makes
different major versions different packages, so the hardest conflict in a diamond dependency no
longer arises; versions within one major version are all backward compatible, so a dependency need
only declare the minimum version it requires. [17.3](./minimum.md) shows that version selection
becomes simple under exactly these two premises.

## Further Reading

- <a id="ref-barkhuysen-and-bui-palsulich-2019"></a>[Barkhuysen and Bui-Palsulich, 2019] Jean
  Barkhuysen, Tyler Bui-Palsulich. *Go Modules: v2 and Beyond.* The Go Blog, 2019-11-07.
  https://go.dev/blog/v2-go-modules The steps for releasing a v2 module; recommends organizing
  multiple major versions with major version subdirectories.
- <a id="ref-cox-2018a"></a>[Cox, 2018a] Russ Cox. *Go & Versioning.* 2018.
  https://research.swtch.com/vgo Index of the "vgo" series.
- <a id="ref-cox-2018b"></a>[Cox, 2018b] Russ Cox. *Semantic Import Versioning.* 2018-02-21.
  https://research.swtch.com/vgo-import The import compatibility rule, the OAuth2 and Moauth story,
  the origin of the v2 path suffix, and the coexistence of multiple major versions.
- <a id="ref-cox-2019"></a>[Cox, 2019] Russ Cox. *The Principles of Versioning in Go.* 2019-12-03.
  https://research.swtch.com/vgo-principles
  The compatibility principle, and the responses to four objections to semantic import versioning.
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors.
  src/cmd/vendor/golang.org/x/mod/semver/semver.go. Go 1.26 source.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/vendor/golang.org/x/mod/semver/semver.go
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  src/cmd/vendor/golang.org/x/mod/module/pseudo.go. Go 1.26 source.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/vendor/golang.org/x/mod/module/pseudo.go
- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *Go Modules Reference.*
  https://go.dev/ref/mod The sections "Major version suffixes", "+incompatible
  versions" and "Pseudo-versions": no suffix for v0 and v1, the `gopkg.in` special case, the
  `+incompatible` transitional channel, and the format and checks of pseudo-versions.
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors.
  *golang.org/x/exp/cmd/gorelease* and *golang.org/x/exp/apidiff.*
  https://pkg.go.dev/golang.org/x/exp/cmd/gorelease Check the compatibility of exported APIs, giving
  tool support for following semantic versioning.
- <a id="ref-preston-werner-2013"></a>[Preston-Werner, 2013] Tom Preston-Werner. *Semantic
  Versioning 2.0.0.* 2013. https://semver.org/ The rules for incrementing the major, minor and patch
  versions, the syntax of pre-release identifiers and build metadata, and version precedence.
- <a id="ref-winters-et-al-2020"></a>[Winters et al., 2020] Titus Winters, Tom Manshreck, Hyrum
  Wright (eds.). *Software Engineering at Google.* O'Reilly, 2020. Chapter 21, "Dependency
  Management" (written by Titus Winters). https://abseil.io/resources/swe-book/html/ch21.html
  Over-constraint and under-protection of semantic versioning as a "lossy estimate"; the assessment
  of minimal version selection.
- This book: [17.1 The Hard Parts of Dependency Management](./challenges.md),
  [17.3 Minimal Version Selection](./minimum.md).
