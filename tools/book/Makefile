# Build 《Go 语言原本》 as PDF and EPUB from the Hugo Markdown sources.
#
# Pipeline:
#   1. assemble.go   collect + order sections by `weight`, strip front matter
#   2. mermaid-cli   render every ```mermaid block to a PNG, rewrite to an image
#   3. pandoc        produce the PDF (xelatex) and EPUB
#
# Requirements: go, node/npx (for mermaid-cli), pandoc, and a TeX engine
# (xelatex, e.g. TeX Live / MacTeX) for the PDF target. EPUB needs only pandoc.
#
# Usage:
#   make            # build both PDF and EPUB into dist/
#   make pdf
#   make epub
#   make clean
#
# Fonts default to macOS "Hiragino Sans GB"; override for other platforms, e.g.
#   make CJK_MAIN="Noto Sans CJK SC"

BOOK_SRC ?= ../../book/zh-cn
BUILD    ?= build
DIST     ?= dist
COVER    ?= ../../book/assets/cover-cn-v3.png

CJK_MAIN ?= Hiragino Sans GB
LATIN    ?= Helvetica Neue
MONO     ?= Menlo

MMDC   ?= npx -y @mermaid-js/mermaid-cli
PANDOC ?= pandoc

COMBINED := $(BUILD)/book.md
RENDERED := $(BUILD)/book.rendered.md
PDF      := $(DIST)/under-the-hood.pdf
EPUB     := $(DIST)/under-the-hood.epub

SOURCES := $(shell find $(BOOK_SRC) -name '*.md')

.PHONY: all pdf epub clean
all: pdf epub

# 1. assemble
$(COMBINED): assemble.go $(SOURCES)
	go run assemble.go -src $(BOOK_SRC) -out $(COMBINED)

# 2. render mermaid blocks to PNG (one browser session for all diagrams)
$(RENDERED): $(COMBINED) mermaid-config.json puppeteer-config.json
	$(MMDC) -i $(COMBINED) -o $(RENDERED) -e png -b white -s 2 \
	  -c mermaid-config.json -p puppeteer-config.json

# 3a. PDF via xelatex
pdf: $(PDF)
$(PDF): $(RENDERED) header.tex metadata.yaml
	@mkdir -p $(DIST)
	$(PANDOC) $(RENDERED) metadata.yaml \
	  --resource-path=.:$(BUILD) \
	  --pdf-engine=xelatex \
	  -H header.tex \
	  --toc --toc-depth=2 \
	  --top-level-division=section \
	  -V CJKmainfont="$(CJK_MAIN)" \
	  -V mainfont="$(LATIN)" -V monofont="$(MONO)" \
	  -o $(PDF)
	@echo "built $(PDF)"

# 3b. EPUB (no TeX needed)
epub: $(EPUB)
$(EPUB): $(RENDERED) metadata.yaml
	@mkdir -p $(DIST)
	$(PANDOC) $(RENDERED) metadata.yaml \
	  --resource-path=.:$(BUILD) \
	  --toc --toc-depth=2 \
	  --top-level-division=section \
	  --mathml \
	  --epub-cover-image=$(COVER) \
	  -o $(EPUB)
	@echo "built $(EPUB)"

clean:
	rm -rf $(BUILD) $(DIST)
