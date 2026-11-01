---
weight: 5302
title: "17.2 语义化版本管理"
---

# 17.2 语义化版本管理

选择版本的前提，是版本号有确定的含义。如果 v1.5 与 v1.4 之间的关系无从预料，任何选择算法都无从下手。Go
模块采用语义化版本作为版本号的语法与次序，但 Cox 在「vgo」系列文章 [[Cox, 2018a](#ref-cox-2018a)]中认为，
语义化版本本身只是选择和比较版本字符串的一种方式，真正决定依赖能否组合的，是另一条规则：导入兼容性规则
[[Cox, 2018b](#ref-cox-2018b)]。本节先介绍语义化版本及其局限，再介绍导入兼容性规则与由此得出的语义化导入版
本，最后说明 Go 如何为没有版本标签、没有 `go.mod` 的代码赋予版本。这些规定共同构成 [17.3](./minimum.md)
中版本选择算法的前提。

## 17.2.1 语义化版本

**语义化版本**（Semantic Versioning，SemVer）由 Tom Preston-Werner 起草，现行的 2.0.0 版发布于 2013 年
[[Preston-Werner, 2013](#ref-preston-werner-2013)]。规范要求软件首先声明公共 API，
版本号的变化描述的正是这个 API 的变化。版本号的形式为 X.Y.Z，三段依次称为主版本号、次版本号与修订号：
做了不兼容的 API 修改时，递增主版本号；做了向下兼容的功能性新增时，递增次版本号；
做了向下兼容的问题修正时，递增修订号。递增较高的一段时，较低的各段归零。此外还有几条容易被忽略的规定：
版本一经发布，其内容不得修改，任何修改都必须作为新版本发布；主版本号为零的 0.y.z 用于初始开发阶段，
任何内容都可能随时改变；1.0.0 则标志着公共 API 的确立。

修订号之后可以附加以连字符引出的先行版本号，如 `1.0.0-rc.1`，以及以加号引出的版本编译信息，如
`1.0.0+20130313144700`。比较两个版本的先后时，主版本号、次版本号、修订号依次按数值比较；三者相同时，
先行版本低于正式版本；先行版本号之间按点分隔的标识符逐个比较；版本编译信息不参与比较。规范给出的例子是：

```text
1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0
```

这一全序关系是「取较高版本」这类操作得以定义的基础。Go 的实现位于 `golang.org/x/mod/semver`，`go`
命令使用其随 Go 源码树提供的副本。包注释说明了它与规范的两处差别
[[Go Authors, 2026a](#ref-go-authors-2026a)]：

```go
// This package follows Semantic Versioning 2.0.0 (see semver.org)
// with two exceptions. First, it requires the "v" prefix. Second, it recognizes
// vMAJOR and vMAJOR.MINOR (with no prerelease or build suffixes)
// as shorthands for vMAJOR.0.0 and vMAJOR.MINOR.0.
package semver
```

因此 Go 模块的版本总是写作 `v1.4.2` 而非 `1.4.2`，`v1` 与 `v1.4` 分别是 `v1.0.0` 与 `v1.4.0` 的简写。

## 17.2.2 版本号承诺不了什么

语义化版本是一种约定，没有任何机制强制作者遵守。`golang.org/x/exp` 中的实验性工具 `gorelease`
可以比较一个模块的基准版本与当前修订的公共 API 及依赖，判断拟发布的版本号是否与语义化版本相符
[[Go Authors, n.d.b](#ref-go-authors-ndb)]。但这类工具检查的只是 API 的形式，函数签名没有变化，
不代表行为没有变化。

Winters 把语义化版本称为对兼容性的一种「有损估计」，它既可能约束过度，也可能保护不足
[[Winters et al., 2020](#ref-winters-et-al-2020)]。约束过度的情形是：一个库包含 `Foo` 与 `Bar` 两个函数，
作者对 `Bar` 做了不兼容的修改，只好递增主版本号；依赖它的另外两个库只用到 `Foo`，本来可以照常工作，
却因为只声明了兼容 1.x 而被求解器拒绝。保护不足的情形则源于海勒姆定律（Hyrum's Law）：用户足够多时，
系统的每一种可观察行为都会被某个人所依赖。改变日志格式、改变「无序」结果的顺序，在 API
的契约之内都不算不兼容的修改，按规范只需递增修订号，却总会破坏某些使用者。

Cox 从另一个角度提出了批评 [[Cox, 2018b](#ref-cox-2018b)]。规范说明了不兼容的修改应当递增主版本号，
却没有说明递增之后该怎么办。文中用一个虚构的故事说明这一点：OAuth2 库发布了部分不兼容的 2.0.0，AWS
客户端库在内部改用了它，Azure 客户端库仍使用 1.x；一个同时使用两者的应用于是陷入钻石依赖，
而这个应用直接导入的包，没有一个改变过主版本号。更糟的是，两者共同使用的中间件 Moauth 在自己的 API
中暴露了 OAuth2 的类型，即使允许 OAuth2 的两个版本共存，也说不清 Moauth 应当导入哪一个。
按语义化版本的规定，每一步都无可指摘，构建却一再失败。Cox 的结论是，把不兼容的修改标记为 2.0.0，
很容易被理解为「递增了主版本号，其余一切自然会好」，而事实并非如此。

## 17.2.3 导入兼容性规则与语义化导入版本

Go 模块的回答是把 2013 年 FAQ 中的建议（[17.1](./challenges.md)）确立为规则，Cox
称之为**导入兼容性规则**（import compatibility rule）[[Cox, 2019](#ref-cox-2019)]：

```text
If an old package and a new package have the same import path,
the new package must be backwards compatible with the old package.
```

即：如果旧包与新包有相同的导入路径，新包必须向后兼容旧包。按照语义化版本，不同的主版本之间没有兼容关系；
按照这条规则，不兼容的包不能共用导入路径。两者同时成立，不同的主版本就必须使用不同的导入路径。Go
模块的做法是把主版本号写进模块路径：从 v2 起，模块路径必须带有与主版本一致的后缀，v1 的 `example.com/mod`
到了 v2.0.0 须改为 `example.com/mod/v2` [[Go Authors, n.d.a](#ref-go-authors-nda)]。Cox
称这一做法为**语义化导入版本**（semantic import versioning）[[Cox, 2019](#ref-cox-2019)]。
模块路径是模块内每个包的导入路径的前缀，后缀因此传递给模块中的每一个包。v2 模块的 `go.mod`
首行与使用者的导入语句如下：

```text
module example.com/mod/v2
```

```go
import (
	"example.com/mod"          // v0 或 v1
	modv2 "example.com/mod/v2" // v2，与上一行是两个不同的包
)
```

两个包的包名通常都是 `mod`，同时导入时需要为其中一个取别名。这条规则有几处边界：

- v0 与 v1 不带后缀。v0 不承诺任何兼容，从 v0 到 v1 无须更换路径；对多数模块而言，v1 与最后一个 v0
  版本兼容，它表达的是对兼容的承诺，而不是一次不兼容的修改。
- 以 `gopkg.in/` 开头的路径是例外，它们在 v0 与 v1 也必须带有主版本后缀，且以点而非斜杠分隔，如
  `gopkg.in/yaml.v2`。这一早于 Go 模块的服务，已经采用了把主版本写进导入路径的做法。
- 一个仓库可以在不同的分支上开发不同的主版本，也可以在主分支上为 v2 建立名为 `v2` 的子目录，放置带有自己
  `go.mod` 的模块。Go 博客推荐后一种做法，因为它与 GOPATH 模式下的构建兼容性最好
  [[Barkhuysen and Bui-Palsulich, 2019](#ref-barkhuysen-and-bui-palsulich-2019)]。

在 OAuth2 的故事里，这条规则改变了两个情节 [[Cox, 2018b](#ref-cox-2018b)]。第一，OAuth2
的作者不能以原来的导入路径发布不兼容的新 API，只能把它作为新的包发布；第二，Moauth 在 API 中暴露了 OAuth2
的类型，OAuth2 分裂为两个包，迫使 Moauth 也分裂为两个包。于是各个包的导入语句恰好对应需要构建的内容，
应用的构建不再需要任何特殊处理。代价由包的作者承担：每一次不兼容的修改都需要一个新的名字。Cox
认为这一代价值得付出，因为作者可以用早已熟悉的「包」与「导入路径」来推想修改对使用者的影响，
并可能因此作出更好的决定，例如在原有的包中并列加入新的 API，或者借助接口让 Moauth 同时支持两个版本，
从而避免分裂。

钻石依赖也就此化解。D 1.3 必须向后兼容 D 1.2，D 2.0 的导入路径则是 `D/v2`；同时使用两个主版本的程序，
像对待任何两个导入路径不同的包一样对待它们 [[Cox, 2019](#ref-cox-2019)]。一个大型程序可以逐个包地从 v1
迁移到 v2，在任何时刻都清楚哪些代码已经迁移、哪些还没有。

这条规则在推出时遭到不少反对。Cox 在 2019 年逐一作了回应 [[Cox, 2019](#ref-cox-2019)]：

| 异议 | 回应 |
|:----|:----|
| 导入路径中的版本号不美观 | 以大写字母表示导出、以完整 URL 作为导入路径，起初也被认为不美观，如今已被视为理所当然 |
| 升级主版本须改写全部导入路径 | 改写可以由工具完成；路径中的版本也使逐步迁移成为可能 |
| 同一个构建中不应允许多个主版本 | 这只对被依赖包的作者更简单；禁止共存会使钻石依赖重新出现，并把生态分裂为互不相容的两群。Cargo 等系统同样允许 |
| 初期开发时频繁破坏兼容，后缀是负担 | v0 不承诺兼容，也不出现在导入路径中 |

## 17.2.4 没有标签与没有 `go.mod` 的代码

语义化导入版本要求 v2 及以上的模块路径带有后缀，但在模块出现之前，许多仓库已经发布了 v2 或更高版本的标签，
路径中没有后缀，仓库中也没有 `go.mod`。为了兼容这些仓库，`go` 命令为这类版本加上 `+incompatible` 后缀，
例如 `v4.1.2+incompatible` [[Go Authors, n.d.a](#ref-go-authors-nda)]。
后缀表示这个版本与较低主版本属于同一个模块，`go` 命令可能从 v1.5.2 自动升级到 v4.1.2+incompatible，
即使这会破坏构建。这是一条过渡的通道，参考手册建议此类仓库在迁移到模块时发布新的主版本，
并使用带后缀的路径。

另一类代码根本没有版本标签。依赖一个尚未标记的提交时，`go` 命令为它合成一个**伪版本**（pseudo-version），
形如 `v0.0.0-20191109021931-daa7c04131f5`，由三部分组成：基础版本前缀、修订创建时刻的 UTC 时间戳（在 Git
中是提交时间而非作者时间），以及提交哈希的 12 个字符的前缀 [[Go Authors, n.d.a](#ref-go-authors-nda)]。`x/mod`
中的注释列出了伪版本的全部形式 [[Go Authors, 2026b](#ref-go-authors-2026b)]：

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

伪版本是一种先行版本。若提交之前最近的标签是 vX.Y.Z，伪版本取形式 (2)，即下一个修订号的先行版本，它高于
vX.Y.Z，又低于 vX.Y.(Z+1) 的任何正式的先行版本；基础版本相同的伪版本之间，则按时间先后排列。借助伪版本，
一个从未被命名的提交也能参与版本的比较。

为了防止伪版本被滥用，`go` 命令还要做三项检查 [[Go Authors, n.d.a](#ref-go-authors-nda)]。
若指定了基础版本，对应的标签必须是该提交的祖先，否则有人可以构造 `v1.999.999-99999999999999-daa7c04131f5`
这样高于一切标签的伪版本，绕过最小版本选择；时间戳必须与提交的时间一致，
以防止有人以同一个提交制造无数个伪版本，或改变版本之间的相对次序；提交必须是仓库中某个分支或标签的祖先，
以防止引用未经认可的修改，例如尚未合并的拉取请求。

## 17.2.5 小结

语义化版本为版本号提供了语法与全序，但它只是作者向使用者传达预期的一种方式：它无法准确描述兼容性，
也没有说明不兼容的修改应当如何与既有的依赖共处。Go 模块在其上加了一条规则：
同一导入路径下的新版本必须兼容旧版本，不兼容的修改必须使用新的导入路径。由此得出的语义化导入版本，
使不同的主版本成为不同的包，钻石依赖中最难处理的冲突不再出现；同一主版本内的版本又都向后兼容，
一个依赖只需声明它所需的最低版本。[17.3](./minimum.md) 将说明，版本选择正是在这两条前提下变得简单。

## 延伸阅读

- <a id="ref-barkhuysen-and-bui-palsulich-2019"></a>[Barkhuysen and Bui-Palsulich, 2019] Jean Barkhuysen,
  Tyler Bui-Palsulich. *Go Modules: v2 and Beyond.* The Go Blog, 2019-11-07.
  https://go.dev/blog/v2-go-modules
  发布 v2 模块的步骤；推荐以主版本子目录组织多个主版本。
- <a id="ref-cox-2018a"></a>[Cox, 2018a] Russ Cox. *Go & Versioning.* 2018. https://research.swtch.com/vgo
  「vgo」系列文章的目录。
- <a id="ref-cox-2018b"></a>[Cox, 2018b] Russ Cox. *Semantic Import Versioning.* 2018-02-21.
  https://research.swtch.com/vgo-import
  导入兼容性规则、OAuth2 与 Moauth 的故事、v2 路径后缀的由来与多个主版本的共存。
- <a id="ref-cox-2019"></a>[Cox, 2019] Russ Cox. *The Principles of Versioning in Go.* 2019-12-03.
  https://research.swtch.com/vgo-principles
  兼容性原则，以及对语义化导入版本的四种异议的回应。
- <a id="ref-go-authors-2026a"></a>[Go Authors, 2026a] The Go Authors.
  src/cmd/vendor/golang.org/x/mod/semver/semver.go. Go 1.26 源码.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/vendor/golang.org/x/mod/semver/semver.go
- <a id="ref-go-authors-2026b"></a>[Go Authors, 2026b] The Go Authors.
  src/cmd/vendor/golang.org/x/mod/module/pseudo.go. Go 1.26 源码.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/vendor/golang.org/x/mod/module/pseudo.go
- <a id="ref-go-authors-nda"></a>[Go Authors, n.d.a] The Go Authors. *Go Modules Reference.*
  https://go.dev/ref/mod
  「Major version suffixes」「+incompatible versions」「Pseudo-versions」各节：v0 与 v1 不带后缀、`gopkg.in`
  的特例、`+incompatible` 过渡通道、伪版本的格式与检查。
- <a id="ref-go-authors-ndb"></a>[Go Authors, n.d.b] The Go Authors. *golang.org/x/exp/cmd/gorelease* 与
  *golang.org/x/exp/apidiff.* https://pkg.go.dev/golang.org/x/exp/cmd/gorelease
  检查导出 API 的兼容性，为遵守语义化版本提供工具支持。
- <a id="ref-preston-werner-2013"></a>[Preston-Werner, 2013] Tom Preston-Werner.
  *Semantic Versioning 2.0.0.* 2013. https://semver.org/
  主版本号、次版本号、修订号的递增规则，先行版本号与版本编译信息的语法，以及版本的优先级。
- <a id="ref-winters-et-al-2020"></a>[Winters et al., 2020] Titus Winters, Tom Manshreck, Hyrum Wright
  (eds.). *Software Engineering at Google.* O'Reilly, 2020. 第 21 章「Dependency Management」（Titus
  Winters 撰写）. https://abseil.io/resources/swe-book/html/ch21.html
  语义化版本作为「有损估计」的约束过度与保护不足；对最小版本选择的评价。
- 本书 [17.1 依赖管理的难点](./challenges.md)、[17.3 最小版本选择算法](./minimum.md)。
