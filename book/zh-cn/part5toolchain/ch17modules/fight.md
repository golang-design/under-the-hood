---
weight: 5304
title: "17.4 vgo 与 dep 之争"
---

# 17.4 vgo 与 dep 之争

前三节讨论了 Go 模块的技术内核：依赖管理的难点（[17.1](./challenges.md)）、
语义化导入版本（[17.2](./semantics.md)）与最小版本选择（[17.3](./minimum.md)）。本节讲述这套设计的由来。2016
年起，一个由社区成员组成的委员会主导开发了依赖管理工具 `dep`；2018 年，Cox 提出了理念不同的 vgo，
它在同年被接受为正式提案，并演变为今天的 Go 模块。这段经历留下了两份互相矛盾的叙述：Cox 在 2018 年
7 月发布的一组推文，以及 Bourgon 随后的逐条回应 [[Bourgon, 2018](#ref-bourgon-2018)]。
本节尽量引用当时留下的文档，凡是仅凭当事人回忆的内容，都注明出自谁的叙述。最后一小节介绍 17.1 与 17.3
留到这里的 `go.sum` 与校验和数据库。

## 17.4.1 包管理委员会与 dep

[17.1](./challenges.md) 介绍过，`go get` 没有版本的概念，社区因此出现了 `godep`、`glide` 等多种 vendor
工具。Go 1.5 引入 vendor 目录的实验，Go 1.6 默认启用它之后，统一工具的讨论变得更加迫切。Boyer 记述，2016
年 7 月的 GopherCon 上，上百名开发者聚在一起讨论 vendor 与生态的问题，包括 Rob Pike 在内的 Go
团队成员也到场；此前 Go 团队大体把依赖管理视为留给社区解决的问题，这次会议之后，认真解决它成了明确的任务
[[Boyer, 2016](#ref-boyer-2016)]。会上成立了一个委员会和一个顾问组，由 Peter Bourgon 召集，委员为 Andrew
Gerrand、Edward Muller、Jessie Frazelle 与 Sam Boyer，目标是做出一个统一并取代现有工具的新工具；
委员会起草了规格说明，随后由 Boyer 主导实现为 `dep` [[Cox, 2018b](#ref-cox-2018b)]。

委员会自 2016 年 9 月起工作：收集用户故事，梳理设计空间，写出规格说明，再以 Boyer 设计的求解库 `gps`
为引擎实现工具 [[Boyer, 2016](#ref-boyer-2016)]。Bourgon 后来总结了委员会为保证结论可信而采取的做法：
成员取自社区中已有的领导者与专家，另设覆盖各个相关项目的顾问组，用半年时间收集用户反馈并研究其他包管理工
具，力求在所有重大决定上达成共识，并把全部过程公开记录下来 [[Bourgon, 2018](#ref-bourgon-2018)]。`dep` 于
2017 年 1 月公开 [[Boyer, 2016](#ref-boyer-2016)]。

`dep` 走的是 Bundler 与 Cargo 开创的路线 [[Cox, 2019](#ref-cox-2019)]：清单文件声明可接受的版本范围，
求解器在范围内选出一组版本，锁文件记录选择的结果。下面是 `dep` 仓库自身的两个文件的节选
[[Boyer et al., 2020](#ref-boyer-et-al-2020)]：

```toml
# Gopkg.toml（节选）[[constraint]]
  name = "github.com/Masterminds/vcs"
  version = "1.11.0"

[[constraint]]
  name = "github.com/boltdb/bolt"
  version = "1.0.0"
```

```toml
# Gopkg.lock（节选）[[projects]]
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

# ……
  solver-name = "gps-cdcl"
  solver-version = 1
```

不带运算符的版本号会被 `dep` 自动加上 `^`，`version = "1.0.0"` 表示 $\ge 1.0.0$ 且 $< 2.0.0$；
锁文件则记录了求解器在这一范围内选中的 v1.3.1 及其提交哈希。清单写的是对未来的预期，
锁文件写的是某一时刻的结果，二者之间的差距正是 17.1 所说的「随时间变化的选择」。

委员会对 `dep` 的定位，从一开始就存在两种说法。Boyer 在 2016 年 12 月写道，委员会的目标是让这个工具成为
Go 标准工具链的一部分，但在基本需求满足之后，至少还需要六个月的检验 [[Boyer, 2016](#ref-boyer-2016)]。Cox
在 2018 年 2 月则称 `dep` 是一个「官方实验」，可以立即使用，也是通向最终方案的重要一步，但它并不是 `go`
命令最终集成版本管理的直接原型 [[Cox, 2018b](#ref-cox-2018b)]。

## 17.4.2 2017 年的分歧

2017 年 6 月，Cox 把一份关于如何在 `go` 命令中集成包管理的草稿分享给委员会，几天后与委员会开会讨论，
并把会议纪要整理成邮件 [[Cox, 2017a](#ref-cox-2017a)]。这份纪要记录了此后争论的大部分技术分歧：

- Boyer 指出，草稿按包而非按项目编写清单，可能与 `dep` 不兼容；
- Boyer 担心草稿过于依赖语义化版本，例如 CockroachDB 为了保证排序规则表在版本之间不变，固定使用 `x/text`
  的某个提交；
- Boyer 认为排除列表只在顶层清单中生效是不够的，否则每个使用者都必须复制依赖的排除列表。Cox 当时表示同意，
  认为依赖中的排除也应当生效，只是不能引入可满足性搜索；最终的 MVS 选择了相反的做法，
  排除只在主模块中生效（[17.3](./minimum.md)）；
- Bourgon 不认为需要在一个程序中同时使用一个包的多个版本。Cox 举例说，若亚马逊的官方 API 使用 json v1，
  谷歌云的官方 API 使用 json v2，而 json 只是两者的内部实现细节，禁止多版本共存就意味着一个程序无法同时使
  用这两套 API：

```text
To me that's a show-stopper that must be avoided.
```

Cox 认为这是必须避免的致命缺陷。同年 7 月 GopherCon 期间的贡献者峰会上，Cox 与包管理小组再次见面，
这次见面在双方的叙述中差别很大。Bourgon 回忆，Cox 说自己要理解一个领域，必须亲手解决其中的问题、
做出东西来，这给委员会的印象是 Cox 暂时不会投入到委员会的研究与 `dep` 之中；Matt Farina 回忆 Cox
说过自己单干能做得更好。Cox 则在推文中表示，自己肯定没有这样说过，更可能说的是 `dep`
的设计需要改变才能集成进 `go` 命令 [[Bourgon, 2018](#ref-bourgon-2018)]。

2017 年 11 月，Cox 把后来称为语义化导入版本的草稿发给委员会 [[Cox, 2017b](#ref-cox-2017b)]，并建议 `dep`
支持这一规则。对随后的讨论，双方的说法再次不同：Cox 说 Boyer 与 Bourgon 认为改动 `dep` 为时已晚，`dep`
应当直接成为 `go dep`；Bourgon 则说委员会从未要求 `dep` 原样成为 `go dep`，只是 Cox
没能说服委员会相信语义化导入版本是必要的，委员会也就没有同意修改 `dep` 去执行它
[[Bourgon, 2018](#ref-bourgon-2018)]。

## 17.4.3 vgo 与提案

按照 Cox 的叙述，既然 `dep` 不会支持导入版本，Cox 便在 `go` 命令中写了一个实现来检验这些想法，
并发现语义化导入版本与最小版本选择相互契合。2018 年 1 月初设计已经成形，但 Boyer 将于 2 月 3 日在 FOSDEM
介绍 `dep`，Cox 不想让事情复杂化，便推迟到 2 月中旬才发布 [[Bourgon, 2018](#ref-bourgon-2018)]。2018 年
2 月 20 日起，Cox 连续发表七篇「Go & Versioning」文章，同时发布了原型 `vgo`
[[Cox, 2018a](#ref-cox-2018a)]。第一篇文章承诺，在 `go` 命令的集成方案确定并普遍可用之前，`dep`
会继续得到支持，并在结尾感谢了委员会与 Boyer 的工作 [[Cox, 2018b](#ref-cox-2018b)]。

正式提案于 2018 年 3 月 20 日提交，讨论在 issue #24301 中进行，5 月 21 日被提案评审委员会接受
[[Cox, 2018a](#ref-cox-2018a)]。Cox 说自己没有参与这一决定，而是交给了其他常规的提案评审者；Bourgon 指出，`dep`
之所以从未提交提案，是因为委员会一直在等待与核心团队建立更正式的沟通渠道
[[Bourgon, 2018](#ref-bourgon-2018)]。提案被接受后，Cox 解释说，接受只意味着设计是合适的、
可以开始编写正式的实现，`vgo` 本身仍是原型 [[Cox, 2018c](#ref-cox-2018c)]。

`dep` 一方的技术意见，以 Boyer 在 2018 年 5 月发表的长文最为完整 [[Boyer, 2018](#ref-boyer-2018)]。Boyer
先列出了 vgo 中自己赞同的部分：模块在 `go.mod` 中声明自己的路径、不再需要 `GOPATH`、模块代理、
同一仓库中嵌套多个模块、伪版本、隐含的兼容性，以及语义化导入版本的基本前提。Boyer 写道，除核心算法之外，
两人几乎在所有问题上意见一致。Boyer 也认可高保真构建是最可能产生可用构建的策略，并指出 `dep`
的求解器早已设计了类似的「首选版本」机制，只是尚未启用。分歧集中在 MVS 上，Boyer 的结论是：

```text
MVS, which is an algorithm for solving a math problem, not a community problem.
```

也就是说，MVS 解决的是一个数学问题，而不是一个社区问题。按照 Boyer 的分析，MVS 为了避开 NP 完全，
砍掉了领域中一部分本质的复杂性，这些复杂性并不会消失，而是转移到了别处。具体的担忧包括：
当新版本的依赖出现不兼容时，使用者只剩下重构、游说上游、分叉或置之不理这几种极端的选择；
兼容性本身难以定义，缺乏共同规则时会演变成「谁有权力」的问题；强制语义化导入版本会让同一个包的多个副本带来
全局状态方面的运行时故障；在 v0 阶段也假定兼容，不利于试验；`require` 把「最低可用版本」
与「当前使用的版本」合并为一个数，真正的下限因此丢失。Boyer 与 Cox 的核心分歧，
在于一个模块能否声明与某个依赖版本不兼容，并让这一声明在全局生效。这一点在 17.3 中已经从 Cox
的角度讨论过：这类声明是否定的蕴含，会破坏 MVS 的唯一性与最小性，Cox
主张以协作代替它（[17.3](./minimum.md)）。

两种设计的主要差别如下：

| 方面 | `dep` | Go 模块 |
|:-----|:------|:--------|
| 依赖声明 | 清单中的版本约束，可以是任意范围 | `go.mod` 中的最低要求；`exclude` 只在主模块中生效 |
| 版本选择 | 求解器在范围内选择，通常偏向较新的版本 | 最小版本选择 |
| 可重复构建 | 锁文件 `Gopkg.lock` | `go.mod` 本身；`go.sum` 只做校验 |
| 同一模块的多个主版本 | 不允许 | 允许，主版本写进导入路径 |
| 与 `go` 命令的关系 | 外部工具，依靠 vendor 目录 | 内置于 `go` 命令 |

其中「多个主版本」一行，正是 2017 年 6 月就已出现的分歧。Cox 认为不能在一个构建中使用多个主版本是一个致命
缺陷，并指出 `dep` 之所以不得不禁止，是因为 Go 的构建系统要求一个导入路径只对应一个包，而 `dep`
没有考虑语义化导入版本 [[Cox, 2019](#ref-cox-2019)]。Bourgon 则认为称之为致命缺陷言过其实，
这至多是一个见仁见智的问题，许多其他包管理系统也有同样的限制，并没有因此无法运转
[[Bourgon, 2018](#ref-bourgon-2018)]。

## 17.4.4 两种叙述

2018 年 7 月 26 日，Cox 在一组推文中回顾了 `dep`、vgo 与 Go 模块的经过，次日 Bourgon 发表文章逐条回应；
由于推文难以原样查阅，下面对 Cox 推文的引用均取自 Bourgon 的转录 [[Bourgon, 2018](#ref-bourgon-2018)]。Cox
写道，早在 2016 年 12 月就已向 Boyer 明确表示，`dep` 只是过程中的一步，预计会被取代，
但整个社区却普遍以为 `dep` 就是官方的最终答案。对自己的责任，Cox 的总结是：

```text
In retrospect I made lots of mistakes, but the biggest one was not
communicating concerns with Dep and plans for go command integration more
widely and publicly.
```

回头看，Cox 犯了许多错误，最大的一个是没有更广泛、更公开地说明自己对 `dep` 的顾虑以及集成进 `go`
命令的计划。Bourgon 的回应则强调，委员会按照上文所述的严格程序工作了近两年，Cox 却只参加过两三次会议；Cox
的技术论点并没有被忽视，而是经过了充分辩论但未能说服委员会，此时 Cox 没有继续完善论证或寻求折中，
而是独自实现并提出了方案。Bourgon 起初的结论是，任何独立的尽职调查都无法弥补设计并非出自核心团队这一点；
随后修改了这一说法，认为问题的核心在于 Go 项目如何解决设计上的分歧。
文章末尾的补记给出了一个双方都能接受的解释：

```text
I think the dep team and the core team were having two completely
different conversations, talking past each other, and it took the vgo papers to
collapse the quantum state.
```

按照这一解释，`dep` 团队认为 `dep` 与之前的工具有本质的不同，是经过研究、审慎考虑、由社区推动的 Go
依赖管理的最终形态；核心团队则认为 `dep` 与之前的工具本质上相同，只是为最终方案提供参考的又一个数据点。Bourgon
认为，两方各自的立场都有据可查，但直到为时已晚，双方才意识到彼此的理解并不相同。

## 17.4.5 从实验到默认

Go 模块此后用了几年时间，从实验性功能变为默认行为。下表列出与本章相关的主要节点
[[Go Authors, n.d.](#ref-go-authors-nd)]：

| 版本（发布时间） | 变化 |
|:-----|:-----|
| Go 1.11（2018-08） | 初步支持模块，标注为实验性；引入 `go.mod` 与 `go.sum` [[Go Authors, 2018](#ref-go-authors-2018)] |
| Go 1.13（2019-09） | `GOPROXY` 默认为 `https://proxy.golang.org,direct`；新增 `GOSUMDB`、`GOPRIVATE`；`GO111MODULE=auto` 只要存在 `go.mod` 即启用模块模式，即使位于 `GOPATH/src` 中 [[Go Authors, 2019](#ref-go-authors-2019)] |
| Go 1.14（2020-02） | 模块支持被认为可用于生产环境 [[Go Authors, 2020](#ref-go-authors-2020)] |
| `dep`（2020） | 宣布弃用并归档 [[Boyer et al., 2020](#ref-boyer-et-al-2020)] |
| Go 1.16（2021-02） | `GO111MODULE` 默认为 `on`；新增 `retract` 指令；`exclude` 不再改用下一个版本 [[Go Authors, 2021](#ref-go-authors-2021)] |
| Go 1.17、1.18、1.21（2021-08 至 2023-08） | 模块图剪枝、工作区、工具链管理（详见 [17.3](./minimum.md)） |
| Go 1.22（2024-02） | `go mod init` 不再尝试从 `Gopkg.lock` 等其他工具的配置文件导入依赖 [[Go Authors, 2024](#ref-go-authors-2024)] |

官方博客在 2019 年起以系列文章介绍模块的日常用法，从创建模块、添加和升级依赖讲起
[[Bui-Palsulich and Compton, 2019](#ref-bui-palsulich-and-compton-2019)]。2019 年 Cox 回顾这段历史时，把
`dep` 的作用概括为从中认识到 Bundler、Cargo 与 `dep` 共同的那条路线中有一些决定会让软件工程更加复杂，Go
模块因此作出了不同的决定 [[Cox, 2019](#ref-cox-2019)]。

## 17.4.6 go.sum 与校验和数据库

最小版本选择决定使用哪个版本，但并不保证下载到的代码就是那个版本本来的内容。代码托管服务可能被入侵，
作者也可能把一个已经发布的标签指向别的提交。Go 1.11 随模块一同引入了 `go.sum` 文件，
记录每个依赖内容的密码学哈希 [[Cox and Valsorda, 2019](#ref-cox-and-valsorda-2019)]。下面是 Go 源码树中
`cmd` 模块的 `go.sum` 的前两行 [[Go Authors, 2026](#ref-go-authors-2026)]：

```text
github.com/google/go-cmp v0.7.0 h1:wk8382ETsv4JYUZwIsn6YpYiWiBsYLSJiTsyBybVuN8=
github.com/google/go-cmp v0.7.0/go.mod h1:pXiqmnSA92OHEEa9HXL2W4E7lf9JzCmGVUdgjX3N/iU=
```

每行依次是模块路径、版本与哈希。版本以 `/go.mod` 结尾时，哈希只针对该版本的 `go.mod` 文件，否则针对模块
zip 文件中的全部文件；`h1:` 表示 SHA-256，目前也是唯一支持的算法
[[Go Authors, n.d.](#ref-go-authors-nd)]。`go.sum` 不是锁文件：MVS 可能需要读取一个依赖多个版本的
`go.mod`，所以 `go.sum` 中可以出现不在构建列表中的版本，它只负责校验，
不参与选择（[17.3](./minimum.md)）。

`go.sum` 保证明天下载的代码与今天相同，却无法验证第一次下载。Cox 与 Valsorda 把这比作 SSH
的「首次使用时信任」：第一次添加或升级依赖时，`go` 命令只能相信自己下载到的就是正确的代码，
再把它的哈希写进 `go.sum`。两人在 2019 年的设计中给「正确」下了一个定义
[[Cox and Valsorda, 2019](#ref-cox-and-valsorda-2019)]：

```text
For our purposes, "correct" for a particular module version download is
defined as the same code everyone else downloads.
```

也就是说，某个模块版本的正确下载，就是与其他所有人下载到的相同的代码。按照这一定义，
无须为每个作者分配密钥，只需一个列出所有公开模块版本哈希的全局 `go.sum`。
为了不让这个全局文件成为新的攻击目标，校验和数据库 `sum.golang.org` 采用了证书透明度（Certificate
Transparency）所用的透明日志：日志以 Merkle 树组织，客户端可以验证某条记录确实在日志中、
服务器从未删除过记录，独立的审计者则可以检查记录本身是否正确。`go` 命令会缓存最近见过的签名树头，
一旦发现两个不一致的树头，就报错并让构建失败。这样，代码托管服务与模块代理都被移出了可信计算基：
它们可以停止提供某个版本，却无法替换其内容 [[Cox and Valsorda, 2019](#ref-cox-and-valsorda-2019)]。

Go 1.13 把模块代理与校验和数据库设为默认 [[Go Authors, 2019](#ref-go-authors-2019)]。
私有模块不应查询公共数据库，否则会泄露内部的导入路径，因此需要通过 `GOPRIVATE` 或 `GONOSUMDB` 列出；
数据库无法提供某个模块的记录时，`go` 命令视为硬性失败，以免攻击者通过阻断数据库让任意代码看起来都是真的
[[Cox and Valsorda, 2019](#ref-cox-and-valsorda-2019)]。至此，17.1 提出的可重复构建有了两层保证：MVS
使版本的选择不随时间变化，`go.sum` 与校验和数据库使同一版本的内容不随时间变化。

## 17.4.7 小结

`dep` 与 vgo 的分歧，既是技术上的，也是程序上的。技术上，双方在模块路径、去除 `GOPATH`、
模块代理等大多数问题上意见一致，分歧集中在版本选择算法、多个主版本能否共存，
以及依赖能否声明全局生效的不兼容；这些问题在 17.2 与 17.3 中已经分别从 Cox 的角度讨论过，Boyer
的分析则给出了另一方的理由。程序上，Cox 承认最大的错误是没有更公开地说明自己对 `dep` 的顾虑，Bourgon
则把问题归结为 Go 项目如何解决设计分歧；双方都接受的解释是，两边在很长时间里各自进行着不同的对话。此后的
Go 模块在默认行为、安全性与规模上不断演进，`dep` 则在 2020 年归档。

## 延伸阅读

- <a id="ref-bourgon-2018"></a>[Bourgon, 2018] Peter Bourgon. *A response about dep and vgo.* 2018-07-27.
  https://peter.bourgon.org/blog/2018/07/27/a-response-about-dep-and-vgo.html
  逐条转录并回应 Cox 在 2018 年 7 月 26 日发布的推文，文末附有补记。
- <a id="ref-boyer-2016"></a>[Boyer, 2016] Sam Boyer. *The Saga of Go Dependency Management.* Gopher
  Academy Blog, 2016-12-13. https://blog.gopheracademy.com/advent-2016/saga-go-dependency-management/
  包管理委员会的成立、工作方法与目标。
- <a id="ref-boyer-2018"></a>[Boyer, 2018] Sam Boyer. *An Analysis of Vgo.* 2018-05-14.
  https://sdboyer.io/vgo/intro/
  存档：https://web.archive.org/web/20180708073730/https://sdboyer.io/vgo/intro/
  `dep` 一方对 vgo 最完整的技术评价。
- <a id="ref-boyer-et-al-2020"></a>[Boyer et al., 2020] Sam Boyer 等.
  *dep：Go 依赖管理工具（官方实验，现已归档）.* https://github.com/golang/dep
  README 说明 `dep` 已于 2020 年弃用并归档；版本约束的写法见仓库中的 `docs/Gopkg.toml.md`。
- <a id="ref-bui-palsulich-and-compton-2019"></a>[Bui-Palsulich and Compton, 2019] Tyler Bui-Palsulich,
  Eno Compton. *Using Go Modules（官方博客系列）.* 2019-03-19. https://go.dev/blog/using-go-modules
- <a id="ref-cox-2017a"></a>[Cox, 2017a] Russ Cox. *Go package management meeting notes - June 13, 2017.*
  https://research.swtch.com/go-pkg-june-2017-notes.html
  2018 年公开；同时公开的还有会议讨论的草稿 https://research.swtch.com/go-pkg-june-2017.html 。
- <a id="ref-cox-2017b"></a>[Cox, 2017b] Russ Cox. *Import Versioning（草稿）.* 2017-11-20.
  https://research.swtch.com/impver-draft-20171120.pdf
  语义化导入版本的早期草稿。
- <a id="ref-cox-2018a"></a>[Cox, 2018a] Russ Cox. *Go & Versioning（vgo 系列，2018 年 2 月，共七篇）.*
  https://research.swtch.com/vgo 。其中 *Minimal Version Selection*（<https://research.swtch.com/vgo-mvs>）
  给出 MVS 限定在 Horn 公式子类、避开 NP 完全的论证，*Semantic
  Import Versioning*（<https://research.swtch.com/vgo-import>）阐述主版本进路径的设计。
  系列目录还列出了提案的提交与接受日期，以及此后的续篇。
- <a id="ref-cox-2018b"></a>[Cox, 2018b] Russ Cox. *Go += Package Versioning.* 2018-02-20.
  https://research.swtch.com/vgo-intro
  vgo 系列第一篇，回顾 `go get`、vendor 工具与包管理委员会的历史。
- <a id="ref-cox-2018c"></a>[Cox, 2018c] Russ Cox. *The vgo proposal is accepted. Now what?* 2018-05-29.
  https://research.swtch.com/vgo-accepted
- <a id="ref-cox-2019"></a>[Cox, 2019] Russ Cox. *The Principles of Versioning in Go.* 2019-12-03.
  https://research.swtch.com/vgo-principles
- <a id="ref-cox-and-valsorda-2019"></a>[Cox and Valsorda, 2019] Russ Cox, Filippo Valsorda. *Proposal:
  Secure the Public Go Module Ecosystem.* 2019. https://go.dev/design/25530-sumdb
  `go.sum` 的信任问题与校验和数据库的设计。
- <a id="ref-go-authors-2018"></a>[Go Authors, 2018] The Go Authors. *Go 1.11 Release
  Notes（模块的实验性初步支持）.* https://go.dev/doc/go1.11
- <a id="ref-go-authors-2019"></a>[Go Authors, 2019] The Go Authors. *Go 1.13 Release Notes.*
  https://go.dev/doc/go1.13#modules
- <a id="ref-go-authors-2020"></a>[Go Authors, 2020] The Go Authors. *Go 1.14 Release Notes.*
  https://go.dev/doc/go1.14#introduction
- <a id="ref-go-authors-2021"></a>[Go Authors, 2021] The Go Authors. *Go 1.16 Release Notes（GO111MODULE
  默认 on，模块成为缺省）.* https://go.dev/doc/go1.16
- <a id="ref-go-authors-2024"></a>[Go Authors, 2024] The Go Authors. *Go 1.22 Release Notes.*
  https://go.dev/doc/go1.22#go-command
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. src/cmd/go.sum. Go 1.26 源码.
  https://github.com/golang/go/blob/release-branch.go1.26/src/cmd/go.sum
- <a id="ref-go-authors-nd"></a>[Go Authors, n.d.] The Go Authors. *Go Modules Reference（cmd/go
  模块机制的权威说明）.* https://go.dev/ref/mod
- 本书 [17.1 依赖管理的难点](./challenges.md)、[17.2 语义化版本管理](./semantics.md)、[17.3
  最小版本选择算法](./minimum.md)，与 [1 设计哲学与历史](../../part1overview/ch01intro/readme.md)。
