# 离线书构建（PDF / EPUB）

本目录把 `book/zh-cn/` 下按章节组织的 Markdown 源，编译成单一的 PDF 与 EPUB。

## 流水线

```
book/zh-cn/**/*.md
   │  assemble.go      按 weight 排序、剥离 front matter 与重复的许可页脚，合并为单文件
   ▼
build/book.md
   │  mermaid-cli      把每个 ```mermaid 代码块渲染成 PNG 并替换为图片引用
   ▼
build/book.rendered.md
   │  pandoc           生成 PDF（xelatex）与 EPUB
   ▼
dist/under-the-hood.pdf, dist/under-the-hood.epub
```

## 依赖

- **go**（运行 `assemble.go`）
- **node / npx**（[`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli)，按需自动拉取）
- **pandoc** 3.x
- **xelatex**（TeX Live / MacTeX，仅 PDF 需要；EPUB 只用 pandoc）
- 一款中文字体。默认用 macOS 自带的 `Hiragino Sans GB`；其它平台用 `CJK_MAIN` / `CJK_MONO` 覆盖。

## 使用

```bash
make            # 同时构建 PDF 与 EPUB，输出到 dist/
make pdf
make epub
make clean

# 非 macOS（例如装了 fonts-noto-cjk 的 Linux）：
make CJK_MAIN="Noto Sans CJK SC" LATIN="DejaVu Serif" MONO="DejaVu Sans Mono"
```

产物写入 `dist/`，中间文件写入 `build/`，两者都不纳入版本控制（见 `.gitignore`）。

## 持续集成与发布

两条流水线都在 Ubuntu 上安装上述工具链（pandoc、texlive-xetex、`fonts-noto-cjk`、
mermaid-cli），并用 `CJK_MAIN`/`CJK_MONO=Noto Sans CJK SC` 构建：

- **`.github/workflows/book.yml`**：每次改动 `book/` 或 `tools/book/` 时构建 PDF 与 EPUB，
  作为构建产物（artifact）上传，用于日常校验。
- **`.github/workflows/release.yml`**：推送 `v*` 版本标签时触发，构建后自动创建 GitHub
  Release，并把带版本号的 PDF 与 EPUB 作为发布附件上传。

发布一个版本：

```bash
git tag v1.26.0
git push origin v1.26.0
```

随后在仓库的 Releases 页面即可下载自动编译好的 `under-the-hood-v1.26.0.pdf` 与 `.epub`。

## 已知限制

- 章节之间的相对 Markdown 链接（如 `[9.7](../ch09sched/preemption.md)`）在离线版里
  不会跳转，仅作为文本保留。
- 极少数特殊数学符号（如 `⇒ ∅ ⨟ 𝓤`）受字体覆盖所限，可能不显示，仅出现在个别示例中，
  不影响正文阅读。
